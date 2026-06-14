import type { TenantProductModule } from "@bms/shared";

/** API path prefixes that require a product module (org settings and reports are universal). */
export const API_PATH_MODULE: Array<{ prefix: string; module: TenantProductModule }> = [
  { prefix: "/api/v1/customers", module: "susu_management" },
  { prefix: "/api/v1/transactions", module: "susu_management" },
  { prefix: "/api/v1/ledger", module: "susu_management" },
  { prefix: "/api/v1/tenant/commission-policy", module: "susu_management" },
  { prefix: "/api/v1/tenant/account-number-policy", module: "susu_management" },
  { prefix: "/api/v1/payroll", module: "susu_management" },
  { prefix: "/api/v1/routes", module: "susu_management" },
  { prefix: "/api/v1/loans", module: "loans_credit" },
  { prefix: "/api/v1/banking", module: "banking" },
  { prefix: "/api/v1/agency", module: "banking" },
  { prefix: "/api/v1/treasury", module: "treasury" },
  { prefix: "/api/v1/investments", module: "investment_management" }
];

export function moduleForApiPath(path: string): TenantProductModule | undefined {
  const match = API_PATH_MODULE.find((entry) => path.startsWith(entry.prefix));
  return match?.module;
}
