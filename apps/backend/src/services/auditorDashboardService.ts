import { auditorDashboardSchema, type AuditorDashboard, type Permission } from "@bms/shared";
import { getBackOfficeBootstrap } from "./backOfficeService.js";
import { listBranches } from "./branchService.js";
import { listTransactions } from "./transactionService.js";
import { getTreasuryBootstrap } from "./treasuryService.js";
import type { TransactionRequestContext } from "./transactionService.js";
import type { UserContext } from "../types/express.js";
import { getSupabaseAdminClient } from "../config/supabaseClient.js";
import { HIGH_VALUE_DEFAULT } from "./accountantDashboardService.js";

function toUserContext(context: TransactionRequestContext): UserContext {
  return {
    userId: context.userId,
    tenantId: context.tenantId,
    role: context.role,
    scopeType: context.scopeType,
    branchId: context.branchId,
    permissions: (context.permissions ?? []) as Permission[]
  };
}

export async function getAuditorDashboard(
  context: TransactionRequestContext,
  options?: { branchId?: string }
): Promise<AuditorDashboard> {
  const filterBranchId = options?.branchId?.trim() || undefined;
  const businessDate = new Date().toISOString().slice(0, 10);
  const userCtx = toUserContext(context);

  const [backOffice, branches, transactions, auditLogs] = await Promise.all([
    getBackOfficeBootstrap(context, {
      branchId: filterBranchId ?? (context.scopeType === "head_office" ? "all" : context.branchId),
      businessDate
    }).catch(() => null),
    listBranches(context.tenantId).catch(() => []),
    listTransactions(context.tenantId),
    loadRecentAuditLogs(context.tenantId, 300)
  ]);

  const scopedTransactions = filterBranchId
    ? transactions.filter((tx) => tx.transactionBranchId === filterBranchId)
    : context.scopeType === "branch" && context.branchId
      ? transactions.filter((tx) => tx.transactionBranchId === context.branchId)
      : transactions;

  const pendingDeposits =
    backOffice?.depositQueue?.filter(
      (d) => d.executionStatus === "pending_bank" || d.executionStatus === "pending_accountant"
    ).length ?? 0;
  const pendingEcash = backOffice?.pendingEcashCount ?? 0;
  const transactionsNeedingReview = pendingDeposits + pendingEcash;

  const cashDifferences =
    backOffice?.tellerReconciliation?.filter((row) => Math.abs(row.difference) > 0.01).length ?? 0;

  const operationalBranches = filterBranchId
    ? branches.filter((b) => b.id === filterBranchId && b.status === "active")
    : branches.filter((b) => b.status === "active");

  let vaultDifference = 0;
  await Promise.all(
    operationalBranches.map(async (branch) => {
      try {
        const bootstrap = await getTreasuryBootstrap(userCtx, branch.id, branch.name);
        if (!bootstrap.trialBalance.isBalanced) {
          vaultDifference += 1;
        }
      } catch {
        /* skip */
      }
    })
  );

  const reversedTransactions = scopedTransactions.filter(
    (tx) => String(tx.notes ?? "").toLowerCase().includes("revers")
  ).length;

  const highValueTransactions = scopedTransactions.filter(
    (tx) => tx.amount >= HIGH_VALUE_DEFAULT
  ).length;

  const today = businessDate;
  const userActivityLogs = auditLogs.filter((row) => row.createdAt.startsWith(today)).length;

  const complianceExceptions =
    auditLogs.filter((row) => row.statusCode >= 400).length +
    (backOffice?.pendingAccountantCount ?? 0);

  const fraudAlerts =
    cashDifferences +
    vaultDifference +
    scopedTransactions.filter(
      (tx) => tx.amount >= HIGH_VALUE_DEFAULT * 2 && tx.type === "withdrawal"
    ).length;

  const reviewQueue: AuditorDashboard["reviewQueue"] = [];
  for (const row of backOffice?.depositQueue?.slice(0, 8) ?? []) {
    if (row.executionStatus === "pending_bank" || row.executionStatus === "pending_accountant") {
      reviewQueue.push({
        id: row.id,
        kind: "deposit",
        label: row.customerName ?? "Deposit",
        amount: row.amount,
        branchName: row.branchName
      });
    }
  }
  for (const row of scopedTransactions.filter((tx) => tx.amount >= HIGH_VALUE_DEFAULT).slice(0, 5)) {
    reviewQueue.push({
      id: row.id,
      kind: "high_value",
      label: `${row.type} — ${row.amount.toFixed(2)}`,
      amount: row.amount
    });
  }

  return auditorDashboardSchema.parse({
    transactionsNeedingReview,
    cashDifferences,
    vaultDifference,
    reversedTransactions,
    highValueTransactions,
    userActivityLogs,
    complianceExceptions,
    fraudAlerts,
    highValueThreshold: HIGH_VALUE_DEFAULT,
    reviewQueue
  });
}

async function loadRecentAuditLogs(
  tenantId: string,
  limit: number
): Promise<Array<{ createdAt: string; statusCode: number; action: string }>> {
  const supabase = getSupabaseAdminClient();
  if (!supabase) {
    return [];
  }
  const { data } = await supabase
    .from("audit_logs")
    .select("created_at, status_code, action")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false })
    .limit(limit);
  return (data ?? []).map((row) => ({
    createdAt: String(row.created_at),
    statusCode: Number(row.status_code ?? 0),
    action: String(row.action ?? "")
  }));
}
