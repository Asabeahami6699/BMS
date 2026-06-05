import { randomUUID } from "node:crypto";
import type { SubmitCalloverInput } from "./calloverReportService.js";
import { submitCalloverReport } from "./calloverReportService.js";
import { getCustomerById } from "./customerService.js";
import { getSupabaseAdminClient } from "../config/supabaseClient.js";
import { createTransaction } from "./transactionService.js";
import { createAgentNotification, notifyTenantStaff } from "./notificationService.js";
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
  lines: CollectionBatchLine[];
};

export type FieldAgentTodayCollection = {
  customerId: string;
  amount: number;
  createdAt: string;
  entryCount?: number;
};

export type FieldAgentTodayCollections = {
  customerIds: string[];
  totalAmount: number;
  items: FieldAgentTodayCollection[];
  batchStatus?: CollectionBatchStatus;
  batchId?: string;
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
  const grouped = new Map<string, { amount: number; createdAt: string; entryCount: number }>();
  for (const line of lines) {
    const existing = grouped.get(line.customerId);
    if (!existing) {
      grouped.set(line.customerId, {
        amount: line.amount,
        createdAt: line.createdAt,
        entryCount: 1
      });
      continue;
    }
    existing.amount += line.amount;
    existing.entryCount += 1;
    if (line.createdAt > existing.createdAt) {
      existing.createdAt = line.createdAt;
    }
  }
  return [...grouped.entries()]
    .map(([customerId, row]) => ({
      customerId,
      amount: row.amount,
      createdAt: row.createdAt,
      entryCount: row.entryCount
    }))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
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

    return {
      id: String(batchRow.id),
      tenantId: batchRow.tenant_id,
      fieldAgentId: batchRow.field_agent_id,
      businessDate: String(batchRow.business_date).slice(0, 10),
      status: batchRow.status as CollectionBatchStatus,
      totalAmount: Number(batchRow.total_amount ?? 0),
      lineCount: Number(batchRow.line_count ?? lines.length),
      calloverReportId: batchRow.callover_report_id ?? undefined,
      agentNotes: batchRow.agent_notes ?? undefined,
      submittedAt: batchRow.submitted_at ?? undefined,
      postedAt: batchRow.posted_at ?? undefined,
      postedBy: batchRow.posted_by ?? undefined,
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

export async function getAgentTodayCollections(context: AgentContext): Promise<FieldAgentTodayCollections> {
  const businessDate = todayDate();
  const batch = await loadBatchRow(context.tenantId, context.userId, businessDate);
  return toTodayCollections(batch);
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
  batch.totalAmount = Math.round((batch.totalAmount + line.amount) * 100) / 100;
  batch.lineCount = batch.lines.length;
  await persistBatch(batch);

  return toTodayCollections(batch);
}

export async function submitCollectionBatchForApproval(
  context: AgentContext,
  calloverInput: SubmitCalloverInput
): Promise<{ batchId: string; status: CollectionBatchStatus; calloverReportId: string }> {
  const businessDate = todayDate();
  const batch = await loadBatchHeader(context.tenantId, context.userId, businessDate);
  if (!batch || batch.lineCount <= 0) {
    throw new Error("Record at least one collection before sending for approval");
  }
  if (batch.status !== "draft" && batch.status !== "rejected") {
    throw new Error("This batch cannot be submitted in its current status");
  }

  const callover = await submitCalloverReport(context.tenantId, context.userId, calloverInput);
  await markBatchPendingApproval(batch, callover.id, calloverInput.agentNotes);

  void notifyTenantStaff({
    tenantId: context.tenantId,
    roles: ["admin", "coordinator"],
    kind: "collection_batch_pending",
    title: "Collection batch awaiting approval",
    body: `Field agent submitted GHS ${batch.totalAmount.toFixed(2)} for ${businessDate} (${batch.lineCount} lines).`
  }).catch(() => {
    /* non-blocking */
  });

  return { batchId: batch.id, status: "pending_approval", calloverReportId: callover.id };
}

export type PendingCollectionBatchView = CollectionBatch & {
  fieldAgentName: string;
  fieldAgentEmail?: string;
  branchId?: string;
};

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
      .eq("business_date", businessDate)
      .eq("status", "pending_approval");

    if (options?.fieldAgentId) {
      query = query.eq("field_agent_id", options.fieldAgentId);
    }

    const { data, error } = await query.order("submitted_at", { ascending: false });
    if (error) {
      throw new Error(`Failed to list pending batches: ${error.message}`);
    }

    for (const row of data ?? []) {
      const batch = await loadBatchRow(context.tenantId, row.field_agent_id, businessDate);
      if (!batch) {
        continue;
      }
      const agent = await resolveAgentName(context.tenantId, batch.fieldAgentId);
      if (!agentMatchesBranchFilter(agent.branchId, context, options?.branchId)) {
        continue;
      }
      results.push({
        ...batch,
        fieldAgentName: agent.name,
        fieldAgentEmail: agent.email,
        branchId: agent.branchId
      });
    }
    return results;
  }

  for (const batch of memoryBatches.values()) {
    if (
      batch.tenantId === context.tenantId &&
      batch.businessDate === businessDate &&
      batch.status === "pending_approval" &&
      (!options?.fieldAgentId || batch.fieldAgentId === options.fieldAgentId)
    ) {
      const agent = await resolveAgentName(context.tenantId, batch.fieldAgentId);
      if (!agentMatchesBranchFilter(agent.branchId, context, options?.branchId)) {
        continue;
      }
      results.push({
        ...batch,
        fieldAgentName: agent.name,
        fieldAgentEmail: agent.email,
        branchId: agent.branchId
      });
    }
  }
  return results;
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

  const agent = await resolveAgentName(context.tenantId, batch.fieldAgentId);
  return { ...batch, fieldAgentName: agent.name, fieldAgentEmail: agent.email, branchId: agent.branchId };
}

async function postSingleBatch(context: CoordinatorContext, batch: CollectionBatch): Promise<CollectionBatch> {
  if (batch.status !== "pending_approval") {
    throw new Error("Only pending batches can be posted");
  }

  for (const line of batch.lines) {
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
        notes: line.notes ? `${line.notes} · batch ${batch.id.slice(0, 8)}` : `Batch ${batch.id.slice(0, 8)}`
      }
    );

    line.transactionId = tx.id;

    const supabase = getSupabaseAdminClient();
    if (supabase) {
      await supabase.from("field_agent_collection_batch_lines").update({ transaction_id: tx.id }).eq("id", line.id);
    }
  }

  batch.status = "posted";
  batch.postedAt = new Date().toISOString();
  batch.postedBy = context.userId;
  await persistBatch(batch);

  if (batch.calloverReportId) {
    const supabase = getSupabaseAdminClient();
    if (supabase) {
      await supabase
        .from("field_agent_callover_reports")
        .update({ status: "reviewed" })
        .eq("id", batch.calloverReportId);
    }
  }

  try {
    await createAgentNotification({
      tenantId: context.tenantId,
      userId: batch.fieldAgentId,
      kind: "collection_batch_posted",
      title: "Collections posted",
      body: `Your batch of GHS ${batch.totalAmount.toFixed(2)} for ${batch.businessDate} was posted to customer accounts.`
    });
  } catch {
    /* non-blocking */
  }

  return batch;
}

export async function postCollectionBatch(context: CoordinatorContext, batchId: string): Promise<CollectionBatch> {
  const batchView = await getCollectionBatchById(context, batchId);
  return postSingleBatch(context, batchView);
}

export async function postAllPendingCollectionBatches(
  context: CoordinatorContext,
  options?: { businessDate?: string; fieldAgentId?: string; branchId?: string }
): Promise<{ posted: number; batchIds: string[] }> {
  const pending = await listPendingCollectionBatches(context, options);
  const batchIds: string[] = [];
  for (const batch of pending) {
    await postSingleBatch(context, batch);
    batchIds.push(batch.id);
  }
  return { posted: batchIds.length, batchIds };
}
