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
    "loans.read",
    "loans.products.manage",
    "loans.applications.create",
    "loans.applications.approve",
    "loans.disburse",
    "loans.repayments.create",
    "treasury.read",
    "treasury.cash.move",
    "treasury.reconcile",
    "agency.withdrawals.approve",
    "agency.bank.execute",
    "agency.withdrawals.pay",
    "agency.deposits.record",
    "agency.accounts.create",
    "banking.products.read",
    "banking.products.manage",
    "workspace.notifications"
  ],
  coordinator: [
    "customers.create",
    "customers.read",
    "branches.read",
    "transactions.create.daily_susu",
    "transactions.read",
    "branch_float.manage",
    "ledger.read",
    "reports.read",
    "payroll.read",
    "commission_policy.read",
    "treasury.read",
    "workspace.notifications"
  ],
  field_agent: [
    "customers.create",
    "customers.read",
    "transactions.create.daily_susu",
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
    "loans.read",
    "treasury.read",
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
    "loans.read",
    "loans.products.manage",
    "loans.applications.create",
    "loans.applications.approve",
    "loans.disburse",
    "loans.repayments.create",
    "treasury.read",
    "treasury.cash.move",
    "treasury.reconcile",
    "workspace.notifications"
  ],
  teller: [
    "customers.read",
    "branches.read",
    "agency.deposits.record",
    "agency.accounts.create",
    "agency.withdrawals.pay",
    "transactions.read",
    "ledger.read",
    "reports.read",
    "payroll.read",
    "workspace.notifications"
  ],
  back_officer: [
    "customers.read",
    "branches.read",
    "agency.bank.execute",
    "transactions.read",
    "ledger.read",
    "reports.read",
    "treasury.read",
    "workspace.notifications"
  ],
  customer_service: [
    "customers.read",
    "agency.withdrawals.approve",
    "agency.accounts.create",
    "transactions.read",
    "ledger.read",
    "reports.read",
    "workspace.notifications"
  ]
};

/** Built-in job titles a tenant admin may customize (not field_agent / super_admin). */
export const TENANT_EDITABLE_BUILTIN_ROLES = [
  "admin",
  "coordinator",
  "teller",
  "back_officer",
  "accountant",
  "auditor",
  "customer_service"
] as const satisfies readonly Role[];

export type TenantEditableBuiltinRole = (typeof TENANT_EDITABLE_BUILTIN_ROLES)[number];

export function isTenantEditableBuiltinRole(role: Role): role is TenantEditableBuiltinRole {
  return (TENANT_EDITABLE_BUILTIN_ROLES as readonly Role[]).includes(role);
}

/** Job titles assignable when creating tenant staff (excludes super_admin). */
export const TENANT_STAFF_ROLES = [
  "admin",
  "coordinator",
  "accountant",
  "auditor",
  "teller",
  "back_officer",
  "customer_service",
  "field_agent"
] as const satisfies readonly Role[];

export type TenantStaffRole = (typeof TENANT_STAFF_ROLES)[number];

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
