import { useEffect } from "react";
import { Link } from "react-router-dom";
import { useShallow } from "zustand/react/shallow";

import { hasAnyPermission, MODULE_DESCRIPTIONS, MODULE_LABELS } from "@bms/shared";

import type { AppRole } from "./api";
import { AGENCY_ROLE_DESKS } from "./banking/roleDeskConfig";
import { useAgencyStore } from "./stores/agencyStore";

type Props = {
  role: AppRole;
  permissions?: import("@bms/shared").Permission[];
};

type HubCard = {
  to: string;
  title: string;
  description: string;
  show: boolean;
};

function deskVisible(
  desk: (typeof AGENCY_ROLE_DESKS)[number],
  role: AppRole,
  permissions?: import("@bms/shared").Permission[]
): boolean {
  if (role === "admin") {
    return true;
  }
  if (!desk.roles.includes(role)) {
    return false;
  }
  if (desk.anyPermissions?.length) {
    return hasAnyPermission(permissions, desk.anyPermissions);
  }
  return true;
}

export function BankingOverviewPage({ role, permissions }: Props) {
  const { bootstrap, loading, error, hydrate, startLiveSync, stopLiveSync } = useAgencyStore(
    useShallow((s) => ({
      bootstrap: s.bootstrap,
      loading: s.loading,
      error: s.error,
      hydrate: s.hydrate,
      startLiveSync: s.startLiveSync,
      stopLiveSync: s.stopLiveSync
    }))
  );

  useEffect(() => {
    hydrate({ force: true });
    startLiveSync();
    return () => stopLiveSync();
  }, [hydrate, startLiveSync, stopLiveSync]);

  const cards: HubCard[] = [
    ...AGENCY_ROLE_DESKS.map((desk) => ({
      to: `/app/${desk.path}`,
      title: desk.title,
      description: desk.subtitle,
      show: deskVisible(desk, role, permissions)
    })),
    {
      to: "/app/banking/deposits",
      title: "Record deposits",
      description: "Teller walk-in cash — pending back-office bank execution.",
      show: hasAnyPermission(permissions, ["agency.deposits.record"]) || role === "admin"
    },
    {
      to: "/app/banking/withdrawals",
      title: "Withdrawal verification",
      description: "Customer Service verifies requests before teller cash payout.",
      show: hasAnyPermission(permissions, ["agency.withdrawals.approve"]) || role === "admin"
    },
    {
      to: "/app/banking/products",
      title: "Bank products",
      description: "Configure partner bank deposit and withdrawal types.",
      show: role === "admin" || hasAnyPermission(permissions, ["banking.products.read"])
    }
  ];

  const visible = cards.filter((c) => c.show);
  const seen = new Set<string>();
  const uniqueVisible = visible.filter((card) => {
    if (seen.has(card.to)) {
      return false;
    }
    seen.add(card.to);
    return true;
  });

  const queue = bootstrap?.queue;

  return (
    <div className="agents-page agency-banking-page">
      <header className="agents-page__header workspace-animate-in">
        <div>
          <h2>{MODULE_LABELS.banking}</h2>
          <p className="muted">{MODULE_DESCRIPTIONS.banking}</p>
          {error ? <p className="error-text">{error}</p> : null}
        </div>
      </header>

      {queue ? (
        <section className="kpi-grid agents-page__kpis workspace-animate-in workspace-animate-in--2">
          <article className="kpi-card kpi-card--warning">
            <p className="kpi-value">{queue.depositsPendingBank}</p>
            <span className="kpi-label">Deposits pending bank</span>
          </article>
          <article className="kpi-card kpi-card--primary">
            <p className="kpi-value">{queue.withdrawalsPendingCs}</p>
            <span className="kpi-label">Withdrawals pending CS</span>
          </article>
          <article className="kpi-card kpi-card--success">
            <p className="kpi-value">{queue.withdrawalsPendingTeller}</p>
            <span className="kpi-label">Ready for teller payout</span>
          </article>
        </section>
      ) : loading ? (
        <p className="muted">Loading agency queues…</p>
      ) : null}

      <section className="treasury-kpi-grid workspace-animate-in workspace-animate-in--3">
        {uniqueVisible.map((card) => (
          <Link key={card.to} to={card.to} className="card treasury-kpi hub-card-link">
            <h3 style={{ margin: "0 0 0.35rem" }}>{card.title}</h3>
            <p className="muted" style={{ margin: 0, fontSize: "0.92rem" }}>
              {card.description}
            </p>
            <span className="hub-card-link__cta">Open →</span>
          </Link>
        ))}
      </section>

      {uniqueVisible.length === 0 ? (
        <article className="card">
          <p className="muted">
            No agency banking screens are assigned to your job title. Ask an admin to grant agency
            banking permissions under Settings → Roles &amp; Permissions.
          </p>
        </article>
      ) : (
        <article className="card workspace-animate-in workspace-animate-in--3">
          <h3>Agency workflow</h3>
          <ol className="muted" style={{ margin: 0, paddingLeft: "1.25rem", lineHeight: 1.6 }}>
            <li>Teller records deposit → Back Officer credits customer account at bank</li>
            <li>Withdrawal request → Customer Service verifies → Teller pays cash</li>
            <li>Configure bank product types under Bank products before posting transactions</li>
          </ol>
        </article>
      )}
    </div>
  );
}
