import type { TenantProductModule } from "@bms/shared";

/** API path prefixes that require a product module (org settings and reports are universal). */
export const API_PATH_MODULE: Array<{ prefix: string; modules: TenantProductModule[] }> = [
  { prefix: "/api/v1/customers", modules: ["susu_management"] },
  { prefix: "/api/v1/transactions", modules: ["susu_management"] },
  { prefix: "/api/v1/ledger", modules: ["susu_management"] },
  { prefix: "/api/v1/tenant/commission-policy", modules: ["susu_management"] },
  { prefix: "/api/v1/tenant/account-number-policy", modules: ["susu_management"] },
  { prefix: "/api/v1/payroll", modules: ["susu_management"] },
  { prefix: "/api/v1/routes", modules: ["susu_management"] },
  { prefix: "/api/v1/loans", modules: ["loans_credit"] },
  { prefix: "/api/v1/banking", modules: ["banking"] },
  /** Till expenses are shared by Susu branch counter and agency banking desks. */
  { prefix: "/api/v1/agency/till-journal", modules: ["banking", "susu_management"] },
  { prefix: "/api/v1/agency", modules: ["banking"] },
  { prefix: "/api/v1/treasury", modules: ["treasury"] },
  { prefix: "/api/v1/investments", modules: ["investment_management"] }
];

const API_PATH_MODULE_BY_LENGTH = [...API_PATH_MODULE].sort(
  (a, b) => b.prefix.length - a.prefix.length
);

/** Modules that may unlock this API path (any one is enough). */
export function modulesForApiPath(path: string): TenantProductModule[] | undefined {
  const match = API_PATH_MODULE_BY_LENGTH.find((entry) => path.startsWith(entry.prefix));
  return match?.modules;
}

/** @deprecated Prefer modulesForApiPath — kept for callers that expect a single module. */
export function moduleForApiPath(path: string): TenantProductModule | undefined {
  return modulesForApiPath(path)?.[0];
}
