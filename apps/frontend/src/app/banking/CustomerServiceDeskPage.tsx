import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useShallow } from "zustand/react/shallow";
import { useRoleWorkspaceSync } from "../hooks/useRoleWorkspaceSync";
import { useRoleWorkspaceStore } from "../stores/roleWorkspaceStore";
import { getRoleDeskConfig } from "./roleDeskConfig";
import { RoleDeskShell } from "./RoleDeskShell";

type Props = { displayName?: string };

export function CustomerServiceDeskPage({ displayName }: Props) {
  const config = getRoleDeskConfig("customer_service");
  useRoleWorkspaceSync("customer_service");

  const { agency, loading, error, lastFetchedAt, refresh } = useRoleWorkspaceStore(
    useShallow((s) => ({
      agency: s.agency,
      loading: s.loading,
      error: s.error,
      lastFetchedAt: s.lastFetchedAt,
      refresh: s.refresh
    }))
  );

  const queue = agency?.queue;

  const kpis = useMemo(
    () => [
      {
        label: "Ready at teller",
        value: queue?.withdrawalsPendingTeller ?? 0,
        tone: "success" as const
      },
      {
        label: "Awaiting verification",
        value: queue?.withdrawalsPendingCs ?? 0,
        tone: "warning" as const
      },
      {
        label: "Deposits at bank",
        value: queue?.depositsPendingBank ?? 0,
        tone: "primary" as const
      }
    ],
    [queue]
  );

  const updatedLabel = lastFetchedAt
    ? `Updated ${new Date(lastFetchedAt).toLocaleTimeString()}`
    : undefined;

  return (
    <RoleDeskShell
      config={config}
      displayName={displayName}
      updatedLabel={updatedLabel}
      error={error}
      loading={loading && !agency}
      kpis={agency || loading ? kpis : undefined}
      onRefresh={() => void refresh()}
      refreshing={loading}
    >
      <section className="card role-workspace__panel role-workspace__panel--accent">
        <h3>Enter a transaction</h3>
        <p className="muted">
          Customer Service is the first point of contact. Collect customer details and initiate
          withdrawals — walk-in non-BMS requests go straight to the teller; BMS members are verified
          on the withdrawal desk before payout.
        </p>
        <div className="role-workspace__quick-actions">
          <Link to="/app/banking/withdrawals/initiate" className="button primary role-workspace__cta">
            Initiate withdrawal →
          </Link>
          <Link to="/app/banking/account-opening" className="button secondary">
            Account opening
          </Link>
        </div>
      </section>

      <section className="card role-workspace__panel">
        <header className="role-workspace__panel-head">
          <div>
            <h3>More actions</h3>
            <p className="muted">Verification and full queues live on the withdrawal desk.</p>
          </div>
        </header>
        <div className="role-workspace__link-grid">
          {config.quickLinks.map((link) => (
            <Link key={link.to} to={link.to} className="role-workspace__link-card">
              <strong>{link.label}</strong>
              <span className="muted">{link.description}</span>
            </Link>
          ))}
        </div>
      </section>
    </RoleDeskShell>
  );
}
