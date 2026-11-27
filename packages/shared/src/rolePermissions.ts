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
    "transactions.reverse.daily_susu",
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
    "loans.qualification.manage",
    "treasury.read",
    "treasury.cash.move",
    "treasury.reconcile",
    "income.read",
    "agency.withdrawals.approve",
    "agency.bank.execute",
    "agency.withdrawals.pay",
    "agency.deposits.record",
    "agency.accounts.create",
    "banking.products.read",
    "banking.products.manage",
    "investments.read",
    "investments.products.manage",
    "investments.applications.create",
    "investments.applications.approve",
    "investments.redeem",
    "investments.forms.manage",
    "investments.reports.read",
    "workspace.notifications",
    "workspace.manual.read"
  ],
  coordinator: [
    "customers.create",
    "customers.read",
    "branches.read",
    "transactions.create.daily_susu",
    "transactions.read",
    "transactions.reverse.daily_susu",
    "branch_float.manage",
    "ledger.read",
    "reports.read",
    "payroll.read",
    "commission_policy.read",
    "treasury.read",
    "income.read.daily",
    "workspace.notifications",
    "workspace.manual.read"
  ],
  field_agent: [
    "customers.create",
    "customers.read",
    "field_agent.withdrawals.request",
    "field_agent.balance.request",
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
    "workspace.notifications",
    "workspace.manual.read"
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
    "workspace.notifications",
    "workspace.manual.read"
  ],
  teller: [
    "customers.read",
    "branches.read",
    "agency.deposits.record",
    "agency.accounts.create",
    "banking.products.read",
    "agency.withdrawals.pay",
    "transactions.read",
    "transactions.create.deposit",
    "transactions.create.withdrawal",
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
    "banking.products.read",
    "transactions.read",
    "ledger.read",
    "reports.read",
    "workspace.notifications"
  ]
};

/** Core duties always kept on field_agent so collections, call-over, and offline sync never break. */
export const FIELD_AGENT_LOCKED_PERMISSIONS = [
  "customers.read",
  "transactions.create.daily_susu",
  "transactions.read",
  "ledger.read",
  "reports.read",
  "workspace.notifications"
] as const satisfies readonly Permission[];

/** Curated, safe capabilities a tenant admin may switch on or off for field agents. */
export const FIELD_AGENT_TOGGLEABLE_PERMISSIONS = [
  "customers.create",
  "field_agent.withdrawals.request",
  "field_agent.balance.request",
  "payroll.read"
] as const satisfies readonly Permission[];

export type FieldAgentToggleablePermission = (typeof FIELD_AGENT_TOGGLEABLE_PERMISSIONS)[number];

export const FIELD_AGENT_CONTROL_OPTIONS: ReadonlyArray<{
  permission: FieldAgentToggleablePermission;
  label: string;
  description: string;
}> = [
  {
    permission: "customers.create",
    label: "Can register new customers",
    description:
      "Allow field agents to open the registration form and submit new customer accounts (including offline sync)."
  },
  {
    permission: "field_agent.withdrawals.request",
    label: "Can submit withdrawal requests",
    description:
      "Allow field agents to submit customer withdrawal requests for coordinator approval. Existing approved withdrawals can still be confirmed as delivered."
  },
  {
    permission: "field_agent.balance.request",
    label: "Can request customer balance disclosures",
    description:
      "Allow field agents to request temporary 6-hour customer balance views from a coordinator."
  },
  {
    permission: "payroll.read",
    label: "Can view own commission/payslip",
    description:
      "Show projected commission and monthly payslip breakdown inside the field agent profile menu."
  }
];

const FIELD_AGENT_TOGGLEABLE_SET = new Set<Permission>(FIELD_AGENT_TOGGLEABLE_PERMISSIONS);

/**
 * Normalize field_agent duties so core collection/sync permissions can never be removed
 * and office/approval permissions can never be added.
 */
export function sanitizeFieldAgentDuties(duties: readonly Permission[]): Permission[] {
  const allowedToggles = FIELD_AGENT_TOGGLEABLE_PERMISSIONS.filter(
    (perm) => FIELD_AGENT_TOGGLEABLE_SET.has(perm) && duties.includes(perm)
  );
  return [...FIELD_AGENT_LOCKED_PERMISSIONS, ...allowedToggles];
}

/** Built-in job titles a tenant admin may customize via the full permission editor (not field_agent / super_admin). */
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

export type TenantCustomizableBuiltinRole = TenantEditableBuiltinRole | "field_agent";

export function isTenantEditableBuiltinRole(role: Role): role is TenantEditableBuiltinRole {
  return (TENANT_EDITABLE_BUILTIN_ROLES as readonly Role[]).includes(role);
}

export function isTenantCustomizableBuiltinRole(role: Role): role is TenantCustomizableBuiltinRole {
  return isTenantEditableBuiltinRole(role) || role === "field_agent";
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
  if (role === "field_agent") {
    return overrideDuties != null
      ? sanitizeFieldAgentDuties(overrideDuties)
      : getPermissionsForRole("field_agent");
  }
  const resolved =
    overrideDuties != null ? [...new Set(overrideDuties)] : getPermissionsForRole(role);
  if (
    (role === "admin" || role === "coordinator") &&
    !resolved.includes("transactions.reverse.daily_susu")
  ) {
    resolved.push("transactions.reverse.daily_susu");
  }
  // Newer institutional-income duties must reach tenants with saved role overrides
  // that were snapshotted before these permissions existed.
  if (role === "admin" && !resolved.includes("income.read")) {
    resolved.push("income.read");
  }
  if (role === "coordinator" && !resolved.includes("income.read.daily")) {
    resolved.push("income.read.daily");
  }
  return resolved;
}
