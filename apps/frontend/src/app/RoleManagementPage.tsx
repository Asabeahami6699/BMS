import { useEffect, useMemo, useState } from "react";
import type {
  CustomRoleProductScope,
  Permission,
  PermissionCatalogEntry,
  PermissionGroupId,
  PermissionProductSection,
  Role
} from "@bms/shared";
import {
  BUILTIN_ROLE_LABELS,
  MODULE_LABELS,
  PERMISSION_GROUP_LABELS,
  TENANT_EDITABLE_BUILTIN_ROLES,
  TENANT_PRODUCT_MODULES,
  catalogEntriesForCustomRoleScope,
  catalogEntriesForTenant,
  customRoleProductScopeLabel,
  hasTenantModule,
  permissionProductSectionsForCustomRoleScope,
  permissionProductSectionsForTenant,
  validateCustomRoleDuties,
  validateDutySelection,
  validateSusuNavVisibilityItems
} from "@bms/shared";
import type { AppRole, Branch, BuiltinRolePermissionView, SusuNavVisibilityConfigItem, UserRecord } from "./api";
import {
  assignRole,
  createRole,
  createTenantJobTitle,
  deleteTenantJobTitle,
  getBuiltinRolePermissions,
  getRoleAssignments,
  getRoles,
  getSusuNavVisibilityConfig,
  getTenantId,
  listBranches,
  listUsers,
  resetBuiltinRolePermissions,
  resetSusuNavVisibilityConfig,
  saveBuiltinRolePermissions,
  saveSusuNavVisibilityConfig,
  updateTenantJobTitle
} from "./api";
import { UserFormModal } from "./UserFormModal";
import { subscribeToTenantRealtime } from "./realtime";
import { useToast } from "../components/Toast";
import { toUserFacingError } from "../lib/networkError";
import { useAuth } from "../auth/AuthContext";
import { RolesSectionHeader } from "./roles/RolesSectionHeader";
import { SidebarAccessSection } from "./roles/SidebarAccessSection";
import { RolesFormField, RolesInlineLabel, FieldHelpTip } from "./roles/RolesFormField";
import {
  ROLES_PAGE_GUIDE_STEPS,
  ROLES_PAGE_TABS,
  ROLES_FIELD_HELP,
  ROLES_SECTION_HELP,
  type RolesPageTab
} from "./roles/rolesPageGuide";

type Props = {
  role: AppRole;
};

function toastValidation(
  showToast: (message: string, variant?: "success" | "error" | "info") => void,
  result: { errors: string[]; warnings: string[] }
): boolean {
  if (result.errors.length > 0) {
    for (const msg of result.errors) {
      showToast(msg, "error");
    }
    return false;
  }
  for (const msg of result.warnings) {
    showToast(msg, "info");
  }
  return true;
}

export function RoleManagementPage({ role }: Props) {
  const { showToast } = useToast();
  const { user } = useAuth();
  const subscribedModules = user?.subscribedModules;
  const canManageRoles = role === "admin";
  const [activeTab, setActiveTab] = useState<RolesPageTab>("overview");
  const [roleKey, setRoleKey] = useState("susu_cash_supervisor");
  const [displayName, setDisplayName] = useState("Susu cash supervisor");
  const [duties, setDuties] = useState<Permission[]>(["customers.read", "transactions.read"]);
  const [assignUserId, setAssignUserId] = useState("");
  const [assignRoleKey, setAssignRoleKey] = useState("");
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [userModalOpen, setUserModalOpen] = useState(false);
  const [roles, setRoles] = useState<
    Array<{
      roleKey: string;
      displayName: string;
      roleKind?: "job_title" | "extra_duties";
      productScope?: CustomRoleProductScope;
      duties: string[];
    }>
  >([]);
  const [assignments, setAssignments] = useState<Array<{ userId: string; roleKey: string }>>([]);
  const [builtinViews, setBuiltinViews] = useState<BuiltinRolePermissionView[]>([]);
  const [editingBuiltin, setEditingBuiltin] = useState<Role | null>(null);
  const [builtinDraft, setBuiltinDraft] = useState<Permission[]>([]);
  const [builtinSaving, setBuiltinSaving] = useState(false);
  const [jobTitleKey, setJobTitleKey] = useState("branch_supervisor");
  const [jobTitleName, setJobTitleName] = useState("Branch supervisor");
  const [jobTitleScope, setJobTitleScope] = useState<CustomRoleProductScope>("susu_management");
  const [jobTitleDuties, setJobTitleDuties] = useState<Permission[]>(["customers.read", "transactions.read"]);
  const [editingTenantJobTitle, setEditingTenantJobTitle] = useState<string | null>(null);
  const [tenantJobTitleDraft, setTenantJobTitleDraft] = useState<Permission[]>([]);
  const [tenantJobTitleSaving, setTenantJobTitleSaving] = useState(false);
  const [navItems, setNavItems] = useState<SusuNavVisibilityConfigItem[]>([]);
  const [navSaving, setNavSaving] = useState(false);
  const [customRoleScope, setCustomRoleScope] = useState<CustomRoleProductScope>("susu_management");
  const [expandedNavPath, setExpandedNavPath] = useState<string | null>(null);

  const tenantCatalog = useMemo(
    () => catalogEntriesForTenant(subscribedModules),
    [subscribedModules]
  );

  const productSections = useMemo(
    () => permissionProductSectionsForTenant(subscribedModules),
    [subscribedModules]
  );

  const customRoleCatalog = useMemo(
    () => catalogEntriesForCustomRoleScope(subscribedModules, customRoleScope),
    [subscribedModules, customRoleScope]
  );

  const customRoleSections = useMemo(
    () => permissionProductSectionsForCustomRoleScope(subscribedModules, customRoleScope),
    [subscribedModules, customRoleScope]
  );

  const customRoleScopeOptions = useMemo(() => {
    const options: Array<{ value: CustomRoleProductScope; label: string }> = [
      { value: "all", label: customRoleProductScopeLabel("all") }
    ];
    for (const module of TENANT_PRODUCT_MODULES) {
      if (hasTenantModule(subscribedModules, module)) {
        options.push({ value: module, label: MODULE_LABELS[module] });
      }
    }
    return options;
  }, [subscribedModules]);

  const extraDutyRoles = useMemo(
    () => roles.filter((role) => (role.roleKind ?? "extra_duties") === "extra_duties"),
    [roles]
  );

  const tenantJobTitleRoles = useMemo(
    () => roles.filter((role) => role.roleKind === "job_title"),
    [roles]
  );

  const jobTitleCatalog = useMemo(
    () => catalogEntriesForCustomRoleScope(subscribedModules, jobTitleScope),
    [subscribedModules, jobTitleScope]
  );

  const jobTitleSections = useMemo(
    () => permissionProductSectionsForCustomRoleScope(subscribedModules, jobTitleScope),
    [subscribedModules, jobTitleScope]
  );

  const jobTitleCatalogByGroup = useMemo(
    () => catalogByGroupFrom(jobTitleCatalog),
    [jobTitleCatalog]
  );

  const allJobTitlePermissions = useMemo(
    () => jobTitleCatalog.map((entry) => entry.id),
    [jobTitleCatalog]
  );

  const jobTitleValidation = useMemo(
    () => validateCustomRoleDuties(jobTitleDuties, jobTitleScope, subscribedModules),
    [jobTitleDuties, jobTitleScope, subscribedModules]
  );

  const tenantJobTitleValidation = useMemo(
    () => validateDutySelection(tenantJobTitleDraft),
    [tenantJobTitleDraft]
  );

  const navPermissionOptions = useMemo(() => tenantCatalog.map((e) => e.id), [tenantCatalog]);

  const validation = useMemo(
    () => validateCustomRoleDuties(duties, customRoleScope, subscribedModules),
    [duties, customRoleScope, subscribedModules]
  );
  const builtinValidation = useMemo(() => validateDutySelection(builtinDraft), [builtinDraft]);

  useEffect(() => {
    const allowed = new Set(customRoleCatalog.map((entry) => entry.id));
    setDuties((prev) => prev.filter((duty) => allowed.has(duty as Permission)));
  }, [customRoleCatalog]);

  useEffect(() => {
    const allowed = new Set(jobTitleCatalog.map((entry) => entry.id));
    setJobTitleDuties((prev) => prev.filter((duty) => allowed.has(duty as Permission)));
    setTenantJobTitleDraft((prev) => prev.filter((duty) => allowed.has(duty as Permission)));
  }, [jobTitleCatalog]);

  function catalogByGroupFrom(
    catalog: PermissionCatalogEntry[]
  ): Map<PermissionGroupId, PermissionCatalogEntry[]> {
    const map = new Map<PermissionGroupId, PermissionCatalogEntry[]>();
    for (const entry of catalog) {
      const list = map.get(entry.group) ?? [];
      list.push(entry);
      map.set(entry.group, list);
    }
    return map;
  }

  const tenantCatalogByGroup = useMemo(() => catalogByGroupFrom(tenantCatalog), [tenantCatalog]);
  const customRoleCatalogByGroup = useMemo(
    () => catalogByGroupFrom(customRoleCatalog),
    [customRoleCatalog]
  );

  const allCustomRolePermissions = useMemo(
    () => customRoleCatalog.map((entry) => entry.id),
    [customRoleCatalog]
  );

  const allCatalogPermissions = useMemo(() => tenantCatalog.map((entry) => entry.id), [tenantCatalog]);

  const subscribedProductLabels = useMemo(
    () =>
      TENANT_PRODUCT_MODULES.filter((m) => hasTenantModule(subscribedModules, m)).map((m) => MODULE_LABELS[m]),
    [subscribedModules]
  );

  function renderPermissionGroups(
    selected: Permission[],
    onToggle: (duty: Permission) => void,
    sections: PermissionProductSection[],
    catalogByGroup: Map<PermissionGroupId, PermissionCatalogEntry[]>,
    disabled?: boolean
  ) {
    return sections.map((section) => (
      <div key={section.scope} className="roles-page__product-section">
        <h4 className="roles-page__product-heading">{section.label}</h4>
        <div className="roles-page__duty-groups">
          {section.groupIds.map((groupId) => {
            const entries = catalogByGroup.get(groupId);
            if (!entries?.length) {
              return null;
            }
            return (
              <div key={groupId} className="roles-page__duty-group">
                <h5 className="roles-page__duty-group-title">
                  {PERMISSION_GROUP_LABELS[groupId]}
                  <FieldHelpTip label={`${PERMISSION_GROUP_LABELS[groupId]} duties`}>
                    Permissions in the {PERMISSION_GROUP_LABELS[groupId].toLowerCase()} group. Grant
                    only what this role needs; the editor warns if required companion duties are missing.
                  </FieldHelpTip>
                </h5>
                <div className="duty-grid">
                  {entries.map((entry) => (
                    <label key={entry.id} className="duty-item roles-page__duty-item">
                      <input
                        type="checkbox"
                        checked={selected.includes(entry.id)}
                        disabled={disabled}
                        onChange={() => onToggle(entry.id)}
                      />
                      <span>
                        <strong className="roles-page__duty-item-label">
                          {entry.label}
                          <FieldHelpTip label={entry.label}>{entry.description}</FieldHelpTip>
                        </strong>
                        <small>{entry.id}</small>
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    ));
  }

  async function loadRoles() {
    try {
      const [data, assignmentData, builtin, nav, userRows, branchRows] = await Promise.all([
        getRoles(),
        getRoleAssignments(),
        getBuiltinRolePermissions(),
        getSusuNavVisibilityConfig(),
        listUsers().catch(() => []),
        listBranches().catch(() => [])
      ]);
      setRoles(data);
      setAssignments(assignmentData);
      setBuiltinViews(builtin);
      setNavItems(nav);
      setUsers(userRows);
      setBranches(branchRows);
      const extraRoles = data.filter((role) => (role.roleKind ?? "extra_duties") === "extra_duties");
      if (!assignRoleKey && extraRoles[0]?.roleKey) {
        setAssignRoleKey(extraRoles[0].roleKey);
      }
    } catch (error) {
      showToast(toUserFacingError(error, "Failed to load roles"), "error");
    }
  }

  function openBuiltinEditor(builtinRole: Role) {
    const view = builtinViews.find((v) => v.role === builtinRole);
    setEditingBuiltin(builtinRole);
    setBuiltinDraft(view?.effectiveDuties ?? []);
  }

  function toggleBuiltinDuty(duty: Permission) {
    setBuiltinDraft((prev) =>
      prev.includes(duty) ? prev.filter((item) => item !== duty) : [...prev, duty]
    );
  }

  async function handleSaveBuiltin() {
    if (!editingBuiltin) {
      showToast("Select a job title to edit first.", "error");
      return;
    }
    if (!toastValidation(showToast, builtinValidation)) {
      return;
    }
    setBuiltinSaving(true);
    try {
      const updated = await saveBuiltinRolePermissions(editingBuiltin, builtinDraft);
      const refreshed = await getBuiltinRolePermissions();
      setBuiltinViews(refreshed);
      const confirmed = refreshed.find((v) => v.role === editingBuiltin) ?? updated;
      setBuiltinDraft(confirmed.effectiveDuties);
      showToast(
        `Saved ${confirmed.effectiveDuties.length} permissions for ${BUILTIN_ROLE_LABELS[editingBuiltin]}. Staff should refresh or sign in again.`,
        "success"
      );
    } catch (error) {
      showToast(toUserFacingError(error, "Failed to save permissions"), "error");
    } finally {
      setBuiltinSaving(false);
    }
  }

  async function handleResetBuiltin(builtinRole: Role) {
    if (!window.confirm(`Reset ${BUILTIN_ROLE_LABELS[builtinRole]} to platform defaults?`)) {
      return;
    }
    setBuiltinSaving(true);
    try {
      const updated = await resetBuiltinRolePermissions(builtinRole);
      setBuiltinViews((prev) => prev.map((v) => (v.role === updated.role ? updated : v)));
      if (editingBuiltin === builtinRole) {
        setBuiltinDraft(updated.effectiveDuties);
      }
      showToast(`Reset ${BUILTIN_ROLE_LABELS[builtinRole]} to platform defaults.`, "success");
    } catch (error) {
      showToast(toUserFacingError(error, "Failed to reset role"), "error");
    } finally {
      setBuiltinSaving(false);
    }
  }

  function openTenantJobTitleEditor(roleKey: string) {
    const match = tenantJobTitleRoles.find((role) => role.roleKey === roleKey);
    setEditingTenantJobTitle(roleKey);
    setTenantJobTitleDraft((match?.duties ?? []) as Permission[]);
  }

  function toggleTenantJobTitleDuty(duty: Permission) {
    setTenantJobTitleDraft((prev) =>
      prev.includes(duty) ? prev.filter((item) => item !== duty) : [...prev, duty]
    );
  }

  function toggleJobTitleDuty(duty: Permission) {
    setJobTitleDuties((prev) =>
      prev.includes(duty) ? prev.filter((item) => item !== duty) : [...prev, duty]
    );
  }

  async function handleCreateJobTitle() {
    if (!toastValidation(showToast, jobTitleValidation)) {
      return;
    }
    try {
      await createTenantJobTitle({
        roleKey: jobTitleKey.trim(),
        displayName: jobTitleName.trim(),
        productScope: jobTitleScope,
        duties: jobTitleDuties
      });
      showToast(`Job title "${jobTitleName}" created.`, "success");
      await loadRoles();
    } catch (error) {
      showToast(toUserFacingError(error, "Failed to create job title"), "error");
    }
  }

  async function handleSaveTenantJobTitle() {
    if (!editingTenantJobTitle) {
      showToast("Select a company job title to edit first.", "error");
      return;
    }
    if (!toastValidation(showToast, tenantJobTitleValidation)) {
      return;
    }
    setTenantJobTitleSaving(true);
    try {
      const match = tenantJobTitleRoles.find((role) => role.roleKey === editingTenantJobTitle);
      await updateTenantJobTitle(editingTenantJobTitle, {
        displayName: match?.displayName,
        productScope: match?.productScope,
        duties: tenantJobTitleDraft
      });
      showToast("Saved company job title permissions. Staff should refresh or sign in again.", "success");
      await loadRoles();
    } catch (error) {
      showToast(toUserFacingError(error, "Failed to save job title"), "error");
    } finally {
      setTenantJobTitleSaving(false);
    }
  }

  async function handleDeleteTenantJobTitle(roleKey: string, displayName: string) {
    if (!window.confirm(`Delete job title "${displayName}"? Users must be reassigned first.`)) {
      return;
    }
    try {
      await deleteTenantJobTitle(roleKey);
      if (editingTenantJobTitle === roleKey) {
        setEditingTenantJobTitle(null);
      }
      showToast(`Deleted job title "${displayName}".`, "success");
      await loadRoles();
    } catch (error) {
      showToast(toUserFacingError(error, "Failed to delete job title"), "error");
    }
  }

  function tenantJobTitleLabel(roleKey: string): string {
    const match = tenantJobTitleRoles.find((role) => role.roleKey === roleKey);
    return match?.displayName ?? roleKey;
  }

  useEffect(() => {
    void loadRoles();
    const unsubscribe = subscribeToTenantRealtime({
      tenantId: getTenantId(),
      tables: [
        "tenant_roles",
        "user_role_assignments",
        "tenant_builtin_role_overrides",
        "tenant_susu_nav_overrides"
      ],
      onChange: () => {
        void loadRoles();
      }
    });
    return () => unsubscribe();
  }, [role]);

  function toggleDuty(duty: Permission) {
    setDuties((prev) => (prev.includes(duty) ? prev.filter((item) => item !== duty) : [...prev, duty]));
  }

  function renderDutyCheckAllToolbar(
    selected: Permission[],
    onChange: (next: Permission[]) => void,
    allPermissions: Permission[],
    disabled?: boolean
  ) {
    return (
      <div className="roles-page__check-all">
        <RolesInlineLabel label="Duty selection" help={ROLES_FIELD_HELP.dutyCheckAll} />
        <div className="roles-page__check-all-actions">
          <button
            type="button"
            className="button-link"
            disabled={disabled}
            onClick={() => onChange([...allPermissions])}
          >
            Check all
          </button>
          <span className="muted" aria-hidden>
            ·
          </span>
          <button
            type="button"
            className="button-link"
            disabled={disabled}
            onClick={() => onChange([])}
          >
            Uncheck all
          </button>
          <span className="muted roles-page__check-count">
            {selected.length} / {allPermissions.length} selected
          </span>
        </div>
      </div>
    );
  }

  async function handleCreateRole() {
    if (!toastValidation(showToast, validation)) {
      return;
    }
    try {
      await createRole({
        roleKey,
        displayName,
        roleKind: "extra_duties",
        productScope: customRoleScope,
        duties
      });
      showToast(`Custom role "${displayName}" created.`, "success");
      await loadRoles();
    } catch (error) {
      showToast(toUserFacingError(error, "Failed to create role"), "error");
    }
  }

  function updateNavItem(
    navPath: string,
    patch: Partial<Pick<SusuNavVisibilityConfigItem, "roles" | "anyPermissions">>
  ) {
    setNavItems((prev) =>
      prev.map((item) => (item.navPath === navPath ? { ...item, ...patch } : item))
    );
  }

  function toggleNavRole(navPath: string, jobRole: Role) {
    const item = navItems.find((i) => i.navPath === navPath);
    if (!item) {
      return;
    }
    const nextRoles = item.roles.includes(jobRole)
      ? item.roles.filter((r) => r !== jobRole)
      : [...item.roles, jobRole];
    updateNavItem(navPath, { roles: nextRoles });
  }

  function toggleNavPermission(navPath: string, permission: Permission) {
    const item = navItems.find((i) => i.navPath === navPath);
    if (!item) {
      return;
    }
    const anyPermissions = item.anyPermissions.includes(permission)
      ? item.anyPermissions.filter((p) => p !== permission)
      : [...item.anyPermissions, permission];
    updateNavItem(navPath, { anyPermissions });
  }

  async function handleSaveNav() {
    const payload = navItems.map((item) => ({
      navPath: item.navPath,
      roles: item.roles,
      anyPermissions: item.anyPermissions
    }));
    const { errors } = validateSusuNavVisibilityItems(payload);
    if (errors.length > 0) {
      for (const msg of errors) {
        showToast(msg, "error");
      }
      return;
    }

    setNavSaving(true);
    try {
      const saved = await saveSusuNavVisibilityConfig(payload);
      setNavItems(saved);
      showToast(
        "Susu sidebar access saved. Refresh the page (or sign in again) to update menus for active sessions.",
        "success"
      );
    } catch (error) {
      showToast(toUserFacingError(error, "Failed to save sidebar access"), "error");
    } finally {
      setNavSaving(false);
    }
  }

  async function handleResetNav() {
    if (!window.confirm("Reset all Susu sidebar rules to platform defaults?")) {
      return;
    }
    setNavSaving(true);
    try {
      setNavItems(await resetSusuNavVisibilityConfig());
      showToast("Susu sidebar reset to defaults. Refresh the page to update menus.", "success");
    } catch (error) {
      showToast(toUserFacingError(error, "Failed to reset sidebar access"), "error");
    } finally {
      setNavSaving(false);
    }
  }

  async function handleAssignRole() {
    if (!assignUserId.trim() || !assignRoleKey.trim()) {
      showToast("Select a user and custom role.", "error");
      return;
    }
    try {
      await assignRole({ userId: assignUserId.trim(), roleKey: assignRoleKey.trim() });
      await loadRoles();
      showToast("Custom role assigned.", "success");
    } catch (error) {
      showToast(toUserFacingError(error, "Failed to assign role"), "error");
    }
  }

  function userLabel(userId: string): string {
    const match = users.find((u) => u.userId === userId);
    if (!match) {
      return userId;
    }
    return match.fullName ? `${match.fullName} (${match.email})` : match.email;
  }

  function customRoleLabel(roleKey: string): string {
    const match = extraDutyRoles.find((r) => r.roleKey === roleKey);
    return match ? match.displayName : roleKey;
  }

  return (
    <div className="roles-page">
      <header className="roles-page__hero card roles-animate-in">
        <div className="roles-page__hero-text">
          <p className="roles-page__eyebrow">Settings · Access control</p>
          <h2>Roles &amp; permissions</h2>
          <p className="muted">
            Configure job titles, department menus, and optional custom duty bundles for{" "}
            {subscribedProductLabels.length > 0
              ? subscribedProductLabels.join(", ")
              : "your subscribed products"}
            .
          </p>
        </div>
        <nav className="roles-page__tabs" aria-label="Roles page sections">
          {ROLES_PAGE_TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={`roles-page__tab${activeTab === tab.id ? " is-active" : ""}`}
              onClick={() => setActiveTab(tab.id)}
            >
              <span className="roles-page__tab-label">{tab.label}</span>
              <span className="roles-page__tab-short">{tab.short}</span>
            </button>
          ))}
        </nav>
      </header>

      {activeTab === "overview" ? (
        <section className="card roles-page__section roles-animate-in roles-animate-in--2">
          <RolesSectionHeader
            title="User guide for new tenants"
            subtitle="Follow these steps in order. Hover the i icon on any tab for section-specific help."
            help={ROLES_SECTION_HELP.overview}
          />
          <ol className="roles-page__guide-steps">
            {ROLES_PAGE_GUIDE_STEPS.map((step, index) => (
              <li key={step.title} className="roles-page__guide-step roles-animate-in" style={{ animationDelay: `${index * 60}ms` }}>
                <span className="roles-page__guide-step-num">{index + 1}</span>
                <div>
                  <strong>{step.title}</strong>
                  <p className="muted">{step.body}</p>
                </div>
              </li>
            ))}
          </ol>
          <div className="roles-page__guide-cards">
            <button type="button" className="roles-page__guide-card" onClick={() => setActiveTab("job-titles")}>
              <strong>Job titles</strong>
              <span className="muted">Edit permissions for admin, teller, coordinator…</span>
            </button>
            <button type="button" className="roles-page__guide-card" onClick={() => setActiveTab("sidebar")}>
              <strong>Sidebar access</strong>
              <span className="muted">Susu, Loans, Agency Banking, Treasury menus</span>
            </button>
            <button type="button" className="roles-page__guide-card" onClick={() => setActiveTab("custom-roles")}>
              <strong>Custom roles</strong>
              <span className="muted">Product-scoped duty bundles</span>
            </button>
          </div>
        </section>
      ) : null}

      {activeTab === "job-titles" ? (
        <section className="card roles-page__section roles-animate-in">
          <RolesSectionHeader
            title="System & company job titles"
            subtitle="Customize platform titles or create your own. Changes apply after staff refresh or sign in again."
            help={ROLES_SECTION_HELP.jobTitles}
          />
          <h3 className="roles-page__subsection-title">System job titles</h3>
          <div className="roles-page__builtin-grid">
            {TENANT_EDITABLE_BUILTIN_ROLES.map((builtinRole, index) => {
              const view = builtinViews.find((v) => v.role === builtinRole);
              const effective = view?.effectiveDuties ?? [];
              const isEditing = editingBuiltin === builtinRole;
              return (
                <article
                  key={builtinRole}
                  className={`roles-page__builtin-card roles-animate-in${isEditing ? " is-editing" : ""}`}
                  style={{ animationDelay: `${index * 40}ms` }}
                >
                  <div className="roles-page__builtin-card-head">
                    <div>
                      <h4>{BUILTIN_ROLE_LABELS[builtinRole]}</h4>
                      <p className="muted">
                        <code>{builtinRole}</code> · {effective.length} active
                        {view?.isCustomized ? (
                          <span className="roles-page__custom-badge"> Customized</span>
                        ) : (
                          <span> · defaults</span>
                        )}
                      </p>
                    </div>
                    {canManageRoles ? (
                      <div className="roles-page__builtin-actions">
                        {!isEditing ? (
                          <button
                            type="button"
                            className="button secondary"
                            onClick={() => openBuiltinEditor(builtinRole)}
                          >
                            Edit permissions
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="button-link"
                            onClick={() => setEditingBuiltin(null)}
                          >
                            Close
                          </button>
                        )}
                        {view?.isCustomized ? (
                          <button
                            type="button"
                            className="button-link"
                            disabled={builtinSaving}
                            onClick={() => void handleResetBuiltin(builtinRole)}
                          >
                            Reset to defaults
                          </button>
                        ) : null}
                      </div>
                    ) : null}
                  </div>

                  {!isEditing ? (
                    <ul className="roles-page__perm-list">
                      {effective.map((p) => (
                        <li key={p}>
                          <code>{p}</code>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <div className="roles-page__builtin-editor">
                      {renderDutyCheckAllToolbar(
                        builtinDraft,
                        setBuiltinDraft,
                        allCatalogPermissions,
                        builtinSaving
                      )}
                      {renderPermissionGroups(
                        builtinDraft,
                        toggleBuiltinDuty,
                        productSections,
                        tenantCatalogByGroup,
                        builtinSaving
                      )}
                      <button
                        type="button"
                        className="button"
                        disabled={builtinSaving || !canManageRoles}
                        onClick={() => void handleSaveBuiltin()}
                      >
                        {builtinSaving ? "Saving…" : "Save permissions"}
                      </button>
                    </div>
                  )}
                </article>
              );
            })}
          </div>

          <RolesSectionHeader
            title="Your company job titles"
            subtitle="Create additional job titles with their own permissions. Assign them as a user's primary title when adding staff."
            help="Custom job titles work like system titles (admin, teller, etc.) but are defined by your company. They appear in the user form under Your company job titles."
          />

          {canManageRoles ? (
            <div className="roles-page__custom-form roles-page__job-title-create roles-animate-in roles-animate-in--2">
              <RolesFormField label="Product scope" help={ROLES_FIELD_HELP.productScope}>
                <select
                  value={jobTitleScope}
                  onChange={(e) => setJobTitleScope(e.target.value as CustomRoleProductScope)}
                >
                  {customRoleScopeOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </RolesFormField>

              <RolesFormField label="Job title key (unique slug)" help={ROLES_FIELD_HELP.roleKey}>
                <input
                  value={jobTitleKey}
                  onChange={(e) => setJobTitleKey(e.target.value)}
                  placeholder="e.g. branch_supervisor"
                />
              </RolesFormField>

              <RolesFormField label="Display name" help={ROLES_FIELD_HELP.displayName}>
                <input
                  value={jobTitleName}
                  onChange={(e) => setJobTitleName(e.target.value)}
                  placeholder="e.g. Branch supervisor"
                />
              </RolesFormField>

              {renderDutyCheckAllToolbar(
                jobTitleDuties,
                setJobTitleDuties,
                allJobTitlePermissions,
                tenantJobTitleSaving
              )}
              {renderPermissionGroups(
                jobTitleDuties,
                toggleJobTitleDuty,
                jobTitleSections,
                jobTitleCatalogByGroup,
                tenantJobTitleSaving
              )}

              <button type="button" className="button" onClick={() => void handleCreateJobTitle()}>
                Create company job title
              </button>
            </div>
          ) : null}

          <div className="roles-page__builtin-grid">
            {tenantJobTitleRoles.length === 0 ? (
              <p className="muted">No company job titles yet. Create one above to use alongside system titles.</p>
            ) : (
              tenantJobTitleRoles.map((jobTitle, index) => {
                const effective = (jobTitle.duties ?? []) as Permission[];
                const isEditing = editingTenantJobTitle === jobTitle.roleKey;
                return (
                  <article
                    key={jobTitle.roleKey}
                    className={`roles-page__builtin-card roles-animate-in${isEditing ? " is-editing" : ""}`}
                    style={{ animationDelay: `${index * 40}ms` }}
                  >
                    <div className="roles-page__builtin-card-head">
                      <div>
                        <h4>{jobTitle.displayName}</h4>
                        <p className="muted">
                          <code>{jobTitle.roleKey}</code> · {effective.length} active ·{" "}
                          {customRoleProductScopeLabel(jobTitle.productScope ?? "all")}
                          <span className="roles-page__custom-badge"> Company title</span>
                        </p>
                      </div>
                      {canManageRoles ? (
                        <div className="roles-page__builtin-actions">
                          {!isEditing ? (
                            <button
                              type="button"
                              className="button secondary"
                              onClick={() => openTenantJobTitleEditor(jobTitle.roleKey)}
                            >
                              Edit permissions
                            </button>
                          ) : (
                            <button
                              type="button"
                              className="button-link"
                              onClick={() => setEditingTenantJobTitle(null)}
                            >
                              Close
                            </button>
                          )}
                          <button
                            type="button"
                            className="button-link"
                            disabled={tenantJobTitleSaving}
                            onClick={() =>
                              void handleDeleteTenantJobTitle(jobTitle.roleKey, jobTitle.displayName)
                            }
                          >
                            Delete
                          </button>
                        </div>
                      ) : null}
                    </div>

                    {!isEditing ? (
                      <ul className="roles-page__perm-list">
                        {effective.map((p) => (
                          <li key={p}>
                            <code>{p}</code>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <div className="roles-page__builtin-editor">
                        {renderDutyCheckAllToolbar(
                          tenantJobTitleDraft,
                          setTenantJobTitleDraft,
                          allJobTitlePermissions,
                          tenantJobTitleSaving
                        )}
                        {renderPermissionGroups(
                          tenantJobTitleDraft,
                          toggleTenantJobTitleDuty,
                          jobTitleSections,
                          jobTitleCatalogByGroup,
                          tenantJobTitleSaving
                        )}
                        <button
                          type="button"
                          className="button"
                          disabled={tenantJobTitleSaving || !canManageRoles}
                          onClick={() => void handleSaveTenantJobTitle()}
                        >
                          {tenantJobTitleSaving ? "Saving…" : "Save permissions"}
                        </button>
                      </div>
                    )}
                  </article>
                );
              })
            )}
          </div>
        </section>
      ) : null}

      {activeTab === "sidebar" ? (
        <SidebarAccessSection
          subscribedModules={subscribedModules}
          canManageRoles={canManageRoles}
          navItems={navItems}
          navPermissionOptions={navPermissionOptions}
          navSaving={navSaving}
          expandedNavPath={expandedNavPath}
          onExpandedNavPathChange={setExpandedNavPath}
          onToggleNavRole={toggleNavRole}
          onToggleNavPermission={toggleNavPermission}
          onSaveNav={() => void handleSaveNav()}
          onResetNav={() => void handleResetNav()}
        />
      ) : null}

      {activeTab === "custom-roles" ? (
        <section className="card roles-page__section roles-animate-in">
          <RolesSectionHeader
            title="Custom tenant roles"
            subtitle="Named duty bundles stored per company. Scope to one product so unrelated menus never appear."
            help={ROLES_SECTION_HELP.customRoles}
          />

          <div className="roles-page__custom-grid">
            <div className="roles-page__custom-form roles-animate-in roles-animate-in--2">
              <RolesFormField
                label="Product scope"
                help={ROLES_FIELD_HELP.productScope}
                hint={
                  customRoleScope === "all"
                    ? "Duties may include any subscribed product plus core admin permissions."
                    : `Only core permissions and ${customRoleProductScopeLabel(customRoleScope)} duties are listed below.`
                }
              >
                <select
                  value={customRoleScope}
                  disabled={!canManageRoles}
                  onChange={(e) => setCustomRoleScope(e.target.value as CustomRoleProductScope)}
                >
                  {customRoleScopeOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </RolesFormField>

              <RolesFormField label="Role key (unique slug)" help={ROLES_FIELD_HELP.roleKey}>
                <input
                  value={roleKey}
                  disabled={!canManageRoles}
                  onChange={(e) => setRoleKey(e.target.value)}
                  placeholder="e.g. susu_cash_supervisor"
                />
              </RolesFormField>

              <RolesFormField label="Display name" help={ROLES_FIELD_HELP.displayName}>
                <input
                  value={displayName}
                  disabled={!canManageRoles}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="e.g. Susu cash supervisor"
                />
              </RolesFormField>

              <p className="roles-page__field-intro muted">
                <RolesInlineLabel label="Permissions for this role" help={ROLES_FIELD_HELP.dutySelection} />
              </p>

              {renderDutyCheckAllToolbar(duties, setDuties, allCustomRolePermissions, !canManageRoles)}
              {renderPermissionGroups(
                duties,
                toggleDuty,
                customRoleSections,
                customRoleCatalogByGroup,
                !canManageRoles
              )}

              <button
                type="button"
                className="button"
                disabled={!canManageRoles}
                onClick={() => void handleCreateRole()}
              >
                Create custom role
              </button>
            </div>

            <aside className="roles-page__custom-aside roles-animate-in roles-animate-in--3">
              <RolesSectionHeader
                title="Assign custom role to user"
                subtitle="Pick an existing staff member or create a new user with system job title plus custom roles."
                help="Assign duty bundles to users who already have a system job title (admin, teller, etc.). To create a new login, use Add user."
              />

              <button
                type="button"
                className="button secondary roles-page__add-user-btn"
                disabled={!canManageRoles}
                onClick={() => setUserModalOpen(true)}
              >
                Add user
              </button>

              <RolesFormField label="Staff member" help={ROLES_FIELD_HELP.assignUserId}>
                <select
                  value={assignUserId}
                  disabled={!canManageRoles || users.length === 0}
                  onChange={(e) => setAssignUserId(e.target.value)}
                >
                  <option value="">Select user…</option>
                  {users.map((staff) => (
                    <option key={staff.userId} value={staff.userId}>
                      {staff.fullName ? `${staff.fullName} — ` : ""}
                      {staff.email} ({staff.role.replace(/_/g, " ")})
                    </option>
                  ))}
                </select>
              </RolesFormField>

              <RolesFormField label="Custom role" help={ROLES_FIELD_HELP.assignRoleKey}>
                <select
                  value={assignRoleKey}
                  disabled={!canManageRoles || extraDutyRoles.length === 0}
                  onChange={(e) => setAssignRoleKey(e.target.value)}
                >
                  <option value="">Select custom role…</option>
                  <optgroup label="Extra duty bundles">
                    {extraDutyRoles.map((entry) => (
                      <option key={entry.roleKey} value={entry.roleKey}>
                        {entry.displayName} ({entry.roleKey})
                      </option>
                    ))}
                  </optgroup>
                </select>
              </RolesFormField>
              <button
                type="button"
                className="button secondary"
                disabled={!canManageRoles}
                onClick={() => void handleAssignRole()}
              >
                Assign custom role
              </button>

              <h4>Created roles</h4>
              <div className="roles-page__role-list">
                {extraDutyRoles.length === 0 ? (
                  <p className="muted">No extra duty bundles yet.</p>
                ) : (
                  extraDutyRoles.map((entry) => (
                    <div key={entry.roleKey} className="roles-page__role-list-item">
                      <strong>{entry.displayName}</strong>
                      <small className="muted">
                        {entry.roleKey} · {customRoleProductScopeLabel(entry.productScope ?? "all")} ·{" "}
                        {entry.duties.length} duties
                      </small>
                    </div>
                  ))
                )}
              </div>

              <h4>Recent assignments</h4>
              <div className="roles-page__role-list">
                {assignments.length === 0 ? (
                  <p className="muted">No assignments yet.</p>
                ) : (
                  assignments.slice(0, 12).map((entry) => (
                    <div key={`${entry.userId}-${entry.roleKey}`} className="roles-page__role-list-item">
                      <strong>{userLabel(entry.userId)}</strong>
                      <small className="muted">
                        {customRoleLabel(entry.roleKey)} · <code>{entry.roleKey}</code>
                      </small>
                    </div>
                  ))
                )}
              </div>
            </aside>
          </div>
        </section>
      ) : null}

      <UserFormModal
        open={userModalOpen}
        mode="create"
        user={null}
        branches={branches}
        createDefaults={{
          customRoleKeys: assignRoleKey ? [assignRoleKey] : undefined
        }}
        onClose={() => setUserModalOpen(false)}
        onSaved={() => void loadRoles()}
      />
    </div>
  );
}
