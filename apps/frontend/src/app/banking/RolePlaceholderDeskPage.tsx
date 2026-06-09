import type { RoleWorkspaceKind } from "../stores/roleWorkspaceStore";
import { getRoleDeskConfig } from "./roleDeskConfig";
import { RoleDeskShell } from "./RoleDeskShell";

type Props = {
  kind: RoleWorkspaceKind;
  displayName?: string;
};

export function RolePlaceholderDeskPage({ kind, displayName }: Props) {
  const config = getRoleDeskConfig(kind);

  return (
    <RoleDeskShell config={config} displayName={displayName}>
      <section className="card role-workspace__panel role-workspace__placeholder">
        <div className="role-workspace__placeholder-badge">Coming soon</div>
        <h3>Agency banking desk under construction</h3>
        <p className="muted">
          This role desk is scaffolded for future editing. Use the quick links above for live agency
          banking tools today.
        </p>
        {config.placeholderFeatures && config.placeholderFeatures.length > 0 ? (
          <ul className="role-workspace__feature-list">
            {config.placeholderFeatures.map((feature) => (
              <li key={feature}>{feature}</li>
            ))}
          </ul>
        ) : null}
      </section>
    </RoleDeskShell>
  );
}
