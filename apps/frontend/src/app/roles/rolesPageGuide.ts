import type { TenantProductModule } from "@bms/shared";
import { MODULE_LABELS } from "@bms/shared";

export type RolesPageTab = "overview" | "job-titles" | "sidebar" | "custom-roles";

export const ROLES_PAGE_TABS: Array<{ id: RolesPageTab; label: string; short: string }> = [
  { id: "overview", label: "User guide", short: "Guide" },
  { id: "job-titles", label: "Job titles", short: "Titles" },
  { id: "sidebar", label: "Sidebar access", short: "Menus" },
  { id: "custom-roles", label: "Custom roles", short: "Custom" }
];

export const ROLES_PAGE_GUIDE_STEPS = [
  {
    title: "Pick each staff member's job title",
    body: "Under Settings → Users, set admin, coordinator, teller, Customer Service, Back Officer, and so on. The job title is the primary access key for API routes."
  },
  {
    title: "Tune permissions per job title",
    body: "On the Job titles tab, open Edit permissions for a title. Grant only the duties that title needs across your subscribed products (Susu, Loans, Agency Banking, Treasury)."
  },
  {
    title: "Control who sees each menu item",
    body: "On the Sidebar access tab, review every department menu. Susu rules are editable per tenant; other products show platform defaults (job title + permission gates)."
  },
  {
    title: "Optional: named custom roles",
    body: "Create a custom role when you need an extra duty bundle (e.g. Susu cash supervisor). Scope it to one product so Agency Banking duties never appear by mistake."
  },
  {
    title: "Staff must refresh after changes",
    body: "Saved permission and sidebar changes apply when users refresh the browser or sign in again. Tell staff to reload if menus look stale."
  }
] as const;

export const ROLES_SECTION_HELP = {
  overview:
    "Start here when onboarding a new tenant. Follow the steps in order: users → job title permissions → sidebar menus → optional custom roles.",
  jobTitles:
    "System job titles (admin, teller, etc.) can be customized per company. You can also create your own company job titles with a unique key, display name, and permissions — assign them as a user's primary title when adding staff.",
  sidebar:
    "Each sidebar item requires a job title (where applicable) and at least one permission. Susu menus can be customized and saved; other departments show reference rules from the platform catalog.",
  customRoles:
    "Custom roles add extra permissions on top of a user's job title. Choose a product scope so a Susu-only supervisor never receives Agency Banking checkboxes."
} as const;

export const ROLES_FIELD_HELP = {
  productScope:
    "Restricts which duty checkboxes appear below. Pick one department (e.g. Susu Management) so unrelated products like Agency Banking never show. Choose “All subscribed products” only for cross-department bundles.",
  roleKey:
    "Unique slug stored in your company, lowercase with underscores, e.g. susu_cash_supervisor. You will use this exact key when assigning the role to a user.",
  displayName:
    "Human-readable name for admins, e.g. Susu cash supervisor. Shown in role lists; does not affect login or API access by itself.",
  assignUserId:
    "Choose the staff member to receive the custom role. They keep their system job title (admin, teller, etc.); this adds extra duties on top.",
  assignRoleKey:
    "Pick a custom tenant role you created on this page. Custom roles are listed separately from system job titles like admin or teller.",
  dutySelection:
    "Each duty grants API and UI access. Required dependencies (e.g. users.update needs users.read) are validated when you save. Hover i on any duty for what it does.",
  dutyCheckAll:
    "Quickly select or clear all duties visible for the current editor. On custom roles, the list respects the product scope you chose above.",
  sidebarMenuItem:
    "Controls visibility of this sidebar link. Both job title and permission rules must pass for the user to see the item.",
  sidebarJobTitles:
    "Built-in job titles that may see this menu item. Uncheck a title to hide the link from coordinators, tellers, etc., even if they hold the permissions.",
  sidebarPermissions:
    "The user must hold at least one of these permissions. Tighten this list to hide a menu from staff who have the job title but should not open that screen.",
  sidebarJobTitleChip:
    "When checked, users with this job title can see the menu item if they also satisfy the permission rule below.",
  sidebarPermissionChip:
    "Grants menu visibility when combined with an allowed job title. Uses the same permission keys as the Job titles tab."
} as const;

export function sidebarModuleLabel(module: TenantProductModule | "settings"): string {
  if (module === "settings") {
    return "Settings & admin";
  }
  return MODULE_LABELS[module];
}
