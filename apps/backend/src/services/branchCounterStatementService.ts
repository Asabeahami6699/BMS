import type { Role, Transaction } from "@bms/shared";
import { transactionSchema } from "@bms/shared";
import { getSupabaseAdminClient } from "../config/supabaseClient.js";
import { findUserById, listUsersByTenant } from "./authStore.js";
import { getCustomerById } from "./customerService.js";
import { userDisplayName } from "./userNameResolver.js";

/** Roles that post via branch counter / hall (not mobile field collections). */
const HALL_POSTING_ROLES = new Set<Role>([
  "admin",
  "coordinator",
  "teller",
  "accountant",
  "customer_service"
]);

export type BranchCounterStatementLine = Transaction & {
  customerName: string;
  customerAccountNumber?: string;
  recordedByName: string;
  recordedByRole: string;
  workflowData?: Record<string, unknown>;
};

type UserMeta = {
  role: string;
  name: string;
};

function parseStatementDate(dateStr: string): { start: string; end: string } {
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
    notes: row.notes ? String(row.notes) : undefined,
    executionStatus: row.execution_status ?? "completed",
    bankProductId: row.bank_product_id != null ? String(row.bank_product_id) : undefined,
    workflowData: (row.workflow_data as Record<string, unknown>) ?? undefined
  });
}

export async function listBranchCounterStatement(
  tenantId: string,
  branchId: string,
  dateStr: string
): Promise<BranchCounterStatementLine[]> {
  if (!branchId) {
    throw new Error("Branch is required for the statement");
  }

  const { start, end } = parseStatementDate(dateStr);
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
      .lte("created_at", end)
      .order("created_at", { ascending: false });

    if (error) {
      throw new Error(`Failed to load branch transactions: ${error.message}`);
    }

    transactions = (data ?? []).map((row) => mapTransactionRow(row as Record<string, unknown>));
  } else {
    const { listTransactions } = await import("./transactionService.js");
    const all = await listTransactions(tenantId);
    transactions = all.filter(
      (tx) =>
        tx.transactionBranchId === branchId &&
        tx.createdAt >= start &&
        tx.createdAt <= end
    );
  }

  const hallTx = transactions.filter((tx) => isBranchCounterPost(tx, userMeta));

  const lines: BranchCounterStatementLine[] = [];
  for (const tx of hallTx) {
    const recorder = userMeta.get(tx.recordedByUserId);
    const customer = await getCustomerById(tenantId, tx.customerId);
    lines.push({
      ...tx,
      customerName: customer?.fullName ?? tx.customerId,
      customerAccountNumber: customer?.accountNumber,
      recordedByName: recorder?.name ?? tx.recordedByUserId,
      recordedByRole: recorder?.role ?? "—",
      workflowData: tx.workflowData
    });
  }

  return lines;
}

export type BranchCounterStatementSummary = {
  date: string;
  branchId: string;
  transactionCount: number;
  totalDeposits: number;
  totalWithdrawals: number;
  totalDailySusu: number;
  netAmount: number;
  byStaff: Array<{
    userId: string;
    name: string;
    role: string;
    count: number;
    totalAmount: number;
  }>;
};

export function summarizeBranchCounterStatement(
  lines: BranchCounterStatementLine[],
  date: string,
  branchId: string
): BranchCounterStatementSummary {
  let totalDeposits = 0;
  let totalWithdrawals = 0;
  let totalDailySusu = 0;
  const staffMap = new Map<
    string,
    { userId: string; name: string; role: string; count: number; totalAmount: number }
  >();

  for (const line of lines) {
    if (line.type === "deposit") {
      totalDeposits += line.amount;
    } else if (line.type === "withdrawal") {
      totalWithdrawals += line.amount;
    } else {
      totalDailySusu += line.amount;
    }

    const existing = staffMap.get(line.recordedByUserId);
    if (existing) {
      existing.count += 1;
      existing.totalAmount += line.amount;
    } else {
      staffMap.set(line.recordedByUserId, {
        userId: line.recordedByUserId,
        name: line.recordedByName,
        role: line.recordedByRole,
        count: 1,
        totalAmount: line.amount
      });
    }
  }

  const byStaff = [...staffMap.values()].sort((a, b) => b.totalAmount - a.totalAmount);

  return {
    date,
    branchId,
    transactionCount: lines.length,
    totalDeposits,
    totalWithdrawals,
    totalDailySusu,
    netAmount: totalDeposits + totalDailySusu - totalWithdrawals,
    byStaff
  };
}
