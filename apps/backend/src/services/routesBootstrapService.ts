import { listBranches } from "./branchService.js";

type BranchRow = Awaited<ReturnType<typeof listBranches>>[number];
import type { FieldRoute } from "@bms/shared";
import { listFieldRoutes } from "./routeService.js";

export type RoutesBootstrap = {
  routes: FieldRoute[];
  branches: BranchRow[];
};

export async function getRoutesBootstrap(tenantId: string): Promise<RoutesBootstrap> {
  const [routes, branchRows] = await Promise.all([
    listFieldRoutes(tenantId),
    listBranches(tenantId).catch(() => [] as BranchRow[])
  ]);

  return {
    routes,
    branches: branchRows.filter((b) => b.status !== "inactive")
  };
}
