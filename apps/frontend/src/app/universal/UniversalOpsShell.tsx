import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { UNIVERSAL_OPS_NAV } from "@bms/shared";

type Props = {
  title: string;
  subtitle: string;
  displayName?: string;
  children: ReactNode;
  actions?: ReactNode;
};

export function UniversalOpsShell({ title, subtitle, displayName, children, actions }: Props) {
  return (
    <div className="role-workspace role-workspace--slate workspace-animate-in universal-ops">
      <header className="role-workspace__hero desk-hero-panel universal-ops__hero">
        <div className="desk-hero-panel__row">
          <div>
            <p className="desk-hero-panel__eyebrow">Universal Operations</p>
            <h2>{title}</h2>
            <p className="role-workspace__subtitle">{subtitle}</p>
            {displayName ? <p className="role-workspace__greeting muted">Welcome, {displayName}</p> : null}
          </div>
          {actions}
        </div>
      </header>
      {children}
    </div>
  );
}

export function UniversalOpsQuickLinks({ excludePath }: { excludePath?: string }) {
  return (
    <section className="card universal-ops__quick">
      <h3>Quick navigation</h3>
      <div className="desk-link-grid">
        {UNIVERSAL_OPS_NAV.filter((row) => row.navPath !== excludePath).map((row) => (
          <Link key={row.navPath} className="desk-link-card" to={`/app/${row.navPath}`}>
            <strong>{row.label}</strong>
          </Link>
        ))}
      </div>
    </section>
  );
}

export function UniversalOpsFeatureGrid({
  items
}: {
  items: Array<{ title: string; description: string }>;
}) {
  return (
    <div className="universal-ops__feature-grid">
      {items.map((item) => (
        <article key={item.title} className="card universal-ops__feature-card">
          <h4>{item.title}</h4>
          <p className="muted">{item.description}</p>
        </article>
      ))}
    </div>
  );
}
