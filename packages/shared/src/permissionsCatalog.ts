import { z } from "zod";
import type { Permission, Role } from "./auth.js";
import { isBuiltinRole } from "./auth.js";
import { hasTenantModule, MODULE_LABELS, tenantProductModuleSchema, type TenantProductModule } from "./modules.js";

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
  | "investments"
  | "agency_banking"
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
  investments: "investment_management",
  agency_banking: "banking",
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
  "investments",
  "agency_banking",
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
  investments: "Investment management",
  agency_banking: "Agency operations",
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
  "investment_management",
  "banking",
  "treasury"
];

export const PERMISSION_PRODUCT_LABELS: Record<PermissionProductScope, string> = {
  core: "Core & admin",
  susu_management: MODULE_LABELS.susu_management,
  loans_credit: MODULE_LABELS.loans_credit,
  investment_management: MODULE_LABELS.investment_management,
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
    id: "investments.read",
    label: "View investments",
    description: "See investment products, applications, portfolio, and customer records.",
    group: "investments"
  },
  {
    id: "investments.products.manage",
    label: "Manage investment products",
    description: "Create and edit fixed deposit, treasury bill, bond, and share products.",
    group: "investments",
    requires: ["investments.read"]
  },
  {
    id: "investments.applications.create",
    label: "Create investment applications",
    description: "Submit customer investment applications at a branch.",
    group: "investments",
    requires: ["investments.read"]
  },
  {
    id: "investments.applications.approve",
    label: "Approve investments",
    description: "Activate approved investment applications.",
    group: "investments",
    requires: ["investments.read"]
  },
  {
    id: "investments.redeem",
    label: "Redeem or close investments",
    description: "Redeem matured investments or close/cancel active positions.",
    group: "investments",
    requires: ["investments.read"]
  },
  {
    id: "investments.forms.manage",
    label: "Manage application forms",
    description: "Customize tenant investment application fields and sections.",
    group: "investments",
    requires: ["investments.read"]
  },
  {
    id: "investments.reports.read",
    label: "View investment reports",
    description: "Portfolio, branch, and product performance reports.",
    group: "investments",
    requires: ["investments.read"]
  },
  {
    id: "treasury.read",
    label: "View treasury & cash positions",
    description: "Vault, teller drawer, and bank cash balances plus trial balance.",
    group: "transactions"
  },
  {
    id: "treasury.cash.move",
    label: "Record cash movements",
    description: "Vault ↔ teller, vault ↔ bank, and internal cash transfers.",
    group: "transactions",
    requires: ["treasury.read"]
  },
  {
    id: "treasury.reconcile",
    label: "Reconcile cash accounts",
    description: "End-of-day settlement and variance resolution for branch cash.",
    group: "transactions",
    requires: ["treasury.read"]
  },
  {
    id: "agency.withdrawals.approve",
    label: "Verify withdrawal requests",
    description:
      "Customer Service initiates walk-in withdrawals (straight to teller) and verifies BMS member requests before teller payout.",
    group: "agency_banking",
    requires: ["customers.read"]
  },
  {
    id: "agency.bank.execute",
    label: "Execute bank-side deposits (Back Officer)",
    description: "Credit customer accounts at the bank after teller deposit.",
    group: "agency_banking",
    requires: ["customers.read", "transactions.read"]
  },
  {
    id: "agency.withdrawals.pay",
    label: "Pay approved withdrawals (Teller)",
    description: "Hand physical cash after Customer Service verification (ledger debit at payout).",
    group: "agency_banking",
    requires: ["customers.read", "transactions.read"]
  },
  {
    id: "agency.deposits.record",
    label: "Record teller deposits (pending bank)",
    description: "Accept customer cash at till — Back Officer must credit account before SUCCESS.",
    group: "agency_banking",
    requires: ["customers.read"]
  },
  {
    id: "agency.accounts.create",
    label: "Open partner bank accounts",
    description: "Customer Service records real accounts opened on partner bank platforms.",
    group: "agency_banking",
    requires: ["customers.read", "banking.products.read"]
  },
  {
    id: "banking.products.read",
    label: "View bank products",
    description: "See tenant-configured deposit and withdrawal products (Ecobank, GCB, etc.).",
    group: "agency_banking"
  },
  {
    id: "banking.products.manage",
    label: "Manage bank products",
    description: "Create and edit agency banking deposit/withdrawal product types.",
    group: "agency_banking",
    requires: ["banking.products.read"]
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

export type InvestmentsNavKey =
  | "overview"
  | "applications"
  | "apply"
  | "products"
  | "formBuilder"
  | "reports";

export type InvestmentsNavVisibilityRow = {
  navPath: string;
  navKey: InvestmentsNavKey;
  label: string;
  description: string;
  anyPermissions: Permission[];
};

export const INVESTMENTS_NAV_VISIBILITY: InvestmentsNavVisibilityRow[] = [
  {
    navPath: "investments",
    navKey: "overview",
    label: "Overview",
    description: "Investment portfolio KPIs and summary.",
    anyPermissions: ["investments.read"]
  },
  {
    navPath: "investments/applications",
    navKey: "applications",
    label: "Portfolio",
    description: "Search and manage customer investments.",
    anyPermissions: ["investments.read"]
  },
  {
    navPath: "investments/apply",
    navKey: "apply",
    label: "New application",
    description: "Standard customer investment application form.",
    anyPermissions: ["investments.applications.create"]
  },
  {
    navPath: "investments/products",
    navKey: "products",
    label: "Products & rates",
    description: "Fixed deposits, treasury bills, bonds, and shares.",
    anyPermissions: ["investments.read"]
  },
  {
    navPath: "investments/form-builder",
    navKey: "formBuilder",
    label: "Form builder",
    description: "Customize application fields per company.",
    anyPermissions: ["investments.forms.manage"]
  },
  {
    navPath: "investments/reports",
    navKey: "reports",
    label: "Reports",
    description: "Active, matured, redeemed, and performance reports.",
    anyPermissions: ["investments.reports.read"]
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
    label: "Withdrawal gate",
    description: "Review and approve MoMo withdrawal requests.",
    anyPermissions: ["agency.withdrawals.approve"],
    roles: ["admin", "customer_service"]
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
  },
  {
    navPath: "susu/closing-balances",
    label: "Closing balances",
    description: "Daily susu cash closing calculation for susu-only tenants.",
    anyPermissions: ["transactions.read"],
    roles: ["admin", "coordinator", "accountant"]
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

export function filterInvestmentsNavByPermissions(
  permissions: Permission[] | undefined
): InvestmentsNavVisibilityRow[] {
  return INVESTMENTS_NAV_VISIBILITY.filter((row) => hasAnyPermission(permissions, row.anyPermissions));
}

export function resolveInvestmentsRoutePermissions(routePath: string): Permission[] {
  const normalized = routePath.replace(/^\/+/, "").replace(/^app\//, "").split("?")[0] ?? "";
  if (/^investments\/applications\/[^/]+$/.test(normalized)) {
    return ["investments.read"];
  }
  const exact = INVESTMENTS_NAV_VISIBILITY.find((row) => row.navPath === normalized);
  if (exact) {
    return exact.anyPermissions;
  }
  const prefix = INVESTMENTS_NAV_VISIBILITY.find((row) => normalized.startsWith(`${row.navPath}/`));
  return prefix?.anyPermissions ?? ["investments.read"];
}

const SUSU_OVERVIEW_ACCESS: Pick<SusuNavVisibilityRow, "anyPermissions" | "roles"> = {
  anyPermissions: ["reports.read", "customers.read"],
  roles: ["admin", "coordinator", "accountant", "auditor", "teller"]
};

function normalizeAppRoute(routePath: string): string {
  return routePath.replace(/^\/+/, "").replace(/^app\//, "").split("?")[0] ?? "";
}

function resolveSusuNavRow(
  routePath: string,
  susuNavVisibility?: SusuNavVisibilityRow[]
): SusuNavVisibilityRow | null {
  const normalized = normalizeAppRoute(routePath);
  if (normalized === "susu/overview") {
    return {
      navPath: normalized,
      label: "Overview",
      description: "Susu department summary.",
      ...SUSU_OVERVIEW_ACCESS
    };
  }
  const rows = susuNavVisibility?.length ? susuNavVisibility : SUSU_NAV_VISIBILITY;
  return rows.find((row) => row.navPath === normalized) ?? null;
}

/** Minimum permissions for a tenant Susu route (aligns with sidebar matrix). */
export function resolveSusuRoutePermissions(
  routePath: string,
  susuNavVisibility?: SusuNavVisibilityRow[]
): Permission[] {
  const row = resolveSusuNavRow(routePath, susuNavVisibility);
  return row?.anyPermissions ?? ["customers.read"];
}

/** Route access: built-in role gate + permission check (matches nav rules). */
export function canAccessSusuRoute(
  role: Role | string | undefined,
  permissions: Permission[] | undefined,
  routePath: string,
  susuNavVisibility?: SusuNavVisibilityRow[]
): boolean {
  const row = resolveSusuNavRow(routePath, susuNavVisibility);
  if (!row || !role) {
    return false;
  }
  if (isBuiltinRole(role) && !row.roles.includes(role)) {
    return false;
  }
  return hasAnyPermission(permissions, row.anyPermissions);
}

export type SettingsRouteVisibilityRow = {
  routePath: string;
  label: string;
  anyPermissions: Permission[];
  roles: Role[];
};

export const SETTINGS_ROUTE_VISIBILITY: SettingsRouteVisibilityRow[] = [
  {
    routePath: "settings",
    label: "Settings hub",
    anyPermissions: ["users.read", "branches.read", "roles.read", "audit.read"],
    roles: ["admin"]
  },
  {
    routePath: "settings/profile",
    label: "Company profile",
    anyPermissions: ["users.read"],
    roles: ["admin"]
  },
  {
    routePath: "settings/branches",
    label: "Branches",
    anyPermissions: ["branches.read"],
    roles: ["admin"]
  },
  {
    routePath: "settings/account-numbers",
    label: "Account numbers",
    anyPermissions: ["customers.create"],
    roles: ["admin"]
  },
  {
    routePath: "settings/subscription",
    label: "Product subscription",
    anyPermissions: ["roles.read"],
    roles: ["admin"]
  },
  {
    routePath: "settings/users",
    label: "Users",
    anyPermissions: ["users.read"],
    roles: ["admin"]
  },
  {
    routePath: "settings/roles",
    label: "Roles & permissions",
    anyPermissions: ["roles.read"],
    roles: ["admin"]
  },
  {
    routePath: "settings/approval-workflows",
    label: "Approval workflows",
    anyPermissions: ["customers.read"],
    roles: ["admin"]
  },
  {
    routePath: "settings/notifications",
    label: "Notifications",
    anyPermissions: ["workspace.notifications"],
    roles: ["admin"]
  },
  {
    routePath: "settings/audit-logs",
    label: "Audit logs",
    anyPermissions: ["audit.read"],
    roles: ["admin", "auditor"]
  }
];

export function resolveSettingsRoutePermissions(routePath: string): Permission[] {
  const normalized = normalizeAppRoute(routePath);
  const row = SETTINGS_ROUTE_VISIBILITY.find((r) => r.routePath === normalized);
  return row?.anyPermissions ?? ["users.read"];
}

export function canAccessSettingsRoute(
  role: Role | string | undefined,
  permissions: Permission[] | undefined,
  routePath: string
): boolean {
  const normalized = normalizeAppRoute(routePath);
  const row = SETTINGS_ROUTE_VISIBILITY.find((r) => r.routePath === normalized);
  if (!row || !role) {
    return false;
  }
  if (isBuiltinRole(role) && !row.roles.includes(role)) {
    return false;
  }
  return hasAnyPermission(permissions, row.anyPermissions);
}

export type TreasuryNavVisibilityRow = {
  navPath: string;
  label: string;
  anyPermissions: Permission[];
};

export const TREASURY_NAV_VISIBILITY: TreasuryNavVisibilityRow[] = [
  {
    navPath: "treasury",
    label: "Cash positions",
    anyPermissions: ["treasury.read"]
  },
  {
    navPath: "treasury/movements",
    label: "Cash movements",
    anyPermissions: ["treasury.cash.move"]
  },
  {
    navPath: "treasury/trial-balance",
    label: "Trial balance",
    anyPermissions: ["treasury.read"]
  }
];

/** Agency banking transactional routes (permission gates). */
export const AGENCY_NAV_VISIBILITY: Array<{
  navPath: string;
  label: string;
  anyPermissions: Permission[];
}> = [
  {
    navPath: "banking/teller",
    label: "Teller desk",
    anyPermissions: ["agency.deposits.record", "agency.withdrawals.pay"]
  },
  {
    navPath: "banking/deposits",
    label: "Record deposits",
    anyPermissions: ["agency.deposits.record"]
  },
  {
    navPath: "banking/reconciliation",
    label: "Teller reconciliation",
    anyPermissions: ["agency.deposits.record"]
  },
  {
    navPath: "banking/till-daybook",
    label: "Till daybook",
    anyPermissions: ["agency.deposits.record"]
  },
  {
    navPath: "banking/customer-service",
    label: "Customer service",
    anyPermissions: ["agency.withdrawals.approve"]
  },
  {
    navPath: "banking/withdrawals",
    label: "Withdrawals",
    anyPermissions: ["agency.withdrawals.approve"]
  },
  {
    navPath: "banking/account-opening",
    label: "Account opening",
    anyPermissions: ["agency.accounts.create"]
  },
  {
    navPath: "banking/back-office",
    label: "Back office",
    anyPermissions: ["agency.bank.execute"]
  },
  {
    navPath: "banking/back-office/deposits",
    label: "Deposit queue",
    anyPermissions: ["agency.bank.execute"]
  },
  {
    navPath: "banking/back-office/balancing",
    label: "Account balancing",
    anyPermissions: ["agency.bank.execute"]
  },
  {
    navPath: "banking/back-office/reconciliation",
    label: "Teller/Back Officer reconciliation",
    anyPermissions: ["agency.bank.execute"]
  },
  {
    navPath: "banking/products",
    label: "Bank products",
    anyPermissions: ["banking.products.read"]
  },
  {
    navPath: "banking/accountant",
    label: "Accountant desk",
    anyPermissions: ["ledger.read", "reports.read"]
  },
  {
    navPath: "banking/accountant/approvals",
    label: "Accountant approvals",
    anyPermissions: ["ledger.read", "treasury.read"]
  },
  {
    navPath: "banking/accountant/reports",
    label: "Accountant reports",
    anyPermissions: ["reports.read"]
  },
  {
    navPath: "banking/auditor",
    label: "Auditor desk",
    anyPermissions: ["audit.read", "transactions.read"]
  },
  {
    navPath: "banking/auditor/logs",
    label: "Audit logs",
    anyPermissions: ["audit.read"]
  },
  {
    navPath: "banking/auditor/reports",
    label: "Auditor reports",
    anyPermissions: ["reports.read", "transactions.read"]
  },
  {
    navPath: "banking/auditor/exceptions",
    label: "Exception review",
    anyPermissions: ["audit.read", "transactions.read"]
  },
  {
    navPath: "banking/hrm",
    label: "HR desk",
    anyPermissions: ["users.read"]
  },
  {
    navPath: "banking/hrm/staff",
    label: "Staff directory",
    anyPermissions: ["users.read"]
  },
  {
    navPath: "banking/hrm/payroll",
    label: "Payroll",
    anyPermissions: ["users.read"]
  },
  {
    navPath: "banking/accountant/trial-balance",
    label: "Accountant trial balance",
    anyPermissions: ["ledger.read"]
  },
  {
    navPath: "banking/hrm/profiles",
    label: "Employee profiles",
    anyPermissions: ["users.read"]
  },
  {
    navPath: "banking/hrm/branches",
    label: "Branch assignments",
    anyPermissions: ["users.read"]
  },
  {
    navPath: "banking/hrm/attendance",
    label: "Attendance",
    anyPermissions: ["users.read"]
  },
  {
    navPath: "banking/hrm/leave",
    label: "Leave management",
    anyPermissions: ["users.read"]
  },
  {
    navPath: "banking/hrm/staff-loans",
    label: "Staff loans",
    anyPermissions: ["users.read"]
  },
  {
    navPath: "banking/hrm/policies",
    label: "HR policies",
    anyPermissions: ["users.read"]
  },
  {
    navPath: "banking/hrm/appointments",
    label: "Appointment letters",
    anyPermissions: ["users.read"]
  },
  {
    navPath: "banking/hrm/training",
    label: "Training compliance",
    anyPermissions: ["users.read"]
  },
  {
    navPath: "banking/hrm/roles",
    label: "Job titles",
    anyPermissions: ["roles.read", "users.read"]
  },
  {
    navPath: "banking/operations",
    label: "Branch operations",
    anyPermissions: ["reports.read", "treasury.read"]
  }
];

/** Banking sidebar — visibility by job title; route gates still enforce permissions. */
export const BANKING_NAV_VISIBILITY: Array<{
  navPath: string;
  label: string;
  anyPermissions: Permission[];
  roles: Role[];
}> = [
  {
    navPath: "banking",
    label: "Overview",
    anyPermissions: ["transactions.read"],
    roles: ["admin", "accountant", "back_officer", "teller", "customer_service", "coordinator", "auditor"]
  },
  {
    navPath: "banking/products",
    label: "Bank products",
    anyPermissions: ["banking.products.read"],
    roles: ["admin"]
  },
  {
    navPath: "banking/operations",
    label: "Branch operations",
    anyPermissions: ["reports.read", "treasury.read"],
    roles: ["admin", "coordinator"]
  }
];

export type BankingNavSubgroupRow = {
  navPath: string;
  label: string;
  anyPermissions: Permission[];
  roles: Role[];
};

export type BankingNavSubgroup = {
  id: string;
  label: string;
  children: BankingNavSubgroupRow[];
};

/** Collapsible desk sections under Agency Banking. */
export const BANKING_NAV_SUBGROUPS: BankingNavSubgroup[] = [
  {
    id: "banking_teller",
    label: "Teller",
    children: [
      {
        navPath: "banking/teller",
        label: "Desk home",
        anyPermissions: ["agency.deposits.record", "agency.withdrawals.pay"],
        roles: ["admin", "teller"]
      },
      {
        navPath: "banking/deposits",
        label: "Record deposits",
        anyPermissions: ["agency.deposits.record"],
        roles: ["admin", "teller"]
      },
      {
        navPath: "banking/reconciliation",
        label: "Reconciliation",
        anyPermissions: ["agency.deposits.record"],
        roles: ["admin", "teller", "coordinator"]
      },
      {
        navPath: "banking/till-daybook",
        label: "Till daybook",
        anyPermissions: ["agency.deposits.record"],
        roles: ["admin", "teller"]
      }
    ]
  },
  {
    id: "banking_customer_service",
    label: "Customer service",
    children: [
      {
        navPath: "banking/customer-service",
        label: "Desk home",
        anyPermissions: ["agency.withdrawals.approve"],
        roles: ["admin", "customer_service"]
      },
      {
        navPath: "banking/withdrawals",
        label: "Withdrawals",
        anyPermissions: ["agency.withdrawals.approve"],
        roles: ["admin", "customer_service"]
      },
      {
        navPath: "banking/account-opening",
        label: "Account opening",
        anyPermissions: ["agency.accounts.create"],
        roles: ["admin", "customer_service"]
      }
    ]
  },
  {
    id: "banking_back_officer",
    label: "Back office",
    children: [
      {
        navPath: "banking/back-office",
        label: "Desk home",
        anyPermissions: ["agency.bank.execute"],
        roles: ["admin", "back_officer"]
      },
      {
        navPath: "banking/back-office/deposits",
        label: "Deposit queue",
        anyPermissions: ["agency.bank.execute"],
        roles: ["admin", "back_officer"]
      },
      {
        navPath: "banking/back-office/balancing",
        label: "Account balancing",
        anyPermissions: ["agency.bank.execute"],
        roles: ["admin", "back_officer"]
      },
      {
        navPath: "banking/back-office/reconciliation",
        label: "Teller/Back Officer reconciliation",
        anyPermissions: ["agency.bank.execute"],
        roles: ["admin", "back_officer"]
      }
    ]
  },
  {
    id: "banking_accountant",
    label: "Accountant",
    children: [
      {
        navPath: "banking/accountant",
        label: "Desk home",
        anyPermissions: ["ledger.read", "reports.read"],
        roles: ["admin", "accountant"]
      },
      {
        navPath: "banking/accountant/approvals",
        label: "Approvals queue",
        anyPermissions: ["ledger.read", "treasury.read"],
        roles: ["admin", "accountant"]
      },
      {
        navPath: "banking/accountant/reports",
        label: "Reports",
        anyPermissions: ["reports.read"],
        roles: ["admin", "accountant"]
      },
      {
        navPath: "banking/accountant/trial-balance",
        label: "Trial balance",
        anyPermissions: ["ledger.read"],
        roles: ["admin", "accountant"]
      }
    ]
  },
  {
    id: "banking_auditor",
    label: "Auditor",
    children: [
      {
        navPath: "banking/auditor",
        label: "Desk home",
        anyPermissions: ["audit.read", "transactions.read"],
        roles: ["admin", "auditor"]
      },
      {
        navPath: "banking/auditor/logs",
        label: "Audit logs",
        anyPermissions: ["audit.read"],
        roles: ["admin", "auditor"]
      },
      {
        navPath: "banking/auditor/reports",
        label: "Reports",
        anyPermissions: ["reports.read", "transactions.read"],
        roles: ["admin", "auditor"]
      },
      {
        navPath: "banking/auditor/exceptions",
        label: "Exceptions",
        anyPermissions: ["audit.read", "transactions.read"],
        roles: ["admin", "auditor"]
      }
    ]
  },
  {
    id: "banking_hrm",
    label: "Human resources",
    children: [
      {
        navPath: "banking/hrm",
        label: "Desk home",
        anyPermissions: ["users.read"],
        roles: ["admin", "coordinator"]
      },
      {
        navPath: "banking/hrm/profiles",
        label: "Employee profiles",
        anyPermissions: ["users.read"],
        roles: ["admin", "coordinator"]
      },
      {
        navPath: "banking/hrm/branches",
        label: "Branch assignments",
        anyPermissions: ["users.read"],
        roles: ["admin", "coordinator"]
      },
      {
        navPath: "banking/hrm/attendance",
        label: "Attendance",
        anyPermissions: ["users.read"],
        roles: ["admin", "coordinator"]
      },
      {
        navPath: "banking/hrm/leave",
        label: "Leave management",
        anyPermissions: ["users.read"],
        roles: ["admin", "coordinator"]
      },
      {
        navPath: "banking/hrm/staff-loans",
        label: "Staff loans",
        anyPermissions: ["users.read"],
        roles: ["admin", "coordinator"]
      },
      {
        navPath: "banking/hrm/policies",
        label: "HR policies",
        anyPermissions: ["users.read"],
        roles: ["admin", "coordinator"]
      },
      {
        navPath: "banking/hrm/appointments",
        label: "Appointment letters",
        anyPermissions: ["users.read"],
        roles: ["admin", "coordinator"]
      },
      {
        navPath: "banking/hrm/payroll",
        label: "Payroll",
        anyPermissions: ["users.read"],
        roles: ["admin", "coordinator"]
      },
      {
        navPath: "banking/hrm/roles",
        label: "Roles & permissions",
        anyPermissions: ["roles.read", "users.read"],
        roles: ["admin", "coordinator"]
      },
      {
        navPath: "banking/hrm/training",
        label: "Training & compliance",
        anyPermissions: ["users.read"],
        roles: ["admin", "coordinator"]
      }
    ]
  }
];

export function resolveBankingRoutePermissions(routePath: string): Permission[] {
  const normalized = normalizeAppRoute(routePath);
  if (normalized === "banking") {
    return ["transactions.read"];
  }
  return resolveAgencyRoutePermissions(routePath);
}

export function resolveAgencyRoutePermissions(routePath: string): Permission[] {
  const normalized = normalizeAppRoute(routePath);
  const row = AGENCY_NAV_VISIBILITY.find((r) => r.navPath === normalized);
  if (row) {
    return [...row.anyPermissions] as Permission[];
  }
  const subgroupRow = BANKING_NAV_SUBGROUPS.flatMap((group) => group.children).find(
    (child) => child.navPath === normalized
  );
  if (subgroupRow) {
    return [...subgroupRow.anyPermissions];
  }
  const bankingRow = BANKING_NAV_VISIBILITY.find((r) => r.navPath === normalized);
  if (bankingRow) {
    return [...bankingRow.anyPermissions];
  }
  if (normalized === "banking/products") {
    return ["banking.products.read"];
  }
  return ["transactions.read"];
}

export function resolveTreasuryRoutePermissions(routePath: string): Permission[] {
  const normalized = normalizeAppRoute(routePath);
  const row = TREASURY_NAV_VISIBILITY.find((r) => r.navPath === normalized);
  return row?.anyPermissions ?? ["treasury.read"];
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

function isCatalogEntryVisibleForTenant(
  entry: PermissionCatalogEntry,
  subscribedModules: TenantProductModule[] | undefined
): boolean {
  if (entry.group === "platform") {
    return false;
  }
  if (entry.group === "agency_banking") {
    if (hasTenantModule(subscribedModules, "banking")) {
      return true;
    }
    return (
      entry.id === "agency.withdrawals.approve" &&
      hasTenantModule(subscribedModules, "susu_management")
    );
  }
  return isPermissionGroupVisibleForTenant(entry.group, subscribedModules);
}

export function catalogEntriesForTenant(
  subscribedModules: TenantProductModule[] | undefined
): PermissionCatalogEntry[] {
  return PERMISSION_CATALOG.filter((entry) =>
    isCatalogEntryVisibleForTenant(entry, subscribedModules)
  );
}

/** Scope for custom tenant roles — `all` spans every subscribed product plus core duties. */
export const customRoleProductScopeSchema = z.union([z.literal("all"), tenantProductModuleSchema]);
export type CustomRoleProductScope = z.infer<typeof customRoleProductScopeSchema>;

const TREASURY_PERMISSION_IDS = new Set<Permission>([
  "treasury.read",
  "treasury.cash.move",
  "treasury.reconcile"
]);

/** Product department a permission belongs to (core duties are shared across products). */
export function permissionScopeForCatalogEntry(entry: PermissionCatalogEntry): PermissionProductScope {
  if (TREASURY_PERMISSION_IDS.has(entry.id)) {
    return "treasury";
  }
  return PERMISSION_GROUP_PRODUCT[entry.group];
}

export function customRoleProductScopeLabel(scope: CustomRoleProductScope): string {
  return scope === "all" ? "All subscribed products" : PERMISSION_PRODUCT_LABELS[scope];
}

function isCatalogEntryInCustomRoleScope(
  entry: PermissionCatalogEntry,
  roleScope: CustomRoleProductScope,
  subscribedModules: TenantProductModule[] | undefined
): boolean {
  if (entry.group === "platform") {
    return false;
  }
  if (roleScope === "all") {
    return isCatalogEntryVisibleForTenant(entry, subscribedModules);
  }
  const entryScope = permissionScopeForCatalogEntry(entry);
  if (entryScope === "core") {
    return true;
  }
  if (entryScope === roleScope) {
    return isCatalogEntryVisibleForTenant(entry, subscribedModules);
  }
  if (
    roleScope === "susu_management" &&
    entry.id === "agency.withdrawals.approve" &&
    hasTenantModule(subscribedModules, "susu_management")
  ) {
    return true;
  }
  return false;
}

export function catalogEntriesForCustomRoleScope(
  subscribedModules: TenantProductModule[] | undefined,
  roleScope: CustomRoleProductScope
): PermissionCatalogEntry[] {
  return PERMISSION_CATALOG.filter((entry) =>
    isCatalogEntryInCustomRoleScope(entry, roleScope, subscribedModules)
  );
}

function buildPermissionProductSections(
  visibleEntries: PermissionCatalogEntry[]
): PermissionProductSection[] {
  const sections: PermissionProductSection[] = [];
  for (const scope of PERMISSION_PRODUCT_SECTION_ORDER) {
    const groupIds = PERMISSION_GROUP_ORDER.filter((groupId) => {
      if (groupId === "platform") {
        return false;
      }
      if (PERMISSION_GROUP_PRODUCT[groupId] !== scope) {
        return false;
      }
      return visibleEntries.some((entry) => entry.group === groupId);
    });
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

export function permissionProductSectionsForCustomRoleScope(
  subscribedModules: TenantProductModule[] | undefined,
  roleScope: CustomRoleProductScope
): PermissionProductSection[] {
  if (roleScope === "all") {
    return permissionProductSectionsForTenant(subscribedModules);
  }

  const visibleEntries = catalogEntriesForCustomRoleScope(subscribedModules, roleScope);
  const sections: PermissionProductSection[] = [];

  const coreGroupIds = PERMISSION_GROUP_ORDER.filter(
    (groupId) =>
      groupId !== "platform" &&
      PERMISSION_GROUP_PRODUCT[groupId] === "core" &&
      visibleEntries.some((entry) => entry.group === groupId)
  );
  if (coreGroupIds.length > 0) {
    sections.push({
      scope: "core",
      label: PERMISSION_PRODUCT_LABELS.core,
      groupIds: coreGroupIds
    });
  }

  const productGroupIds = PERMISSION_GROUP_ORDER.filter(
    (groupId) =>
      groupId !== "platform" &&
      PERMISSION_GROUP_PRODUCT[groupId] !== "core" &&
      visibleEntries.some((entry) => entry.group === groupId)
  );
  if (productGroupIds.length > 0) {
    sections.push({
      scope: roleScope,
      label: PERMISSION_PRODUCT_LABELS[roleScope],
      groupIds: productGroupIds
    });
  }

  return sections;
}

export function validateCustomRoleDuties(
  duties: Permission[],
  roleScope: CustomRoleProductScope,
  subscribedModules?: TenantProductModule[]
): { errors: string[]; warnings: string[] } {
  const result = validateDutySelection(duties);
  const allowed = new Set(
    catalogEntriesForCustomRoleScope(subscribedModules, roleScope).map((entry) => entry.id)
  );
  for (const duty of duties) {
    if (!allowed.has(duty)) {
      result.errors.push(
        `${duty} is outside the ${customRoleProductScopeLabel(roleScope).toLowerCase()} scope for this role`
      );
    }
  }
  return result;
}

export type PermissionProductSection = {
  scope: PermissionProductScope;
  label: string;
  groupIds: PermissionGroupId[];
};

export function permissionProductSectionsForTenant(
  subscribedModules: TenantProductModule[] | undefined
): PermissionProductSection[] {
  return buildPermissionProductSections(catalogEntriesForTenant(subscribedModules));
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
  "back_officer",
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
  teller: "Teller (cash operator)",
  back_officer: "Back Officer (bank execution)",
  customer_service: "Customer Service (withdrawal verification)"
};
