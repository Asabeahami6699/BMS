import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  hasAnyPermission,
  hasTenantModule,
  MODULE_DESCRIPTIONS,
  MODULE_LABELS,
  type Permission,
  type TenantProductModule
} from "@bms/shared";
import { useShallow } from "zustand/react/shallow";
import type { AppRole, AuthMe, Branch, LoansBootstrap } from "./api";
import { getLoansBootstrap } from "./api";
import { useOverviewLiveSync } from "./hooks/useOverviewLiveSync";
import { selectCoordinatorKpis, useCoordinatorStore } from "./stores/coordinatorStore";
import { selectWithdrawalKpis, useWithdrawalsStore } from "./stores/withdrawalsStore";

type Props = {
  role: AppRole;
  modules: TenantProductModule[] | undefined;
  permissions: Permission[] | undefined;
  me: AuthMe | null;
  branches: Branch[];
  displayName: string;
};

function formatMoney(amount: number): string {
  return `GHS ${amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

type ProductCard = {
  id: TenantProductModule;
  title: string;
  description: string;
  to: string;
  metrics: Array<{ label: string; value: string }>;
};

export function TenantDashboardPage({ role, modules, permissions, me, branches, displayName }: Props) {
  const hasSusu = hasTenantModule(modules, "susu_management");
  const hasLoans = hasTenantModule(modules, "loans_credit");
  const hasBanking = hasTenantModule(modules, "banking");
  const hasTreasury = hasTenantModule(modules, "treasury");
  const canLoansRead = hasAnyPermission(permissions, ["loans.read"]);

  const loadCoordinator = hasSusu && (role === "admin" || role === "coordinator" || role === "accountant" || role === "auditor" || role === "teller");
  const loadWithdrawals = hasSusu && (role === "admin" || role === "coordinator");

  useOverviewLiveSync({
    role,
    enabled: hasSusu,
    loadCoordinator,
    loadWithdrawals,
    loadGroupSavings: false,
    loadPerformance: false
  });

  const susuKpis = useCoordinatorStore(useShallow(selectCoordinatorKpis));
  const withdrawals = useWithdrawalsStore((s) => s.withdrawals);
  const withdrawalKpis = useMemo(() => selectWithdrawalKpis(withdrawals), [withdrawals]);

  const [loansData, setLoansData] = useState<LoansBootstrap | null>(null);

  useEffect(() => {
    if (!hasLoans || !canLoansRead) {
      return;
    }
    void getLoansBootstrap()
      .then(setLoansData)
      .catch(() => setLoansData(null));
  }, [hasLoans, canLoansRead]);

  const productCards = useMemo((): ProductCard[] => {
    const cards: ProductCard[] = [];

    if (hasSusu) {
      cards.push({
        id: "susu_management",
        title: MODULE_LABELS.susu_management,
        description: MODULE_DESCRIPTIONS.susu_management,
        to: "/app/susu/overview",
        metrics: loadCoordinator
          ? [
              { label: "Active customers", value: String(susuKpis.activeCustomers) },
              { label: "Net collections", value: formatMoney(susuKpis.totalCollections) },
              { label: "Pending withdrawals", value: String(withdrawalKpis.pending) }
            ]
          : [{ label: "Status", value: "Open overview" }]
      });
    }

    if (hasLoans && canLoansRead) {
      const summary = loansData?.summary;
      cards.push({
        id: "loans_credit",
        title: MODULE_LABELS.loans_credit,
        description: MODULE_DESCRIPTIONS.loans_credit,
        to: "/app/loans",
        metrics: summary
          ? [
              { label: "Active loans", value: String(summary.disbursed) },
              { label: "Pending approval", value: String(summary.pendingApproval) },
              { label: "Outstanding", value: formatMoney(summary.totalOutstanding) }
            ]
          : [{ label: "Status", value: "Loading…" }]
      });
    } else if (hasLoans) {
      cards.push({
        id: "loans_credit",
        title: MODULE_LABELS.loans_credit,
        description: MODULE_DESCRIPTIONS.loans_credit,
        to: "/app/loans",
        metrics: [{ label: "Access", value: "Limited" }]
      });
    }

    if (hasBanking) {
      cards.push({
        id: "banking",
        title: MODULE_LABELS.banking,
        description: MODULE_DESCRIPTIONS.banking,
        to: "/app/banking",
        metrics: [{ label: "Department", value: "Overview" }]
      });
    }

    if (hasTreasury) {
      cards.push({
        id: "treasury",
        title: MODULE_LABELS.treasury,
        description: MODULE_DESCRIPTIONS.treasury,
        to: "/app/treasury",
        metrics: [{ label: "Department", value: "Overview" }]
      });
    }

    return cards;
  }, [
    hasSusu,
    hasLoans,
    hasBanking,
    hasTreasury,
    canLoansRead,
    loadCoordinator,
    susuKpis,
    withdrawalKpis.pending,
    loansData
  ]);

  const subscribedCount = modules?.length ?? 0;

  return (
    <div className="overview-page tenant-dashboard">
      <header className="overview-hero">
        <div>
          <p className="overview-hero__eyebrow">Workspace</p>
          <h1 className="overview-hero__title">Dashboard</h1>
          <p className="overview-hero__sub muted">
            Welcome back, {displayName}. Summary across your {subscribedCount} subscribed product
            {subscribedCount === 1 ? "" : "s"}.
          </p>
        </div>
      </header>

      <section className="kpi-grid overview-kpis" aria-label="Tenant summary">
        <article className="kpi-card kpi-card--primary">
          <p className="kpi-label">Tenant</p>
          <p className="kpi-value">{me?.tenantName ?? me?.tenantId ?? "—"}</p>
        </article>
        <article className="kpi-card kpi-card--success">
          <p className="kpi-label">Products</p>
          <p className="kpi-value">{subscribedCount}</p>
        </article>
        <article className="kpi-card">
          <p className="kpi-label">Branches</p>
          <p className="kpi-value">{branches.length}</p>
        </article>
        <article className="kpi-card kpi-card--purple">
          <p className="kpi-label">Signed in as</p>
          <p className="kpi-value">{me?.email ?? role}</p>
        </article>
      </section>

      {productCards.length > 0 ? (
        <section className="tenant-dashboard__products" aria-label="Product overviews">
          <h2 className="tenant-dashboard__heading">Your products</h2>
          <div className="tenant-dashboard__grid">
            {productCards.map((card) => (
              <Link key={card.id} to={card.to} className="tenant-dashboard__card">
                <div className="tenant-dashboard__card-head">
                  <h3>{card.title}</h3>
                  <span className="tenant-dashboard__card-link">Open overview →</span>
                </div>
                <p className="muted">{card.description}</p>
                <dl className="tenant-dashboard__metrics">
                  {card.metrics.map((metric) => (
                    <div key={metric.label}>
                      <dt>{metric.label}</dt>
                      <dd>{metric.value}</dd>
                    </div>
                  ))}
                </dl>
              </Link>
            ))}
          </div>
        </section>
      ) : (
        <p className="muted">
          No product modules are enabled on this subscription. Contact your administrator.
        </p>
      )}

      <p className="muted tenant-dashboard__reports">
        Cross-product reporting: <Link to="/app/reports">Reports &amp; Analytics</Link>
      </p>
    </div>
  );
}
