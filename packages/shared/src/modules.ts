import { z } from "zod";

export const tenantProductModuleSchema = z.enum([
  "banking",
  "susu_management",
  "loans_credit",
  "treasury",
  "investment_management"
]);

export type TenantProductModule = z.infer<typeof tenantProductModuleSchema>;

export const TENANT_PRODUCT_MODULES: TenantProductModule[] = [
  "banking",
  "susu_management",
  "loans_credit",
  "treasury",
  "investment_management"
];

export const MODULE_LABELS: Record<TenantProductModule, string> = {
  banking: "Agency Banking",
  susu_management: "Susu Management",
  loans_credit: "Loans",
  treasury: "Treasury",
  investment_management: "Investment Management"
};

export const MODULE_DESCRIPTIONS: Record<TenantProductModule, string> = {
  banking: "Branch treasury, teller counter, and agency banking workflows (deposits, withdrawals, bank products).",
  susu_management: "Susu desk — collections, agents, coordinators, and payroll.",
  loans_credit: "Loans department — products, disbursements, and repayments.",
  treasury: "Treasury operations — liquidity, fixed deposits, and cash management.",
  investment_management:
    "Investment & wealth management — fixed deposits, treasury bills, bonds, shares, and customizable application forms."
};

/** Legacy product keys mapped to current module keys */
export const LEGACY_MODULE_ALIASES: Record<string, TenantProductModule> = {
  core_banking: "banking",
  fixed_deposit: "treasury",
  mobile_money: "banking"
};

export function normalizeTenantModule(key: string): TenantProductModule | undefined {
  const parsed = tenantProductModuleSchema.safeParse(key);
  if (parsed.success) {
    return parsed.data;
  }
  return LEGACY_MODULE_ALIASES[key];
}

export function hasTenantModule(
  modules: TenantProductModule[] | undefined,
  module: TenantProductModule
): boolean {
  if (!modules) {
    return false;
  }
  return modules.some((entry) => {
    const normalized = normalizeTenantModule(entry as string) ?? entry;
    return normalized === module;
  });
}

/** Subscribed tenant products in catalog order (for dashboards and reports). */
export function listSubscribedProductModules(
  modules: TenantProductModule[] | undefined
): TenantProductModule[] {
  if (!modules?.length) {
    return [];
  }
  return TENANT_PRODUCT_MODULES.filter((module) => hasTenantModule(modules, module));
}
