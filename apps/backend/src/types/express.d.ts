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
  /** Raw tenant setting; use canUseSusuLoanBridge(modules, flag) for the effective capability. */
  susuLoanBridgeEnabled?: boolean;
  tenantSubdomain?: string;
}

export interface RequestAuditContext {
  entityType?: string;
  entityId?: string;
  action?: string;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
}

declare global {
  namespace Express {
    interface Request {
      userContext?: UserContext;
      /** Resolved after branch-scope middleware (query param or user branch). */
      effectiveBranchId?: string;
      /** Structured before/after domain audit snapshot attached by route handlers. */
      auditContext?: RequestAuditContext;
    }
  }
}

export {};
