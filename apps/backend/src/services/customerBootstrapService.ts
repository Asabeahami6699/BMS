import type { Customer } from "@bms/shared";
import { listBranches } from "./branchService.js";
import { listCustomers } from "./customerService.js";

type BranchRow = Awaited<ReturnType<typeof listBranches>>[number];

export type CustomerBootstrap = {
  customers: Customer[];
  branches: BranchRow[];
};

export async function getCustomerBootstrap(
  tenantId: string,
  options?: { agentId?: string; branchId?: string }
): Promise<CustomerBootstrap> {
  const [customers, branchRows] = await Promise.all([
    listCustomers(tenantId, { agentId: options?.agentId, branchId: options?.branchId }),
    listBranches(tenantId).catch(() => [] as BranchRow[])
  ]);

  return {
    customers,
    branches: branchRows.filter((b) => b.status !== "inactive")
  };
}
