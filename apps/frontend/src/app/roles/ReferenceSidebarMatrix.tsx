import type { Permission, Role } from "@bms/shared";
import { BUILTIN_ROLE_LABELS } from "@bms/shared";
import { FieldHelpTip, RolesInlineLabel } from "./RolesFormField";
import { ROLES_FIELD_HELP } from "./rolesPageGuide";

export type ReferenceSidebarRow = {
  label: string;
  description?: string;
  anyPermissions: Permission[];
  roles?: Role[];
};

type Props = {
  rows: ReferenceSidebarRow[];
  permissionOnly?: boolean;
};

export function ReferenceSidebarMatrix({ rows, permissionOnly = false }: Props) {
  return (
    <div className="roles-page__nav-matrix-list">
      {rows.map((row) => (
        <article key={row.label} className="roles-page__nav-row roles-page__nav-row--reference">
          <header className="roles-page__nav-row-head">
            <div>
              <strong className="roles-page__nav-item-title">
                {row.label}
                {row.description ? (
                  <FieldHelpTip label={`${row.label} menu`}>{row.description}</FieldHelpTip>
                ) : null}
              </strong>
            </div>
            <span className="roles-page__ref-badge">Platform default</span>
          </header>

          {!permissionOnly && row.roles?.length ? (
            <div className="roles-page__nav-roles">
              <RolesInlineLabel
                label="Job titles that may see this item"
                help={ROLES_FIELD_HELP.sidebarJobTitles}
                className="roles-page__nav-roles-label"
              />
              <div className="roles-page__nav-role-chips roles-page__nav-role-chips--readonly">
                {row.roles.map((jobRole) => (
                  <span key={jobRole} className="roles-page__nav-chip-static">
                    {BUILTIN_ROLE_LABELS[jobRole]}
                  </span>
                ))}
              </div>
            </div>
          ) : permissionOnly ? (
            <p className="muted roles-page__perm-only-note">
              Visible to any job title that holds the required permission(s) below.
            </p>
          ) : null}

          <div className="roles-page__nav-perm-summary">
            <RolesInlineLabel
              label="Required permissions (any one)"
              help={ROLES_FIELD_HELP.sidebarPermissions}
              className="roles-page__nav-roles-label"
            />
            {row.anyPermissions.map((p) => (
              <span key={p} className="roles-page__tag-wrap">
                <code className="roles-page__tag">{p}</code>
                <FieldHelpTip label={p}>{ROLES_FIELD_HELP.sidebarPermissionChip}</FieldHelpTip>
              </span>
            ))}
          </div>
        </article>
      ))}
    </div>
  );
}
