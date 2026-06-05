import {
  getAgentPerformance,
  getBranchBreakdown,
  getBranchPerformanceSummary
} from "./analyticsService.js";
import { listBranches } from "./branchService.js";
import { listTenantFieldAgents } from "./authService.js";

export type PerformanceBootstrap = {
  summary: Awaited<ReturnType<typeof getBranchPerformanceSummary>>;
  agents: Awaited<ReturnType<typeof getAgentPerformance>>;
  branchReports: Awaited<ReturnType<typeof getBranchBreakdown>>;
  branches: Awaited<ReturnType<typeof listBranches>>;
  agentNames: Record<string, string>;
};

export async function getPerformanceBootstrap(
  tenantId: string,
  context: {
    role: string;
    scopeType: "head_office" | "branch";
    branchId?: string;
  },
  branchFilter?: string
): Promise<PerformanceBootstrap> {
  const scope = {
    role: context.role,
    scopeType: context.scopeType,
    branchId: context.branchId,
    filterBranchId: branchFilter?.trim() || undefined
  };

  const [summary, agents, branchReports, branchRows, fieldAgents] = await Promise.all([
    getBranchPerformanceSummary(tenantId, scope),
    getAgentPerformance(tenantId, scope),
    getBranchBreakdown(tenantId, scope),
    listBranches(tenantId).catch(() => []),
    listTenantFieldAgents(tenantId).catch(() => [])
  ]);

  const agentNames: Record<string, string> = {};
  for (const agent of fieldAgents) {
    agentNames[agent.userId] = agent.fullName?.trim() || agent.email || agent.userId;
  }

  return {
    summary,
    agents,
    branchReports,
    branches: branchRows.filter((b) => b.status !== "inactive"),
    agentNames
  };
}
