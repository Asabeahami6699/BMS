import type { Customer } from "@bms/shared";
import { listBranches } from "./branchService.js";
import { listCustomers } from "./customerService.js";

export type GroupSavingsBootstrap = {
  members: Customer[];
  branches: Awaited<ReturnType<typeof listBranches>>;
  totals: {
    totalMembers: number;
    activeMembers: number;
    pendingMembers: number;
    totalDailyPlan: number;
  };
};

export async function getGroupSavingsBootstrap(
  tenantId: string,
  context: {
    scopeType: "head_office" | "branch";
    branchId?: string;
  },
  branchFilter?: string
): Promise<GroupSavingsBootstrap> {
  const filterBranchId = branchFilter?.trim() || undefined;
  const scopeBranchId =
    filterBranchId || (context.scopeType !== "head_office" ? context.branchId : undefined);

  const [allCustomers, branchRows] = await Promise.all([
    listCustomers(tenantId),
    listBranches(tenantId).catch(() => [])
  ]);

  let members = allCustomers.filter((c) => c.accountType === "group");
  if (scopeBranchId) {
    members = members.filter((c) => c.homeBranchId === scopeBranchId);
  }

  members = [...members].sort((a, b) => a.fullName.localeCompare(b.fullName));

  const activeMembers = members.filter((c) => c.status === "active").length;
  const pendingMembers = members.filter((c) => c.status === "pending_activation").length;
  const totalDailyPlan = members.reduce(
    (sum, c) => sum + (c.dailyContributionAmount > 0 ? c.dailyContributionAmount : 0),
    0
  );

  return {
    members,
    branches: branchRows.filter((b) => b.status !== "inactive"),
    totals: {
      totalMembers: members.length,
      activeMembers,
      pendingMembers,
      totalDailyPlan
    }
  };
}
