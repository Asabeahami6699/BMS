import type { BalanceDisclosure } from "@bms/shared";
import { listBranches } from "./branchService.js";
import { listTenantWithdrawalDisclosures } from "./balanceDisclosureService.js";

export type WithdrawalsBootstrap = {
  withdrawals: BalanceDisclosure[];
  branches: Awaited<ReturnType<typeof listBranches>>;
};

export async function getWithdrawalsBootstrap(
  tenantId: string,
  context: {
    role: string;
    scopeType: "head_office" | "branch";
    branchId?: string;
    userId: string;
  },
  options?: { branchId?: string }
): Promise<WithdrawalsBootstrap> {
  const fieldAgentId = context.role === "field_agent" ? context.userId : undefined;
  const [withdrawals, branchRows] = await Promise.all([
    listTenantWithdrawalDisclosures(tenantId, {
      role: context.role,
      scopeType: context.scopeType,
      branchId: context.branchId,
      filterBranchId: options?.branchId,
      fieldAgentId
    }),
    listBranches(tenantId).catch(() => [])
  ]);

  return {
    withdrawals,
    branches: branchRows.filter((b) => b.status !== "inactive")
  };
}
