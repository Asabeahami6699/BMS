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
import { createTransaction } from "./transactionService.js";
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
  /** Earlier-date draft/rejected batches with recorded lines that were never submitted. */
  priorUnsubmittedBatches?: PriorUnsubmittedBatchSummary[];
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

function batchKey(tenantId: string, agentId: string, date: string): string {
  return `${tenantId}:${agentId}:${date}`;
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

function toTodayCollections(batch: CollectionBatch | null): FieldAgentTodayCollections {
  if (!batch) {
    return { customerIds: [], totalAmount: 0, items: [] };
  }
  if (batch.lines.length === 0) {
    return {
      customerIds: [],
      totalAmount: batch.totalAmount,
      items: [],
      batchStatus: batch.status,
      batchId: batch.id
    };
  }
  const items = aggregateItems(batch.lines);
  return {
    customerIds: items.map((i) => i.customerId),
    totalAmount: batch.totalAmount,
    items,
    batchStatus: batch.status,
    batchId: batch.id
  };
}

async function loadBatchRow(
  tenantId: string,
  fieldAgentId: string,
  businessDate: string
): Promise<CollectionBatch | null> {
  const supabase = getSupabaseAdminClient();
  if (supabase) {
    const { data: batchRow, error } = await supabase
      .from("field_agent_collection_batches")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("field_agent_id", fieldAgentId)
      .eq("business_date", businessDate)
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to load collection batch: ${error.message}`);
    }
    if (!batchRow) {
      return null;
    }

    const { data: lineRows, error: lineErr } = await supabase
      .from("field_agent_collection_batch_lines")
      .select("id, customer_id, amount, notes, client_line_id, transaction_id, created_at")
      .eq("batch_id", batchRow.id)
      .order("created_at", { ascending: true });

    if (lineErr) {
      throw new Error(`Failed to load batch lines: ${lineErr.message}`);
    }

    const lines: CollectionBatchLine[] = (lineRows ?? []).map((row) => ({
      id: String(row.id),
      customerId: String(row.customer_id),
      amount: Number(row.amount),
      notes: row.notes ?? undefined,
      clientLineId: row.client_line_id ?? undefined,
      transactionId: row.transaction_id ?? undefined,
      createdAt: row.created_at
    }));

    const computedTotal = Math.round(lines.reduce((sum, l) => sum + l.amount, 0) * 100) / 100;

    return {
      id: String(batchRow.id),
      tenantId: batchRow.tenant_id,
      fieldAgentId: batchRow.field_agent_id,
      businessDate: String(batchRow.business_date).slice(0, 10),
      status: batchRow.status as CollectionBatchStatus,
      totalAmount: computedTotal,
      lineCount: lines.length,
      calloverReportId: batchRow.callover_report_id ?? undefined,
      agentNotes: batchRow.agent_notes ?? undefined,
      submittedAt: batchRow.submitted_at ?? undefined,
      postedAt: batchRow.posted_at ?? undefined,
      postedBy: batchRow.posted_by ?? undefined,
      cashReceivedAmount:
        batchRow.cash_received_amount != null ? Number(batchRow.cash_received_amount) : undefined,
      cashVariance: batchRow.cash_variance != null ? Number(batchRow.cash_variance) : undefined,
      cashVarianceStatus: (batchRow.cash_variance_status as CashVarianceStatus | null) ?? undefined,
      cashReceivedAt: batchRow.cash_received_at ?? undefined,
      cashReceivedBy: batchRow.cash_received_by ?? undefined,
      lines
    };
  }

  return memoryBatches.get(batchKey(tenantId, fieldAgentId, businessDate)) ?? null;
}

type BatchHeader = {
  id: string;
  tenantId: string;
  fieldAgentId: string;
  businessDate: string;
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
    const { data: batchRow, error } = await supabase
      .from("field_agent_collection_batches")
      .select("id, tenant_id, field_agent_id, business_date, status, total_amount, line_count")
      .eq("tenant_id", tenantId)
      .eq("field_agent_id", fieldAgentId)
      .eq("business_date", businessDate)
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to load collection batch: ${error.message}`);
    }
    if (!batchRow) {
      return null;
    }

    return {
      id: String(batchRow.id),
      tenantId: batchRow.tenant_id,
      fieldAgentId: batchRow.field_agent_id,
      businessDate: String(batchRow.business_date).slice(0, 10),
      status: batchRow.status as CollectionBatchStatus,
      totalAmount: Number(batchRow.total_amount ?? 0),
      lineCount: Number(batchRow.line_count ?? 0)
    };
  }

  const batch = memoryBatches.get(batchKey(tenantId, fieldAgentId, businessDate));
  if (!batch) {
    return null;
  }
  return {
    id: batch.id,
    tenantId: batch.tenantId,
    fieldAgentId: batch.fieldAgentId,
    businessDate: batch.businessDate,
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

  const memoryBatch = memoryBatches.get(batchKey(batch.tenantId, batch.fieldAgentId, batch.businessDate));
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
    const { error } = await supabase.from("field_agent_collection_batches").upsert(
      {
        id: batch.id,
        tenant_id: batch.tenantId,
        field_agent_id: batch.fieldAgentId,
        business_date: batch.businessDate,
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
        updated_at: new Date().toISOString()
      },
      { onConflict: "tenant_id,field_agent_id,business_date" }
    );
    if (error) {
      throw new Error(`Failed to save collection batch: ${error.message}`);
    }
    return;
  }
  memoryBatches.set(batchKey(batch.tenantId, batch.fieldAgentId, batch.businessDate), batch);
}

async function getOrCreateDraftBatch(
  tenantId: string,
  fieldAgentId: string,
  businessDate: string
): Promise<CollectionBatch> {
  const existing = await loadBatchRow(tenantId, fieldAgentId, businessDate);
  if (existing) {
    if (existing.status === "posted") {
      throw new Error("Today's collections are already posted. You cannot add more for this date.");
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
  const [batch, priorUnsubmittedBatches] = await Promise.all([
    loadBatchRow(context.tenantId, context.userId, businessDate),
    listAgentPriorUnsubmittedBatches(context.tenantId, context.userId, businessDate)
  ]);
  return {
    ...toTodayCollections(batch),
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

  if (payload.clientLineId) {
    const dup = batch.lines.find((l) => l.clientLineId === payload.clientLineId);
    if (dup) {
      return toTodayCollections(batch);
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

  return toTodayCollections(batch);
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
};

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
      const rowDate = String(row.business_date).slice(0, 10);
      const batch = await loadBatchRow(context.tenantId, row.field_agent_id, rowDate);
      if (!batch) {
        continue;
      }
      const agent = await resolveAgentName(context.tenantId, batch.fieldAgentId);
      if (!agentMatchesBranchFilter(agent.branchId, context, options?.branchId)) {
        continue;
      }
      const reportedDifferences = await loadReportedDifferencesForBatch(batch);
      results.push({
        ...batch,
        fieldAgentName: agent.name,
        fieldAgentEmail: agent.email,
        branchId: agent.branchId,
        hasReportedDifferences: reportedDifferences.length > 0,
        reportedDifferences
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
      const reportedDifferences = await loadReportedDifferencesForBatch(batch);
      results.push({
        ...batch,
        fieldAgentName: agent.name,
        fieldAgentEmail: agent.email,
        branchId: agent.branchId,
        hasReportedDifferences: reportedDifferences.length > 0,
        reportedDifferences
      });
    }
  }
  return results.sort((a, b) => a.businessDate.localeCompare(b.businessDate));
}

export async function getCollectionBatchById(
  context: CoordinatorContext,
  batchId: string
): Promise<PendingCollectionBatchView> {
  const supabase = getSupabaseAdminClient();
  let batch: CollectionBatch | null = null;

  if (supabase) {
    const { data, error } = await supabase
      .from("field_agent_collection_batches")
      .select("field_agent_id, business_date, tenant_id")
      .eq("tenant_id", context.tenantId)
      .eq("id", batchId)
      .maybeSingle();
    if (error || !data) {
      throw new Error("Collection batch not found");
    }
    batch = await loadBatchRow(context.tenantId, data.field_agent_id, String(data.business_date).slice(0, 10));
  } else {
    batch = [...memoryBatches.values()].find((b) => b.id === batchId && b.tenantId === context.tenantId) ?? null;
  }

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
  options?: { cashReceivedAmount?: number; confirmDifferencesReviewed?: boolean }
): Promise<CollectionBatch> {
  return withBatchLock(batch.id, () => postSingleBatchUnlocked(context, batch, options));
}

async function postSingleBatchUnlocked(
  context: CoordinatorContext,
  batch: CollectionBatch,
  options?: { cashReceivedAmount?: number; confirmDifferencesReviewed?: boolean }
): Promise<CollectionBatch> {
  const fresh = await loadBatchRow(context.tenantId, batch.fieldAgentId, batch.businessDate);
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
    await createAgentNotification({
      tenantId: context.tenantId,
      userId: batch.fieldAgentId,
      kind: "collection_batch_posted",
      title: "Collections posted",
      body: `Your batch of GHS ${formatAccountAmount(batch.totalAmount)} for ${batch.businessDate} was posted to customer accounts.${varianceNote}`
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
  options?: { cashReceivedAmount?: number; confirmDifferencesReviewed?: boolean }
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

export async function postAllPendingCollectionBatches(
  context: CoordinatorContext,
  options?: {
    businessDate?: string;
    fieldAgentId?: string;
    branchId?: string;
    /** Map of batchId → cash brought. Required for each pending batch. */
    cashByBatchId?: Record<string, number>;
  }
): Promise<{ posted: number; batchIds: string[]; skippedWithDifferences: number }> {
  const pending = await listPendingCollectionBatches(context, options);
  const batchIds: string[] = [];
  let skippedWithDifferences = 0;
  for (const batch of pending) {
    if (batch.hasReportedDifferences) {
      // Never auto-post a call-over where the agent reported differences.
      skippedWithDifferences += 1;
      continue;
    }
    const cash = options?.cashByBatchId?.[batch.id];
    await postSingleBatch(context, batch, { cashReceivedAmount: cash });
    batchIds.push(batch.id);
  }
  return { posted: batchIds.length, batchIds, skippedWithDifferences };
}
