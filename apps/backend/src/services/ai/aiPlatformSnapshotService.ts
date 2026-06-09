import {
  aiPlatformSnapshotSchema,
  hasAnyPermission,
  hasTenantModule,
  type AiPlatformSnapshot,
  type Permission,
  type TenantProductModule,
  type Transaction
} from "@bms/shared";
import { getAgentPerformance, getCustomerAccountMix, getDailyTransactionTrend } from "../analyticsService.js";
import { getAgencyBootstrap } from "../agencyBankingService.js";
import { listPendingBalanceDisclosures } from "../balanceDisclosureService.js";
import { listBranches } from "../branchService.js";
import { listLoanApplications } from "../loanService.js";
import { getPerformanceBootstrap } from "../performanceBootstrapService.js";
import { listTransactions } from "../transactionService.js";
import type { ResolvedUserContext } from "../userContextService.js";
import { getSupabaseAdminClient } from "../../config/supabaseClient.js";

const DEFAULT_PERIOD_DAYS = 30;
const AGENT_LEADERBOARD_SIZE = 3;
const TREND_DAYS = 7;

type RoleScope = {
  role: string;
  scopeType: "head_office" | "branch";
  branchId?: string;
};

function periodStart(days: number): { sinceIso: string; periodStart: string } {
  const since = new Date();
  since.setDate(since.getDate() - days);
  since.setHours(0, 0, 0, 0);
  const sinceIso = since.toISOString();
  return { sinceIso, periodStart: sinceIso.slice(0, 10) };
}

function scopedTransactions(transactions: Transaction[], context: RoleScope): Transaction[] {
  if (context.scopeType !== "head_office" && context.branchId) {
    return transactions.filter((entry) => entry.transactionBranchId === context.branchId);
  }
  return transactions;
}

function summarizeTransactions(transactions: Transaction[]) {
  const summary = {
    transactionCount: transactions.length,
    totalDeposits: 0,
    totalWithdrawals: 0,
    totalDailySusu: 0
  };

  for (const transaction of transactions) {
    if (transaction.type === "deposit") {
      summary.totalDeposits += transaction.amount;
    } else if (transaction.type === "withdrawal") {
      summary.totalWithdrawals += transaction.amount;
    } else if (transaction.type === "daily_susu") {
      summary.totalDailySusu += transaction.amount;
    }
  }

  return {
    ...summary,
    netFlow: summary.totalDeposits + summary.totalDailySusu - summary.totalWithdrawals
  };
}

function canReadSusuData(permissions: Permission[]): boolean {
  return hasAnyPermission(permissions, ["reports.read", "customers.read", "transactions.read"]);
}

function canReadAgencyData(permissions: Permission[]): boolean {
  return hasAnyPermission(permissions, [
    "agency.deposits.record",
    "agency.bank.execute",
    "agency.withdrawals.pay",
    "agency.withdrawals.approve",
    "banking.products.read",
    "transactions.read"
  ]);
}

async function buildTreasurySection(
  tenantId: string,
  context: RoleScope
): Promise<AiPlatformSnapshot["treasury"]> {
  const supabase = getSupabaseAdminClient();
  if (!supabase) {
    return {
      branchCount: context.scopeType === "branch" && context.branchId ? 1 : 0,
      vaultCash: 0,
      tellerCash: 0,
      bankCash: 0,
      totalCashPosition: 0
    };
  }

  let query = supabase
    .from("branch_cash_accounts")
    .select("branch_id, kind, balance")
    .eq("tenant_id", tenantId)
    .eq("is_active", true);

  if (context.scopeType === "branch" && context.branchId) {
    query = query.eq("branch_id", context.branchId);
  }

  const { data, error } = await query;
  if (error) {
    return undefined;
  }

  const rows = data ?? [];
  const branchIds = new Set(rows.map((row) => row.branch_id as string));
  let vaultCash = 0;
  let tellerCash = 0;
  let bankCash = 0;

  for (const row of rows) {
    const balance = Number(row.balance ?? 0);
    if (row.kind === "vault") {
      vaultCash += balance;
    } else if (row.kind === "teller_drawer") {
      tellerCash += balance;
    } else if (row.kind === "bank") {
      bankCash += balance;
    }
  }

  return {
    branchCount: branchIds.size,
    vaultCash,
    tellerCash,
    bankCash,
    totalCashPosition: vaultCash + tellerCash + bankCash
  };
}

export async function buildAiPlatformSnapshot(
  context: ResolvedUserContext,
  options?: { days?: number }
): Promise<AiPlatformSnapshot> {
  const days = options?.days ?? DEFAULT_PERIOD_DAYS;
  const { sinceIso, periodStart: periodStartDate } = periodStart(days);
  const modules = context.subscribedModules ?? [];
  const scope: RoleScope = {
    role: context.role,
    scopeType: context.scopeType,
    branchId: context.branchId
  };
  const permissions = context.permissions;

  const branches = await listBranches(context.tenantId).catch(() => []);
  const branchName =
    context.branchId != null
      ? branches.find((branch) => branch.id === context.branchId)?.name
      : undefined;

  const snapshot: AiPlatformSnapshot = {
    generatedAt: new Date().toISOString(),
    periodDays: days,
    periodStart: periodStartDate,
    scope: {
      type: context.scopeType,
      branchId: context.branchId,
      branchName
    },
    subscribedModules: modules as TenantProductModule[]
  };

  const scopedScope = {
    ...scope,
    filterBranchId: undefined as string | undefined
  };

  if (hasTenantModule(modules, "susu_management") && canReadSusuData(permissions)) {
    const [allTransactions, perf, accountMix, pendingRequests, dailyTrend] = await Promise.all([
      listTransactions(context.tenantId),
      getPerformanceBootstrap(context.tenantId, scope),
      getCustomerAccountMix(context.tenantId, scopedScope),
      listPendingBalanceDisclosures(context.tenantId),
      getDailyTransactionTrend(context.tenantId, scopedScope, TREND_DAYS)
    ]);

    const periodTransactions = scopedTransactions(allTransactions, scope).filter(
      (tx) => tx.createdAt >= sinceIso
    );
    const agents = await getAgentPerformance(context.tenantId, scopedScope);
    const periodAgentMap = new Map<
      string,
      { fieldAgentId: string; totalCollections: number; dailySusuCount: number }
    >();

    for (const transaction of periodTransactions) {
      if (!transaction.fieldAgentId) {
        continue;
      }
      const existing = periodAgentMap.get(transaction.fieldAgentId) ?? {
        fieldAgentId: transaction.fieldAgentId,
        totalCollections: 0,
        dailySusuCount: 0
      };
      existing.totalCollections += transaction.amount;
      if (transaction.type === "daily_susu") {
        existing.dailySusuCount += 1;
      }
      periodAgentMap.set(transaction.fieldAgentId, existing);
    }

    const rankedAgents = Array.from(periodAgentMap.values()).sort(
      (a, b) => b.totalCollections - a.totalCollections
    );
    const mapAgentName = (fieldAgentId: string) =>
      perf.agentNames[fieldAgentId]?.trim() || fieldAgentId.slice(0, 8);

    const pendingWithdrawals = pendingRequests.filter(
      (row) => row.requestType === "withdrawal" && row.status === "pending"
    );
    const pendingBalance = pendingRequests.filter(
      (row) => row.requestType === "balance" && row.status === "pending"
    );

    snapshot.susuManagement = {
      collections: summarizeTransactions(periodTransactions),
      agents: {
        activeCount: agents.length,
        topPerformers: rankedAgents.slice(0, AGENT_LEADERBOARD_SIZE).map((agent) => ({
          name: mapAgentName(agent.fieldAgentId),
          totalCollections: agent.totalCollections,
          dailySusuCount: agent.dailySusuCount
        })),
        bottomPerformers: (rankedAgents.length > AGENT_LEADERBOARD_SIZE
          ? rankedAgents.slice(-AGENT_LEADERBOARD_SIZE)
          : []
        )
          .reverse()
          .map((agent) => ({
            name: mapAgentName(agent.fieldAgentId),
            totalCollections: agent.totalCollections,
            dailySusuCount: agent.dailySusuCount
          }))
      },
      pending: {
        registrations: accountMix.pending,
        withdrawals: pendingWithdrawals.length,
        balanceInquiries: pendingBalance.length,
        withdrawalAmount: pendingWithdrawals.reduce(
          (sum, row) => sum + (row.withdrawalAmount ?? 0),
          0
        )
      },
      customers: {
        active: accountMix.totalActive,
        pendingActivation: accountMix.pending,
        susu: accountMix.susu,
        savings: accountMix.savings,
        group: accountMix.group
      },
      recentDailyTrend: dailyTrend.map((point) => ({
        date: point.date,
        dailySusu: point.dailySusu,
        deposits: point.deposits,
        withdrawals: point.withdrawals
      }))
    };
  }

  if (hasTenantModule(modules, "banking") && canReadAgencyData(permissions)) {
    const txContext = {
      userId: context.userId,
      tenantId: context.tenantId,
      role: context.role,
      scopeType: context.scopeType,
      branchId: context.branchId,
      permissions
    };
    const agency = await getAgencyBootstrap(
      txContext,
      context.scopeType === "branch" ? context.branchId : undefined
    );
    const allTransactions = scopedTransactions(await listTransactions(context.tenantId), scope);
    const periodTransactions = allTransactions.filter((tx) => tx.createdAt >= sinceIso);

    snapshot.agencyBanking = {
      queues: {
        depositsPendingBank: agency.queue.depositsPendingBank,
        withdrawalsPendingCs: agency.queue.withdrawalsPendingCs,
        withdrawalsPendingTeller: agency.queue.withdrawalsPendingTeller
      },
      pendingDepositAmount: agency.depositsPendingBank.reduce((sum, row) => sum + row.amount, 0),
      periodDeposits: periodTransactions
        .filter((tx) => tx.type === "deposit")
        .reduce((sum, tx) => sum + tx.amount, 0),
      periodWithdrawals: periodTransactions
        .filter((tx) => tx.type === "withdrawal")
        .reduce((sum, tx) => sum + tx.amount, 0)
    };
  }

  if (hasTenantModule(modules, "loans_credit") && hasAnyPermission(permissions, ["loans.read"])) {
    let applications = await listLoanApplications(context.tenantId);
    if (context.scopeType === "branch" && context.branchId) {
      applications = applications.filter((app) => app.branchId === context.branchId);
    }

    const recentApplications = applications.filter((app) => app.appliedAt >= sinceIso);
    const disbursed = applications.filter((app) => app.status === "disbursed");

    snapshot.loansCredit = {
      portfolio: {
        pendingApproval: applications.filter((app) => app.status === "pending_approval").length,
        approved: applications.filter((app) => app.status === "approved").length,
        disbursed: disbursed.length,
        closed: applications.filter((app) => app.status === "closed").length,
        rejected: applications.filter((app) => app.status === "rejected").length,
        totalOutstandingPrincipal: disbursed.reduce((sum, app) => sum + app.outstandingPrincipal, 0),
        totalRepaid: applications.reduce((sum, app) => sum + app.totalRepaid, 0)
      },
      lastPeriod: {
        newApplications: recentApplications.length,
        disbursedCount: recentApplications.filter((app) => app.status === "disbursed").length,
        disbursedAmount: recentApplications
          .filter((app) => app.status === "disbursed")
          .reduce((sum, app) => sum + app.principalAmount, 0)
      }
    };
  }

  if (hasTenantModule(modules, "treasury") && hasAnyPermission(permissions, ["treasury.read"])) {
    snapshot.treasury = await buildTreasurySection(context.tenantId, scope);
  }

  return aiPlatformSnapshotSchema.parse(snapshot);
}

export function looksLikeAnalyticsQuestion(message: string): boolean {
  const normalized = message.toLowerCase();
  const keywords = [
    "analy",
    "analysis",
    "trend",
    "performance",
    "summary",
    "overview",
    "how many",
    "how much",
    "total",
    "top",
    "bottom",
    "pending",
    "collection",
    "withdrawal",
    "deposit",
    "agent",
    "loan",
    "treasury",
    "cash position",
    "agency",
    "susu",
    "last 30",
    "last month",
    "this month",
    "compare",
    "kpi"
  ];
  return keywords.some((keyword) => normalized.includes(keyword));
}
