import { useMemo, useState } from "react";
import type { Permission, Role, TenantProductModule } from "@bms/shared";
import {
  BANKING_NAV_VISIBILITY,
  BUILTIN_ROLE_LABELS,
  LOANS_NAV_VISIBILITY,
  MODULE_LABELS,
  NAV_MATRIX_ASSIGNABLE_ROLES,
  PERMISSION_CATALOG,
  SETTINGS_ROUTE_VISIBILITY,
  TREASURY_NAV_VISIBILITY,
  hasTenantModule
} from "@bms/shared";
import type { SusuNavVisibilityConfigItem } from "../api";
import { FieldHelpTip, RolesInlineLabel } from "./RolesFormField";
import { RolesSectionHeader } from "./RolesSectionHeader";
import { ReferenceSidebarMatrix, type ReferenceSidebarRow } from "./ReferenceSidebarMatrix";
import { ROLES_FIELD_HELP, ROLES_SECTION_HELP, sidebarModuleLabel } from "./rolesPageGuide";

type Props = {
  subscribedModules: TenantProductModule[] | undefined;
  canManageRoles: boolean;
  navItems: SusuNavVisibilityConfigItem[];
  navPermissionOptions: Permission[];
  navSaving: boolean;
  expandedNavPath: string | null;
  onExpandedNavPathChange: (path: string | null) => void;
  onToggleNavRole: (navPath: string, jobRole: Role) => void;
  onToggleNavPermission: (navPath: string, permission: Permission) => void;
  onSaveNav: () => void;
  onResetNav: () => void;
};

type SidebarPanelId = TenantProductModule | "settings";

export function SidebarAccessSection({
  subscribedModules,
  canManageRoles,
  navItems,
  navPermissionOptions,
  navSaving,
  expandedNavPath,
  onExpandedNavPathChange,
  onToggleNavRole,
  onToggleNavPermission,
  onSaveNav,
  onResetNav
}: Props) {
  const panels = useMemo(() => {
    const list: SidebarPanelId[] = [];
    for (const module of ["susu_management", "banking", "loans_credit", "treasury"] as TenantProductModule[]) {
      if (hasTenantModule(subscribedModules, module)) {
        list.push(module);
      }
    }
    list.push("settings");
    return list;
  }, [subscribedModules]);

  const [openPanel, setOpenPanel] = useState<SidebarPanelId>(panels[0] ?? "settings");

  const permissionDescriptions = useMemo(() => {
    const map = new Map<Permission, string>();
    for (const entry of PERMISSION_CATALOG) {
      map.set(entry.id, entry.description);
    }
    return map;
  }, []);

  const bankingRows: ReferenceSidebarRow[] = useMemo(
    () =>
      BANKING_NAV_VISIBILITY.map((row) => ({
        label: row.label,
        anyPermissions: row.anyPermissions,
        roles: row.roles
      })),
    []
  );

  const loansRows: ReferenceSidebarRow[] = useMemo(
    () =>
      LOANS_NAV_VISIBILITY.map((row) => ({
        label: row.label,
        description: row.description,
        anyPermissions: row.anyPermissions
      })),
    []
  );

  const treasuryRows: ReferenceSidebarRow[] = useMemo(
    () =>
      TREASURY_NAV_VISIBILITY.map((row) => ({
        label: row.label,
        anyPermissions: row.anyPermissions
      })),
    []
  );

  const settingsRows: ReferenceSidebarRow[] = useMemo(
    () =>
      SETTINGS_ROUTE_VISIBILITY.filter((row) => row.routePath !== "settings").map((row) => ({
        label: row.label,
        anyPermissions: row.anyPermissions,
        roles: row.roles
      })),
    []
  );

  return (
    <section className="card roles-page__section roles-animate-in">
      <RolesSectionHeader
        title="Department sidebar access"
        subtitle="See who can open each menu item. Customize Susu menus for your company; other departments use platform defaults until tenant overrides are added."
        help={ROLES_SECTION_HELP.sidebar}
        actions={
          openPanel === "susu_management" && canManageRoles ? (
            <>
              <button
                type="button"
                className="button secondary"
                disabled={navSaving}
                onClick={() => void onResetNav()}
              >
                Reset Susu defaults
              </button>
              <button type="button" className="button" disabled={navSaving} onClick={() => void onSaveNav()}>
                {navSaving ? "Saving…" : "Save Susu menus"}
              </button>
            </>
          ) : null
        }
      />

      <div className="roles-page__sidebar-accordion">
        {panels.map((panelId) => {
          const isOpen = openPanel === panelId;
          const isSusu = panelId === "susu_management";
          return (
            <article
              key={panelId}
              className={`roles-page__sidebar-panel${isOpen ? " is-open" : ""}${isSusu ? " is-editable" : ""}`}
            >
              <button
                type="button"
                className="roles-page__sidebar-panel-toggle"
                aria-expanded={isOpen}
                onClick={() => setOpenPanel(panelId)}
              >
                <span className="roles-page__sidebar-panel-title">
                  {sidebarModuleLabel(panelId)}
                  {isSusu ? (
                    <span className="roles-page__custom-badge roles-page__panel-badge">Tenant editable</span>
                  ) : (
                    <span className="roles-page__ref-badge roles-page__panel-badge">Reference</span>
                  )}
                </span>
                <span className="roles-page__sidebar-panel-chevron" aria-hidden>
                  {isOpen ? "−" : "+"}
                </span>
              </button>

              {isOpen ? (
                <div className="roles-page__sidebar-panel-body roles-animate-in roles-animate-in--2">
                  {panelId === "susu_management" ? (
                    <>
                      <p className="muted roles-page__sidebar-intro">
                        Toggle which <strong>job titles</strong> may see each Susu menu item and which{" "}
                        <strong>permissions</strong> are required. Example: keep Till float visible only to admin
                        even if coordinators have float duties.
                      </p>
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
                                  <strong className="roles-page__nav-item-title">
                                    {item.label}
                                    <FieldHelpTip label={`${item.label} menu`}>
                                      {item.description} {ROLES_FIELD_HELP.sidebarMenuItem}
                                    </FieldHelpTip>
                                  </strong>
                                  {item.isCustomized ? (
                                    <span className="roles-page__custom-badge"> Customized</span>
                                  ) : null}
                                </div>
                                {canManageRoles ? (
                                  <button
                                    type="button"
                                    className="button-link"
                                    onClick={() =>
                                      onExpandedNavPathChange(expanded ? null : item.navPath)
                                    }
                                  >
                                    {expanded ? "Hide permissions" : "Edit permissions"}
                                  </button>
                                ) : null}
                              </header>

                              <div className="roles-page__nav-roles">
                                <RolesInlineLabel
                                  label="Job titles"
                                  help={ROLES_FIELD_HELP.sidebarJobTitles}
                                  className="roles-page__nav-roles-label"
                                />
                                <div className="roles-page__nav-role-chips">
                                  {NAV_MATRIX_ASSIGNABLE_ROLES.map((jobRole) => (
                                    <label key={jobRole} className="roles-page__nav-chip">
                                      <input
                                        type="checkbox"
                                        checked={item.roles.includes(jobRole)}
                                        disabled={!canManageRoles}
                                        onChange={() => onToggleNavRole(item.navPath, jobRole)}
                                      />
                                      <span>{BUILTIN_ROLE_LABELS[jobRole]}</span>
                                      <FieldHelpTip label={BUILTIN_ROLE_LABELS[jobRole]}>
                                        {ROLES_FIELD_HELP.sidebarJobTitleChip} Applies to the &ldquo;
                                        {item.label}&rdquo; menu item.
                                      </FieldHelpTip>
                                    </label>
                                  ))}
                                </div>
                              </div>

                              {expanded && canManageRoles ? (
                                <div className="roles-page__nav-perms">
                                  <RolesInlineLabel
                                    label="Any of these permissions (user must hold at least one)"
                                    help={ROLES_FIELD_HELP.sidebarPermissions}
                                    className="roles-page__nav-roles-label"
                                  />
                                  <div className="duty-grid roles-page__nav-perm-grid">
                                    {navPermissionOptions.map((perm) => (
                                      <label key={perm} className="duty-item roles-page__duty-item">
                                        <input
                                          type="checkbox"
                                          checked={item.anyPermissions.includes(perm)}
                                          onChange={() => onToggleNavPermission(item.navPath, perm)}
                                        />
                                        <span className="roles-page__perm-chip-label">
                                          <small>{perm}</small>
                                          <FieldHelpTip label={perm}>
                                            {permissionDescriptions.get(perm) ??
                                              ROLES_FIELD_HELP.sidebarPermissionChip}
                                          </FieldHelpTip>
                                        </span>
                                      </label>
                                    ))}
                                  </div>
                                </div>
                              ) : (
                                <div className="roles-page__nav-perm-summary">
                                  <RolesInlineLabel
                                    label="Required permissions"
                                    help={ROLES_FIELD_HELP.sidebarPermissions}
                                    className="roles-page__nav-roles-label"
                                  />
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
                    </>
                  ) : panelId === "banking" ? (
                    <>
                      <p className="muted roles-page__sidebar-intro">
                        {MODULE_LABELS.banking} menus require both a matching job title and permission. Adjust
                        duties on the Job titles tab to change who reaches Back office, Teller payouts, and Bank
                        products.
                      </p>
                      <ReferenceSidebarMatrix rows={bankingRows} />
                    </>
                  ) : panelId === "loans_credit" ? (
                    <>
                      <p className="muted roles-page__sidebar-intro">
                        {MODULE_LABELS.loans_credit} sidebar items are permission-driven only — any job title
                        with the listed permission can see the menu.
                      </p>
                      <ReferenceSidebarMatrix rows={loansRows} permissionOnly />
                    </>
                  ) : panelId === "treasury" ? (
                    <>
                      <p className="muted roles-page__sidebar-intro">
                        {MODULE_LABELS.treasury} menus appear when staff hold treasury permissions. Cash
                        movements require <code>treasury.cash.move</code>.
                      </p>
                      <ReferenceSidebarMatrix rows={treasuryRows} permissionOnly />
                    </>
                  ) : (
                    <>
                      <p className="muted roles-page__sidebar-intro">
                        Settings pages are restricted to admin (and auditor for audit logs). Users still need the
                        listed permissions even when their title matches.
                      </p>
                      <ReferenceSidebarMatrix rows={settingsRows} />
                    </>
                  )}
                </div>
              ) : null}
            </article>
          );
        })}
      </div>
    </section>
  );
}
