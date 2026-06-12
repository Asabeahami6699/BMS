import type { Transaction } from "@bms/shared";
import { transactionSchema } from "@bms/shared";
import { getSupabaseAdminClient } from "../config/supabaseClient.js";
import { listUsersByTenant } from "./authStore.js";
import { DISCLOSURE_WITHDRAWAL_NOTE_TAG } from "./transactionService.js";
import { userDisplayName } from "./userNameResolver.js";
import type { Role } from "@bms/shared";

type RoleContext = {
  role: string;
  scopeType: "head_office" | "branch";
  branchId?: string;
};

export type SusuClosingBalanceSnapshot = {
  branchId: string;
  businessDate: string;
  initialCash: number;
  fieldAgentDeposits: number;
  walkInDeposits: number;
  fieldAgentWithdrawals: number;
  walkInWithdrawals: number;
  susuExpenses: number;
  totalInflows: number;
  totalOutflows: number;
  cashRemaining: number;
  notes?: string;
  recordedBy?: string;
  updatedAt?: string;
};

type UserMeta = { role: string; name: string };

const HALL_POSTING_ROLES = new Set<Role>([
  "admin",
  "coordinator",
  "teller",
  "accountant",
  "customer_service"
]);

function parseDate(dateStr: string): { start: string; end: string } {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    throw new Error("Invalid date — use YYYY-MM-DD");
  }
  return {
    start: `${dateStr}T00:00:00.000Z`,
    end: `${dateStr}T23:59:59.999Z`
  };
}

async function fetchUserMetaMap(tenantId: string): Promise<Map<string, UserMeta>> {
  const map = new Map<string, UserMeta>();
  const supabase = getSupabaseAdminClient();
  if (supabase) {
    const { data, error } = await supabase
      .from("users")
      .select("id, role, full_name, email")
      .eq("tenant_id", tenantId);
    if (error) {
      throw new Error(`Failed to load users: ${error.message}`);
    }
    for (const row of data ?? []) {
      const id = String(row.id);
      map.set(id, {
        role: String(row.role),
        name: userDisplayName(row.full_name, row.email, id)
      });
    }
    return map;
  }
  for (const user of listUsersByTenant(tenantId)) {
    map.set(user.id, {
      role: user.role,
      name: userDisplayName(user.fullName, user.email, user.id)
    });
  }
  return map;
}

function isBranchCounterPost(tx: Transaction, userMeta: Map<string, UserMeta>): boolean {
  const meta = userMeta.get(tx.recordedByUserId);
  if (!meta) {
    return false;
  }
  if (HALL_POSTING_ROLES.has(meta.role as Role)) {
    return true;
  }
  return tx.recordedByUserId !== tx.fieldAgentId;
}

function isFieldAgentChannelPost(tx: Transaction, userMeta: Map<string, UserMeta>): boolean {
  if (tx.notes?.toLowerCase().includes("batch")) {
    return true;
  }
  if (tx.notes?.includes(DISCLOSURE_WITHDRAWAL_NOTE_TAG)) {
    return true;
  }
  const meta = userMeta.get(tx.recordedByUserId);
  if (meta?.role === "field_agent") {
    return true;
  }
  return false;
}

function mapTransactionRow(row: Record<string, unknown>): Transaction {
  return transactionSchema.parse({
    id: String(row.id),
    tenantId: String(row.tenant_id),
    customerId: String(row.customer_id),
    type: row.type,
    amount: Number(row.amount),
    transactionBranchId: String(row.transaction_branch_id),
    homeBranchId: String(row.home_branch_id),
    recordedByUserId: String(row.recorded_by_user_id),
    fieldAgentId: String(row.field_agent_id),
    createdAt: String(row.created_at),
    notes: row.notes ? String(row.notes) : undefined
  });
}

async function loadClosingRecord(
  tenantId: string,
  branchId: string,
  businessDate: string
): Promise<{
  initialCash: number;
  susuExpenses: number;
  notes?: string;
  recordedBy?: string;
  updatedAt?: string;
}> {
  const supabase = getSupabaseAdminClient();
  if (!supabase) {
    return { initialCash: 0, susuExpenses: 0 };
  }

  const { data, error } = await supabase
    .from("susu_daily_closing_records")
    .select("initial_cash, susu_expenses, notes, recorded_by, updated_at")
    .eq("tenant_id", tenantId)
    .eq("branch_id", branchId)
    .eq("business_date", businessDate)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load closing record: ${error.message}`);
  }

  if (!data) {
    const { data: floatRow } = await supabase
      .from("branch_float_sessions")
      .select("opening_float")
      .eq("tenant_id", tenantId)
      .eq("branch_id", branchId)
      .eq("business_date", businessDate)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    return {
      initialCash: floatRow?.opening_float != null ? Number(floatRow.opening_float) : 0,
      susuExpenses: 0
    };
  }

  return {
    initialCash: Number(data.initial_cash ?? 0),
    susuExpenses: Number(data.susu_expenses ?? 0),
    notes: data.notes != null ? String(data.notes) : undefined,
    recordedBy: data.recorded_by != null ? String(data.recorded_by) : undefined,
    updatedAt: data.updated_at != null ? String(data.updated_at) : undefined
  };
}

export async function getSusuClosingBalance(
  tenantId: string,
  context: RoleContext,
  branchId: string,
  businessDate: string
): Promise<SusuClosingBalanceSnapshot> {
  if (!branchId) {
    throw new Error("Branch is required");
  }
  if (context.scopeType === "branch" && context.branchId && context.branchId !== branchId) {
    throw new Error("Cannot view closing balance for another branch");
  }

  const { start, end } = parseDate(businessDate);
  const userMeta = await fetchUserMetaMap(tenantId);
  const supabase = getSupabaseAdminClient();

  let transactions: Transaction[] = [];
  if (supabase) {
    const { data, error } = await supabase
      .from("customer_transactions")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("transaction_branch_id", branchId)
      .gte("created_at", start)
      .lte("created_at", end);
    if (error) {
      throw new Error(`Failed to load transactions: ${error.message}`);
    }
    transactions = (data ?? []).map((row) => mapTransactionRow(row as Record<string, unknown>));
  } else {
    const { listTransactions } = await import("./transactionService.js");
    const all = await listTransactions(tenantId);
    transactions = all.filter(
      (tx) =>
        tx.transactionBranchId === branchId && tx.createdAt >= start && tx.createdAt <= end
    );
  }

  let fieldAgentDeposits = 0;
  let walkInDeposits = 0;
  let fieldAgentWithdrawals = 0;
  let walkInWithdrawals = 0;

  for (const tx of transactions) {
    const isHall = isBranchCounterPost(tx, userMeta);
    const isField = isFieldAgentChannelPost(tx, userMeta);

    if (tx.type === "withdrawal") {
      if (isField && !isHall) {
        fieldAgentWithdrawals += tx.amount;
      } else if (isHall) {
        walkInWithdrawals += tx.amount;
      }
      continue;
    }

    const inflow = tx.type === "deposit" || tx.type === "daily_susu";
    if (!inflow) {
      continue;
    }

    if (isField && !isHall) {
      fieldAgentDeposits += tx.amount;
    } else if (isHall) {
      walkInDeposits += tx.amount;
    }
  }

  const record = await loadClosingRecord(tenantId, branchId, businessDate);
  const totalInflows = record.initialCash + fieldAgentDeposits + walkInDeposits;
  const totalOutflows = fieldAgentWithdrawals + walkInWithdrawals + record.susuExpenses;
  const cashRemaining = Math.round((totalInflows - totalOutflows) * 100) / 100;

  return {
    branchId,
    businessDate,
    initialCash: record.initialCash,
    fieldAgentDeposits: Math.round(fieldAgentDeposits * 100) / 100,
    walkInDeposits: Math.round(walkInDeposits * 100) / 100,
    fieldAgentWithdrawals: Math.round(fieldAgentWithdrawals * 100) / 100,
    walkInWithdrawals: Math.round(walkInWithdrawals * 100) / 100,
    susuExpenses: record.susuExpenses,
    totalInflows: Math.round(totalInflows * 100) / 100,
    totalOutflows: Math.round(totalOutflows * 100) / 100,
    cashRemaining,
    notes: record.notes,
    recordedBy: record.recordedBy,
    updatedAt: record.updatedAt
  };
}

export async function saveSusuClosingRecord(
  tenantId: string,
  context: RoleContext & { userId: string },
  input: {
    branchId: string;
    businessDate: string;
    initialCash: number;
    susuExpenses: number;
    notes?: string;
  }
): Promise<SusuClosingBalanceSnapshot> {
  if (context.role !== "admin" && context.role !== "coordinator" && context.role !== "accountant") {
    throw new Error("Only admin, coordinator, or accountant can save closing records");
  }
  if (context.scopeType === "branch" && context.branchId && context.branchId !== input.branchId) {
    throw new Error("Cannot save closing record for another branch");
  }

  const supabase = getSupabaseAdminClient();
  if (!supabase) {
    throw new Error("Closing records require database storage");
  }

  const now = new Date().toISOString();
  const { error } = await supabase.from("susu_daily_closing_records").upsert(
    {
      tenant_id: tenantId,
      branch_id: input.branchId,
      business_date: input.businessDate,
      initial_cash: input.initialCash,
      susu_expenses: input.susuExpenses,
      notes: input.notes ?? null,
      recorded_by: context.userId,
      updated_at: now
    },
    { onConflict: "tenant_id,branch_id,business_date" }
  );

  if (error) {
    throw new Error(`Failed to save closing record: ${error.message}`);
  }

  return getSusuClosingBalance(tenantId, context, input.branchId, input.businessDate);
}
