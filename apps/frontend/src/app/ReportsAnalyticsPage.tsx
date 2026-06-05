import { useMemo } from "react";
import { Link } from "react-router-dom";
import { hasTenantModule, MODULE_LABELS, type TenantProductModule } from "@bms/shared";
import type { AppRole, AuthMe, BranchReport } from "./api";
import { exportReportsCsv } from "./api";
import { useReportsAnalyticsLiveSync } from "./hooks/useReportsAnalyticsLiveSync";
import { selectAgentDisplayName, selectBranchDisplayName } from "./stores/performanceStore";
import { useReportsAnalyticsStore } from "./stores/reportsAnalyticsStore";
import { useToast } from "../components/Toast";
import { toUserFacingError } from "../lib/networkError";

type Props = {
  role: AppRole;
  me: AuthMe | null;
};

function formatMoney(amount: number): string {
  return `GHS ${amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function barPct(value: number, max: number): number {
  if (max <= 0) {
    return 0;
  }
  return Math.round((value / max) * 100);
}

function formatShortDate(iso: string): string {
  try {
    return new Date(iso + "T12:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" });
  } catch {
    return iso;
  }
}

export function ReportsAnalyticsPage({ role, me }: Props) {
  const modules = me?.subscribedModules;
  const hasSusu = hasTenantModule(modules, "susu_management");
  const canLoad = hasSusu && me?.reportsAnalytics !== false;

  useReportsAnalyticsLiveSync(canLoad);

  const { showToast } = useToast();
  const data = useReportsAnalyticsStore((s) => s.data);
  const loading = useReportsAnalyticsStore((s) => s.loading);
  const error = useReportsAnalyticsStore((s) => s.error);
  const branchFilter = useReportsAnalyticsStore((s) => s.branchFilter);
  const setBranchFilter = useReportsAnalyticsStore((s) => s.setBranchFilter);
  const refresh = useReportsAnalyticsStore((s) => s.refresh);

  const branches = data?.branches ?? [];
  const summary = data?.summary;
  const agentNames = data?.agentNames ?? {};

  const netCollections = useMemo(() => {
    if (!summary) {
      return 0;
    }
    return Math.max(0, summary.totalDeposits + summary.totalDailySusu - summary.totalWithdrawals);
  }, [summary]);

  const collectionBars = useMemo(() => {
    if (!summary) {
      return [];
    }
    const items = [
      { key: "susu", label: "Daily Susu", value: summary.totalDailySusu, tone: "primary" as const },
      { key: "dep", label: "Deposits", value: summary.totalDeposits, tone: "success" as const },
      { key: "wd", label: "Withdrawals", value: summary.totalWithdrawals, tone: "warn" as const }
    ];
    const max = Math.max(...items.map((i) => i.value), 1);
    return items.map((i) => ({ ...i, pct: barPct(i.value, max) }));
  }, [summary]);

  const trendChart = useMemo(() => {
    const trend = data?.dailyTrend ?? [];
    const maxNet = Math.max(...trend.map((d) => Math.abs(d.net)), 1);
    return trend.map((d) => ({
      ...d,
      label: formatShortDate(d.date),
      heightPct: barPct(Math.abs(d.net), maxNet),
      positive: d.net >= 0
    }));
  }, [data?.dailyTrend]);

  const accountSegments = useMemo(() => {
    const mix = data?.accountMix;
    if (!mix) {
      return [];
    }
    const total = mix.totalActive || 1;
    return [
      { key: "susu", label: "Daily Susu", count: mix.susu, pct: Math.round((mix.susu / total) * 100), tone: "primary" },
      { key: "savings", label: "Savings", count: mix.savings, pct: Math.round((mix.savings / total) * 100), tone: "success" },
      { key: "group", label: "Group", count: mix.group, pct: Math.round((mix.group / total) * 100), tone: "purple" },
      { key: "meba", label: "Meba Daakye", count: mix.meba_daakye, pct: Math.round((mix.meba_daakye / total) * 100), tone: "warn" }
    ].filter((s) => s.count > 0);
  }, [data?.accountMix]);

  const agentChart = useMemo(() => {
    const agents = data?.agents.slice(0, 8) ?? [];
    const max = Math.max(...agents.map((a) => a.totalCollections), 1);
    return agents.map((a) => ({
      id: a.fieldAgentId,
      name: selectAgentDisplayName(a.fieldAgentId, agentNames),
      value: a.totalCollections,
      susu: a.dailySusuCount,
      deposits: a.depositCount,
      withdrawals: a.withdrawalCount,
      pct: barPct(a.totalCollections, max)
    }));
  }, [data?.agents, agentNames]);

  const branchChart = useMemo(() => {
    const rows = data?.branchReports ?? [];
    const max = Math.max(...rows.map((b) => b.totalAmount), 1);
    return rows.map((b: BranchReport) => ({
      id: b.branchId,
      name: selectBranchDisplayName(b.branchId, branches),
      total: b.totalAmount,
      deposits: b.depositAmount ?? 0,
      withdrawals: b.withdrawalAmount ?? 0,
      susu: b.dailySusuAmount ?? 0,
      tx: b.transactionCount,
      pct: barPct(b.totalAmount, max)
    }));
  }, [data?.branchReports, branches]);

  const canExport = role === "admin" || role === "accountant" || role === "auditor";
  const canFilterBranch =
    role === "admin" || role === "accountant" || role === "auditor" || role === "coordinator";

  const subscribed: TenantProductModule[] = [];
  if (hasSusu) {
    subscribed.push("susu_management");
  }
  if (hasTenantModule(modules, "banking")) {
    subscribed.push("banking");
  }
  if (hasTenantModule(modules, "loans_credit")) {
    subscribed.push("loans_credit");
  }
  if (hasTenantModule(modules, "treasury")) {
    subscribed.push("treasury");
  }

  async function handleExportCsv() {
    try {
      const csv = await exportReportsCsv(branchFilter || undefined);
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.setAttribute("download", "reports.csv");
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      showToast("Reports CSV downloaded", "success");
    } catch (err) {
      showToast(toUserFacingError(err, "Failed to export reports"), "error");
    }
  }

  if (me?.reportsAnalytics === false) {
    return (
      <article className="card">
        <h2>Reports &amp; Analytics</h2>
        <p className="muted">
          Analytics is not included on your company subscription. Contact platform support to enable
          Reports &amp; Analytics.
        </p>
      </article>
    );
  }

  return (
    <div className="reports-page">
      <header className="overview-hero">
        <div>
          <p className="overview-hero__eyebrow">Insights</p>
          <h1 className="overview-hero__title">Reports &amp; Analytics</h1>
          <p className="overview-hero__sub muted">
            14-day trends, collections, branches, agents, and operational pipeline
            {me?.tenantName ? ` · ${me.tenantName}` : ""}.
          </p>
        </div>
        <div className="reports-hero-actions">
          <button
            type="button"
            className="button secondary"
            disabled={loading}
            onClick={() => void refresh().then(() => showToast("Reports refreshed", "success"))}
          >
            {loading ? "Refreshing…" : "Refresh"}
          </button>
          {canExport ? (
            <button type="button" className="button secondary" onClick={() => void handleExportCsv()}>
              Export CSV
            </button>
          ) : null}
        </div>
      </header>

      <div className="reports-modules" aria-label="Subscribed products">
        {subscribed.map((m) => (
          <span key={m} className="reports-module-chip">
            {MODULE_LABELS[m]}
          </span>
        ))}
      </div>

      {canFilterBranch && branches.length > 0 ? (
        <label className="field overview-branch-filter">
          <span>Branch filter</span>
          <select value={branchFilter} onChange={(e) => setBranchFilter(e.target.value)}>
            <option value="">All branches</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name} ({b.code})
              </option>
            ))}
          </select>
        </label>
      ) : null}

      {error ? <p className="overview-error">{error}</p> : null}

      {hasSusu && canLoad ? (
        <>
          <section className="kpi-grid reports-kpis">
            <article className="kpi-card kpi-card--primary">
              <p className="kpi-label">Transactions (all time)</p>
              <p className="kpi-value">{loading && !data ? "…" : summary?.totalTransactions ?? 0}</p>
            </article>
            <article className="kpi-card kpi-card--success">
              <p className="kpi-label">Net collections</p>
              <p className="kpi-value">{loading && !data ? "…" : formatMoney(netCollections)}</p>
            </article>
            <article className="kpi-card">
              <p className="kpi-label">Active customers</p>
              <p className="kpi-value">{loading && !data ? "…" : data?.accountMix.totalActive ?? 0}</p>
            </article>
            <article className="kpi-card kpi-card--warn">
              <p className="kpi-label">Pending registrations</p>
              <p className="kpi-value">{data?.pending.registrations ?? 0}</p>
              <Link className="kpi-link" to="/app/susu/pending-approvals">
                Review →
              </Link>
            </article>
            <article className="kpi-card kpi-card--purple">
              <p className="kpi-label">Withdrawals pending</p>
              <p className="kpi-value">{data?.withdrawals.pending ?? 0}</p>
              <p className="kpi-meta muted">{formatMoney(data?.withdrawals.pendingAmount ?? 0)}</p>
            </article>
            <article className="kpi-card">
              <p className="kpi-label">Agent requests</p>
              <p className="kpi-value">{data?.pending.agentRequests ?? 0}</p>
              <p className="kpi-meta muted">
                {data?.pending.withdrawals ?? 0} withdrawal · {data?.pending.balanceInquiries ?? 0} balance
              </p>
            </article>
          </section>

          <section className="overview-panel reports-panel--wide">
            <h2 className="overview-panel__title">14-day net collections trend</h2>
            <p className="overview-panel__lead muted">Daily net (deposits + Susu − withdrawals) by calendar day.</p>
            {trendChart.length === 0 ? (
              <p className="muted">{loading ? "Loading…" : "No trend data yet."}</p>
            ) : (
              <div className="reports-trend-chart" role="img" aria-label="14 day net collections trend">
                {trendChart.map((day) => (
                  <div className="reports-trend-col" key={day.date}>
                    <div className="reports-trend-col__bar-wrap">
                      <div
                        className={`reports-trend-col__bar${day.positive ? "" : " reports-trend-col__bar--neg"}`}
                        style={{ height: `${Math.max(day.heightPct, 4)}%` }}
                        title={`${day.label}: ${formatMoney(day.net)}`}
                      />
                    </div>
                    <span className="reports-trend-col__label">{day.label}</span>
                  </div>
                ))}
              </div>
            )}
          </section>

          <div className="overview-grid reports-charts-grid">
            <section className="overview-panel">
              <h2 className="overview-panel__title">Collection mix</h2>
              <div className="overview-bars">
                {collectionBars.map((bar) => (
                  <div className="overview-bar-row" key={bar.key}>
                    <div className="overview-bar-row__head">
                      <span>{bar.label}</span>
                      <strong>{formatMoney(bar.value)}</strong>
                    </div>
                    <div className="overview-bar-track">
                      <div
                        className={`overview-bar-fill overview-bar-fill--${bar.tone}`}
                        style={{ width: `${bar.pct}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <section className="overview-panel">
              <h2 className="overview-panel__title">Customer mix</h2>
              <p className="overview-panel__lead muted">
                {data?.accountMix.pending ?? 0} pending activation
              </p>
              {accountSegments.length === 0 ? (
                <p className="muted">No active customers.</p>
              ) : (
                <>
                  <div className="reports-donut" aria-hidden>
                    {accountSegments.map((seg) => (
                      <div
                        key={seg.key}
                        className={`reports-donut__seg reports-donut__seg--${seg.tone}`}
                        style={{ flexGrow: seg.count }}
                      />
                    ))}
                  </div>
                  <ul className="overview-mix-list">
                    {accountSegments.map((seg) => (
                      <li className="overview-mix-item" key={seg.key}>
                        <span>{seg.label}</span>
                        <span className="overview-mix-item__stat">
                          <strong>{seg.count}</strong>
                          <small className="muted">{seg.pct}%</small>
                        </span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </section>

            <section className="overview-panel">
              <h2 className="overview-panel__title">Withdrawal pipeline</h2>
              <div className="reports-stat-grid">
                <div>
                  <span className="muted">Pending</span>
                  <strong>{data?.withdrawals.pending ?? 0}</strong>
                </div>
                <div>
                  <span className="muted">Approved</span>
                  <strong>{data?.withdrawals.approved ?? 0}</strong>
                </div>
                <div>
                  <span className="muted">Rejected</span>
                  <strong>{data?.withdrawals.rejected ?? 0}</strong>
                </div>
                <div>
                  <span className="muted">Pending amount</span>
                  <strong>{formatMoney(data?.withdrawals.pendingAmount ?? 0)}</strong>
                </div>
              </div>
            </section>

            <section className="overview-panel">
              <h2 className="overview-panel__title">Top field agents</h2>
              {agentChart.map((row) => (
                <div className="overview-bar-row" key={row.id}>
                  <div className="overview-bar-row__head">
                    <span>{row.name}</span>
                    <strong>{formatMoney(row.value)}</strong>
                  </div>
                  <div className="overview-bar-track">
                    <div className="overview-bar-fill overview-bar-fill--primary" style={{ width: `${row.pct}%` }} />
                  </div>
                  <p className="reports-agent-meta muted">
                    {row.susu} Susu · {row.deposits} dep · {row.withdrawals} w/d
                  </p>
                </div>
              ))}
            </section>

            <section className="overview-panel reports-panel--wide">
              <h2 className="overview-panel__title">Branch performance (deposits vs withdrawals)</h2>
              {branchChart.map((row) => (
                <div className="reports-branch-row" key={row.id}>
                  <div className="reports-branch-row__head">
                    <span>{row.name}</span>
                    <strong>{formatMoney(row.total)}</strong>
                    <small className="muted">{row.tx} transactions</small>
                  </div>
                  <div className="reports-branch-stack">
                    <div
                      className="reports-branch-stack__dep"
                      style={{
                        width: `${barPct(row.deposits, row.deposits + row.withdrawals + row.susu)}%`
                      }}
                      title={`Deposits ${formatMoney(row.deposits)}`}
                    />
                    <div
                      className="reports-branch-stack__susu"
                      style={{ width: `${barPct(row.susu, row.deposits + row.withdrawals + row.susu)}%` }}
                      title={`Susu ${formatMoney(row.susu)}`}
                    />
                    <div
                      className="reports-branch-stack__wd"
                      style={{
                        width: `${barPct(row.withdrawals, row.deposits + row.withdrawals + row.susu)}%`
                      }}
                      title={`Withdrawals ${formatMoney(row.withdrawals)}`}
                    />
                  </div>
                </div>
              ))}
            </section>
          </div>

          <p className="muted reports-footnote">
            Branch counter till float and EOD balancing live under{" "}
            <Link to="/app/susu/collections">Susu → Branch counter</Link>. Field agents collect in the
            field without a branch till float.
          </p>
        </>
      ) : (
        <p className="muted">Subscribe to Susu Management to unlock analytics charts.</p>
      )}
    </div>
  );
}
