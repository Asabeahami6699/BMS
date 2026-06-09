import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import type { RoleDeskConfig } from "./roleDeskConfig";

type Kpi = {
  label: string;
  value: string | number;
  tone?: "primary" | "success" | "warning" | "neutral";
};

type Props = {
  config: RoleDeskConfig;
  displayName?: string;
  updatedLabel?: string;
  error?: string | null;
  loading?: boolean;
  kpis?: Kpi[];
  children?: ReactNode;
  onRefresh?: () => void;
  refreshing?: boolean;
};

export function RoleDeskShell({
  config,
  displayName,
  updatedLabel,
  error,
  loading,
  kpis,
  children,
  onRefresh,
  refreshing
}: Props) {
  return (
    <div className={`role-workspace agency-banking-page role-workspace--${config.accent}`}>
      <header className="card role-workspace__hero workspace-animate-in">
        <p className="role-workspace__eyebrow">Agency banking · {config.eyebrow}</p>
        <div className="role-workspace__hero-row">
          <div>
            <h2>{config.title}</h2>
            <p className="muted role-workspace__subtitle">{config.subtitle}</p>
            {displayName ? (
              <p className="muted role-workspace__greeting">
                Welcome back, <strong>{displayName}</strong>
                {updatedLabel ? ` · ${updatedLabel}` : ""}
              </p>
            ) : null}
            {error ? <p className="error-text role-workspace__error">{error}</p> : null}
          </div>
          {onRefresh ? (
            <button
              type="button"
              className="button secondary role-workspace__refresh"
              disabled={refreshing}
              onClick={onRefresh}
              aria-label="Refresh desk"
            >
              {refreshing ? "…" : "↻"}
            </button>
          ) : null}
        </div>
      </header>

      {kpis && kpis.length > 0 ? (
        <section className="kpi-grid role-workspace__kpis workspace-animate-in workspace-animate-in--2">
          {kpis.map((kpi) => (
            <article
              key={kpi.label}
              className={`kpi-card${kpi.tone ? ` kpi-card--${kpi.tone}` : ""} role-workspace__kpi`}
            >
              <p className="kpi-value">{kpi.value}</p>
              <span className="kpi-label">{kpi.label}</span>
            </article>
          ))}
        </section>
      ) : loading ? (
        <p className="muted workspace-animate-in workspace-animate-in--2">Loading desk…</p>
      ) : null}

      <section className="card role-workspace__workflow workspace-animate-in workspace-animate-in--2">
        <h3>Workflow</h3>
        <ol className="role-workspace__steps">
          {config.workflow.map((step, index) => (
            <li key={step} className="role-workspace__step">
              <span className="role-workspace__step-num">{index + 1}</span>
              <span>{step}</span>
            </li>
          ))}
        </ol>
      </section>

      <section className="role-workspace__quick-grid workspace-animate-in workspace-animate-in--3">
        {config.quickLinks.map((link) => (
          <Link key={link.to} to={link.to} className="card role-workspace__quick-card">
            <strong>{link.label}</strong>
            <span className="muted">{link.description}</span>
            <span className="role-workspace__quick-cta">Open →</span>
          </Link>
        ))}
      </section>

      {children ? (
        <div className="role-workspace__main workspace-animate-in workspace-animate-in--3">{children}</div>
      ) : null}
    </div>
  );
}
