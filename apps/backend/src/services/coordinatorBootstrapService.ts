import type { BalanceDisclosure, Customer } from "@bms/shared";
import {
  getAgentPerformance,
  getBranchBreakdown,
  getBranchPerformanceSummary
} from "./analyticsService.js";
import { listPendingBalanceDisclosures } from "./balanceDisclosureService.js";
import { listBranches } from "./branchService.js";
import { listCustomers } from "./customerService.js";
import { buildAgentNamesRecord } from "./userNameResolver.js";

type BranchRow = Awaited<ReturnType<typeof listBranches>>[number];

export type CoordinatorBootstrap = {
  customers: Customer[];
  pendingRegistrations: Customer[];
  pendingRequests: BalanceDisclosure[];
  summary: Awaited<ReturnType<typeof getBranchPerformanceSummary>>;
  agents: Awaited<ReturnType<typeof getAgentPerformance>>;
  branchReports: Awaited<ReturnType<typeof getBranchBreakdown>>;
  branches: BranchRow[];
  agentNames: Record<string, string>;
};

function sortCustomers(list: Customer[]): Customer[] {
  return [...list].sort((a, b) => a.fullName.localeCompare(b.fullName));
}

function sortRequests(list: BalanceDisclosure[]): BalanceDisclosure[] {
  return [...list].sort(
    (a, b) => new Date(b.requestedAt).getTime() - new Date(a.requestedAt).getTime()
  );
}

export async function getCoordinatorBootstrap(
  tenantId: string,
  context: {
    role: string;
    scopeType: "head_office" | "branch";
    branchId?: string;
  },
  branchFilter?: string
): Promise<CoordinatorBootstrap> {
  const filterBranchId = branchFilter?.trim() || undefined;
  const scope = {
    role: context.role,
    scopeType: context.scopeType,
    branchId: context.branchId,
    filterBranchId
  };

  const [customers, pendingRequests, summary, agents, branchReports, branchRows] =
    await Promise.all([
      listCustomers(tenantId),
      listPendingBalanceDisclosures(tenantId),
      getBranchPerformanceSummary(tenantId, scope),
      getAgentPerformance(tenantId, scope),
      getBranchBreakdown(tenantId, scope),
      listBranches(tenantId).catch(() => [] as BranchRow[])
    ]);

  const pendingRegistrations = customers.filter((c) => c.status === "pending_activation");

  const agentNames = await buildAgentNamesRecord(
    tenantId,
    agents.map((agent) => agent.fieldAgentId)
  );

  return {
    customers: sortCustomers(customers),
    pendingRegistrations: sortCustomers(pendingRegistrations),
    pendingRequests: sortRequests(pendingRequests),
    summary,
    agents,
    branchReports,
    branches: branchRows.filter((b) => b.status !== "inactive"),
    agentNames
  };
}
