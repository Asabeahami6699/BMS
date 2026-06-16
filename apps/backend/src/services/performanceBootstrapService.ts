import {
  getAgentPerformance,
  getBranchBreakdown,
  getBranchPerformanceSummary
} from "./analyticsService.js";
import { listBranches } from "./branchService.js";
import { buildAgentNamesRecord } from "./userNameResolver.js";

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

  const [summary, agents, branchReports, branchRows] = await Promise.all([
    getBranchPerformanceSummary(tenantId, scope),
    getAgentPerformance(tenantId, scope),
    getBranchBreakdown(tenantId, scope),
    listBranches(tenantId).catch(() => [])
  ]);

  const agentNames = await buildAgentNamesRecord(
    tenantId,
    agents.map((agent) => agent.fieldAgentId)
  );

  return {
    summary,
    agents,
    branchReports,
    branches: branchRows.filter((b) => b.status !== "inactive"),
    agentNames
  };
}
