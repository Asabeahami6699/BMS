import { listBranches } from "./branchService.js";

type BranchRow = Awaited<ReturnType<typeof listBranches>>[number];
import { listCoordinatorRoster, type CoordinatorRosterRow } from "./coordinatorRosterService.js";

export type CoordinatorsBootstrap = {
  roster: CoordinatorRosterRow[];
  branches: BranchRow[];
};

export async function getCoordinatorsBootstrap(tenantId: string): Promise<CoordinatorsBootstrap> {
  const [roster, branchRows] = await Promise.all([
    listCoordinatorRoster(tenantId),
    listBranches(tenantId).catch(() => [] as BranchRow[])
  ]);

  return {
    roster,
    branches: branchRows.filter((b) => b.status !== "inactive")
  };
}
