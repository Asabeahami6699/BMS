import { formatAccountAmount } from "@bms/shared";
import { randomUUID } from "node:crypto";
import type { CalloverReportLineInput, SubmitCalloverInput } from "./calloverReportService.js";
import {
  extractReportedDifferences,
  getCalloverReportById,
  getLatestUnreviewedCalloverReport,
  markCalloverReportsReviewed,
  submitCalloverReport
} from "./calloverReportService.js";
import { getCustomerById } from "./customerService.js";
import { getSupabaseAdminClient } from "../config/supabaseClient.js";
import { beginIdempotency } from "../middleware/idempotency.js";
import { createTransaction, listTransactions } from "./transactionService.js";
import { createAgentNotification, notifyTenantStaff } from "./notificationService.js";
import { openCashVarianceFromBatch } from "./cashVarianceService.js";
import { listUsersByTenant } from "./authStore.js";
import { z } from "zod";

export type CollectionBatchStatus = "draft" | "pending_approval" | "posted" | "rejected";

export type CollectionBatchLine = {
  id: string;
  customerId: string;
  amount: number;
  notes?: string;
  clientLineId?: string;
  transactionId?: string;
  createdAt: string;
};

export type CashVarianceStatus = "balanced" | "shortage" | "overage";

export type CollectionBatch = {
  id: string;
  tenantId: string;
  fieldAgentId: string;
  businessDate: string;
  batchSequence: number;
  status: CollectionBatchStatus;
  totalAmount: number;
  lineCount: number;
  calloverReportId?: string;
  agentNotes?: string;
  submittedAt?: string;
  postedAt?: string;
  postedBy?: string;
  cashReceivedAmount?: number;
  cashVariance?: number;
  cashVarianceStatus?: CashVarianceStatus;
  cashReceivedAt?: string;
  cashReceivedBy?: string;
  unlockedBy?: string;
  unlockReason?: string;
  unlockedAt?: string;
  lines: CollectionBatchLine[];
};

export function computeCashVariance(
  batchTotal: number,
  cashReceived: number
): { variance: number; status: CashVarianceStatus } {
  const variance = Math.round((cashReceived - batchTotal) * 100) / 100;
  if (Math.abs(variance) < 0.005) {
    return { variance: 0, status: "balanced" };
  }
  if (variance < 0) {
    return { variance, status: "shortage" };
  }
  return { variance, status: "overage" };
}

export type FieldAgentTodayCollection = {
  customerId: string;
  amount: number;
  createdAt: string;
  entryCount?: number;
};

export type PriorUnsubmittedBatchSummary = {
  id: string;
  businessDate: string;
  status: CollectionBatchStatus;
  totalAmount: number;
  lineCount: number;
};

export type FieldAgentTodayCollections = {
  customerIds: string[];
  totalAmount: number;
  items: FieldAgentTodayCollection[];
  batchStatus?: CollectionBatchStatus;
  batchId?: string;
  batchSequence?: number;
  postedBatchesTodayCount?: number;
  postedTotalToday?: number;
  combinedTotalToday?: number;
  /** Customer ID → total already posted today in earlier batches by this agent (used for Batch #2 duplicate guard). */
  postedCustomerTotalsToday?: Record<string, number>;
  unlockReason?: string;
  /** Earlier-date draft/rejected batches with recorded lines that were never submitted. */
  priorUnsubmittedBatches?: PriorUnsubmittedBatchSummary[];
};

export type SameDayDuplicateMatch = {
  lineId: string;
  customerId: string;
  customerName: string;
  accountNumber?: string;
  lineAmount: number;
  existingAmount: number;
  exactAmountMatch: boolean;
  source: "posted_batch" | "counter_or_initial_deposit" | "same_batch";
  existingNotes?: string;
  existingCreatedAt: string;
};

type AgentContext = {
  tenantId: string;
  userId: string;
  role: string;
  branchId?: string;
};

type CoordinatorContext = {
  tenantId: string;
  userId: string;
  role: string;
  branchId?: string;
  scopeType: "head_office" | "branch";
};

const addLineSchema = z.object({
  customerId: z.string().min(1),
  amount: z.number().positive(),
  transactionBranchId: z.string().min(1),
  notes: z.string().optional(),
  clientLineId: z.string().optional()
});

const memoryBatches = new Map<string, CollectionBatch>();

function todayDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function isMissingSequenceColumnError(message?: string): boolean {
  return Boolean(message && /batch_sequence|unlocked_by|unlock_reason|unlocked_at/i.test(message));
}

function findMemoryBatchesForAgentDate(
  tenantId: string,
  agentId: string,
  date: string
): CollectionBatch[] {
  return [...memoryBatches.values()]
    .filter((b) => b.tenantId === tenantId && b.fieldAgentId === agentId && b.businessDate === date)
    .sort((a, b) => b.batchSequence - a.batchSequence);
}

function findLatestMemoryBatch(
  tenantId: string,
  agentId: string,
  date: string
): CollectionBatch | null {
  return findMemoryBatchesForAgentDate(tenantId, agentId, date)[0] ?? null;
}

function aggregateItems(lines: CollectionBatchLine[]): FieldAgentTodayCollection[] {
  const grouped = new Map<
    string,
    { amount: number; firstCreatedAt: string; entryCount: number; order: number }
  >();
  let order = 0;
  for (const line of lines) {
    const existing = grouped.get(line.customerId);
    if (!existing) {
      grouped.set(line.customerId, {
        amount: line.amount,
        firstCreatedAt: line.createdAt,
        entryCount: 1,
        order: order++
      });
      continue;
    }
    existing.amount += line.amount;
    existing.entryCount += 1;
    if (line.createdAt < existing.firstCreatedAt) {
      existing.firstCreatedAt = line.createdAt;
    }
  }
  return [...grouped.entries()]
    .sort(([, a], [, b]) => {
      const cmp = a.firstCreatedAt.localeCompare(b.firstCreatedAt);
      return cmp !== 0 ? cmp : a.order - b.order;
    })
    .map(([customerId, row]) => ({
      customerId,
      amount: row.amount,
      createdAt: row.firstCreatedAt,
      entryCount: row.entryCount
    }));
}

function toTodayCollections(
  batch: CollectionBatch | null,
  postedSummary?: {
    count: number;
    totalAmount: number;
    customerTotals?: Record<string, number>;
  }
): FieldAgentTodayCollections {
  const postedCount = postedSummary?.count ?? (batch?.status === "posted" ? 1 : 0);
  const postedTotal =
    postedSummary?.totalAmount ?? (batch?.status === "posted" ? batch.totalAmount : 0);
  const postedCustomerTotalsToday =
    postedSummary?.customerTotals && Object.keys(postedSummary.customerTotals).length > 0
      ? postedSummary.customerTotals
      : undefined;
  if (!batch) {
    return {
      customerIds: [],
      totalAmount: 0,
      items: [],
      postedBatchesTodayCount: postedCount,
      postedTotalToday: postedTotal,
      combinedTotalToday: postedTotal,
      ...(postedCustomerTotalsToday ? { postedCustomerTotalsToday } : {})
    };
  }
  const combinedTotalToday =
    batch.status === "posted"
      ? postedTotal
      : Math.round((postedTotal + batch.totalAmount) * 100) / 100;
  if (batch.lines.length === 0) {
    return {
      customerIds: [],
      totalAmount: batch.totalAmount,
      items: [],
      batchStatus: batch.status,
      batchId: batch.id,
      batchSequence: batch.batchSequence,
      postedBatchesTodayCount: postedCount,
      postedTotalToday: postedTotal,
      combinedTotalToday,
      ...(postedCustomerTotalsToday ? { postedCustomerTotalsToday } : {}),
      unlockReason: batch.unlockReason
    };
  }
  const items = aggregateItems(batch.lines);
  return {
    customerIds: items.map((i) => i.customerId),
    totalAmount: batch.totalAmount,
    items,
    batchStatus: batch.status,
    batchId: batch.id,
    batchSequence: batch.batchSequence,
    postedBatchesTodayCount: postedCount,
    postedTotalToday: postedTotal,
    combinedTotalToday,
    ...(postedCustomerTotalsToday ? { postedCustomerTotalsToday } : {}),
    unlockReason: batch.unlockReason
  };
}

async function hydrateBatchFromRow(batchRow: Record<string, unknown>): Promise<CollectionBatch> {
  const supabase = getSupabaseAdminClient();
  const lines: CollectionBatchLine[] = [];
  if (supabase) {
    const { data: lineRows, error: lineErr } = await supabase
      .from("field_agent_collection_batch_lines")
      .select("id, customer_id, amount, notes, client_line_id, transaction_id, created_at")
      .eq("batch_id", String(batchRow.id))
      .order("created_at", { ascending: true });

    if (lineErr) {
      throw new Error(`Failed to load batch lines: ${lineErr.message}`);
    }

    for (const row of lineRows ?? []) {
      lines.push({
        id: String(row.id),
        customerId: String(row.customer_id),
        amount: Number(row.amount),
        notes: row.notes ?? undefined,
        clientLineId: row.client_line_id ?? undefined,
        transactionId: row.transaction_id ?? undefined,
        createdAt: row.created_at
      });
    }
  }

  const computedTotal = Math.round(lines.reduce((sum, l) => sum + l.amount, 0) * 100) / 100;

  return {
    id: String(batchRow.id),
    tenantId: String(batchRow.tenant_id),
    fieldAgentId: String(batchRow.field_agent_id),
    businessDate: String(batchRow.business_date).slice(0, 10),
    batchSequence: Math.max(1, Number(batchRow.batch_sequence ?? 1)),
    status: batchRow.status as CollectionBatchStatus,
    totalAmount: computedTotal,
    lineCount: lines.length,
    calloverReportId: (batchRow.callover_report_id as string | null) ?? undefined,
    agentNotes: (batchRow.agent_notes as string | null) ?? undefined,
    submittedAt: (batchRow.submitted_at as string | null) ?? undefined,
    postedAt: (batchRow.posted_at as string | null) ?? undefined,
    postedBy: (batchRow.posted_by as string | null) ?? undefined,
    cashReceivedAmount:
      batchRow.cash_received_amount != null ? Number(batchRow.cash_received_amount) : undefined,
    cashVariance: batchRow.cash_variance != null ? Number(batchRow.cash_variance) : undefined,
    cashVarianceStatus: (batchRow.cash_variance_status as CashVarianceStatus | null) ?? undefined,
    cashReceivedAt: (batchRow.cash_received_at as string | null) ?? undefined,
    cashReceivedBy: (batchRow.cash_received_by as string | null) ?? undefined,
    unlockedBy: (batchRow.unlocked_by as string | null) ?? undefined,
    unlockReason: (batchRow.unlock_reason as string | null) ?? undefined,
    unlockedAt: (batchRow.unlocked_at as string | null) ?? undefined,
    lines
  };
}

async function loadBatchById(tenantId: string, batchId: string): Promise<CollectionBatch | null> {
  const supabase = getSupabaseAdminClient();
  if (supabase) {
    const { data: batchRow, error } = await supabase
      .from("field_agent_collection_batches")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("id", batchId)
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to load collection batch: ${error.message}`);
    }
    if (!batchRow) {
      return null;
    }
    return hydrateBatchFromRow(batchRow as Record<string, unknown>);
  }

  const found = memoryBatches.get(batchId);
  return found && found.tenantId === tenantId ? found : null;
}

async function loadBatchRow(
  tenantId: string,
  fieldAgentId: string,
  businessDate: string
): Promise<CollectionBatch | null> {
  const supabase = getSupabaseAdminClient();
  if (supabase) {
    let { data: rows, error } = await supabase
      .from("field_agent_collection_batches")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("field_agent_id", fieldAgentId)
      .eq("business_date", businessDate)
      .order("batch_sequence", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(1);

    if (error && isMissingSequenceColumnError(error.message)) {
      const retry = await supabase
        .from("field_agent_collection_batches")
        .select("*")
        .eq("tenant_id", tenantId)
        .eq("field_agent_id", fieldAgentId)
        .eq("business_date", businessDate)
        .order("created_at", { ascending: false })
        .limit(1);
      rows = retry.data;
      error = retry.error;
    }

    if (error) {
      throw new Error(`Failed to load collection batch: ${error.message}`);
    }
    const batchRow = rows?.[0];
    if (!batchRow) {
      return null;
    }
    return hydrateBatchFromRow(batchRow as Record<string, unknown>);
  }

  return findLatestMemoryBatch(tenantId, fieldAgentId, businessDate);
}

async function loadPostedSummaryForDay(
  tenantId: string,
  fieldAgentId: string,
  businessDate: string
): Promise<{ count: number; totalAmount: number; customerTotals: Record<string, number> }> {
  const supabase = getSupabaseAdminClient();
  if (supabase) {
    const { data, error } = await supabase
      .from("field_agent_collection_batches")
      .select("id, total_amount")
      .eq("tenant_id", tenantId)
      .eq("field_agent_id", fieldAgentId)
      .eq("business_date", businessDate)
      .eq("status", "posted");
    if (error) {
      return { count: 0, totalAmount: 0, customerTotals: {} };
    }
    const rows = data ?? [];
    const totalAmount =
      Math.round(rows.reduce((sum, r) => sum + Number(r.total_amount ?? 0), 0) * 100) / 100;
    const customerTotals: Record<string, number> = {};
    const postedBatchIds = rows.map((r) => String(r.id));
    if (postedBatchIds.length > 0) {
      const { data: lineRows } = await supabase
        .from("field_agent_collection_batch_lines")
        .select("customer_id, amount")
        .in("batch_id", postedBatchIds);
      for (const lr of lineRows ?? []) {
        const cid = String(lr.customer_id);
        customerTotals[cid] =
          Math.round(((customerTotals[cid] ?? 0) + Number(lr.amount ?? 0)) * 100) / 100;
      }
    }
    return { count: rows.length, totalAmount, customerTotals };
  }

  const posted = findMemoryBatchesForAgentDate(tenantId, fieldAgentId, businessDate).filter(
    (b) => b.status === "posted"
  );
  const customerTotals: Record<string, number> = {};
  for (const b of posted) {
    for (const l of b.lines) {
      customerTotals[l.customerId] =
        Math.round(((customerTotals[l.customerId] ?? 0) + l.amount) * 100) / 100;
    }
  }
  return {
    count: posted.length,
    totalAmount: Math.round(posted.reduce((sum, b) => sum + b.totalAmount, 0) * 100) / 100,
    customerTotals
  };
}

type BatchHeader = {
  id: string;
  tenantId: string;
  fieldAgentId: string;
  businessDate: string;
  batchSequence: number;
  status: CollectionBatchStatus;
  totalAmount: number;
  lineCount: number;
};

async function loadBatchHeader(
  tenantId: string,
  fieldAgentId: string,
  businessDate: string
): Promise<BatchHeader | null> {
  const supabase = getSupabaseAdminClient();
  if (supabase) {
    let { data: rows, error } = await supabase
      .from("field_agent_collection_batches")
      .select("id, tenant_id, field_agent_id, business_date, batch_sequence, status, total_amount, line_count")
      .eq("tenant_id", tenantId)
      .eq("field_agent_id", fieldAgentId)
      .eq("business_date", businessDate)
      .order("batch_sequence", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(1);

    if (error && isMissingSequenceColumnError(error.message)) {
      const retry = await supabase
        .from("field_agent_collection_batches")
        .select("id, tenant_id, field_agent_id, business_date, status, total_amount, line_count")
        .eq("tenant_id", tenantId)
        .eq("field_agent_id", fieldAgentId)
        .eq("business_date", businessDate)
        .order("created_at", { ascending: false })
        .limit(1);
      rows = retry.data as typeof rows;
      error = retry.error;
    }

    if (error) {
      throw new Error(`Failed to load collection batch: ${error.message}`);
    }
    const batchRow = rows?.[0];
    if (!batchRow) {
      return null;
    }

    return {
      id: String(batchRow.id),
      tenantId: batchRow.tenant_id,
      fieldAgentId: batchRow.field_agent_id,
      businessDate: String(batchRow.business_date).slice(0, 10),
      batchSequence: Math.max(1, Number((batchRow as { batch_sequence?: unknown }).batch_sequence ?? 1)),
      status: batchRow.status as CollectionBatchStatus,
      totalAmount: Number(batchRow.total_amount ?? 0),
      lineCount: Number(batchRow.line_count ?? 0)
    };
  }

  const batch = findLatestMemoryBatch(tenantId, fieldAgentId, businessDate);
  if (!batch) {
    return null;
  }
  return {
    id: batch.id,
    tenantId: batch.tenantId,
    fieldAgentId: batch.fieldAgentId,
    businessDate: batch.businessDate,
    batchSequence: batch.batchSequence,
    status: batch.status,
    totalAmount: batch.totalAmount,
    lineCount: batch.lineCount
  };
}

async function markBatchPendingApproval(
  batch: BatchHeader,
  calloverReportId: string,
  agentNotes?: string
): Promise<void> {
  const submittedAt = new Date().toISOString();
  const supabase = getSupabaseAdminClient();
  if (supabase) {
    const { error } = await supabase
      .from("field_agent_collection_batches")
      .update({
        status: "pending_approval",
        submitted_at: submittedAt,
        callover_report_id: calloverReportId,
        agent_notes: agentNotes ?? null,
        updated_at: submittedAt
      })
      .eq("id", batch.id);
    if (error) {
      throw new Error(`Failed to submit collection batch: ${error.message}`);
    }
    return;
  }

  const memoryBatch = memoryBatches.get(batch.id);
  if (memoryBatch) {
    memoryBatch.status = "pending_approval";
    memoryBatch.submittedAt = submittedAt;
    memoryBatch.calloverReportId = calloverReportId;
    memoryBatch.agentNotes = agentNotes;
  }
}

async function persistBatch(batch: CollectionBatch): Promise<void> {
  const supabase = getSupabaseAdminClient();
  if (supabase) {
    const fullRow = {
      id: batch.id,
      tenant_id: batch.tenantId,
      field_agent_id: batch.fieldAgentId,
      business_date: batch.businessDate,
      batch_sequence: batch.batchSequence,
      status: batch.status,
      total_amount: batch.totalAmount,
      line_count: batch.lineCount,
      callover_report_id: batch.calloverReportId ?? null,
      agent_notes: batch.agentNotes ?? null,
      submitted_at: batch.submittedAt ?? null,
      posted_at: batch.postedAt ?? null,
      posted_by: batch.postedBy ?? null,
      cash_received_amount: batch.cashReceivedAmount ?? null,
      cash_variance: batch.cashVariance ?? null,
      cash_variance_status: batch.cashVarianceStatus ?? null,
      cash_received_at: batch.cashReceivedAt ?? null,
      cash_received_by: batch.cashReceivedBy ?? null,
      unlocked_by: batch.unlockedBy ?? null,
      unlock_reason: batch.unlockReason ?? null,
      unlocked_at: batch.unlockedAt ?? null,
      updated_at: new Date().toISOString()
    };

    let { error } = await supabase
      .from("field_agent_collection_batches")
      .upsert(fullRow, { onConflict: "id" });

    if (error && isMissingSequenceColumnError(error.message)) {
      const legacyRow = {
        id: fullRow.id,
        tenant_id: fullRow.tenant_id,
        field_agent_id: fullRow.field_agent_id,
        business_date: fullRow.business_date,
        status: fullRow.status,
        total_amount: fullRow.total_amount,
        line_count: fullRow.line_count,
        callover_report_id: fullRow.callover_report_id,
        agent_notes: fullRow.agent_notes,
        submitted_at: fullRow.submitted_at,
        posted_at: fullRow.posted_at,
        posted_by: fullRow.posted_by,
        cash_received_amount: fullRow.cash_received_amount,
        cash_variance: fullRow.cash_variance,
        cash_variance_status: fullRow.cash_variance_status,
        cash_received_at: fullRow.cash_received_at,
        cash_received_by: fullRow.cash_received_by,
        updated_at: fullRow.updated_at
      };
      const retry = await supabase
        .from("field_agent_collection_batches")
        .upsert(legacyRow, { onConflict: "id" });
      error = retry.error;
    }

    if (error) {
      throw new Error(`Failed to save collection batch: ${error.message}`);
    }
    return;
  }
  memoryBatches.set(batch.id, batch);
}

async function getOrCreateDraftBatch(
  tenantId: string,
  fieldAgentId: string,
  businessDate: string
): Promise<CollectionBatch> {
  const existing = await loadBatchRow(tenantId, fieldAgentId, businessDate);
  if (existing) {
    if (existing.status === "posted") {
      throw new Error(
        "Today's collections are already posted. Ask your coordinator to unlock an extra batch if you need to collect more today."
      );
    }
    if (existing.status === "pending_approval") {
      throw new Error("Collections are awaiting coordinator approval. Wait for posting before adding more.");
    }
    return existing;
  }

  const batch: CollectionBatch = {
    id: randomUUID(),
    tenantId,
    fieldAgentId,
    businessDate,
    batchSequence: 1,
    status: "draft",
    totalAmount: 0,
    lineCount: 0,
    lines: []
  };
  await persistBatch(batch);
  return batch;
}

async function listAgentPriorUnsubmittedBatches(
  tenantId: string,
  fieldAgentId: string,
  beforeDate: string
): Promise<PriorUnsubmittedBatchSummary[]> {
  const supabase = getSupabaseAdminClient();
  if (supabase) {
    const { data, error } = await supabase
      .from("field_agent_collection_batches")
      .select("id, business_date, status, total_amount, line_count")
      .eq("tenant_id", tenantId)
      .eq("field_agent_id", fieldAgentId)
      .lt("business_date", beforeDate)
      .in("status", ["draft", "rejected"])
      .gt("line_count", 0)
      .order("business_date", { ascending: true })
      .limit(14);
    if (error) {
      return [];
    }
    return (data ?? []).map((row) => ({
      id: String(row.id),
      businessDate: String(row.business_date).slice(0, 10),
      status: row.status as CollectionBatchStatus,
      totalAmount: Number(row.total_amount ?? 0),
      lineCount: Number(row.line_count ?? 0)
    }));
  }

  const out: PriorUnsubmittedBatchSummary[] = [];
  for (const b of memoryBatches.values()) {
    if (
      b.tenantId === tenantId &&
      b.fieldAgentId === fieldAgentId &&
      b.businessDate < beforeDate &&
      (b.status === "draft" || b.status === "rejected") &&
      b.lineCount > 0
    ) {
      out.push({
        id: b.id,
        businessDate: b.businessDate,
        status: b.status,
        totalAmount: b.totalAmount,
        lineCount: b.lineCount
      });
    }
  }
  return out.sort((a, b) => a.businessDate.localeCompare(b.businessDate));
}

export async function getAgentTodayCollections(context: AgentContext): Promise<FieldAgentTodayCollections> {
  const businessDate = todayDate();
  const [batch, postedSummary, priorUnsubmittedBatches] = await Promise.all([
    loadBatchRow(context.tenantId, context.userId, businessDate),
    loadPostedSummaryForDay(context.tenantId, context.userId, businessDate),
    listAgentPriorUnsubmittedBatches(context.tenantId, context.userId, businessDate)
  ]);
  return {
    ...toTodayCollections(batch, postedSummary),
    priorUnsubmittedBatches
  };
}

export async function addCollectionBatchLine(
  context: AgentContext,
  input: unknown
): Promise<FieldAgentTodayCollections> {
  const payload = addLineSchema.parse(input);
  const customer = await getCustomerById(context.tenantId, payload.customerId);
  if (!customer) {
    throw new Error("Customer not found");
  }
  if (customer.status !== "active") {
    throw new Error("Customer is not active");
  }
  if (context.role === "field_agent" && customer.assignedFieldAgentId !== context.userId) {
    throw new Error("This customer is not assigned to you");
  }

  const businessDate = todayDate();
  const batch = await getOrCreateDraftBatch(context.tenantId, context.userId, businessDate);
  const postedSummary = await loadPostedSummaryForDay(context.tenantId, context.userId, businessDate);

  if (payload.clientLineId) {
    const dup = batch.lines.find((l) => l.clientLineId === payload.clientLineId);
    if (dup) {
      return toTodayCollections(batch, postedSummary);
    }
  }

  const line: CollectionBatchLine = {
    id: randomUUID(),
    customerId: payload.customerId,
    amount: payload.amount,
    notes: payload.notes,
    clientLineId: payload.clientLineId,
    createdAt: new Date().toISOString()
  };

  const supabase = getSupabaseAdminClient();
  if (supabase) {
    const { error } = await supabase.from("field_agent_collection_batch_lines").insert({
      id: line.id,
      batch_id: batch.id,
      tenant_id: context.tenantId,
      customer_id: line.customerId,
      amount: line.amount,
      notes: line.notes ?? null,
      client_line_id: line.clientLineId ?? null
    });
    if (error) {
      throw new Error(`Failed to save collection line: ${error.message}`);
    }
  }

  batch.lines.push(line);
  batch.totalAmount = Math.round(batch.lines.reduce((sum, l) => sum + l.amount, 0) * 100) / 100;
  batch.lineCount = batch.lines.length;
  await persistBatch(batch);

  return toTodayCollections(batch, postedSummary);
}

export async function submitCollectionBatchForApproval(
  context: AgentContext,
  calloverInput: Partial<SubmitCalloverInput> & { businessDate?: string }
): Promise<{ batchId: string; status: CollectionBatchStatus; calloverReportId: string }> {
  const requestedDate =
    typeof calloverInput?.businessDate === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(calloverInput.businessDate.trim())
      ? calloverInput.businessDate.trim()
      : todayDate();
  const businessDate = requestedDate;
  const hasExplicitLines = Array.isArray(calloverInput?.lines) && calloverInput.lines.length > 0;
  let batch: BatchHeader | null = null;
  let loadedBatchLines: CollectionBatchLine[] = [];
  if (hasExplicitLines) {
    batch = await loadBatchHeader(context.tenantId, context.userId, businessDate);
  } else {
    const fullBatch = await loadBatchRow(context.tenantId, context.userId, businessDate);
    batch = fullBatch;
    loadedBatchLines = fullBatch?.lines ?? [];
  }
  if (!batch || batch.lineCount <= 0) {
    throw new Error("Record at least one collection before sending for approval");
  }
  if (batch.status !== "draft" && batch.status !== "rejected") {
    throw new Error("This batch cannot be submitted in its current status");
  }

  let effectiveLines = calloverInput.lines;
  let effectiveSummary = calloverInput.summary;
  if (!hasExplicitLines) {
    const byCustomer = new Map<string, number>();
    for (const line of loadedBatchLines) {
      byCustomer.set(
        line.customerId,
        Math.round(((byCustomer.get(line.customerId) ?? 0) + line.amount) * 100) / 100
      );
    }
    const customers = await Promise.all(
      [...byCustomer.keys()].map(async (cid) => {
        const c = await getCustomerById(context.tenantId, cid).catch(() => null);
        return [cid, c?.fullName ?? cid] as const;
      })
    );
    const nameMap = new Map(customers);
    effectiveLines = [...byCustomer.entries()].map(([customerId, amount]) => ({
      customerId,
      customerName: nameMap.get(customerId) ?? customerId,
      documentAmount: amount,
      appAmount: amount,
      varianceType: "match" as const
    }));
    const total = Math.round(effectiveLines.reduce((s, l) => s + l.appAmount, 0) * 100) / 100;
    effectiveSummary = {
      totalDocument: total,
      totalApp: total,
      totalVariance: 0,
      unresolvedCount: 0
    };
  }

  const callover = await submitCalloverReport(context.tenantId, context.userId, {
    ...calloverInput,
    lines: effectiveLines,
    summary: effectiveSummary,
    reportDate: calloverInput.reportDate ?? businessDate
  });
  await markBatchPendingApproval(batch, callover.id, calloverInput.agentNotes);

  void notifyTenantStaff({
    tenantId: context.tenantId,
    roles: ["admin", "coordinator"],
    kind: "collection_batch_pending",
    title: "Collection batch awaiting approval",
    body: `Field agent submitted GHS ${formatAccountAmount(batch.totalAmount)} for ${businessDate} (${batch.lineCount} lines).`
  }).catch(() => {
    /* non-blocking */
  });

  return { batchId: batch.id, status: "pending_approval", calloverReportId: callover.id };
}

export type PendingCollectionBatchView = CollectionBatch & {
  fieldAgentName: string;
  fieldAgentEmail?: string;
  branchId?: string;
  hasReportedDifferences?: boolean;
  reportedDifferences?: CalloverReportLineInput[];
  hasSameDayDuplicates?: boolean;
  sameDayDuplicates?: SameDayDuplicateMatch[];
};

function isSystemFeeOrLoanNote(notes: string | undefined): boolean {
  if (!notes) {
    return false;
  }
  const lower = notes.toLowerCase();
  return (
    lower.includes("susu_comm_tx:") ||
    lower.includes("susu_comm_refund:") ||
    lower.includes("sms_charge:") ||
    lower.includes("loan_disburse:") ||
    lower.includes("loan_repay:") ||
    lower.includes("loan_repay_reverse:")
  );
}

/**
 * Safeguard against duplicate same-day collections (e.g. an agent re-entering a Batch #1
 * customer in Batch #2, or entering a customer whose Savings initial deposit was already
 * credited on approval / at the counter today).
 */
export async function detectSameDayDuplicateLines(
  tenantId: string,
  batch: CollectionBatch
): Promise<SameDayDuplicateMatch[]> {
  if (!batch.lines || batch.lines.length === 0) {
    return [];
  }

  const customerIds = Array.from(new Set(batch.lines.map((l) => l.customerId)));
  const startIso = `${batch.businessDate}T00:00:00.000Z`;
  const endIso = `${batch.businessDate}T23:59:59.999Z`;
  const linkedTxIds = new Set(
    batch.lines.map((l) => l.transactionId).filter((id): id is string => Boolean(id))
  );

  type ExistingCredit = {
    id: string;
    customerId: string;
    amount: number;
    notes?: string;
    createdAt: string;
  };

  const existingByCustomer = new Map<string, ExistingCredit[]>();
  const supabase = getSupabaseAdminClient();
  if (supabase) {
    const { data, error } = await supabase
      .from("customer_transactions")
      .select("id, customer_id, type, amount, notes, created_at, reversed_at, execution_status")
      .eq("tenant_id", tenantId)
      .in("customer_id", customerIds)
      .in("type", ["deposit", "daily_susu"])
      .gte("created_at", startIso)
      .lte("created_at", endIso);

    if (!error) {
      for (const row of data ?? []) {
        const r = row as Record<string, unknown>;
        if (r.reversed_at != null) {
          continue;
        }
        const execStatus = typeof r.execution_status === "string" ? r.execution_status : null;
        if (execStatus && execStatus !== "completed" && execStatus !== "settled") {
          continue;
        }
        const txId = String(r.id);
        if (linkedTxIds.has(txId)) {
          continue;
        }
        const notes = r.notes != null ? String(r.notes) : undefined;
        if (isSystemFeeOrLoanNote(notes)) {
          continue;
        }
        const cid = String(r.customer_id);
        const list = existingByCustomer.get(cid) ?? [];
        list.push({
          id: txId,
          customerId: cid,
          amount: Math.round(Number(r.amount ?? 0) * 100) / 100,
          notes,
          createdAt: String(r.created_at)
        });
        existingByCustomer.set(cid, list);
      }
    }
  } else {
    const allTx = await listTransactions(tenantId);
    for (const tx of allTx) {
      if (!customerIds.includes(tx.customerId)) {
        continue;
      }
      if (tx.type !== "deposit" && tx.type !== "daily_susu") {
        continue;
      }
      if (tx.reversedAt) {
        continue;
      }
      if (
        tx.executionStatus &&
        tx.executionStatus !== "completed" &&
        tx.executionStatus !== "bank_executed"
      ) {
        continue;
      }
      if (tx.createdAt < startIso || tx.createdAt > endIso) {
        continue;
      }
      if (linkedTxIds.has(tx.id)) {
        continue;
      }
      if (isSystemFeeOrLoanNote(tx.notes)) {
        continue;
      }
      const list = existingByCustomer.get(tx.customerId) ?? [];
      list.push({
        id: tx.id,
        customerId: tx.customerId,
        amount: Math.round(tx.amount * 100) / 100,
        notes: tx.notes,
        createdAt: tx.createdAt
      });
      existingByCustomer.set(tx.customerId, list);
    }
  }

  const customerMap = new Map<string, { fullName: string; accountNumber?: string }>();
  await Promise.all(
    customerIds.map(async (cid) => {
      const cust = await getCustomerById(tenantId, cid).catch(() => null);
      customerMap.set(cid, {
        fullName: cust?.fullName ?? cid,
        accountNumber: cust?.accountNumber
      });
    })
  );

  const matches: SameDayDuplicateMatch[] = [];
  const seenInBatch = new Map<string, CollectionBatchLine>();

  for (const line of batch.lines) {
    const cust = customerMap.get(line.customerId) ?? { fullName: line.customerId };
    const existingList = existingByCustomer.get(line.customerId) ?? [];

    if (existingList.length > 0) {
      // Aggregate existing credits today on this customer (catches split initial deposits like 20 + 2,380 = 2,400!)
      const existingTotal =
        Math.round(existingList.reduce((sum, item) => sum + item.amount, 0) * 100) / 100;
      const exactSingle = existingList.find((item) => Math.abs(item.amount - line.amount) < 0.005);
      const exactTotal = Math.abs(existingTotal - line.amount) < 0.005;
      const ref = exactSingle ?? existingList[existingList.length - 1]!;
      const existingAmount = exactSingle ? exactSingle.amount : existingTotal;
      const isPostedBatch = (ref.notes ?? "").toLowerCase().includes("batch ");

      matches.push({
        lineId: line.id,
        customerId: line.customerId,
        customerName: cust.fullName,
        accountNumber: cust.accountNumber,
        lineAmount: line.amount,
        existingAmount,
        exactAmountMatch: Boolean(exactSingle || exactTotal),
        source: isPostedBatch ? "posted_batch" : "counter_or_initial_deposit",
        existingNotes: ref.notes,
        existingCreatedAt: ref.createdAt
      });
    } else if (seenInBatch.has(line.customerId)) {
      const first = seenInBatch.get(line.customerId)!;
      matches.push({
        lineId: line.id,
        customerId: line.customerId,
        customerName: cust.fullName,
        accountNumber: cust.accountNumber,
        lineAmount: line.amount,
        existingAmount: first.amount,
        exactAmountMatch: Math.abs(first.amount - line.amount) < 0.005,
        source: "same_batch",
        existingNotes: first.notes ?? "Earlier entry in this same batch",
        existingCreatedAt: first.createdAt
      });
    }

    if (!seenInBatch.has(line.customerId)) {
      seenInBatch.set(line.customerId, line);
    }
  }

  return matches;
}

async function loadReportedDifferencesForBatch(
  batch: CollectionBatch
): Promise<CalloverReportLineInput[]> {
  if (batch.calloverReportId) {
    const linked = await getCalloverReportById(batch.tenantId, batch.calloverReportId);
    const linkedDiffs = extractReportedDifferences(linked);
    if (linkedDiffs.length > 0) {
      return linkedDiffs;
    }
  }
  const latestUnreviewed = await getLatestUnreviewedCalloverReport(
    batch.tenantId,
    batch.fieldAgentId,
    batch.businessDate
  );
  return extractReportedDifferences(latestUnreviewed);
}

function agentMatchesBranchFilter(
  agentBranchId: string | undefined,
  context: CoordinatorContext,
  filterBranchId?: string
): boolean {
  if (context.scopeType === "branch" && context.branchId) {
    if (!agentBranchId || agentBranchId !== context.branchId) {
      return false;
    }
  }
  if (filterBranchId) {
    return agentBranchId === filterBranchId;
  }
  return true;
}

async function resolveAgentName(
  tenantId: string,
  agentId: string
): Promise<{ name: string; email?: string; branchId?: string }> {
  const supabase = getSupabaseAdminClient();
  if (supabase) {
    const { data } = await supabase
      .from("users")
      .select("full_name, email, branch_id")
      .eq("tenant_id", tenantId)
      .eq("id", agentId)
      .maybeSingle();
    if (data) {
      return {
        name: data.full_name?.trim() || data.email || agentId,
        email: data.email ?? undefined,
        branchId: data.branch_id ?? undefined
      };
    }
  }
  const user = listUsersByTenant(tenantId).find((u) => u.id === agentId);
  return {
    name: user?.fullName ?? user?.email ?? agentId,
    email: user?.email,
    branchId: user?.branchId
  };
}

export async function listPendingCollectionBatches(
  context: CoordinatorContext,
  options?: { businessDate?: string; fieldAgentId?: string; branchId?: string }
): Promise<PendingCollectionBatchView[]> {
  if (context.role !== "admin" && context.role !== "coordinator") {
    throw new Error("Only admin or coordinator can review collection batches");
  }

  const businessDate = options?.businessDate?.trim() || todayDate();
  const supabase = getSupabaseAdminClient();
  const results: PendingCollectionBatchView[] = [];

  if (supabase) {
    let query = supabase
      .from("field_agent_collection_batches")
      .select("*")
      .eq("tenant_id", context.tenantId)
      .lte("business_date", businessDate)
      .eq("status", "pending_approval");

    if (options?.fieldAgentId) {
      query = query.eq("field_agent_id", options.fieldAgentId);
    }

    const { data, error } = await query
      .order("business_date", { ascending: true })
      .order("submitted_at", { ascending: false });
    if (error) {
      throw new Error(`Failed to list pending batches: ${error.message}`);
    }

    for (const row of data ?? []) {
      const batch = await loadBatchById(context.tenantId, String(row.id));
      if (!batch) {
        continue;
      }
      const agent = await resolveAgentName(context.tenantId, batch.fieldAgentId);
      if (!agentMatchesBranchFilter(agent.branchId, context, options?.branchId)) {
        continue;
      }
      const [reportedDifferences, sameDayDuplicates] = await Promise.all([
        loadReportedDifferencesForBatch(batch),
        detectSameDayDuplicateLines(context.tenantId, batch)
      ]);
      results.push({
        ...batch,
        fieldAgentName: agent.name,
        fieldAgentEmail: agent.email,
        branchId: agent.branchId,
        hasReportedDifferences: reportedDifferences.length > 0,
        reportedDifferences,
        hasSameDayDuplicates: sameDayDuplicates.length > 0,
        sameDayDuplicates
      });
    }
    return results;
  }

  for (const batch of memoryBatches.values()) {
    if (
      batch.tenantId === context.tenantId &&
      batch.businessDate <= businessDate &&
      batch.status === "pending_approval" &&
      (!options?.fieldAgentId || batch.fieldAgentId === options.fieldAgentId)
    ) {
      const agent = await resolveAgentName(context.tenantId, batch.fieldAgentId);
      if (!agentMatchesBranchFilter(agent.branchId, context, options?.branchId)) {
        continue;
      }
      const [reportedDifferences, sameDayDuplicates] = await Promise.all([
        loadReportedDifferencesForBatch(batch),
        detectSameDayDuplicateLines(context.tenantId, batch)
      ]);
      results.push({
        ...batch,
        fieldAgentName: agent.name,
        fieldAgentEmail: agent.email,
        branchId: agent.branchId,
        hasReportedDifferences: reportedDifferences.length > 0,
        reportedDifferences,
        hasSameDayDuplicates: sameDayDuplicates.length > 0,
        sameDayDuplicates
      });
    }
  }
  return results.sort((a, b) => a.businessDate.localeCompare(b.businessDate));
}

export type PostedCollectionBatchView = PendingCollectionBatchView & {
  hasOpenNextBatch: boolean;
  openNextBatchStatus?: CollectionBatchStatus;
  openNextBatchSequence?: number;
  isLatestBatchForAgent: boolean;
  canUnlockExtraBatch: boolean;
};

export async function listPostedCollectionBatches(
  context: CoordinatorContext,
  options?: { businessDate?: string; fieldAgentId?: string; branchId?: string }
): Promise<PostedCollectionBatchView[]> {
  if (context.role !== "admin" && context.role !== "coordinator") {
    throw new Error("Only admin or coordinator can view posted collection batches");
  }

  const businessDate = options?.businessDate?.trim() || todayDate();
  const isToday = businessDate === todayDate();
  const supabase = getSupabaseAdminClient();
  const allForDate: CollectionBatch[] = [];

  if (supabase) {
    let query = supabase
      .from("field_agent_collection_batches")
      .select("*")
      .eq("tenant_id", context.tenantId)
      .eq("business_date", businessDate);

    if (options?.fieldAgentId) {
      query = query.eq("field_agent_id", options.fieldAgentId);
    }

    const { data, error } = await query.order("created_at", { ascending: false });
    if (error) {
      throw new Error(`Failed to list posted batches: ${error.message}`);
    }

    for (const row of data ?? []) {
      allForDate.push(await hydrateBatchFromRow(row as Record<string, unknown>));
    }
  } else {
    for (const batch of memoryBatches.values()) {
      if (
        batch.tenantId === context.tenantId &&
        batch.businessDate === businessDate &&
        (!options?.fieldAgentId || batch.fieldAgentId === options.fieldAgentId)
      ) {
        allForDate.push(batch);
      }
    }
  }

  const openByAgent = new Map<string, CollectionBatch>();
  const maxPostedSeqByAgent = new Map<string, number>();

  for (const b of allForDate) {
    if (b.status === "posted") {
      const prev = maxPostedSeqByAgent.get(b.fieldAgentId) ?? 0;
      if (b.batchSequence > prev) {
        maxPostedSeqByAgent.set(b.fieldAgentId, b.batchSequence);
      }
    } else {
      const existing = openByAgent.get(b.fieldAgentId);
      if (!existing || b.batchSequence > existing.batchSequence) {
        openByAgent.set(b.fieldAgentId, b);
      }
    }
  }

  const posted = allForDate
    .filter((b) => b.status === "posted")
    .sort((a, b) => {
      const timeCmp = (b.postedAt ?? "").localeCompare(a.postedAt ?? "");
      return timeCmp !== 0 ? timeCmp : b.batchSequence - a.batchSequence;
    });

  const results: PostedCollectionBatchView[] = [];
  for (const batch of posted) {
    const agent = await resolveAgentName(context.tenantId, batch.fieldAgentId);
    if (!agentMatchesBranchFilter(agent.branchId, context, options?.branchId)) {
      continue;
    }
    const openNext = openByAgent.get(batch.fieldAgentId);
    const maxPostedSeq = maxPostedSeqByAgent.get(batch.fieldAgentId) ?? batch.batchSequence;
    const isLatestBatchForAgent = batch.batchSequence >= maxPostedSeq;
    const hasOpenNextBatch = Boolean(openNext);
    results.push({
      ...batch,
      fieldAgentName: agent.name,
      fieldAgentEmail: agent.email,
      branchId: agent.branchId,
      hasOpenNextBatch,
      openNextBatchStatus: openNext?.status,
      openNextBatchSequence: openNext?.batchSequence,
      isLatestBatchForAgent,
      canUnlockExtraBatch: isToday && isLatestBatchForAgent && !hasOpenNextBatch
    });
  }
  return results;
}

export async function unlockExtraCollectionBatch(
  context: CoordinatorContext,
  input: { batchId?: string; fieldAgentId?: string; reason: string }
): Promise<{
  batch: CollectionBatch;
  priorPostedCount: number;
  priorPostedTotal: number;
  fieldAgentName: string;
}> {
  if (context.role !== "admin" && context.role !== "coordinator") {
    throw new Error("Only admin or coordinator can unlock an extra collection batch");
  }

  const reason = input.reason?.trim() ?? "";
  if (reason.length < 3) {
    throw new Error("Enter a short reason (at least 3 characters) for unlocking an extra batch");
  }

  let fieldAgentId = input.fieldAgentId?.trim() || "";
  let businessDate = todayDate();

  if (input.batchId) {
    const sourceBatch = await loadBatchById(context.tenantId, input.batchId);
    if (!sourceBatch) {
      throw new Error("Source collection batch not found");
    }
    if (sourceBatch.status !== "posted") {
      throw new Error("Only a posted collection batch can be followed by an extra batch");
    }
    fieldAgentId = sourceBatch.fieldAgentId;
    businessDate = sourceBatch.businessDate;
  }

  if (!fieldAgentId) {
    throw new Error("Field agent is required");
  }

  if (businessDate !== todayDate()) {
    throw new Error("Extra collection batches can only be unlocked for today's business date");
  }

  const agent = await resolveAgentName(context.tenantId, fieldAgentId);
  if (!agentMatchesBranchFilter(agent.branchId, context)) {
    throw new Error("This field agent belongs to another branch");
  }

  const latest = await loadBatchRow(context.tenantId, fieldAgentId, businessDate);
  if (!latest) {
    throw new Error("This field agent has no posted batch today — they can already collect normally");
  }
  if (latest.status !== "posted") {
    throw new Error(
      `This field agent already has an open batch (Batch #${latest.batchSequence} · ${latest.status.replace(/_/g, " ")})`
    );
  }

  const postedSummary = await loadPostedSummaryForDay(context.tenantId, fieldAgentId, businessDate);
  const nextSequence = latest.batchSequence + 1;
  const now = new Date().toISOString();
  const nextBatch: CollectionBatch = {
    id: randomUUID(),
    tenantId: context.tenantId,
    fieldAgentId,
    businessDate,
    batchSequence: nextSequence,
    status: "draft",
    totalAmount: 0,
    lineCount: 0,
    unlockedBy: context.userId,
    unlockReason: reason,
    unlockedAt: now,
    lines: []
  };

  try {
    await persistBatch(nextBatch);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (/duplicate key|unique constraint/i.test(msg)) {
      throw new Error(
        "Could not unlock extra batch. Make sure database migration 108_collection_batch_sequence.sql is applied and no extra batch is already open."
      );
    }
    throw error;
  }

  try {
    await createAgentNotification({
      tenantId: context.tenantId,
      userId: fieldAgentId,
      kind: "collection_batch_pending",
      title: `Extra batch unlocked (Batch #${nextSequence})`,
      body: `Coordinator unlocked Batch #${nextSequence} for today (${reason}). You can continue collecting — at call-over, hand over cash for Batch #${nextSequence} only (earlier posted today: GHS ${formatAccountAmount(postedSummary.totalAmount)}).`
    });
  } catch {
    /* non-blocking */
  }

  return {
    batch: nextBatch,
    priorPostedCount: postedSummary.count,
    priorPostedTotal: postedSummary.totalAmount,
    fieldAgentName: agent.name
  };
}

export async function getCollectionBatchById(
  context: CoordinatorContext,
  batchId: string
): Promise<PendingCollectionBatchView> {
  const batch = await loadBatchById(context.tenantId, batchId);

  if (!batch) {
    throw new Error("Collection batch not found");
  }

  const [agent, reportedDifferences] = await Promise.all([
    resolveAgentName(context.tenantId, batch.fieldAgentId),
    loadReportedDifferencesForBatch(batch)
  ]);
  return {
    ...batch,
    fieldAgentName: agent.name,
    fieldAgentEmail: agent.email,
    branchId: agent.branchId,
    hasReportedDifferences: reportedDifferences.length > 0,
    reportedDifferences
  };
}

const batchPostLocks = new Map<string, Promise<unknown>>();

function withBatchLock<T>(batchId: string, work: () => Promise<T>): Promise<T> {
  const previous = batchPostLocks.get(batchId) ?? Promise.resolve();
  const run = previous.then(work, work);
  const tail = run.then(
    () => undefined,
    () => undefined
  );
  batchPostLocks.set(batchId, tail);
  return run.finally(() => {
    if (batchPostLocks.get(batchId) === tail) {
      batchPostLocks.delete(batchId);
    }
  });
}

async function postSingleBatch(
  context: CoordinatorContext,
  batch: CollectionBatch,
  options?: {
    cashReceivedAmount?: number;
    confirmDifferencesReviewed?: boolean;
    confirmDuplicatesReviewed?: boolean;
  }
): Promise<CollectionBatch> {
  return withBatchLock(batch.id, () => postSingleBatchUnlocked(context, batch, options));
}

async function postSingleBatchUnlocked(
  context: CoordinatorContext,
  batch: CollectionBatch,
  options?: {
    cashReceivedAmount?: number;
    confirmDifferencesReviewed?: boolean;
    confirmDuplicatesReviewed?: boolean;
  }
): Promise<CollectionBatch> {
  const fresh = await loadBatchById(context.tenantId, batch.id);
  const current = fresh ?? batch;
  if (current.status === "posted") {
    return current;
  }
  if (current.status !== "pending_approval") {
    throw new Error("Only pending batches can be posted");
  }

  const reportedDifferences = await loadReportedDifferencesForBatch(current);
  if (reportedDifferences.length > 0 && !options?.confirmDifferencesReviewed) {
    throw new Error(
      "This call-over has reported differences from the field agent and cannot be auto-posted. Review the differences first, then return to the agent or explicitly confirm before posting."
    );
  }

  const sameDayDuplicates = await detectSameDayDuplicateLines(context.tenantId, current);
  if (sameDayDuplicates.length > 0 && !options?.confirmDuplicatesReviewed) {
    const names = Array.from(new Set(sameDayDuplicates.map((d) => d.customerName)))
      .slice(0, 3)
      .join(", ");
    throw new Error(
      `Same-day duplicate deposit alert for ${names}. Remove the duplicate line(s) or explicitly confirm they are separate physical payments before posting.`
    );
  }

  const cashReceived =
    options?.cashReceivedAmount ??
    current.cashReceivedAmount ??
    undefined;
  if (cashReceived == null || !Number.isFinite(cashReceived) || cashReceived < 0) {
    throw new Error("Enter the cash amount the mobilizer brought to the office before posting");
  }
  const cashCheck = computeCashVariance(current.totalAmount, cashReceived);
  current.cashReceivedAmount = Math.round(cashReceived * 100) / 100;
  current.cashVariance = cashCheck.variance;
  current.cashVarianceStatus = cashCheck.status;
  current.cashReceivedAt = new Date().toISOString();
  current.cashReceivedBy = context.userId;

  for (const line of current.lines) {
    if (line.transactionId) {
      continue;
    }
    const customer = await getCustomerById(context.tenantId, line.customerId);
    if (!customer) {
      throw new Error(`Customer not found for line ${line.id}`);
    }
    const branchId = customer.homeBranchId ?? context.branchId;
    if (!branchId) {
      throw new Error(`No branch for customer ${customer.fullName}`);
    }

    const claim = await beginIdempotency(context.tenantId, `collection-line:${line.id}`);
    let transactionId = line.transactionId;
    if (!claim.owned) {
      const replay = claim.body as { id?: string; error?: string } | null;
      if (claim.statusCode >= 300 || !replay?.id) {
        throw new Error(replay?.error || "This collection line is already being posted");
      }
      transactionId = replay.id;
    } else {
      try {
        const tx = await createTransaction(
          {
            tenantId: context.tenantId,
            userId: context.userId,
            role: context.role,
            branchId: context.branchId,
            scopeType: context.scopeType
          },
          {
            customerId: line.customerId,
            type: "daily_susu",
            amount: line.amount,
            transactionBranchId: branchId,
            notes: line.notes
              ? `${line.notes} · batch ${current.id.slice(0, 8)}`
              : `Batch ${current.id.slice(0, 8)}`
          },
          { skipBranchFloat: true }
        );
        await claim.finish(201, tx);
        transactionId = tx.id;
      } catch (error) {
        claim.abort();
        throw error;
      }
    }

    if (!transactionId) {
      continue;
    }
    line.transactionId = transactionId;

    const supabase = getSupabaseAdminClient();
    if (supabase) {
      await supabase
        .from("field_agent_collection_batch_lines")
        .update({ transaction_id: transactionId })
        .eq("id", line.id);
    }
  }

  batch = current;

  batch.status = "posted";
  batch.postedAt = new Date().toISOString();
  batch.postedBy = context.userId;
  await persistBatch(batch);

  await markCalloverReportsReviewed(
    batch.tenantId,
    batch.fieldAgentId,
    batch.businessDate,
    batch.calloverReportId
  );

  try {
    const varianceNote =
      batch.cashVarianceStatus === "shortage"
        ? ` Shortage GHS ${formatAccountAmount(Math.abs(batch.cashVariance ?? 0))} is open — pay at the office.`
        : batch.cashVarianceStatus === "overage"
          ? ` Overage GHS ${formatAccountAmount((batch.cashVariance ?? 0))} must be reconciled (missing entries) — it cannot clear a shortage.`
          : "";
    const seqLabel = batch.batchSequence > 1 ? ` (Batch #${batch.batchSequence})` : "";
    await createAgentNotification({
      tenantId: context.tenantId,
      userId: batch.fieldAgentId,
      kind: "collection_batch_posted",
      title: batch.batchSequence > 1 ? `Collections posted · Batch #${batch.batchSequence}` : "Collections posted",
      body: `Your batch${seqLabel} of GHS ${formatAccountAmount(batch.totalAmount)} for ${batch.businessDate} was posted to customer accounts.${varianceNote}`
    });
  } catch (error) {
    console.warn(
      "[collections] agent post notification failed:",
      error instanceof Error ? error.message : error
    );
  }

  try {
    const agent = await resolveAgentName(batch.tenantId, batch.fieldAgentId);
    await openCashVarianceFromBatch(
      batch,
      context.userId,
      agent.branchId ?? context.branchId
    );
  } catch (error) {
    console.warn(
      "[collections] open cash variance failed:",
      error instanceof Error ? error.message : error
    );
  }

  return batch;
}

export async function postCollectionBatch(
  context: CoordinatorContext,
  batchId: string,
  options?: {
    cashReceivedAmount?: number;
    confirmDifferencesReviewed?: boolean;
    confirmDuplicatesReviewed?: boolean;
  }
): Promise<CollectionBatch> {
  const batchView = await getCollectionBatchById(context, batchId);
  return postSingleBatch(context, batchView, options);
}

export async function rejectCollectionBatch(
  context: CoordinatorContext,
  batchId: string,
  reason?: string
): Promise<CollectionBatch> {
  if (context.role !== "admin" && context.role !== "coordinator") {
    throw new Error("Only admin or coordinator can return a collection batch");
  }
  const batch = await getCollectionBatchById(context, batchId);
  if (batch.status !== "pending_approval") {
    throw new Error("Only pending collection batches can be returned to the agent");
  }
  const note = reason?.trim() || undefined;
  batch.status = "rejected";
  if (note) {
    batch.agentNotes = note;
  }
  await persistBatch(batch);
  try {
    await createAgentNotification({
      tenantId: context.tenantId,
      userId: batch.fieldAgentId,
      kind: "collection_batch_pending",
      title: "Call-over returned for review",
      body: note
        ? `Your call-over batch for ${batch.businessDate} was returned by the coordinator: ${note}`
        : `Your call-over batch for ${batch.businessDate} was returned by the coordinator to resolve differences before posting.`
    });
  } catch {
    /* non-blocking */
  }
  return batch;
}

export type CancelUnpostedBatchResult = {
  deletedBatchId: string;
  fieldAgentId: string;
  businessDate: string;
  removedLineCount: number;
  removedTotalAmount: number;
};

/**
 * Cancels/deletes an UNPOSTED collection batch (pending_approval, draft, or rejected).
 * Posted batches can never be canceled. Touches zero customer ledgers or alerts.
 */
export async function cancelUnpostedCollectionBatch(
  context: CoordinatorContext,
  batchId: string,
  reason: string
): Promise<CancelUnpostedBatchResult> {
  if (context.role !== "admin" && context.role !== "coordinator") {
    throw new Error("Only admin or coordinator can cancel an unposted collection batch");
  }
  const trimmedReason = reason?.trim() ?? "";
  if (trimmedReason.length < 3) {
    throw new Error("Enter a short reason before canceling an unposted batch");
  }

  const batch = await getCollectionBatchById(context, batchId);
  if (batch.status === "posted") {
    throw new Error("Posted collection batches cannot be canceled");
  }

  const supabase = getSupabaseAdminClient();
  if (supabase) {
    const { error: deleteErr } = await supabase
      .from("field_agent_collection_batches")
      .delete()
      .eq("tenant_id", context.tenantId)
      .eq("id", batch.id)
      .neq("status", "posted");
    if (deleteErr) {
      throw new Error(`Failed to cancel collection batch: ${deleteErr.message}`);
    }
    if (batch.calloverReportId) {
      await supabase
        .from("field_agent_callover_reports")
        .delete()
        .eq("tenant_id", context.tenantId)
        .eq("id", batch.calloverReportId);
    }
  } else {
    memoryBatches.delete(batch.id);
  }

  try {
    await createAgentNotification({
      tenantId: context.tenantId,
      userId: batch.fieldAgentId,
      kind: "collection_batch_pending",
      title: "Unposted call-over batch canceled",
      body: `Your unposted call-over batch for ${batch.businessDate} (GHS ${batch.totalAmount.toFixed(2)}) was canceled by the coordinator: ${trimmedReason}. You can record collections cleanly.`
    });
  } catch {
    /* non-blocking */
  }

  return {
    deletedBatchId: batch.id,
    fieldAgentId: batch.fieldAgentId,
    businessDate: batch.businessDate,
    removedLineCount: batch.lines.length,
    removedTotalAmount: batch.totalAmount
  };
}

export type RemoveCollectionBatchLineResult = {
  batchDeleted: boolean;
  batch: CollectionBatch | null;
  removedLine: CollectionBatchLine;
  previousTotalAmount: number;
  newTotalAmount: number;
};

/**
 * Removes a single line from an UNPOSTED collection batch and recalculates the batch total.
 * If it was the last remaining line, automatically deletes the now-empty unposted batch.
 */
export async function removeCollectionBatchLine(
  context: CoordinatorContext,
  batchId: string,
  lineId: string,
  reason: string
): Promise<RemoveCollectionBatchLineResult> {
  if (context.role !== "admin" && context.role !== "coordinator") {
    throw new Error("Only admin or coordinator can remove a line from a collection batch");
  }
  const trimmedReason = reason?.trim() ?? "";
  if (trimmedReason.length < 3) {
    throw new Error("Enter a short reason before removing a collection line");
  }

  const batch = await getCollectionBatchById(context, batchId);
  if (batch.status === "posted") {
    throw new Error("Lines cannot be removed from a posted collection batch");
  }

  const targetLine = batch.lines.find((line) => line.id === lineId);
  if (!targetLine) {
    throw new Error("Collection line not found in this batch");
  }

  const previousTotalAmount = batch.totalAmount;
  const remainingLines = batch.lines.filter((line) => line.id !== lineId);

  if (remainingLines.length === 0) {
    await cancelUnpostedCollectionBatch(context, batchId, trimmedReason);
    return {
      batchDeleted: true,
      batch: null,
      removedLine: targetLine,
      previousTotalAmount,
      newTotalAmount: 0
    };
  }

  const newTotalAmount =
    Math.round(remainingLines.reduce((sum, line) => sum + line.amount, 0) * 100) / 100;

  const supabase = getSupabaseAdminClient();
  if (supabase) {
    const { error: delLineErr } = await supabase
      .from("field_agent_collection_batch_lines")
      .delete()
      .eq("batch_id", batch.id)
      .eq("id", targetLine.id);
    if (delLineErr) {
      throw new Error(`Failed to remove collection line: ${delLineErr.message}`);
    }
    const { error: updBatchErr } = await supabase
      .from("field_agent_collection_batches")
      .update({
        total_amount: newTotalAmount,
        updated_at: new Date().toISOString()
      })
      .eq("tenant_id", context.tenantId)
      .eq("id", batch.id)
      .neq("status", "posted");
    if (updBatchErr) {
      throw new Error(`Failed to update batch total: ${updBatchErr.message}`);
    }
  } else {
    const stored = memoryBatches.get(batch.id);
    if (stored) {
      stored.lines = remainingLines;
      stored.totalAmount = newTotalAmount;
      memoryBatches.set(batch.id, stored);
    }
  }

  const updatedBatch: CollectionBatch = {
    ...batch,
    lines: remainingLines,
    totalAmount: newTotalAmount
  };

  try {
    await createAgentNotification({
      tenantId: context.tenantId,
      userId: batch.fieldAgentId,
      kind: "collection_batch_pending",
      title: "Collection line removed from unposted batch",
      body: `A GHS ${targetLine.amount.toFixed(2)} entry was removed from your unposted ${batch.businessDate} batch by the coordinator (${trimmedReason}). Updated batch total: GHS ${newTotalAmount.toFixed(2)}.`
    });
  } catch {
    /* non-blocking */
  }

  return {
    batchDeleted: false,
    batch: updatedBatch,
    removedLine: targetLine,
    previousTotalAmount,
    newTotalAmount
  };
}

export async function postAllPendingCollectionBatches(
  context: CoordinatorContext,
  options?: {
    businessDate?: string;
    fieldAgentId?: string;
    branchId?: string;
    /** Map of batchId → cash brought. Required for each pending batch. */
    cashByBatchId?: Record<string, number>;
  }
): Promise<{
  posted: number;
  batchIds: string[];
  skippedWithDifferences: number;
  skippedWithDuplicates: number;
}> {
  const pending = await listPendingCollectionBatches(context, options);
  const batchIds: string[] = [];
  let skippedWithDifferences = 0;
  let skippedWithDuplicates = 0;
  for (const batch of pending) {
    if (batch.hasReportedDifferences) {
      // Never auto-post a call-over where the agent reported differences.
      skippedWithDifferences += 1;
      continue;
    }
    if (batch.hasSameDayDuplicates) {
      // Never auto-post a batch with same-day duplicate deposit alerts.
      skippedWithDuplicates += 1;
      continue;
    }
    const cash = options?.cashByBatchId?.[batch.id];
    await postSingleBatch(context, batch, { cashReceivedAmount: cash });
    batchIds.push(batch.id);
  }
  return { posted: batchIds.length, batchIds, skippedWithDifferences, skippedWithDuplicates };
}
