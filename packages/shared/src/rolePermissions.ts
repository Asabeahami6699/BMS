import type { Permission, Role } from "./auth.js";

export const permissionsByRole: Record<Role, Permission[]> = {
  super_admin: [
    "platform.tenants.read",
    "platform.tenants.create",
    "platform.tenants.update",
    "users.create",
    "users.read",
    "workspace.notifications"
  ],
  admin: [
    "roles.create",
    "roles.read",
    "roles.assign",
    "users.create",
    "users.read",
    "users.update",
    "users.delete",
    "branches.create",
    "branches.update",
    "branches.read",
    "branches.delete",
    "customers.create",
    "customers.read",
    "transactions.create.daily_susu",
    "transactions.create.deposit",
    "transactions.create.withdrawal",
    "transactions.read",
    "branch_float.manage",
    "ledger.read",
    "reports.read",
    "payroll.read",
    "payroll.run",
    "commission_policy.update",
    "commission_policy.read",
    "audit.read",
    "workspace.notifications"
  ],
  coordinator: [
    "customers.create",
    "customers.read",
    "branches.read",
    "transactions.create.daily_susu",
    "transactions.create.deposit",
    "transactions.create.withdrawal",
    "transactions.read",
    "branch_float.manage",
    "ledger.read",
    "reports.read",
    "payroll.read",
    "commission_policy.read",
    "workspace.notifications"
  ],
  field_agent: [
    "customers.create",
    "customers.read",
    "transactions.create.daily_susu",
    "transactions.create.deposit",
    "transactions.create.withdrawal",
    "transactions.read",
    "ledger.read",
    "reports.read",
    "payroll.read",
    "workspace.notifications"
  ],
  auditor: [
    "roles.read",
    "users.read",
    "branches.read",
    "customers.read",
    "transactions.read",
    "ledger.read",
    "reports.read",
    "payroll.read",
    "commission_policy.read",
    "audit.read",
    "workspace.notifications"
  ],
  accountant: [
    "roles.read",
    "customers.read",
    "branches.read",
    "transactions.read",
    "ledger.read",
    "reports.read",
    "payroll.read",
    "payroll.run",
    "commission_policy.read",
    "workspace.notifications"
  ],
  teller: [
    "customers.read",
    "branches.read",
    "transactions.create.deposit",
    "transactions.create.withdrawal",
    "transactions.read",
    "ledger.read",
    "reports.read",
    "payroll.read",
    "workspace.notifications"
  ],
  customer_service: [
    "customers.read",
    "transactions.read",
    "ledger.read",
    "reports.read",
    "payroll.read",
    "workspace.notifications"
  ]
};

/** Built-in job titles a tenant admin may customize (not field_agent / super_admin). */
export const TENANT_EDITABLE_BUILTIN_ROLES = [
  "admin",
  "coordinator",
  "teller",
  "accountant",
  "auditor",
  "customer_service"
] as const satisfies readonly Role[];

export type TenantEditableBuiltinRole = (typeof TENANT_EDITABLE_BUILTIN_ROLES)[number];

export function isTenantEditableBuiltinRole(role: Role): role is TenantEditableBuiltinRole {
  return (TENANT_EDITABLE_BUILTIN_ROLES as readonly Role[]).includes(role);
}

export function getPermissionsForRole(role: Role): Permission[] {
  return [...permissionsByRole[role]];
}

/** Apply tenant override when present; otherwise platform defaults. */
export function resolveRolePermissions(
  role: Role,
  overrideDuties: Permission[] | null | undefined
): Permission[] {
  if (overrideDuties != null) {
    return [...new Set(overrideDuties)];
  }
  return getPermissionsForRole(role);
}
