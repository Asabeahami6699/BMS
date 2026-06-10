import type { ScopeType, SubscriptionStatus, TenantProductModule } from "@bms/shared";
import { hashPassword } from "./password.js";

export type StoredAuthUser = {
  id: string;
  email: string;
  passwordHash: string;
  role: string;
  tenantId: string | null;
  scopeType: ScopeType;
  branchId?: string;
  tellerType?: 1 | 2 | 3 | 4;
  fullName?: string;
  status?: "active" | "inactive";
  createdAt?: string;
  createdBy?: string;
};

export type StoredTenant = {
  id: string;
  name: string;
  subscriptionStatus: SubscriptionStatus;
  accountNumberPrefix?: string;
  subscribedModules?: TenantProductModule[];
  subscribedAddons?: import("@bms/shared").TenantAddon[];
  createdAt: string;
};

const tenants = new Map<string, StoredTenant>();
const usersByEmail = new Map<string, StoredAuthUser>();
const usersById = new Map<string, StoredAuthUser>();
const sessions = new Map<string, { userId: string; expiresAt: number }>();

function seedIfEmpty(): void {
  if (usersByEmail.size > 0) {
    return;
  }

  const demoTenant: StoredTenant = {
    id: "tenant-demo",
    name: "Demo Cooperative",
    subscriptionStatus: "active",
    accountNumberPrefix: "233000",
    subscribedModules: ["banking", "susu_management"],
    createdAt: new Date().toISOString()
  };
  tenants.set(demoTenant.id, demoTenant);

  const superAdmin: StoredAuthUser = {
    id: "user-super-admin",
    email: "super@bms.com",
    passwordHash: hashPassword("ChangeMe123!"),
    role: "super_admin",
    tenantId: null,
    scopeType: "head_office",
    fullName: "Platform Super Admin"
  };

  const companyAdmin: StoredAuthUser = {
    id: "user-demo-admin",
    email: "admin@demo.com",
    passwordHash: hashPassword("ChangeMe123!"),
    role: "admin",
    tenantId: "tenant-demo",
    scopeType: "head_office",
    fullName: "Demo Company Admin"
  };

  for (const user of [superAdmin, companyAdmin]) {
    usersByEmail.set(user.email.toLowerCase(), user);
    usersById.set(user.id, user);
  }
}

seedIfEmpty();

export function listTenantsFromStore(): Array<
  StoredTenant & {
    subscribedModules: TenantProductModule[];
    subscribedAddons: import("@bms/shared").TenantAddon[];
    reportsAnalytics: boolean;
  }
> {
  return [...tenants.values()]
    .map((tenant) => ({
      ...tenant,
      subscribedModules: tenant.subscribedModules ?? ["susu_management"],
      subscribedAddons: tenant.subscribedAddons ?? [],
      reportsAnalytics: tenant.subscriptionStatus === "active"
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function getTenantFromStore(tenantId: string): StoredTenant | undefined {
  return tenants.get(tenantId);
}

export function upsertTenantInStore(tenant: StoredTenant): StoredTenant {
  tenants.set(tenant.id, tenant);
  return tenant;
}

export function findUserByEmail(email: string): StoredAuthUser | undefined {
  return usersByEmail.get(email.toLowerCase());
}

export function findUserById(userId: string): StoredAuthUser | undefined {
  return usersById.get(userId);
}

export function saveAuthUser(user: StoredAuthUser): StoredAuthUser {
  usersByEmail.set(user.email.toLowerCase(), user);
  usersById.set(user.id, user);
  return user;
}

export function createSession(userId: string, ttlMs = 1000 * 60 * 60 * 12): string {
  const token = `sess_${crypto.randomUUID().replace(/-/g, "")}`;
  sessions.set(token, { userId, expiresAt: Date.now() + ttlMs });
  return token;
}

export function resolveSession(token: string): StoredAuthUser | undefined {
  const session = sessions.get(token);
  if (!session) {
    return undefined;
  }
  if (session.expiresAt < Date.now()) {
    sessions.delete(token);
    return undefined;
  }
  return findUserById(session.userId);
}

export function extendSession(token: string, ttlMs = 1000 * 60 * 60 * 12): boolean {
  const session = sessions.get(token);
  if (!session) {
    return false;
  }
  if (session.expiresAt < Date.now()) {
    sessions.delete(token);
    return false;
  }
  session.expiresAt = Date.now() + ttlMs;
  return true;
}

export function revokeSession(token: string): void {
  sessions.delete(token);
}

export function listUsersByTenant(tenantId: string): StoredAuthUser[] {
  return [...usersById.values()].filter((user) => user.tenantId === tenantId);
}

export function updateStoredAuthUser(
  userId: string,
  patch: Partial<
    Pick<
      StoredAuthUser,
      "email" | "role" | "scopeType" | "branchId" | "tellerType" | "fullName" | "status" | "passwordHash"
    >
  >
): StoredAuthUser {
  const existing = usersById.get(userId);
  if (!existing) {
    throw new Error("User not found");
  }
  if (patch.email && patch.email.toLowerCase() !== existing.email.toLowerCase()) {
    usersByEmail.delete(existing.email.toLowerCase());
    usersByEmail.set(patch.email.toLowerCase(), existing);
  }
  const updated: StoredAuthUser = {
    ...existing,
    ...patch,
    email: patch.email ?? existing.email
  };
  usersById.set(userId, updated);
  usersByEmail.set(updated.email.toLowerCase(), updated);
  return updated;
}

export function deleteStoredAuthUser(userId: string): void {
  const existing = usersById.get(userId);
  if (!existing) {
    throw new Error("User not found");
  }
  usersById.delete(userId);
  usersByEmail.delete(existing.email.toLowerCase());
}
