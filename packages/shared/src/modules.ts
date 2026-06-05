import { z } from "zod";

export const tenantProductModuleSchema = z.enum([
  "banking",
  "susu_management",
  "loans_credit",
  "treasury"
]);

export type TenantProductModule = z.infer<typeof tenantProductModuleSchema>;

export const TENANT_PRODUCT_MODULES: TenantProductModule[] = [
  "banking",
  "susu_management",
  "loans_credit",
  "treasury"
];

export const MODULE_LABELS: Record<TenantProductModule, string> = {
  banking: "Banking",
  susu_management: "Susu Management",
  loans_credit: "Loans",
  treasury: "Treasury"
};

export const MODULE_DESCRIPTIONS: Record<TenantProductModule, string> = {
  banking: "Retail and counter banking department.",
  susu_management: "Susu desk — collections, agents, coordinators, and payroll.",
  loans_credit: "Loans department — products, disbursements, and repayments.",
  treasury: "Treasury operations — liquidity, fixed deposits, and cash management."
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
