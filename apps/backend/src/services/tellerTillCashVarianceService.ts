import { formatAccountAmount } from "@bms/shared";
import { randomUUID } from "node:crypto";
import { getSupabaseAdminClient } from "../config/supabaseClient.js";
import { listUsersByTenant } from "./authStore.js";
import { createAgentNotification, notifyTenantStaff } from "./notificationService.js";
import type { BranchFloatSession } from "./branchFloatService.js";

export type TillVarianceType = "shortage" | "overage";
export type TillVarianceCaseStatus = "open" | "partially_settled" | "settled" | "written_off";
export type TillVarianceSettlementMethod =
  | "cash_repayment"
  | "salary_deduction"
  | "customer_correction"
  | "write_off"
  | "other";

export type TellerTillCashVarianceCase = {
  id: string;
  source: "teller_till";
  tenantId: string;
  cashierUserId: string;
  floatSessionId: string;
  businessDate: string;
  branchId?: string;
  varianceType: TillVarianceType;
  expectedCash: number;
  actualCash: number;
  varianceAmount: number;
  outstandingAmount: number;
  status: TillVarianceCaseStatus;
  notes?: string;
  createdBy?: string;
  createdAt: string;
  updatedAt: string;
  settledAt?: string;
  cashierName?: string;
  cashierEmail?: string;
};

type ActorContext = {
  tenantId: string;
  userId: string;
  role: string;
  branchId?: string;
};

const memoryCases = new Map<string, TellerTillCashVarianceCase>();

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

function mapRow(row: Record<string, unknown>): TellerTillCashVarianceCase {
  return {
    id: String(row.id),
    source: "teller_till",
    tenantId: String(row.tenant_id),
    cashierUserId: String(row.cashier_user_id),
    floatSessionId: String(row.float_session_id),
    businessDate: String(row.business_date).slice(0, 10),
    branchId: row.branch_id ? String(row.branch_id) : undefined,
    varianceType: row.variance_type as TillVarianceType,
    expectedCash: Number(row.expected_cash),
    actualCash: Number(row.actual_cash),
    varianceAmount: Number(row.variance_amount),
    outstandingAmount: Number(row.outstanding_amount),
    status: row.status as TillVarianceCaseStatus,
    notes: row.notes ? String(row.notes) : undefined,
    createdBy: row.created_by ? String(row.created_by) : undefined,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    settledAt: row.settled_at ? String(row.settled_at) : undefined
  };
}

async function attachCashierNames(
  tenantId: string,
  cases: TellerTillCashVarianceCase[]
): Promise<TellerTillCashVarianceCase[]> {
  if (cases.length === 0) {
    return cases;
  }
  const ids = [...new Set(cases.map((c) => c.cashierUserId))];
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
    const user = byId.get(c.cashierUserId);
    return {
      ...c,
      cashierName: user?.fullName?.trim() || user?.email || c.cashierUserId.slice(0, 8),
      cashierEmail: user?.email
    };
  });
}

/** Open a teller till OS case after EOD close when variance ≠ 0. Idempotent per session. */
export async function openTillCashVarianceFromClose(
  session: BranchFloatSession,
  actorUserId: string
): Promise<TellerTillCashVarianceCase | null> {
  const variance = session.variance ?? 0;
  if (Math.abs(variance) < 0.005) {
    return null;
  }

  const varianceType: TillVarianceType = variance > 0 ? "overage" : "shortage";
  const varianceAmount = roundMoney(Math.abs(variance));
  const now = new Date().toISOString();
  const record: TellerTillCashVarianceCase = {
    id: randomUUID(),
    source: "teller_till",
    tenantId: session.tenantId,
    cashierUserId: session.cashierUserId,
    floatSessionId: session.id,
    businessDate: session.businessDate,
    branchId: session.branchId,
    varianceType,
    expectedCash: session.expectedClosing ?? 0,
    actualCash: session.actualClosing ?? 0,
    varianceAmount,
    outstandingAmount: varianceAmount,
    status: "open",
    notes: session.varianceNote,
    createdBy: actorUserId,
    createdAt: now,
    updatedAt: now
  };

  const supabase = getSupabaseAdminClient();
  if (supabase) {
    const { data: existing } = await supabase
      .from("teller_till_cash_variances")
      .select("*")
      .eq("float_session_id", session.id)
      .maybeSingle();
    if (existing) {
      return mapRow(existing as Record<string, unknown>);
    }

    const { data, error } = await supabase
      .from("teller_till_cash_variances")
      .insert({
        id: record.id,
        tenant_id: record.tenantId,
        cashier_user_id: record.cashierUserId,
        float_session_id: record.floatSessionId,
        business_date: record.businessDate,
        branch_id: record.branchId ?? null,
        variance_type: record.varianceType,
        expected_cash: record.expectedCash,
        actual_cash: record.actualCash,
        variance_amount: record.varianceAmount,
        outstanding_amount: record.outstandingAmount,
        status: record.status,
        notes: record.notes ?? null,
        created_by: record.createdBy ?? null,
        created_at: record.createdAt,
        updated_at: record.updatedAt
      })
      .select("*")
      .single();

    if (error) {
      if (/duplicate|unique/i.test(error.message)) {
        const { data: again } = await supabase
          .from("teller_till_cash_variances")
          .select("*")
          .eq("float_session_id", session.id)
          .maybeSingle();
        if (again) {
          return mapRow(again as Record<string, unknown>);
        }
      }
      throw new Error(`Failed to open till cash variance: ${error.message}`);
    }
    const saved = mapRow(data as Record<string, unknown>);
    try {
      await notifyTenantStaff({
        tenantId: session.tenantId,
        roles: ["admin", "coordinator"],
        kind: varianceType === "shortage" ? "cash_shortage_opened" : "cash_overage_opened",
        title: varianceType === "shortage" ? "Teller till shortage" : "Teller till overage",
        body: `GHS ${formatAccountAmount(varianceAmount)} ${varianceType} on till close for ${session.businessDate}.`
      });
      await createAgentNotification({
        tenantId: session.tenantId,
        userId: session.cashierUserId,
        kind: varianceType === "shortage" ? "cash_shortage_opened" : "cash_overage_opened",
        title: varianceType === "shortage" ? "Till shortage opened" : "Till overage opened",
        body: `Your till close for ${session.businessDate} has a GHS ${formatAccountAmount(varianceAmount)} ${varianceType}.`
      });
    } catch {
      // Non-blocking
    }
    return saved;
  }

  memoryCases.set(record.id, record);
  return record;
}

export async function listTellerTillCashVariances(
  context: ActorContext,
  options?: {
    status?: "open" | "all";
    cashierUserId?: string;
    varianceType?: TillVarianceType;
    fromDate?: string;
    toDate?: string;
  }
): Promise<TellerTillCashVarianceCase[]> {
  const supabase = getSupabaseAdminClient();
  let cases: TellerTillCashVarianceCase[] = [];

  if (supabase) {
    let query = supabase
      .from("teller_till_cash_variances")
      .select("*")
      .eq("tenant_id", context.tenantId)
      .order("business_date", { ascending: false });

    if (options?.status === "open" || !options?.status) {
      query = query.in("status", ["open", "partially_settled"]);
    }
    if (options?.cashierUserId) {
      query = query.eq("cashier_user_id", options.cashierUserId);
    }
    if (options?.varianceType) {
      query = query.eq("variance_type", options.varianceType);
    }
    if (options?.fromDate) {
      query = query.gte("business_date", options.fromDate);
    }
    if (options?.toDate) {
      query = query.lte("business_date", options.toDate);
    }

    const { data, error } = await query;
    if (error) {
      if (/teller_till_cash_variances|does not exist|schema cache/i.test(error.message)) {
        return [];
      }
      throw new Error(`Failed to list till cash variances: ${error.message}`);
    }
    cases = (data ?? []).map((row) => mapRow(row as Record<string, unknown>));
  } else {
    cases = [...memoryCases.values()].filter((c) => c.tenantId === context.tenantId);
    if (options?.status === "open" || !options?.status) {
      cases = cases.filter((c) => c.status === "open" || c.status === "partially_settled");
    }
    if (options?.cashierUserId) {
      cases = cases.filter((c) => c.cashierUserId === options.cashierUserId);
    }
    if (options?.varianceType) {
      cases = cases.filter((c) => c.varianceType === options.varianceType);
    }
    if (options?.fromDate) {
      cases = cases.filter((c) => c.businessDate >= options.fromDate!);
    }
    if (options?.toDate) {
      cases = cases.filter((c) => c.businessDate <= options.toDate!);
    }
    cases.sort((a, b) => b.businessDate.localeCompare(a.businessDate));
  }

  return attachCashierNames(context.tenantId, cases);
}

export async function settleTellerTillCashVariance(
  context: ActorContext,
  varianceId: string,
  input: { amount: number; method: TillVarianceSettlementMethod; notes?: string }
): Promise<TellerTillCashVarianceCase> {
  if (context.role !== "admin" && context.role !== "coordinator") {
    throw new Error("Only admin or coordinator can settle till variances");
  }
  const amount = roundMoney(input.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("Enter a positive settlement amount");
  }

  const supabase = getSupabaseAdminClient();
  let current: TellerTillCashVarianceCase | null = null;

  if (supabase) {
    const { data, error } = await supabase
      .from("teller_till_cash_variances")
      .select("*")
      .eq("tenant_id", context.tenantId)
      .eq("id", varianceId)
      .maybeSingle();
    if (error) {
      throw new Error(`Failed to load till variance: ${error.message}`);
    }
    if (!data) {
      throw new Error("Till cash variance case not found");
    }
    current = mapRow(data as Record<string, unknown>);
  } else {
    current = memoryCases.get(varianceId) ?? null;
    if (!current || current.tenantId !== context.tenantId) {
      throw new Error("Till cash variance case not found");
    }
  }

  if (current.status === "settled" || current.status === "written_off") {
    throw new Error("This till variance is already closed");
  }
  if (amount - current.outstandingAmount > 0.005) {
    throw new Error(
      `Settlement cannot exceed outstanding GHS ${formatAccountAmount(current.outstandingAmount)}`
    );
  }

  const nextOutstanding = roundMoney(current.outstandingAmount - amount);
  const isWriteOff = input.method === "write_off" && nextOutstanding < 0.005;
  const nextStatus: TillVarianceCaseStatus =
    nextOutstanding < 0.005 ? (isWriteOff ? "written_off" : "settled") : "partially_settled";
  const now = new Date().toISOString();

  if (supabase) {
    const { error: settleErr } = await supabase.from("teller_till_cash_variance_settlements").insert({
      id: randomUUID(),
      variance_id: current.id,
      tenant_id: context.tenantId,
      amount,
      method: input.method,
      notes: input.notes?.trim() || null,
      recorded_by: context.userId,
      recorded_at: now
    });
    if (settleErr) {
      throw new Error(`Failed to record till settlement: ${settleErr.message}`);
    }

    const { data: updated, error: updateErr } = await supabase
      .from("teller_till_cash_variances")
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
      throw new Error(`Failed to update till variance: ${updateErr.message}`);
    }
    current = mapRow(updated as Record<string, unknown>);
  } else {
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
        userId: current.cashierUserId,
        kind: "cash_variance_settled",
        title: current.varianceType === "shortage" ? "Till shortage cleared" : "Till overage reconciled",
        body: `Your GHS ${formatAccountAmount(current.varianceAmount)} till ${current.varianceType} for ${current.businessDate} is closed.`
      });
    }
  } catch {
    // Non-blocking
  }

  const [named] = await attachCashierNames(context.tenantId, [current]);
  return named!;
}
