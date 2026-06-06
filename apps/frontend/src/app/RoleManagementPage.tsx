import { useEffect, useMemo, useState } from "react";
import type { Permission, PermissionCatalogEntry, PermissionGroupId, Role } from "@bms/shared";
import {
  BUILTIN_ROLE_LABELS,
  NAV_MATRIX_ASSIGNABLE_ROLES,
  PERMISSION_GROUP_LABELS,
  PERMISSION_CATALOG,
  TENANT_EDITABLE_BUILTIN_ROLES,
  catalogEntriesForTenant,
  permissionProductSectionsForTenant,
  validateDutySelection,
  validateSusuNavVisibilityItems
} from "@bms/shared";
import type { AppRole, BuiltinRolePermissionView, SusuNavVisibilityConfigItem } from "./api";
import {
  assignRole,
  createRole,
  getBuiltinRolePermissions,
  getRoleAssignments,
  getRoles,
  getSusuNavVisibilityConfig,
  getTenantId,
  resetBuiltinRolePermissions,
  resetSusuNavVisibilityConfig,
  saveBuiltinRolePermissions,
  saveSusuNavVisibilityConfig
} from "./api";
import { subscribeToTenantRealtime } from "./realtime";
import { useToast } from "../components/Toast";
import { toUserFacingError } from "../lib/networkError";
import { useAuth } from "../auth/AuthContext";

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
  const [roleKey, setRoleKey] = useState("branch_supervisor");
  const [displayName, setDisplayName] = useState("Branch Supervisor");
  const [duties, setDuties] = useState<Permission[]>(["customers.read", "transactions.read"]);
  const [assignUserId, setAssignUserId] = useState("");
  const [assignRoleKey, setAssignRoleKey] = useState("branch_supervisor");
  const [roles, setRoles] = useState<Array<{ roleKey: string; displayName: string; duties: string[] }>>([]);
  const [assignments, setAssignments] = useState<Array<{ userId: string; roleKey: string }>>([]);
  const [builtinViews, setBuiltinViews] = useState<BuiltinRolePermissionView[]>([]);
  const [editingBuiltin, setEditingBuiltin] = useState<Role | null>(null);
  const [builtinDraft, setBuiltinDraft] = useState<Permission[]>([]);
  const [builtinSaving, setBuiltinSaving] = useState(false);
  const [navItems, setNavItems] = useState<SusuNavVisibilityConfigItem[]>([]);
  const [navSaving, setNavSaving] = useState(false);
  const [expandedNavPath, setExpandedNavPath] = useState<string | null>(null);

  const tenantCatalog = useMemo(
    () => catalogEntriesForTenant(subscribedModules),
    [subscribedModules]
  );

  const productSections = useMemo(
    () => permissionProductSectionsForTenant(subscribedModules),
    [subscribedModules]
  );

  const navPermissionOptions = useMemo(() => tenantCatalog.map((e) => e.id), [tenantCatalog]);

  const validation = useMemo(() => validateDutySelection(duties), [duties]);
  const builtinValidation = useMemo(() => validateDutySelection(builtinDraft), [builtinDraft]);

  const catalogByGroup = useMemo(() => {
    const map = new Map<PermissionGroupId, PermissionCatalogEntry[]>();
    for (const entry of tenantCatalog) {
      const list = map.get(entry.group) ?? [];
      list.push(entry);
      map.set(entry.group, list);
    }
    return map;
  }, [tenantCatalog]);

  const allCatalogPermissions = useMemo(() => tenantCatalog.map((e) => e.id), [tenantCatalog]);

  function renderPermissionGroups(
    selected: Permission[],
    onToggle: (duty: Permission) => void,
    disabled?: boolean
  ) {
    return productSections.map((section) => (
      <div key={section.scope} className="roles-page__product-section">
        <h3 className="roles-page__product-heading">{section.label}</h3>
        <div className="roles-page__duty-groups">
          {section.groupIds.map((groupId) => {
            const entries = catalogByGroup.get(groupId);
            if (!entries?.length) {
              return null;
            }
            return (
              <div key={groupId} className="roles-page__duty-group">
                <h4>{PERMISSION_GROUP_LABELS[groupId]}</h4>
                <div className="duty-grid">
                  {entries.map((entry) => (
                    <label key={entry.id} className="duty-item" title={entry.description}>
                      <input
                        type="checkbox"
                        checked={selected.includes(entry.id)}
                        disabled={disabled}
                        onChange={() => onToggle(entry.id)}
                      />
                      <span>
                        <strong>{entry.label}</strong>
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
      const [data, assignmentData, builtin, nav] = await Promise.all([
        getRoles(),
        getRoleAssignments(),
        getBuiltinRolePermissions(),
        getSusuNavVisibilityConfig()
      ]);
      setRoles(data);
      setAssignments(assignmentData);
      setBuiltinViews(builtin);
      setNavItems(nav);
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
    disabled?: boolean
  ) {
    return (
      <div className="roles-page__check-all">
        <button
          type="button"
          className="button-link"
          disabled={disabled}
          onClick={() => onChange([...allCatalogPermissions])}
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
          {selected.length} / {allCatalogPermissions.length} selected
        </span>
      </div>
    );
  }

  async function handleCreateRole() {
    if (!toastValidation(showToast, validation)) {
      return;
    }
    try {
      await createRole({ roleKey, displayName, duties });
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
    const roles = item.roles.includes(jobRole)
      ? item.roles.filter((r) => r !== jobRole)
      : [...item.roles, jobRole];
    updateNavItem(navPath, { roles });
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
      showToast("Enter a user ID and custom role key.", "error");
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

  return (
    <div className="roles-page">
      <header className="roles-page__header card">
        <h2>Roles &amp; permissions</h2>
        <p className="muted">
          Staff <strong>job titles</strong> (admin, coordinator, teller, etc.) are set on each user and control API
          access. <strong>Custom roles</strong> below add extra duty bundles for reporting — they do not replace the
          user&apos;s job title yet.
        </p>
      </header>

      <section className="card roles-page__guide">
        <h3>How to set up without conflicts</h3>
        <ol className="roles-page__steps">
          <li>
            Permissions are grouped by your subscribed products (Susu, Loans, etc.). Only duties for enabled
            departments are listed here.
          </li>
          <li>
            Assign the correct <strong>job title</strong> under Settings → Users, then use <strong>Edit permissions</strong>{" "}
            below to add or remove duties for that title (saved per company).
          </li>
          <li>
            Use the <strong>Susu sidebar matrix</strong> below to see which menu items each title can access when they
            hold the listed permissions.
          </li>
          <li>
            Optional: create a <strong>custom role</strong> only when you need a named duty bundle; avoid duplicating
            permissions already granted by the job title.
          </li>
          <li>
            Grant <strong>requires</strong> dependencies together (e.g. <code>users.update</code> needs{" "}
            <code>users.read</code>) — the editor warns you before saving.
          </li>
          <li>
            Till float: coordinators need <code>branch_float.manage</code> + <code>transactions.read</code>; tellers need{" "}
            <code>transactions.read</code> only at the counter.
          </li>
        </ol>
      </section>

      <section className="card roles-page__builtin">
        <h3>Built-in job titles (tenant)</h3>
        <p className="muted">
          Check or uncheck permissions for each title. Changes apply to every user with that job title after they refresh
          or sign in again.
        </p>
        <div className="roles-page__builtin-grid">
          {TENANT_EDITABLE_BUILTIN_ROLES.map((builtinRole) => {
            const view = builtinViews.find((v) => v.role === builtinRole);
            const effective = view?.effectiveDuties ?? [];
            const isEditing = editingBuiltin === builtinRole;
            return (
              <article
                key={builtinRole}
                className={`roles-page__builtin-card${isEditing ? " is-editing" : ""}`}
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
                    {renderDutyCheckAllToolbar(builtinDraft, setBuiltinDraft, builtinSaving)}
                    {renderPermissionGroups(builtinDraft, toggleBuiltinDuty, builtinSaving)}
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
      </section>

      <section className="card roles-page__nav-matrix">
        <div className="roles-page__nav-matrix-head">
          <div>
            <h3>Susu Management sidebar — who sees what</h3>
            <p className="muted">
              Choose which <strong>job titles</strong> can see each menu item and which <strong>permissions</strong> are
              required. Example: restrict Till float to admin only even if coordinators have till permissions.
            </p>
          </div>
          {canManageRoles ? (
            <div className="roles-page__nav-matrix-actions">
              <button
                type="button"
                className="button secondary"
                disabled={navSaving}
                onClick={() => void handleResetNav()}
              >
                Reset to defaults
              </button>
              <button
                type="button"
                className="button"
                disabled={navSaving}
                onClick={() => void handleSaveNav()}
              >
                {navSaving ? "Saving…" : "Save sidebar access"}
              </button>
            </div>
          ) : null}
        </div>

        <div className="roles-page__nav-matrix-list">
          {navItems.map((item) => {
            const expanded = expandedNavPath === item.navPath;
            return (
              <article
                key={item.navPath}
                className={`roles-page__nav-row${item.isCustomized ? " is-customized" : ""}`}
              >
                <header className="roles-page__nav-row-head">
                  <div>
                    <strong>{item.label}</strong>
                    {item.isCustomized ? (
                      <span className="roles-page__custom-badge"> Customized</span>
                    ) : null}
                    <p className="muted">{item.description}</p>
                  </div>
                  {canManageRoles ? (
                    <button
                      type="button"
                      className="button-link"
                      onClick={() => setExpandedNavPath(expanded ? null : item.navPath)}
                    >
                      {expanded ? "Hide permissions" : "Edit permissions"}
                    </button>
                  ) : null}
                </header>

                <div className="roles-page__nav-roles">
                  <span className="roles-page__nav-roles-label">Job titles</span>
                  <div className="roles-page__nav-role-chips">
                    {NAV_MATRIX_ASSIGNABLE_ROLES.map((jobRole) => (
                      <label key={jobRole} className="roles-page__nav-chip">
                        <input
                          type="checkbox"
                          checked={item.roles.includes(jobRole)}
                          disabled={!canManageRoles}
                          onChange={() => toggleNavRole(item.navPath, jobRole)}
                        />
                        <span>{BUILTIN_ROLE_LABELS[jobRole]}</span>
                      </label>
                    ))}
                  </div>
                </div>

                {expanded && canManageRoles ? (
                  <div className="roles-page__nav-perms">
                    <span className="roles-page__nav-roles-label">
                      Any of these permissions (user must hold at least one)
                    </span>
                    <div className="duty-grid roles-page__nav-perm-grid">
                      {navPermissionOptions.map((perm) => (
                        <label key={perm} className="duty-item" title={perm}>
                          <input
                            type="checkbox"
                            checked={item.anyPermissions.includes(perm)}
                            onChange={() => toggleNavPermission(item.navPath, perm)}
                          />
                          <small>{perm}</small>
                        </label>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="roles-page__nav-perm-summary">
                    {item.anyPermissions.map((p) => (
                      <code key={p} className="roles-page__tag">
                        {p}
                      </code>
                    ))}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      </section>

      <section className="card roles-page__custom">
        <h3>Custom tenant roles</h3>
        <p className="muted">Stored per company. Assign to users by user ID after creation.</p>

        <label className="field">
          <span>Role key (unique slug)</span>
          <input value={roleKey} disabled={!canManageRoles} onChange={(e) => setRoleKey(e.target.value)} />
        </label>
        <label className="field">
          <span>Display name</span>
          <input
            value={displayName}
            disabled={!canManageRoles}
            onChange={(e) => setDisplayName(e.target.value)}
          />
        </label>

        {renderDutyCheckAllToolbar(duties, setDuties, !canManageRoles)}
        {renderPermissionGroups(duties, toggleDuty, !canManageRoles)}

        <button
          type="button"
          className="button"
          disabled={!canManageRoles}
          onClick={() => void handleCreateRole()}
        >
          Create custom role
        </button>

        <label className="field">
          <span>Assign to user ID</span>
          <input
            value={assignUserId}
            disabled={!canManageRoles}
            onChange={(e) => setAssignUserId(e.target.value)}
          />
        </label>
        <label className="field">
          <span>Custom role key</span>
          <input
            value={assignRoleKey}
            disabled={!canManageRoles}
            onChange={(e) => setAssignRoleKey(e.target.value)}
          />
        </label>
        <button type="button" className="button secondary" disabled={!canManageRoles} onClick={() => void handleAssignRole()}>
          Assign custom role
        </button>

        <div className="lines">
          {roles.map((entry) => (
            <div key={entry.roleKey} className="line">
              <span>{entry.displayName}</span>
              <small>
                {entry.roleKey} · {entry.duties.length} duties
              </small>
            </div>
          ))}
        </div>
        <h4>Assignments</h4>
        <div className="lines">
          {assignments.slice(0, 12).map((entry) => (
            <div key={`${entry.userId}-${entry.roleKey}`} className="line">
              <span>{entry.userId}</span>
              <small>{entry.roleKey}</small>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
