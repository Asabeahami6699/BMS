import type { Permission, SusuNavVisibilityRow, TenantAddon, TenantProductModule } from "@bms/shared";
import { hasAnyPermission, hasTenantModule, MODULE_LABELS, SUSU_NAV_VISIBILITY } from "@bms/shared";
import type { AppRole } from "../app/api";

export type DashboardNavLink = {
  kind: "link";
  to: string;
  label: string;
};

export type DashboardNavGroup = {
  kind: "group";
  id: string;
  label: string;
  children: Array<{ to: string; label: string }>;
};

export type DashboardNavItem = DashboardNavLink | DashboardNavGroup;

type NavChildDef = {
  to: string;
  label: string;
  roleCheck: (role: AppRole) => boolean;
  anyPermissions?: Permission[];
};

function filterChildren(
  children: NavChildDef[],
  role: AppRole,
  permissions: Permission[] | undefined
): Array<{ to: string; label: string }> {
  return children
    .filter((child) => {
      if (!child.roleCheck(role)) {
        return false;
      }
      if (child.anyPermissions?.length) {
        return hasAnyPermission(permissions, child.anyPermissions);
      }
      return true;
    })
    .map(({ to, label }) => ({ to, label }));
}

function buildSusuChildren(susuNav?: SusuNavVisibilityRow[]): NavChildDef[] {
  const rows = susuNav?.length ? susuNav : SUSU_NAV_VISIBILITY;
  return rows.map((row) => ({
    to: row.navPath,
    label: row.label,
    roleCheck: (r) => row.roles.includes(r as AppRole),
    anyPermissions: row.anyPermissions
  }));
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

const BANKING_CHILDREN: NavChildDef[] = [
  { to: "banking", label: "Department overview", roleCheck: (r) => r === "admin" || r === "accountant" }
];

const LOANS_CHILDREN: NavChildDef[] = [
  { to: "loans", label: "Department overview", roleCheck: (r) => r === "admin" || r === "accountant" }
];

const TREASURY_CHILDREN: NavChildDef[] = [
  { to: "treasury", label: "Department overview", roleCheck: (r) => r === "admin" || r === "accountant" }
];

function buildGroup(
  id: string,
  label: string,
  children: NavChildDef[],
  role: AppRole,
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
  return { kind: "group", id, label, children: filtered };
}

function hasAnyProduct(modules: TenantProductModule[] | undefined): boolean {
  return (modules?.length ?? 0) > 0;
}

export function buildTenantNav(
  role: AppRole,
  subscribedModules: TenantProductModule[] | undefined,
  _subscribedAddons: TenantAddon[] | undefined,
  reportsAnalytics: boolean | undefined,
  permissions?: Permission[],
  susuNavVisibility?: SusuNavVisibilityRow[]
): DashboardNavItem[] {
  const items: DashboardNavItem[] = [{ kind: "link", to: "overview", label: "Overview" }];

  const susu = buildGroup(
    "susu_management",
    MODULE_LABELS.susu_management,
    buildSusuChildren(susuNavVisibility),
    role,
    permissions,
    subscribedModules,
    "susu_management"
  );
  if (susu) {
    items.push(susu);
  }

  const banking = buildGroup(
    "banking",
    MODULE_LABELS.banking,
    BANKING_CHILDREN,
    role,
    permissions,
    subscribedModules,
    "banking"
  );
  if (banking) {
    items.push(banking);
  }

  const loans = buildGroup(
    "loans_credit",
    MODULE_LABELS.loans_credit,
    LOANS_CHILDREN,
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
      items.push({ kind: "group", id: "settings", label: "Settings", children: settingsChildren });
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
