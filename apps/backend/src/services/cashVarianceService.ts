import { randomUUID } from "node:crypto";
import { getSupabaseAdminClient } from "../config/supabaseClient.js";
import { listUsersByTenant } from "./authStore.js";
import { getCustomerById } from "./customerService.js";
import { createAgentNotification } from "./notificationService.js";
import { createTransaction } from "./transactionService.js";
import type { CashVarianceStatus, CollectionBatch } from "./collectionBatchService.js";

export type CashVarianceType = "shortage" | "overage";
export type CashVarianceCaseStatus = "open" | "partially_settled" | "settled" | "written_off";
export type CashVarianceSettlementMethod =
  | "cash_repayment"
  | "salary_deduction"
  | "customer_correction"
  | "write_off"
  | "other";

export type CashVarianceCase = {
  id: string;
  tenantId: string;
  fieldAgentId: string;
  batchId: string;
  businessDate: string;
  branchId?: string;
  varianceType: CashVarianceType;
  batchTotal: number;
  cashReceived: number;
  varianceAmount: number;
  outstandingAmount: number;
  status: CashVarianceCaseStatus;
  notes?: string;
  createdBy?: string;
  createdAt: string;
  updatedAt: string;
  settledAt?: string;
  fieldAgentName?: string;
  fieldAgentEmail?: string;
  settlements?: CashVarianceSettlement[];
};

export type CashVarianceSettlement = {
  id: string;
  varianceId: string;
  tenantId: string;
  amount: number;
  method: CashVarianceSettlementMethod;
  notes?: string;
  recordedBy: string;
  recordedAt: string;
  customerId?: string;
  transactionId?: string;
};

type ActorContext = {
  tenantId: string;
  userId: string;
  role: string;
  branchId?: string;
};

const memoryCases = new Map<string, CashVarianceCase>();
const memorySettlements = new Map<string, CashVarianceSettlement[]>();

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

function mapCaseRow(row: Record<string, unknown>): CashVarianceCase {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    fieldAgentId: String(row.field_agent_id),
    batchId: String(row.batch_id),
    businessDate: String(row.business_date).slice(0, 10),
    branchId: row.branch_id ? String(row.branch_id) : undefined,
    varianceType: row.variance_type as CashVarianceType,
    batchTotal: Number(row.batch_total),
    cashReceived: Number(row.cash_received),
    varianceAmount: Number(row.variance_amount),
    outstandingAmount: Number(row.outstanding_amount),
    status: row.status as CashVarianceCaseStatus,
    notes: row.notes ? String(row.notes) : undefined,
    createdBy: row.created_by ? String(row.created_by) : undefined,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    settledAt: row.settled_at ? String(row.settled_at) : undefined
  };
}

async function attachAgentNames(
  tenantId: string,
  cases: CashVarianceCase[]
): Promise<CashVarianceCase[]> {
  if (cases.length === 0) {
    return cases;
  }
  const ids = [...new Set(cases.map((c) => c.fieldAgentId))];
  const byId = new Map<string, { fullName?: string; email?: string }>();

  const supabase = getSupabaseAdminClient();
  if (supabase) {
    const { data } = await supabase
      .from("users")
      .select("id, full_name, email")
      .eq("tenant_id", tenantId)
      .in("id", ids);
    for (const row of data ?? []) {
      byId.set(String(row.id), {
        fullName: row.full_name ?? undefined,
        email: row.email ?? undefined
      });
    }
  }
  if (byId.size === 0) {
    for (const user of listUsersByTenant(tenantId)) {
      byId.set(user.id, { fullName: user.fullName, email: user.email });
    }
  }

  return cases.map((c) => {
    const user = byId.get(c.fieldAgentId);
    return {
      ...c,
      fieldAgentName: user?.fullName?.trim() || user?.email || c.fieldAgentId.slice(0, 8),
      fieldAgentEmail: user?.email
    };
  });
}

async function resolveAgentBranchId(
  tenantId: string,
  fieldAgentId: string,
  fallback?: string
): Promise<string | undefined> {
  const supabase = getSupabaseAdminClient();
  if (supabase) {
    const { data } = await supabase
      .from("users")
      .select("branch_id")
      .eq("tenant_id", tenantId)
      .eq("id", fieldAgentId)
      .maybeSingle();
    if (data?.branch_id) {
      return String(data.branch_id);
    }
  }
  const agent = listUsersByTenant(tenantId).find((u) => u.id === fieldAgentId);
  return agent?.branchId || fallback || undefined;
}

async function listFieldAgentIdsInBranch(tenantId: string, branchId: string): Promise<string[]> {
  const supabase = getSupabaseAdminClient();
  if (supabase) {
    const { data, error } = await supabase
      .from("users")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("branch_id", branchId)
      .eq("role", "field_agent");
    if (error) {
      throw new Error(`Failed to list branch agents: ${error.message}`);
    }
    return (data ?? []).map((row) => String(row.id));
  }
  return listUsersByTenant(tenantId)
    .filter((u) => u.role === "field_agent" && u.branchId === branchId)
    .map((u) => u.id);
}

/** Open a shortage/overage case after batch post. No-op when balanced. Never nets types. */
export async function openCashVarianceFromBatch(
  batch: CollectionBatch,
  actorUserId: string,
  branchId?: string
): Promise<CashVarianceCase | null> {
  const status = batch.cashVarianceStatus as CashVarianceStatus | undefined;
  if (!status || status === "balanced") {
    return null;
  }
  if (batch.cashReceivedAmount == null || batch.cashVariance == null) {
    return null;
  }

  const varianceType: CashVarianceType = status === "shortage" ? "shortage" : "overage";
  const varianceAmount = roundMoney(Math.abs(batch.cashVariance));
  if (varianceAmount < 0.005) {
    return null;
  }

  const resolvedBranchId = await resolveAgentBranchId(batch.tenantId, batch.fieldAgentId, branchId);

  const now = new Date().toISOString();
  const record: CashVarianceCase = {
    id: randomUUID(),
    tenantId: batch.tenantId,
    fieldAgentId: batch.fieldAgentId,
    batchId: batch.id,
    businessDate: batch.businessDate,
    branchId: resolvedBranchId,
    varianceType,
    batchTotal: roundMoney(batch.totalAmount),
    cashReceived: roundMoney(batch.cashReceivedAmount),
    varianceAmount,
    outstandingAmount: varianceAmount,
    status: "open",
    createdBy: actorUserId,
    createdAt: now,
    updatedAt: now
  };

  const supabase = getSupabaseAdminClient();
  if (supabase) {
    const { data: existing, error: existingErr } = await supabase
      .from("field_agent_cash_variances")
      .select("*")
      .eq("tenant_id", batch.tenantId)
      .eq("batch_id", batch.id)
      .maybeSingle();
    if (existingErr) {
      throw new Error(`Failed to check cash variance case: ${existingErr.message}`);
    }
    if (existing) {
      return mapCaseRow(existing as Record<string, unknown>);
    }

    const { data, error } = await supabase
      .from("field_agent_cash_variances")
      .insert({
        id: record.id,
        tenant_id: record.tenantId,
        field_agent_id: record.fieldAgentId,
        batch_id: record.batchId,
        business_date: record.businessDate,
        branch_id: record.branchId ?? null,
        variance_type: record.varianceType,
        batch_total: record.batchTotal,
        cash_received: record.cashReceived,
        variance_amount: record.varianceAmount,
        outstanding_amount: record.outstandingAmount,
        status: record.status,
        created_by: record.createdBy,
        created_at: record.createdAt,
        updated_at: record.updatedAt
      })
      .select("*")
      .single();

    if (error) {
      throw new Error(`Failed to open cash variance case: ${error.message}`);
    }

    const opened = mapCaseRow(data as Record<string, unknown>);

    try {
      if (opened.varianceType === "shortage") {
        await createAgentNotification({
          tenantId: batch.tenantId,
          userId: batch.fieldAgentId,
          kind: "cash_shortage_opened",
          title: "Cash shortage recorded",
          body: `Callover ${batch.businessDate}: you owe GHS ${opened.varianceAmount.toFixed(2)}. Pay at the office — this is not cleared by later overages.`
        });
      } else {
        await createAgentNotification({
          tenantId: batch.tenantId,
          userId: batch.fieldAgentId,
          kind: "cash_overage_opened",
          title: "Cash overage to reconcile",
          body: `Callover ${batch.businessDate}: GHS ${opened.varianceAmount.toFixed(2)} above system total. Find unposted customer contributions — this cannot settle a shortage.`
        });
      }
    } catch {
      /* non-blocking */
    }

    return opened;
  }

  const existing = [...memoryCases.values()].find(
    (c) => c.tenantId === batch.tenantId && c.batchId === batch.id
  );
  if (existing) {
    return existing;
  }
  memoryCases.set(record.id, record);

  try {
    if (record.varianceType === "shortage") {
      await createAgentNotification({
        tenantId: batch.tenantId,
        userId: batch.fieldAgentId,
        kind: "cash_shortage_opened",
        title: "Cash shortage recorded",
        body: `Callover ${batch.businessDate}: you owe GHS ${record.varianceAmount.toFixed(2)}. Pay at the office — this is not cleared by later overages.`
      });
    } else {
      await createAgentNotification({
        tenantId: batch.tenantId,
        userId: batch.fieldAgentId,
        kind: "cash_overage_opened",
        title: "Cash overage to reconcile",
        body: `Callover ${batch.businessDate}: GHS ${record.varianceAmount.toFixed(2)} above system total. Find unposted customer contributions — this cannot settle a shortage.`
      });
    }
  } catch {
    /* non-blocking */
  }

  return record;
}

export async function listCashVariances(
  context: ActorContext,
  options?: {
    status?: "open" | "all" | CashVarianceCaseStatus;
    fieldAgentId?: string;
    branchId?: string;
    varianceType?: CashVarianceType;
    businessDate?: string;
    fromDate?: string;
    toDate?: string;
  }
): Promise<CashVarianceCase[]> {
  const statusFilter = options?.status ?? "open";
  const supabase = getSupabaseAdminClient();

  if (supabase) {
    let query = supabase
      .from("field_agent_cash_variances")
      .select("*")
      .eq("tenant_id", context.tenantId)
      .order("business_date", { ascending: false });

    if (statusFilter === "open") {
      query = query.in("status", ["open", "partially_settled"]);
    } else if (statusFilter !== "all") {
      query = query.eq("status", statusFilter);
    }
    if (options?.fieldAgentId) {
      query = query.eq("field_agent_id", options.fieldAgentId);
    }
    // Match branch_id or agents assigned to that branch (covers older rows with null branch_id).
    if (options?.branchId) {
      const agentIds = await listFieldAgentIdsInBranch(context.tenantId, options.branchId);
      if (agentIds.length > 0) {
        query = query.or(
          `branch_id.eq.${options.branchId},field_agent_id.in.(${agentIds.join(",")})`
        );
      } else {
        query = query.eq("branch_id", options.branchId);
      }
    }
    if (options?.varianceType) {
      query = query.eq("variance_type", options.varianceType);
    }
    if (options?.businessDate) {
      query = query.eq("business_date", options.businessDate);
    } else {
      if (options?.fromDate) {
        query = query.gte("business_date", options.fromDate);
      }
      if (options?.toDate) {
        query = query.lte("business_date", options.toDate);
      }
    }

    const { data, error } = await query;
    if (error) {
      throw new Error(`Failed to list cash variances: ${error.message}`);
    }
    return attachAgentNames(
      context.tenantId,
      (data ?? []).map((row) => mapCaseRow(row as Record<string, unknown>))
    );
  }

  let cases = [...memoryCases.values()].filter((c) => c.tenantId === context.tenantId);
  if (statusFilter === "open") {
    cases = cases.filter((c) => c.status === "open" || c.status === "partially_settled");
  } else if (statusFilter !== "all") {
    cases = cases.filter((c) => c.status === statusFilter);
  }
  if (options?.fieldAgentId) {
    cases = cases.filter((c) => c.fieldAgentId === options.fieldAgentId);
  }
  if (options?.branchId) {
    const agentIds = new Set(await listFieldAgentIdsInBranch(context.tenantId, options.branchId));
    cases = cases.filter(
      (c) => c.branchId === options.branchId || agentIds.has(c.fieldAgentId)
    );
  }
  if (options?.varianceType) {
    cases = cases.filter((c) => c.varianceType === options.varianceType);
  }
  if (options?.businessDate) {
    cases = cases.filter((c) => c.businessDate === options.businessDate);
  } else {
    if (options?.fromDate) {
      cases = cases.filter((c) => c.businessDate >= options.fromDate!);
    }
    if (options?.toDate) {
      cases = cases.filter((c) => c.businessDate <= options.toDate!);
    }
  }
  cases.sort((a, b) => b.businessDate.localeCompare(a.businessDate));
  return attachAgentNames(context.tenantId, cases);
}

export async function listMyCashVariances(
  context: { tenantId: string; userId: string },
  options?: { status?: "open" | "all" }
): Promise<{
  shortages: CashVarianceCase[];
  overages: CashVarianceCase[];
  totalShortageOutstanding: number;
  totalOverageOutstanding: number;
}> {
  const cases = await listCashVariances(
    { tenantId: context.tenantId, userId: context.userId, role: "field_agent" },
    { status: options?.status ?? "open", fieldAgentId: context.userId }
  );
  const shortages = cases.filter((c) => c.varianceType === "shortage");
  const overages = cases.filter((c) => c.varianceType === "overage");
  return {
    shortages,
    overages,
    totalShortageOutstanding: roundMoney(
      shortages.reduce((s, c) => s + c.outstandingAmount, 0)
    ),
    totalOverageOutstanding: roundMoney(overages.reduce((s, c) => s + c.outstandingAmount, 0))
  };
}

export async function settleCashVariance(
  context: ActorContext,
  varianceId: string,
  input: {
    amount: number;
    method: CashVarianceSettlementMethod;
    notes?: string;
    customerId?: string;
    transactionId?: string;
  }
): Promise<CashVarianceCase> {
  const amount = roundMoney(input.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("Enter a positive settlement amount");
  }

  const supabase = getSupabaseAdminClient();
  let current: CashVarianceCase | null = null;

  if (supabase) {
    const { data, error } = await supabase
      .from("field_agent_cash_variances")
      .select("*")
      .eq("tenant_id", context.tenantId)
      .eq("id", varianceId)
      .maybeSingle();
    if (error) {
      throw new Error(`Failed to load cash variance: ${error.message}`);
    }
    if (!data) {
      throw new Error("Cash variance case not found");
    }
    current = mapCaseRow(data as Record<string, unknown>);
  } else {
    current = memoryCases.get(varianceId) ?? null;
    if (!current || current.tenantId !== context.tenantId) {
      throw new Error("Cash variance case not found");
    }
  }

  if (current.status === "settled" || current.status === "written_off") {
    throw new Error("This variance is already closed");
  }
  if (amount - current.outstandingAmount > 0.005) {
    throw new Error(
      `Settlement cannot exceed outstanding GHS ${current.outstandingAmount.toFixed(2)}`
    );
  }

  if (current.varianceType === "shortage") {
    if (input.method === "customer_correction") {
      throw new Error("Use cash repayment or salary deduction for shortages — do not clear with overages");
    }
  } else if (input.method === "cash_repayment" || input.method === "salary_deduction") {
    throw new Error(
      "Overage is not agent debt — reconcile missing customer entries (customer correction) instead"
    );
  }

  const settlement: CashVarianceSettlement = {
    id: randomUUID(),
    varianceId: current.id,
    tenantId: context.tenantId,
    amount,
    method: input.method,
    notes: input.notes?.trim() || undefined,
    recordedBy: context.userId,
    recordedAt: new Date().toISOString(),
    customerId: input.customerId,
    transactionId: input.transactionId
  };

  const nextOutstanding = roundMoney(current.outstandingAmount - amount);
  const isWriteOff = input.method === "write_off" && nextOutstanding < 0.005;
  const nextStatus: CashVarianceCaseStatus =
    nextOutstanding < 0.005
      ? isWriteOff
        ? "written_off"
        : "settled"
      : "partially_settled";
  const now = new Date().toISOString();

  if (supabase) {
    const { error: settleErr } = await supabase.from("field_agent_cash_variance_settlements").insert({
      id: settlement.id,
      variance_id: settlement.varianceId,
      tenant_id: settlement.tenantId,
      amount: settlement.amount,
      method: settlement.method,
      notes: settlement.notes ?? null,
      recorded_by: settlement.recordedBy,
      recorded_at: settlement.recordedAt,
      customer_id: settlement.customerId ?? null,
      transaction_id: settlement.transactionId ?? null
    });
    if (settleErr) {
      throw new Error(`Failed to record settlement: ${settleErr.message}`);
    }

    const { data: updated, error: updateErr } = await supabase
      .from("field_agent_cash_variances")
      .update({
        outstanding_amount: nextOutstanding,
        status: nextStatus,
        updated_at: now,
        settled_at: nextOutstanding < 0.005 ? now : null
      })
      .eq("id", current.id)
      .eq("tenant_id", context.tenantId)
      .select("*")
      .single();

    if (updateErr) {
      throw new Error(`Failed to update cash variance: ${updateErr.message}`);
    }

    current = mapCaseRow(updated as Record<string, unknown>);
  } else {
    const list = memorySettlements.get(current.id) ?? [];
    list.push(settlement);
    memorySettlements.set(current.id, list);
    current = {
      ...current,
      outstandingAmount: nextOutstanding,
      status: nextStatus,
      updatedAt: now,
      settledAt: nextOutstanding < 0.005 ? now : undefined
    };
    memoryCases.set(current.id, current);
  }

  try {
    if (nextStatus === "settled" || nextStatus === "written_off") {
      await createAgentNotification({
        tenantId: context.tenantId,
        userId: current.fieldAgentId,
        kind: "cash_variance_settled",
        title:
          current.varianceType === "shortage"
            ? "Shortage cleared"
            : "Overage reconciled",
        body:
          current.varianceType === "shortage"
            ? `Your GHS ${current.varianceAmount.toFixed(2)} shortage for ${current.businessDate} is cleared.`
            : `Your GHS ${current.varianceAmount.toFixed(2)} overage for ${current.businessDate} is reconciled.`
      });
    }
  } catch {
    /* non-blocking */
  }

  const [named] = await attachAgentNames(context.tenantId, [current]);
  return named ?? current;
}

/**
 * Credit a customer from an agent's open overage (card/account shortage complaint).
 * Posts a daily_susu credit with notes "Settled shortage" and reduces the overage case.
 * Never uses shortage balances — shortages are agent debt to the office only.
 */
export async function creditCustomerFromOverage(
  context: ActorContext & { scopeType: "head_office" | "branch"; role: string },
  varianceId: string,
  input: { customerId: string; amount: number; notes?: string }
): Promise<{ variance: CashVarianceCase; transactionId: string }> {
  const amount = roundMoney(input.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("Enter a positive credit amount");
  }

  const cases = await listCashVariances(context, { status: "all" });
  const current = cases.find((c) => c.id === varianceId);
  if (!current) {
    throw new Error("Cash variance case not found");
  }
  if (current.varianceType !== "overage") {
    throw new Error("Only overage balances can credit a customer. Shortages must be repaid by the agent.");
  }
  if (current.status === "settled" || current.status === "written_off") {
    throw new Error("This overage is already closed");
  }
  if (amount - current.outstandingAmount > 0.005) {
    throw new Error(
      `Credit cannot exceed open overage GHS ${current.outstandingAmount.toFixed(2)}`
    );
  }

  const customer = await getCustomerById(context.tenantId, input.customerId);
  if (!customer) {
    throw new Error("Customer not found");
  }
  if (customer.status !== "active") {
    throw new Error("Customer must be active to receive a credit");
  }

  const branchId = customer.homeBranchId ?? context.branchId;
  if (!branchId) {
    throw new Error("No branch available to post the customer credit");
  }

  const extra = input.notes?.trim();
  const notes = extra
    ? `Settled shortage · overage ${current.businessDate} · ${extra}`
    : `Settled shortage · overage ${current.businessDate}`;

  const tx = await createTransaction(
    {
      tenantId: context.tenantId,
      userId: context.userId,
      role: context.role,
      branchId: context.branchId,
      scopeType: context.scopeType
    },
    {
      customerId: customer.id,
      type: "daily_susu",
      amount,
      transactionBranchId: branchId,
      notes
    }
  );

  const variance = await settleCashVariance(context, varianceId, {
    amount,
    method: "customer_correction",
    notes,
    customerId: customer.id,
    transactionId: tx.id
  });

  return { variance, transactionId: tx.id };
}
