import { useMemo } from "react";
import { Link } from "react-router-dom";
import { hasTenantModule, type TenantProductModule } from "@bms/shared";
import { useShallow } from "zustand/react/shallow";
import type { AppRole, AuthMe, Branch } from "./api";
import { useOverviewLiveSync } from "./hooks/useOverviewLiveSync";
import {
  selectCoordinatorKpis,
  selectTopAgents,
  selectTopBranches,
  useCoordinatorStore
} from "./stores/coordinatorStore";
import { useGroupSavingsStore } from "./stores/groupSavingsStore";
import {
  selectAgentDisplayName,
  selectBranchDisplayName,
  usePerformanceStore
} from "./stores/performanceStore";
import { selectWithdrawalKpis, useWithdrawalsStore } from "./stores/withdrawalsStore";
import { useToast } from "../components/Toast";

type Props = {
  role: AppRole;
  modules: TenantProductModule[] | undefined;
  reportsAnalytics: boolean;
  isAdminLike: boolean;
  isCoordinatorLike: boolean;
  me: AuthMe | null;
  branches: Branch[];
  displayName: string;
};

function formatMoney(amount: number): string {
  return `GHS ${amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const ACCOUNT_LABELS: Record<string, string> = {
  susu: "Daily Susu",
  savings: "Savings",
  group: "Group savings",
  meba_daakye: "Meba Daakye"
};

type QuickLink = { to: string; label: string; hint?: string };

function buildQuickLinks(role: AppRole, canApprove: boolean): QuickLink[] {
  const links: QuickLink[] = [];
  if (canApprove) {
    links.push({ to: "/app/susu/pending-approvals", label: "Pending approvals", hint: "Registrations & requests" });
  }
  if (role === "admin" || role === "coordinator") {
    links.push({ to: "/app/susu/customers", label: "Customers" });
    links.push({ to: "/app/susu/agents", label: "Field agents" });
    links.push({ to: "/app/susu/routes", label: "Routes" });
    links.push({ to: "/app/susu/withdrawals", label: "Withdrawals" });
    links.push({ to: "/app/susu/group-savings", label: "Group savings" });
  }
  if (role === "admin" || role === "field_agent" || role === "coordinator" || role === "teller") {
    links.push({ to: "/app/susu/collections", label: "Branch counter", hint: "Deposits & withdrawals" });
  }
  links.push({ to: "/app/susu/performance", label: "Performance" });
  if (role === "admin" || role === "coordinator" || role === "accountant" || role === "auditor") {
    links.push({ to: "/app/reports", label: "Reports & analytics" });
  }
  if (role === "admin" || role === "accountant") {
    links.push({ to: "/app/susu/commissions", label: "Commissions" });
    links.push({ to: "/app/susu/payroll", label: "Payroll" });
  }
  return links;
}

export function OverviewPage({
  role,
  modules,
  reportsAnalytics,
  isAdminLike,
  isCoordinatorLike,
  me,
  branches,
  displayName
}: Props) {
  const hasSusu = hasTenantModule(modules, "susu_management");
  const canReports = role === "admin" || role === "coordinator" || role === "accountant" || role === "auditor" || role === "teller";
  const loadCoordinator = hasSusu && canReports;
  const loadWithdrawals = hasSusu && (role === "admin" || role === "coordinator");
  const loadGroupSavings = hasSusu && (role === "admin" || role === "coordinator");
  const loadPerformance = hasSusu && canReports;
  const canApprove = role === "admin" || role === "coordinator";

  useOverviewLiveSync({
    role,
    enabled: hasSusu,
    loadCoordinator,
    loadWithdrawals,
    loadGroupSavings,
    loadPerformance
  });

  const { showToast } = useToast();

  const coordLoading = useCoordinatorStore((s) => s.loading);
  const coordError = useCoordinatorStore((s) => s.error);
  const coordLastFetched = useCoordinatorStore((s) => s.lastFetchedAt);
  const coordBranches = useCoordinatorStore((s) => s.branches);
  const branchFilter = useCoordinatorStore((s) => s.branchFilter);
  const setBranchFilter = useCoordinatorStore((s) => s.setBranchFilter);
  const coordRefresh = useCoordinatorStore((s) => s.refresh);
  const summary = useCoordinatorStore((s) => s.summary);
  const customers = useCoordinatorStore((s) => s.customers);

  const kpis = useCoordinatorStore(useShallow(selectCoordinatorKpis));
  const topAgents = useCoordinatorStore(useShallow(selectTopAgents));
  const topBranches = useCoordinatorStore(useShallow(selectTopBranches));

  const coordAgentNames = useCoordinatorStore((s) => s.agentNames);
  const perfAgentNames = usePerformanceStore((s) => s.agentNames);
  const perfBranches = usePerformanceStore((s) => s.branches);
  const perfLoading = usePerformanceStore((s) => s.loading);

  const agentNames = useMemo(
    () => ({ ...perfAgentNames, ...coordAgentNames }),
    [perfAgentNames, coordAgentNames]
  );

  const withdrawals = useWithdrawalsStore((s) => s.withdrawals);
  const groupTotals = useGroupSavingsStore((s) => s.totals);

  const withdrawalKpis = useMemo(() => selectWithdrawalKpis(withdrawals), [withdrawals]);

  const accountMix = useMemo(() => {
    const active = customers.filter((c) => c.status === "active");
    const count = (type: string) =>
      active.filter((c) => (c.accountType ?? "susu") === type).length;
    return {
      susu: count("susu"),
      savings: count("savings"),
      group: count("group"),
      meba: count("meba_daakye"),
      total: active.length
    };
  }, [customers]);

  const collectionBars = useMemo(() => {
    if (!summary) {
      return [];
    }
    const items = [
      { key: "daily", label: "Daily Susu", value: summary.totalDailySusu, tone: "primary" as const },
      { key: "deposits", label: "Deposits", value: summary.totalDeposits, tone: "success" as const },
      { key: "withdrawals", label: "Withdrawals", value: summary.totalWithdrawals, tone: "warn" as const }
    ];
    const max = Math.max(...items.map((i) => i.value), 1);
    return items.map((i) => ({ ...i, pct: Math.round((i.value / max) * 100) }));
  }, [summary]);

  const updatedLabel = useMemo(() => {
    if (!coordLastFetched) {
      return "Syncing live data…";
    }
    return `Last updated ${new Date(coordLastFetched).toLocaleTimeString()}`;
  }, [coordLastFetched]);

  const quickLinks = useMemo(() => buildQuickLinks(role, canApprove), [role, canApprove]);

  const branchName = (branchId: string) =>
    selectBranchDisplayName(branchId, perfBranches.length ? perfBranches : coordBranches);

  const agentName = (agentId: string) => selectAgentDisplayName(agentId, agentNames);

  const loading = loadCoordinator && coordLoading && !coordLastFetched;

  if (!hasSusu) {
    return (
      <div className="overview-page">
        <header className="overview-hero">
          <div>
            <p className="overview-hero__eyebrow">Workspace</p>
            <h1 className="overview-hero__title">Susu overview</h1>
            <p className="overview-hero__sub muted">
              Welcome back, {displayName}. Your subscribed products appear in the sidebar.
            </p>
          </div>
        </header>
        <section className="kpi-grid">
          {[
            { label: "Signed in as", value: me?.email ?? role },
            { label: "Tenant", value: me?.tenantName ?? me?.tenantId ?? "—" },
            { label: "Branches", value: String(branches.length) },
            { label: "Scope", value: me?.scopeType ?? "—" }
          ].map((kpi) => (
            <article className="kpi-card kpi-card--primary" key={kpi.label}>
              <p className="kpi-label">{kpi.label}</p>
              <p className="kpi-value">{kpi.value}</p>
            </article>
          ))}
        </section>
        {reportsAnalytics && isAdminLike ? (
          <p className="muted">
            Open <Link to="/app/reports">Reports &amp; Analytics</Link> for charts and exports.
          </p>
        ) : null}
      </div>
    );
  }

  if (!loadCoordinator) {
    return (
      <div className="overview-page">
        <header className="overview-hero">
          <div>
            <p className="overview-hero__eyebrow">Susu management</p>
            <h1 className="overview-hero__title">Susu overview</h1>
            <p className="overview-hero__sub muted">Hello, {displayName}. Use the shortcuts below for your daily work.</p>
          </div>
        </header>
        <nav className="overview-quick-links" aria-label="Quick navigation">
          {quickLinks.map((link) => (
            <Link key={link.to} className="overview-quick-link" to={link.to}>
              <span>{link.label}</span>
              {link.hint ? <small>{link.hint}</small> : null}
            </Link>
          ))}
        </nav>
      </div>
    );
  }

  return (
    <div className="overview-page">
      <header className="overview-hero">
        <div>
          <p className="overview-hero__eyebrow">Susu management</p>
          <h1 className="overview-hero__title">Susu overview</h1>
          <p className="overview-hero__sub muted">
            {updatedLabel}
            {me?.tenantName ? ` · ${me.tenantName}` : ""}
          </p>
        </div>
        <button
          type="button"
          className="button secondary"
          disabled={coordLoading || perfLoading}
          onClick={() => {
            void coordRefresh().then(() => showToast("Overview refreshed", "success"));
          }}
        >
          {coordLoading ? "Refreshing…" : "Refresh"}
        </button>
      </header>

      {coordBranches.length > 0 && (isCoordinatorLike || isAdminLike || role === "accountant") ? (
        <label className="field overview-branch-filter">
          <span>Branch context (reports)</span>
          <select value={branchFilter} onChange={(e) => setBranchFilter(e.target.value)}>
            <option value="">All branches</option>
            {coordBranches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name} ({b.code})
              </option>
            ))}
          </select>
        </label>
      ) : null}

      {coordError ? (
        <p className="overview-error" role="alert">
          {coordError}
        </p>
      ) : null}

      <section className="kpi-grid overview-kpis" aria-label="Key metrics">
        {canApprove ? (
          <article className="kpi-card kpi-card--warn">
            <div className="kpi-card-head">
              <p className="kpi-label">Pending registrations</p>
              <span className="kpi-icon" aria-hidden>
                ◷
              </span>
            </div>
            <p className="kpi-value">{loading ? "…" : kpis.pendingRegistrations}</p>
            <Link className="kpi-link" to="/app/susu/pending-approvals">
              Review queue →
            </Link>
          </article>
        ) : null}
        {canApprove ? (
          <article className="kpi-card kpi-card--warning">
            <div className="kpi-card-head">
              <p className="kpi-label">Agent requests</p>
              <span className="kpi-icon" aria-hidden>
                ✉
              </span>
            </div>
            <p className="kpi-value">{loading ? "…" : kpis.pendingAgentRequests}</p>
            <p className="kpi-meta muted">
              {kpis.pendingWithdrawals} withdrawal · {kpis.pendingBalanceRequests} balance
            </p>
          </article>
        ) : null}
        <article className="kpi-card kpi-card--primary">
          <div className="kpi-card-head">
            <p className="kpi-label">Active customers</p>
            <span className="kpi-icon" aria-hidden>
              ◉
            </span>
          </div>
          <p className="kpi-value">{loading ? "…" : kpis.activeCustomers}</p>
          <p className="kpi-meta muted">{accountMix.total} active across all products</p>
          {(role === "admin" || role === "coordinator") && (
            <Link className="kpi-link" to="/app/susu/customers">
              Customer directory →
            </Link>
          )}
        </article>
        <article className="kpi-card kpi-card--success">
          <div className="kpi-card-head">
            <p className="kpi-label">Net collections</p>
            <span className="kpi-icon" aria-hidden>
              ₵
            </span>
          </div>
          <p className="kpi-value">{loading ? "…" : formatMoney(kpis.totalCollections)}</p>
          <p className="kpi-meta muted">{kpis.totalTransactions} ledger transactions</p>
        </article>
        {loadWithdrawals ? (
          <article className="kpi-card kpi-card--purple">
            <div className="kpi-card-head">
              <p className="kpi-label">Withdrawal pipeline</p>
              <span className="kpi-icon" aria-hidden>
                ↓
              </span>
            </div>
            <p className="kpi-value">{withdrawalKpis.pending}</p>
            <p className="kpi-meta muted">{formatMoney(withdrawalKpis.pendingAmount)} awaiting approval</p>
            <Link className="kpi-link" to="/app/susu/withdrawals">
              Open withdrawals →
            </Link>
          </article>
        ) : null}
        {loadGroupSavings ? (
          <article className="kpi-card">
            <div className="kpi-card-head">
              <p className="kpi-label">Group savings members</p>
              <span className="kpi-icon" aria-hidden>
                ⊕
              </span>
            </div>
            <p className="kpi-value">{groupTotals.activeMembers}</p>
            <p className="kpi-meta muted">
              {groupTotals.pendingMembers} pending · {formatMoney(groupTotals.totalDailyPlan)}/day planned
            </p>
            <Link className="kpi-link" to="/app/susu/group-savings">
              Group roster →
            </Link>
          </article>
        ) : null}
      </section>

      <nav className="overview-quick-links" aria-label="Quick navigation">
        {quickLinks.map((link) => (
          <Link key={link.to} className="overview-quick-link" to={link.to}>
            <span>{link.label}</span>
            {link.hint ? <small>{link.hint}</small> : null}
          </Link>
        ))}
      </nav>

      <div className="overview-grid">
        {summary ? (
          <section className="overview-panel">
            <h2 className="overview-panel__title">Collection breakdown</h2>
            <p className="overview-panel__lead muted">Ledger totals for the selected branch scope.</p>
            <div className="overview-bars">
              {collectionBars.map((bar) => (
                <div className="overview-bar-row" key={bar.key}>
                  <div className="overview-bar-row__head">
                    <span>{bar.label}</span>
                    <strong>{formatMoney(bar.value)}</strong>
                  </div>
                  <div className="overview-bar-track" aria-hidden>
                    <div
                      className={`overview-bar-fill overview-bar-fill--${bar.tone}`}
                      style={{ width: `${bar.pct}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        <section className="overview-panel">
          <h2 className="overview-panel__title">Customer mix</h2>
          <p className="overview-panel__lead muted">Active accounts by product type.</p>
          <ul className="overview-mix-list">
            {(["susu", "savings", "group", "meba_daakye"] as const).map((type) => {
              const count =
                type === "susu"
                  ? accountMix.susu
                  : type === "savings"
                    ? accountMix.savings
                    : type === "group"
                      ? accountMix.group
                      : accountMix.meba;
              const pct = accountMix.total > 0 ? Math.round((count / accountMix.total) * 100) : 0;
              return (
                <li className="overview-mix-item" key={type}>
                  <span>{ACCOUNT_LABELS[type] ?? type}</span>
                  <span className="overview-mix-item__stat">
                    <strong>{count}</strong>
                    <small className="muted">{pct}%</small>
                  </span>
                </li>
              );
            })}
          </ul>
        </section>

        <section className="overview-panel">
          <h2 className="overview-panel__title">Top field agents</h2>
          <p className="overview-panel__lead muted">By total collections on the ledger.</p>
          <ol className="overview-rank-list">
            {topAgents.length === 0 ? (
              <li className="overview-rank-empty muted">No agent collections yet.</li>
            ) : (
              topAgents.map((agent, index) => (
                <li className="overview-rank-item" key={agent.fieldAgentId}>
                  <span className="overview-rank-item__pos">{index + 1}</span>
                  <span className="overview-rank-item__name">{agentName(agent.fieldAgentId)}</span>
                  <strong>{formatMoney(agent.totalCollections)}</strong>
                </li>
              ))
            )}
          </ol>
          <Link className="overview-panel__footer-link" to="/app/susu/performance">
            Full performance rankings →
          </Link>
        </section>

        <section className="overview-panel">
          <h2 className="overview-panel__title">Branch activity</h2>
          <p className="overview-panel__lead muted">Transaction volume and value by branch.</p>
          <ol className="overview-rank-list">
            {topBranches.length === 0 ? (
              <li className="overview-rank-empty muted">No branch activity yet.</li>
            ) : (
              topBranches.map((branch, index) => (
                <li className="overview-rank-item" key={branch.branchId}>
                  <span className="overview-rank-item__pos">{index + 1}</span>
                  <span className="overview-rank-item__name">{branchName(branch.branchId)}</span>
                  <span className="overview-rank-item__meta">
                    <strong>{formatMoney(branch.totalAmount)}</strong>
                    <small className="muted">{branch.transactionCount} tx</small>
                  </span>
                </li>
              ))
            )}
          </ol>
        </section>

        {loadWithdrawals ? (
          <section className="overview-panel overview-panel--compact">
            <h2 className="overview-panel__title">Withdrawals snapshot</h2>
            <div className="overview-stat-rows">
              <div className="overview-stat-row">
                <span>Pending</span>
                <strong>{withdrawalKpis.pending}</strong>
              </div>
              <div className="overview-stat-row">
                <span>Approved</span>
                <strong>{withdrawalKpis.approved}</strong>
              </div>
              <div className="overview-stat-row">
                <span>Rejected</span>
                <strong>{withdrawalKpis.rejected}</strong>
              </div>
            </div>
          </section>
        ) : null}
      </div>

    </div>
  );
}
