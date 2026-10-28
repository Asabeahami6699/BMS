import type { AppRole } from "../app/api";
import { hasTenantModule, isBuiltinRole, type TenantProductModule } from "@bms/shared";
import { agencyDeskPathForRole } from "../app/banking/roleDeskConfig";

/** First page for a company that does not include the department they just tried to open. */
export function subscribedHomePath(
  modules: TenantProductModule[] | undefined,
  blocked?: TenantProductModule
): string {
  const choices: Array<[TenantProductModule, string]> = [
    ["susu_management", "/app/susu/overview"],
    ["loans_credit", "/app/loans"],
    ["investment_management", "/app/investments"],
    ["treasury", "/app/treasury"],
    ["banking", "/app/banking"]
  ];
  for (const [module, path] of choices) {
    if (module !== blocked && hasTenantModule(modules, module)) {
      return path;
    }
  }
  return "/app/dashboard";
}

export function getHomePathForRole(role: string, modules?: TenantProductModule[]): string {
  if (role === "super_admin") {
    return "/platform/companies";
  }
  if (role === "field_agent") {
    return "/app/agent/home";
  }

  const bankingDesk = isBuiltinRole(role) ? agencyDeskPathForRole(role as AppRole) : null;
  if (bankingDesk && hasTenantModule(modules, "banking")) {
    return bankingDesk;
  }

  if (role === "admin" && modules?.length === 1 && hasTenantModule(modules, "susu_management")) {
    return "/app/susu/overview";
  }
  if (role === "admin") {
    return "/app/dashboard";
  }

  if (modules && hasTenantModule(modules, "susu_management")) {
    return role === "teller" ? "/app/susu/collections" : "/app/susu/overview";
  }

  return subscribedHomePath(modules);
}
