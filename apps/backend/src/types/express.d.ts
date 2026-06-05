import type { Permission, Role, ScopeType, TenantAddon, TenantProductModule } from "@bms/shared";

export interface UserContext {
  userId: string;
  tenantId: string;
  role: Role;
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
    }
  }
}

export {};
