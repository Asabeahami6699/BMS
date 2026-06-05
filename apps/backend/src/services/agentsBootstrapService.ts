import type { BalanceDisclosure, Customer } from "@bms/shared";
import type { FieldAgentOption } from "./authService.js";
import { listTenantFieldAgents } from "./authService.js";
import { listBranches } from "./branchService.js";

type BranchRow = Awaited<ReturnType<typeof listBranches>>[number];
import { listPendingBalanceDisclosures } from "./balanceDisclosureService.js";
import { listCustomers } from "./customerService.js";
import { getAgentPerformance } from "./analyticsService.js";

export type AgentsBootstrap = {
  agents: FieldAgentOption[];
  customers: Customer[];
  reports: Awaited<ReturnType<typeof getAgentPerformance>>;
  pending: BalanceDisclosure[];
  branches: BranchRow[];
};

export async function getAgentsBootstrap(
  tenantId: string,
  context: {
    role: string;
    scopeType: "head_office" | "branch";
    branchId?: string;
  },
  branchFilter?: string
): Promise<AgentsBootstrap> {
  const filterBranchId = branchFilter?.trim() || undefined;
  const scope = {
    role: context.role,
    scopeType: context.scopeType,
    branchId: context.branchId,
    filterBranchId
  };

  const [agents, customers, reports, pending, branchRows] = await Promise.all([
    listTenantFieldAgents(tenantId),
    listCustomers(tenantId),
    getAgentPerformance(tenantId, scope),
    listPendingBalanceDisclosures(tenantId),
    listBranches(tenantId).catch(() => [] as BranchRow[])
  ]);

  return {
    agents,
    customers,
    reports,
    pending,
    branches: branchRows.filter((b) => b.status !== "inactive")
  };
}
