import type { Permission, Role } from "./auth.js";
import { hasTenantModule, MODULE_LABELS, type TenantProductModule } from "./modules.js";

export type PermissionGroupId =
  | "platform"
  | "roles"
  | "users"
  | "branches"
  | "customers"
  | "transactions"
  | "ledger"
  | "reports"
  | "payroll"
  | "commission"
  | "audit"
  | "loans"
  | "workspace";

export type PermissionProductScope = TenantProductModule | "core";

/** Which subscribed product each permission group belongs to (`core` = always shown). */
export const PERMISSION_GROUP_PRODUCT: Record<PermissionGroupId, PermissionProductScope> = {
  platform: "core",
  roles: "core",
  users: "core",
  branches: "core",
  customers: "susu_management",
  transactions: "susu_management",
  ledger: "susu_management",
  reports: "core",
  payroll: "susu_management",
  commission: "susu_management",
  audit: "core",
  loans: "loans_credit",
  workspace: "core"
};

export const PERMISSION_GROUP_ORDER: PermissionGroupId[] = [
  "roles",
  "users",
  "branches",
  "customers",
  "transactions",
  "ledger",
  "loans",
  "reports",
  "payroll",
  "commission",
  "audit",
  "workspace"
];

export const PERMISSION_GROUP_LABELS: Record<PermissionGroupId, string> = {
  platform: "Platform",
  roles: "Roles",
  users: "Users",
  branches: "Branches",
  customers: "Customers",
  transactions: "Transactions & till",
  ledger: "Ledger",
  loans: "Loans & credit",
  reports: "Reports",
  payroll: "Payroll",
  commission: "Commission",
  audit: "Audit",
  workspace: "Workspace"
};

export const PERMISSION_PRODUCT_SECTION_ORDER: PermissionProductScope[] = [
  "core",
  "susu_management",
  "loans_credit",
  "banking",
  "treasury"
];

export const PERMISSION_PRODUCT_LABELS: Record<PermissionProductScope, string> = {
  core: "Core & admin",
  susu_management: MODULE_LABELS.susu_management,
  loans_credit: MODULE_LABELS.loans_credit,
  banking: MODULE_LABELS.banking,
  treasury: MODULE_LABELS.treasury
};

export type PermissionCatalogEntry = {
  id: Permission;
  label: string;
  description: string;
  group: PermissionGroupId;
  /** Other permissions that should be granted together (warnings only). */
  suggests?: Permission[];
  /** Hard requirement — selection is invalid without these. */
  requires?: Permission[];
};

export const PERMISSION_CATALOG: PermissionCatalogEntry[] = [
  {
    id: "platform.tenants.read",
    label: "View tenants (platform)",
    description: "Super-admin only: list companies on the platform.",
    group: "platform"
  },
  {
    id: "platform.tenants.create",
    label: "Create tenants",
    description: "Super-admin only: onboard new companies.",
    group: "platform",
    requires: ["platform.tenants.read"]
  },
  {
    id: "platform.tenants.update",
    label: "Update tenants",
    description: "Super-admin only: change subscription and modules.",
    group: "platform",
    requires: ["platform.tenants.read"]
  },
  {
    id: "roles.create",
    label: "Create custom roles",
    description: "Define extra duty bundles for your tenant (stored separately from built-in job titles).",
    group: "roles",
    suggests: ["roles.read"]
  },
  {
    id: "roles.read",
    label: "View roles",
    description: "See built-in role duties and any custom tenant roles.",
    group: "roles"
  },
  {
    id: "roles.assign",
    label: "Assign custom roles",
    description: "Link a user to a custom role key. Built-in titles (admin, teller, etc.) are set on the user record.",
    group: "roles",
    requires: ["roles.read"],
    suggests: ["roles.create"]
  },
  {
    id: "users.create",
    label: "Create users",
    description: "Add staff accounts for branches and head office.",
    group: "users",
    suggests: ["users.read"]
  },
  {
    id: "users.read",
    label: "View users",
    description: "List staff, search by email, and open user detail.",
    group: "users"
  },
  {
    id: "users.update",
    label: "Update users",
    description: "Edit role, branch scope, status, and profile fields.",
    group: "users",
    requires: ["users.read"]
  },
  {
    id: "users.delete",
    label: "Delete users",
    description: "Remove staff accounts. Prefer deactivating when unsure.",
    group: "users",
    requires: ["users.read", "users.update"]
  },
  {
    id: "branches.create",
    label: "Create branches",
    description: "Add branch codes and names.",
    group: "branches",
    suggests: ["branches.read"]
  },
  {
    id: "branches.update",
    label: "Update branches",
    description: "Rename or deactivate branches.",
    group: "branches",
    requires: ["branches.read"]
  },
  {
    id: "branches.read",
    label: "View branches",
    description: "Required for branch-scoped screens and counters.",
    group: "branches"
  },
  {
    id: "branches.delete",
    label: "Delete branches",
    description: "Remove empty branches. Blocked when customers or staff are still linked.",
    group: "branches",
    requires: ["branches.read", "branches.update"]
  },
  {
    id: "customers.create",
    label: "Create / register customers",
    description: "Submit new accounts (often pending coordinator approval).",
    group: "customers",
    suggests: ["customers.read"]
  },
  {
    id: "customers.read",
    label: "View customers",
    description: "Search customers, approvals queue, and notification inbox.",
    group: "customers"
  },
  {
    id: "transactions.create.daily_susu",
    label: "Record daily Susu",
    description: "Post daily collection amounts at branch counter or in the field.",
    group: "transactions",
    requires: ["transactions.read", "customers.read"],
    suggests: ["branches.read"]
  },
  {
    id: "transactions.create.deposit",
    label: "Record deposits",
    description: "Cash or savings deposits at the counter.",
    group: "transactions",
    requires: ["transactions.read", "customers.read"]
  },
  {
    id: "transactions.create.withdrawal",
    label: "Record withdrawals",
    description: "Pay out approved withdrawals. Pair with approval duties for coordinators.",
    group: "transactions",
    requires: ["transactions.read", "customers.read"]
  },
  {
    id: "transactions.read",
    label: "View transactions & till",
    description: "Ledgers, branch counter, float sessions, and transaction history.",
    group: "transactions",
    suggests: ["customers.read"]
  },
  {
    id: "branch_float.manage",
    label: "Manage till float",
    description: "Approve float requests, push opening cash, and settle end-of-day sessions.",
    group: "transactions",
    requires: ["transactions.read", "branches.read"],
    suggests: ["users.read"]
  },
  {
    id: "ledger.read",
    label: "View ledger",
    description: "Read-only account balances and journal-style entries.",
    group: "ledger",
    suggests: ["transactions.read"]
  },
  {
    id: "reports.read",
    label: "View reports",
    description: "Access Reports & Analytics when subscribed.",
    group: "reports"
  },
  {
    id: "payroll.read",
    label: "View payroll",
    description: "See payroll runs and payslips.",
    group: "payroll"
  },
  {
    id: "payroll.run",
    label: "Run payroll",
    description: "Execute payroll batches. Usually limited to admin and accountant.",
    group: "payroll",
    requires: ["payroll.read"]
  },
  {
    id: "commission_policy.read",
    label: "View commission policy",
    description: "Read agent commission rules.",
    group: "commission"
  },
  {
    id: "commission_policy.update",
    label: "Update commission policy",
    description: "Change commission percentages and rules.",
    group: "commission",
    requires: ["commission_policy.read"]
  },
  {
    id: "audit.read",
    label: "View audit logs",
    description: "Immutable trail of API mutations (who, what, when, status).",
    group: "audit"
  },
  {
    id: "loans.read",
    label: "View loans",
    description: "See loan products, applications, balances, and repayment history.",
    group: "loans"
  },
  {
    id: "loans.products.manage",
    label: "Manage loan products",
    description: "Create and edit loan product templates (rates, terms, limits).",
    group: "loans",
    requires: ["loans.read"]
  },
  {
    id: "loans.applications.create",
    label: "Create loan applications",
    description: "Submit loan applications for customers at a branch.",
    group: "loans",
    requires: ["loans.read"],
    suggests: ["customers.read"]
  },
  {
    id: "loans.applications.approve",
    label: "Approve or reject loans",
    description: "Credit committee / loans officer approval workflow.",
    group: "loans",
    requires: ["loans.read"]
  },
  {
    id: "loans.disburse",
    label: "Disburse approved loans",
    description: "Release funds for approved loan applications.",
    group: "loans",
    requires: ["loans.read", "loans.applications.approve"]
  },
  {
    id: "loans.repayments.create",
    label: "Record loan repayments",
    description: "Post customer repayments against active loans.",
    group: "loans",
    requires: ["loans.read"]
  },
  {
    id: "workspace.notifications",
    label: "Workspace notifications",
    description: "Bell icon: pending approvals, float requests, and important activity.",
    group: "workspace"
  }
];

export type LoansNavKey = "overview" | "products" | "groups" | "applications" | "apply" | "applyGroup";

export type LoansNavVisibilityRow = {
  navPath: string;
  navKey: LoansNavKey;
  label: string;
  description: string;
  /** User must hold at least one of these permissions to see this nav item. */
  anyPermissions: Permission[];
};

/** Loans sidebar + in-module subnav — visibility is permission-driven only (no role gate). */
export const LOANS_NAV_VISIBILITY: LoansNavVisibilityRow[] = [
  {
    navPath: "loans",
    navKey: "overview",
    label: "Overview",
    description: "Loan KPIs and department summary.",
    anyPermissions: ["loans.read"]
  },
  {
    navPath: "loans/products",
    navKey: "products",
    label: "Loan products",
    description: "View and configure loan product templates.",
    anyPermissions: ["loans.read"]
  },
  {
    navPath: "loans/groups",
    navKey: "groups",
    label: "Solidarity groups",
    description: "Group rosters for solidarity lending.",
    anyPermissions: ["loans.read"]
  },
  {
    navPath: "loans/applications",
    navKey: "applications",
    label: "Portfolio",
    description: "Applications, disbursements, and repayments.",
    anyPermissions: ["loans.read"]
  },
  {
    navPath: "loans/apply",
    navKey: "apply",
    label: "New application",
    description: "Individual loan application wizard.",
    anyPermissions: ["loans.applications.create"]
  },
  {
    navPath: "loans/apply/group",
    navKey: "applyGroup",
    label: "Group application",
    description: "Solidarity group member loan application.",
    anyPermissions: ["loans.applications.create"]
  }
];

export type SusuNavVisibilityRow = {
  navPath: string;
  label: string;
  description: string;
  /** User must hold at least one of these permissions (after built-in role gate). */
  anyPermissions: Permission[];
  /** Built-in roles that may see this item when permissions match. */
  roles: Role[];
};

/** Susu Management sidebar — permissions align with API routes; roles prevent privilege escalation. */
export const SUSU_NAV_VISIBILITY: SusuNavVisibilityRow[] = [
  {
    navPath: "susu/customers",
    label: "Customers",
    description: "Customer directory and account detail.",
    anyPermissions: ["customers.read"],
    roles: ["admin", "field_agent", "coordinator"]
  },
  {
    navPath: "susu/pending-approvals",
    label: "Pending Approvals",
    description: "Registrations, balance, and withdrawal queues.",
    anyPermissions: ["customers.read"],
    roles: ["admin", "coordinator"]
  },
  {
    navPath: "susu/callover-batches",
    label: "Callover batches",
    description: "Review field agent daily collections and post to accounts.",
    anyPermissions: ["transactions.read", "transactions.create.daily_susu"],
    roles: ["admin", "coordinator"]
  },
  {
    navPath: "susu/till-float",
    label: "Till float",
    description: "Approve and settle branch counter cash sessions.",
    anyPermissions: ["branch_float.manage", "transactions.read"],
    roles: ["admin", "coordinator"]
  },
  {
    navPath: "susu/collections",
    label: "Branch counter",
    description: "Post Susu, deposits, and withdrawals at the till.",
    anyPermissions: ["transactions.read"],
    roles: ["admin", "field_agent", "coordinator", "teller"]
  },
  {
    navPath: "susu/agents",
    label: "Agents",
    description: "Field agent roster and performance.",
    anyPermissions: ["customers.read", "users.read"],
    roles: ["admin", "coordinator"]
  },
  {
    navPath: "susu/coordinators",
    label: "Coordinators",
    description: "Coordinator accounts and approval workload.",
    anyPermissions: ["users.read"],
    roles: ["admin"]
  },
  {
    navPath: "susu/routes",
    label: "Routes",
    description: "Collection routes and assignments.",
    anyPermissions: ["customers.read"],
    roles: ["admin", "coordinator"]
  },
  {
    navPath: "susu/commissions",
    label: "Commissions",
    description: "Commission policy and payouts.",
    anyPermissions: ["commission_policy.read"],
    roles: ["admin", "accountant"]
  },
  {
    navPath: "susu/payroll",
    label: "Payroll",
    description: "Staff payroll for Susu operations.",
    anyPermissions: ["payroll.read"],
    roles: ["admin", "accountant"]
  },
  {
    navPath: "susu/withdrawals",
    label: "Withdrawals",
    description: "Withdrawal fulfillment and MoMo receipts.",
    anyPermissions: ["customers.read", "transactions.read"],
    roles: ["admin", "coordinator", "field_agent"]
  },
  {
    navPath: "susu/group-savings",
    label: "Group Savings",
    description: "Group savings products and members.",
    anyPermissions: ["customers.read"],
    roles: ["admin", "coordinator"]
  },
  {
    navPath: "susu/performance",
    label: "Performance",
    description: "KPIs and leaderboards (read-only).",
    anyPermissions: ["reports.read", "customers.read"],
    roles: ["admin", "coordinator", "field_agent", "teller", "accountant", "auditor", "customer_service"]
  },
  {
    navPath: "susu/onboarding",
    label: "Customer Onboarding",
    description: "Register new customers into pending approval.",
    anyPermissions: ["customers.create"],
    roles: ["admin", "field_agent", "coordinator"]
  }
];

export function hasAnyPermission(
  permissions: Permission[] | undefined,
  required: Permission[]
): boolean {
  if (!required.length) {
    return true;
  }
  const set = new Set(permissions ?? []);
  return required.some((p) => set.has(p));
}

export function filterLoansNavByPermissions(
  permissions: Permission[] | undefined
): LoansNavVisibilityRow[] {
  return LOANS_NAV_VISIBILITY.filter((row) => hasAnyPermission(permissions, row.anyPermissions));
}

/** Resolve minimum permissions for a tenant app loans route (e.g. /loans/applications/:id). */
export function resolveLoansRoutePermissions(routePath: string): Permission[] {
  const normalized = routePath.replace(/^\/+/, "").replace(/^app\//, "").split("?")[0] ?? "";
  if (/^loans\/applications\/[^/]+$/.test(normalized)) {
    return ["loans.read"];
  }
  if (normalized === "loans/form") {
    return ["loans.read"];
  }
  const exact = LOANS_NAV_VISIBILITY.find((row) => row.navPath === normalized);
  if (exact) {
    return exact.anyPermissions;
  }
  const prefix = LOANS_NAV_VISIBILITY.find((row) => normalized.startsWith(`${row.navPath}/`));
  return prefix?.anyPermissions ?? ["loans.read"];
}

export function isPermissionGroupVisibleForTenant(
  groupId: PermissionGroupId,
  subscribedModules: TenantProductModule[] | undefined
): boolean {
  if (groupId === "platform") {
    return false;
  }
  const scope = PERMISSION_GROUP_PRODUCT[groupId];
  if (scope === "core") {
    return true;
  }
  return hasTenantModule(subscribedModules, scope);
}

export function catalogEntriesForTenant(
  subscribedModules: TenantProductModule[] | undefined
): PermissionCatalogEntry[] {
  return PERMISSION_CATALOG.filter(
    (entry) =>
      entry.group !== "platform" && isPermissionGroupVisibleForTenant(entry.group, subscribedModules)
  );
}

export type PermissionProductSection = {
  scope: PermissionProductScope;
  label: string;
  groupIds: PermissionGroupId[];
};

export function permissionProductSectionsForTenant(
  subscribedModules: TenantProductModule[] | undefined
): PermissionProductSection[] {
  const sections: PermissionProductSection[] = [];
  for (const scope of PERMISSION_PRODUCT_SECTION_ORDER) {
    if (scope !== "core" && !hasTenantModule(subscribedModules, scope)) {
      continue;
    }
    const groupIds = PERMISSION_GROUP_ORDER.filter(
      (groupId) => groupId !== "platform" && PERMISSION_GROUP_PRODUCT[groupId] === scope
    );
    if (groupIds.length === 0) {
      continue;
    }
    sections.push({
      scope,
      label: PERMISSION_PRODUCT_LABELS[scope],
      groupIds
    });
  }
  return sections;
}

export function validateDutySelection(duties: Permission[]): {
  errors: string[];
  warnings: string[];
} {
  const errors: string[] = [];
  const warnings: string[] = [];
  const selected = new Set(duties);
  const catalogById = new Map(PERMISSION_CATALOG.map((e) => [e.id, e]));

  for (const duty of duties) {
    if (!catalogById.has(duty)) {
      errors.push(`Unknown permission: ${duty}`);
      continue;
    }
    const entry = catalogById.get(duty)!;
    for (const req of entry.requires ?? []) {
      if (!selected.has(req)) {
        errors.push(`${entry.label} requires ${req}`);
      }
    }
  }

  if (selected.has("transactions.create.withdrawal") && !selected.has("customers.read")) {
    warnings.push("Withdrawals without customers.read hides approval context in the UI.");
  }
  if (selected.has("roles.assign") && !selected.has("roles.create")) {
    warnings.push("Assigning custom roles works best after creating the role definition.");
  }
  if (selected.has("branch_float.manage") && !selected.has("users.read")) {
    warnings.push("Till float admin screens list cashiers — consider adding users.read.");
  }

  return { errors, warnings };
}

/** Job titles that can be toggled per Susu sidebar menu item (tenant config). */
export const NAV_MATRIX_ASSIGNABLE_ROLES: Role[] = [
  "admin",
  "coordinator",
  "teller",
  "accountant",
  "auditor",
  "customer_service",
  "field_agent"
];

export type SusuNavVisibilityConfigItem = SusuNavVisibilityRow & {
  defaultRoles: Role[];
  defaultAnyPermissions: Permission[];
  isCustomized: boolean;
};

export function buildSusuNavVisibilityConfig(
  overrides: Record<string, { roles: Role[]; anyPermissions: Permission[] }>
): SusuNavVisibilityConfigItem[] {
  return SUSU_NAV_VISIBILITY.map((row) => {
    const override = overrides[row.navPath];
    return {
      navPath: row.navPath,
      label: row.label,
      description: row.description,
      roles: override?.roles ?? [...row.roles],
      anyPermissions: override?.anyPermissions ?? [...row.anyPermissions],
      defaultRoles: [...row.roles],
      defaultAnyPermissions: [...row.anyPermissions],
      isCustomized: override != null
    };
  });
}

export function toSusuNavVisibilityRows(
  items: Array<Pick<SusuNavVisibilityRow, "navPath" | "label" | "description" | "roles" | "anyPermissions">>
): SusuNavVisibilityRow[] {
  return items.map((item) => ({
    navPath: item.navPath,
    label: item.label,
    description: item.description,
    roles: [...item.roles],
    anyPermissions: [...item.anyPermissions]
  }));
}

export function validateSusuNavVisibilityItems(
  items: Array<{ navPath: string; roles: Role[]; anyPermissions: Permission[] }>
): { errors: string[] } {
  const errors: string[] = [];
  const knownPaths = new Set(SUSU_NAV_VISIBILITY.map((r) => r.navPath));

  for (const item of items) {
    if (!knownPaths.has(item.navPath)) {
      errors.push(`Unknown menu item: ${item.navPath}`);
      continue;
    }
    if (item.roles.length === 0) {
      errors.push(`${item.navPath}: select at least one job title`);
    }
    if (item.anyPermissions.length === 0) {
      errors.push(`${item.navPath}: select at least one permission`);
    }
  }

  return { errors };
}

export const BUILTIN_ROLE_LABELS: Record<Role, string> = {
  super_admin: "Platform super admin",
  admin: "Company admin",
  coordinator: "Coordinator",
  field_agent: "Field agent",
  auditor: "Auditor",
  accountant: "Accountant",
  teller: "Teller",
  customer_service: "Customer service"
};
