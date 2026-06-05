import {
  getAgentPerformance,
  getBranchBreakdown,
  getBranchPerformanceSummary,
  getCustomerAccountMix,
  getDailyTransactionTrend
} from "./analyticsService.js";
import { listPendingBalanceDisclosures } from "./balanceDisclosureService.js";
import { listBranches } from "./branchService.js";
import { listCustomers } from "./customerService.js";
import { getPerformanceBootstrap } from "./performanceBootstrapService.js";

export type ReportsAnalyticsBootstrap = {
  summary: Awaited<ReturnType<typeof getBranchPerformanceSummary>>;
  agents: Awaited<ReturnType<typeof getAgentPerformance>>;
  branchReports: Awaited<ReturnType<typeof getBranchBreakdown>>;
  branches: Awaited<ReturnType<typeof listBranches>>;
  agentNames: Record<string, string>;
  dailyTrend: Awaited<ReturnType<typeof getDailyTransactionTrend>>;
  accountMix: Awaited<ReturnType<typeof getCustomerAccountMix>>;
  pending: {
    registrations: number;
    agentRequests: number;
    withdrawals: number;
    balanceInquiries: number;
  };
  withdrawals: {
    pending: number;
    approved: number;
    rejected: number;
    pendingAmount: number;
  };
};

export async function getReportsAnalyticsBootstrap(
  tenantId: string,
  context: {
    role: string;
    scopeType: "head_office" | "branch";
    branchId?: string;
  },
  branchFilter?: string
): Promise<ReportsAnalyticsBootstrap> {
  const filterBranchId = branchFilter?.trim() || undefined;
  const scope = {
    role: context.role,
    scopeType: context.scopeType,
    branchId: context.branchId,
    filterBranchId
  };

  const perf = await getPerformanceBootstrap(tenantId, context, filterBranchId);

  const [
    summary,
    agents,
    branchReports,
    branchRows,
    dailyTrend,
    accountMix,
    customers,
    pendingRequests
  ] = await Promise.all([
    getBranchPerformanceSummary(tenantId, scope),
    getAgentPerformance(tenantId, scope),
    getBranchBreakdown(tenantId, scope),
    listBranches(tenantId).catch(() => []),
    getDailyTransactionTrend(tenantId, scope, 14),
    getCustomerAccountMix(tenantId, scope),
    listCustomers(tenantId),
    listPendingBalanceDisclosures(tenantId)
  ]);

  const pendingRegistrations = customers.filter((c) => c.status === "pending_activation").length;
  const pendingWithdrawals = pendingRequests.filter(
    (r) => r.requestType === "withdrawal" && r.status === "pending"
  );
  const pendingBalance = pendingRequests.filter(
    (r) => r.requestType === "balance" && r.status === "pending"
  );

  const allWithdrawals = pendingRequests.filter((r) => r.requestType === "withdrawal");
  const withdrawalPendingAmount = pendingWithdrawals.reduce(
    (sum, r) => sum + (r.withdrawalAmount ?? 0),
    0
  );

  return {
    summary,
    agents,
    branchReports,
    branches: branchRows.filter((b) => b.status !== "inactive"),
    agentNames: perf.agentNames,
    dailyTrend,
    accountMix,
    pending: {
      registrations: pendingRegistrations,
      agentRequests: pendingRequests.filter((r) => r.status === "pending").length,
      withdrawals: pendingWithdrawals.length,
      balanceInquiries: pendingBalance.length
    },
    withdrawals: {
      pending: pendingWithdrawals.length,
      approved: allWithdrawals.filter((r) => r.status === "approved").length,
      rejected: allWithdrawals.filter((r) => r.status === "rejected").length,
      pendingAmount: withdrawalPendingAmount
    }
  };
}
