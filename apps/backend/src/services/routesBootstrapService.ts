import type { FieldRoute, TenantRouteSettings } from "@bms/shared";
import { listBranches } from "./branchService.js";
import { listFieldRoutes } from "./routeService.js";
import { getTenantRouteSettings } from "./routeManagementService.js";

type BranchRow = Awaited<ReturnType<typeof listBranches>>[number];

export type RoutesBootstrap = {
  routes: FieldRoute[];
  branches: BranchRow[];
  settings: TenantRouteSettings;
};

export async function getRoutesBootstrap(tenantId: string): Promise<RoutesBootstrap> {
  const [routes, branchRows, settings] = await Promise.all([
    listFieldRoutes(tenantId),
    listBranches(tenantId).catch(() => [] as BranchRow[]),
    getTenantRouteSettings(tenantId)
  ]);

  return {
    routes,
    branches: branchRows.filter((b) => b.status !== "inactive"),
    settings
  };
}
