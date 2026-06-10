import type { Permission, SusuNavVisibilityRow, TenantAddon, TenantProductModule } from "@bms/shared";
import {
  BANKING_NAV_SUBGROUPS,
  hasAnyPermission,
  hasTenantModule,
  isBuiltinRole,
  LOANS_NAV_VISIBILITY,
  MODULE_LABELS,
  SUSU_NAV_VISIBILITY,
  TREASURY_NAV_VISIBILITY,
  BANKING_NAV_VISIBILITY,
  UNIVERSAL_OPS_LABEL,
  UNIVERSAL_OPS_NAV
} from "@bms/shared";
import type { AppRole } from "../app/api";
export type DashboardNavLink = {
  kind: "link";
  to: string;
  label: string;
};

export type DashboardNavChildLink = {
  kind: "link";
  to: string;
  label: string;
};

export type DashboardNavSubgroup = {
  kind: "subgroup";
  id: string;
  label: string;
  children: Array<{ to: string; label: string }>;
};

export type DashboardNavChild = DashboardNavChildLink | DashboardNavSubgroup;

export type DashboardNavGroup = {
  kind: "group";
  id: string;
  label: string;
  children: DashboardNavChild[];
  /** Child links align with the group trigger (no extra indent). */
  flatChildren?: boolean;
};

export type DashboardNavItem = DashboardNavLink | DashboardNavGroup;

type NavChildDef = {
  to: string;
  label: string;
  roleCheck: (role: AppRole | string) => boolean;
  anyPermissions?: Permission[];
};

function filterChildren(
  children: NavChildDef[],
  role: AppRole | string,
  permissions: Permission[] | undefined
): Array<{ to: string; label: string }> {
  return children
    .filter((child) => {
      if (isBuiltinRole(role) && !child.roleCheck(role)) {
        return false;
      }
      if (child.anyPermissions?.length) {
        return hasAnyPermission(permissions, child.anyPermissions);
      }
      return isBuiltinRole(role) ? child.roleCheck(role) : true;
    })
    .map(({ to, label }) => ({ to, label }));
}

const SUSU_OVERVIEW_CHILD: NavChildDef = {
  to: "susu/overview",
  label: "Overview",
  roleCheck: (r) =>
    !isBuiltinRole(r) ||
    r === "admin" ||
    r === "coordinator" ||
    r === "accountant" ||
    r === "auditor" ||
    r === "teller",
  anyPermissions: ["customers.read", "reports.read"]
};

function buildSusuChildren(susuNav?: SusuNavVisibilityRow[]): NavChildDef[] {
  const rows = susuNav?.length ? susuNav : SUSU_NAV_VISIBILITY;
  return rows.map((row) => ({
    to: row.navPath,
    label: row.label,
    roleCheck: (r) => !isBuiltinRole(r) || row.roles.includes(r as AppRole),
    anyPermissions: row.anyPermissions
  }));
}

function buildSusuNavChildren(susuNav?: SusuNavVisibilityRow[]): NavChildDef[] {
  return [SUSU_OVERVIEW_CHILD, ...buildSusuChildren(susuNav)];
}

/** Always shown under Settings when the tenant has any subscribed product */
const SETTINGS_CHILDREN: NavChildDef[] = [
  { to: "settings/profile", label: "Company Profile", roleCheck: (r) => r === "admin" },
  { to: "settings/branches", label: "Branches", roleCheck: (r) => r === "admin", anyPermissions: ["branches.read"] },
  {
    to: "settings/account-numbers",
    label: "Account numbers",
    roleCheck: (r) => r === "admin"
  },
  { to: "settings/subscription", label: "Product Subscription", roleCheck: (r) => r === "admin" },
  {
    to: "settings/users",
    label: "Users",
    roleCheck: (r) => r === "admin",
    anyPermissions: ["users.read"]
  },
  {
    to: "settings/roles",
    label: "Roles & Permissions",
    roleCheck: (r) => r === "admin",
    anyPermissions: ["roles.read"]
  },
  { to: "settings/approval-workflows", label: "Approval Workflows", roleCheck: (r) => r === "admin" },
  { to: "settings/notifications", label: "Notification Settings", roleCheck: (r) => r === "admin" },
  {
    to: "settings/audit-logs",
    label: "Audit Logs",
    roleCheck: (r) => r === "admin" || r === "auditor",
    anyPermissions: ["audit.read"]
  }
];

const STAFF_NAV_ROLE_CHECK = () => true;

function filterBankingNavChildLink(
  row: { navPath: string; label: string; roles: AppRole[]; anyPermissions: Permission[] },
  role: AppRole | string,
  permissions: Permission[] | undefined
): DashboardNavChildLink | null {
  if (isBuiltinRole(role) && !row.roles.includes(role as AppRole)) {
    return null;
  }
  if (!hasAnyPermission(permissions, row.anyPermissions)) {
    return null;
  }
  return { kind: "link", to: row.navPath, label: row.label };
}

function filterBankingNavChildren(
  role: AppRole | string,
  permissions: Permission[] | undefined
): DashboardNavChild[] {
  const items: DashboardNavChild[] = [];
  for (const row of BANKING_NAV_VISIBILITY) {
    const link = filterBankingNavChildLink(row, role, permissions);
    if (link) {
      items.push(link);
    }
  }
  for (const subgroup of BANKING_NAV_SUBGROUPS) {
    const children = subgroup.children
      .map((row) => filterBankingNavChildLink(row, role, permissions))
      .filter((row): row is DashboardNavChildLink => row != null);
    if (children.length > 0) {
      items.push({
        kind: "subgroup",
        id: subgroup.id,
        label: subgroup.label,
        children: children.map(({ to, label }) => ({ to, label }))
      });
    }
  }
  return items;
}

const LOANS_NAV_CHILDREN: NavChildDef[] = LOANS_NAV_VISIBILITY.map((row) => ({
  to: row.navPath,
  label: row.label,
  roleCheck: STAFF_NAV_ROLE_CHECK,
  anyPermissions: [...row.anyPermissions]
}));

function buildLoansChildren(): NavChildDef[] {
  return LOANS_NAV_CHILDREN;
}

const TREASURY_CHILDREN: NavChildDef[] = TREASURY_NAV_VISIBILITY.map((row) => ({
  to: row.navPath,
  label: row.label,
  roleCheck: STAFF_NAV_ROLE_CHECK,
  anyPermissions: [...row.anyPermissions]
}));

function buildGroup(
  id: string,
  label: string,
  children: NavChildDef[],
  role: AppRole | string,
  permissions: Permission[] | undefined,
  modules: TenantProductModule[] | undefined,
  requiredModule?: TenantProductModule
): DashboardNavGroup | null {
  if (requiredModule && !hasTenantModule(modules, requiredModule)) {
    return null;
  }
  const filtered = filterChildren(children, role, permissions);
  if (filtered.length === 0) {
    return null;
  }
  return {
    kind: "group",
    id,
    label,
    children: filtered.map((child) => ({ kind: "link" as const, ...child }))
  };
}

function hasAnyProduct(modules: TenantProductModule[] | undefined): boolean {
  return (modules?.length ?? 0) > 0;
}

export function buildTenantNav(
  role: AppRole | string,
  subscribedModules: TenantProductModule[] | undefined,
  _subscribedAddons: TenantAddon[] | undefined,
  reportsAnalytics: boolean | undefined,
  permissions?: Permission[],
  susuNavVisibility?: SusuNavVisibilityRow[]
): DashboardNavItem[] {
  const items: DashboardNavItem[] = [{ kind: "link", to: "dashboard", label: "Dashboard" }];

  if (hasAnyProduct(subscribedModules)) {
    items.push({
      kind: "group",
      id: "universal_operations",
      label: UNIVERSAL_OPS_LABEL,
      flatChildren: true,
      children: UNIVERSAL_OPS_NAV.map((row) => ({
        kind: "link" as const,
        to: row.navPath,
        label: row.label
      }))
    });
  }

  const susu = buildGroup(
    "susu_management",
    MODULE_LABELS.susu_management,
    buildSusuNavChildren(susuNavVisibility),
    role,
    permissions,
    subscribedModules,
    "susu_management"
  );
  if (susu) {
    items.push(susu);
  }

  const banking = (() => {
    if (!hasTenantModule(subscribedModules, "banking")) {
      return null;
    }
    const children = filterBankingNavChildren(role, permissions);
    if (children.length === 0) {
      return null;
    }
    return {
      kind: "group" as const,
      id: "banking",
      label: MODULE_LABELS.banking,
      children
    };
  })();
  if (banking) {
    items.push(banking);
  }

  const loans = buildGroup(
    "loans_credit",
    MODULE_LABELS.loans_credit,
    buildLoansChildren(),
    role,
    permissions,
    subscribedModules,
    "loans_credit"
  );
  if (loans) {
    items.push(loans);
  }

  const treasury = buildGroup(
    "treasury",
    MODULE_LABELS.treasury,
    TREASURY_CHILDREN,
    role,
    permissions,
    subscribedModules,
    "treasury"
  );
  if (treasury) {
    items.push(treasury);
  }

  if (reportsAnalytics !== false && hasAnyProduct(subscribedModules)) {
    const canReports = hasAnyPermission(permissions, ["reports.read"]);
    if (canReports) {
      items.push({ kind: "link", to: "reports", label: "Reports & Analytics" });
    }
  }

  if (hasAnyProduct(subscribedModules)) {
    const settingsChildren = filterChildren(SETTINGS_CHILDREN, role, permissions);
    if (settingsChildren.length > 0) {
      items.push({
        kind: "group",
        id: "settings",
        label: "Settings",
        children: settingsChildren.map((child) => ({ kind: "link" as const, ...child }))
      });
    }
  }

  return items;
}

export function routeRequiresModule(path: string): TenantProductModule | undefined {
  if (path.includes("/susu/")) {
    return "susu_management";
  }
  if (path.includes("/banking")) {
    return "banking";
  }
  if (path.includes("/loans")) {
    return "loans_credit";
  }
  if (path.includes("/treasury")) {
    return "treasury";
  }
  return undefined;
}
