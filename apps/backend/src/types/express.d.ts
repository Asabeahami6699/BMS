import type { Permission, ScopeType, TenantAddon, TenantProductModule } from "@bms/shared";

export interface UserContext {
  userId: string;
  tenantId: string;
  role: string;
  scopeType: ScopeType;
  branchId?: string;
  permissions: Permission[];
  email?: string;
  fullName?: string;
  tenantName?: string;
  subscribedModules?: TenantProductModule[];
  subscribedAddons?: TenantAddon[];
  reportsAnalytics?: boolean;
}

declare global {
  namespace Express {
    interface Request {
      userContext?: UserContext;
      /** Resolved after branch-scope middleware (query param or user branch). */
      effectiveBranchId?: string;
    }
  }
}

export {};
