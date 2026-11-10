import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useShallow } from "zustand/react/shallow";
import {
  hasAnyPermission,
  hasTenantModule,
  listSubscribedProductModules,
  MODULE_LABELS,
  type TenantProductModule
} from "@bms/shared";
import type { AppRole, AuthMe, BranchReport, SusuReversalHistoryItem } from "./api";
import { exportReportsCsv, getLoansBootstrap, listSusuReversals } from "./api";
import { useReportsAnalyticsLiveSync } from "./hooks/useReportsAnalyticsLiveSync";
import { useInvestmentsLiveSync } from "./hooks/useInvestmentsLiveSync";
import { selectAgentDisplayName, selectBranchDisplayName } from "./stores/performanceStore";
import { useReportsAnalyticsStore } from "./stores/reportsAnalyticsStore";
import { selectInvestmentKpis, useInvestmentStore } from "./stores/investmentStore";
import { useToast } from "../components/Toast";
import { toUserFacingError } from "../lib/networkError";
import { formatInvestmentMoney } from "./investments/investmentUi";

type Props = {
  role: AppRole;
  me: AuthMe | null;
};

type PeriodKey = "daily" | "weekly" | "monthly" | "yearly";

type QuickAction = {
  key: string;
  label: string;
  hint: string;
  to: string;
  tone: "green" | "purple" | "blue" | "orange" | "red" | "teal";
  module: TenantProductModule | "core";
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

function formatWhen(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  return date.toLocaleString();
}

function formatShortDate(iso: string): string {
  try {
    return new Date(iso + "T12:00:00").toLocaleDateString(undefined, {
      month: "short",
      day: "numeric"
    });
  } catch {
    return iso;
  }
}

function isoDaysAgo(days: number): string {
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() - days);
  return date.toISOString().slice(0, 10);
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function periodRange(period: PeriodKey): { fromDate: string; toDate: string } {
  const toDate = todayIso();
  if (period === "daily") {
    return { fromDate: toDate, toDate };
  }
  if (period === "weekly") {
    return { fromDate: isoDaysAgo(6), toDate };
  }
  if (period === "monthly") {
    return { fromDate: isoDaysAgo(29), toDate };
  }
  return { fromDate: isoDaysAgo(364), toDate };
}

function trendDelta(current: number, previous: number): { label: string; up: boolean } | null {
  if (previous === 0 && current === 0) {
    return null;
  }
  if (previous === 0) {
    return { label: "+100%", up: true };
  }
  const pct = ((current - previous) / Math.abs(previous)) * 100;
  const rounded = Math.round(pct * 10) / 10;
  return {
    label: `${rounded >= 0 ? "+" : ""}${rounded}%`,
    up: rounded >= 0
  };
}

const QUICK_ACTIONS: QuickAction[] = [
  {
    key: "customers",
    label: "Customers",
    hint: "Browse accounts",
    to: "/app/susu/customers",
    tone: "green",
    module: "susu_management"
  },
  {
    key: "callover",
    label: "Callover",
    hint: "Post collections",
    to: "/app/susu/callover-batches",
    tone: "green",
    module: "susu_management"
  },
  {
    key: "os",
    label: "Overages/Shortages",
    hint: "Cash variances",
    to: "/app/susu/overages-shortages",
    tone: "orange",
    module: "susu_management"
  },
  {
    key: "branch-counter",
    label: "Branch counter",
    hint: "Till & cash",
    to: "/app/susu/collections",
    tone: "blue",
    module: "susu_management"
  },
  {
    key: "teller",
    label: "Teller",
    hint: "Agency desk",
    to: "/app/banking/teller",
    tone: "purple",
    module: "banking"
  },
  {
    key: "withdrawals",
    label: "Withdrawals",
    hint: "Payout queue",
    to: "/app/banking/withdrawals",
    tone: "teal",
    module: "banking"
  },
  {
    key: "loans",
    label: "Loans",
    hint: "Portfolio",
    to: "/app/loans",
    tone: "blue",
    module: "loans_credit"
  },
  {
    key: "treasury",
    label: "Treasury",
    hint: "Liquidity",
    to: "/app/treasury",
    tone: "purple",
    module: "treasury"
  },
  {
    key: "investments",
    label: "Investments",
    hint: "Portfolio",
    to: "/app/investments/reports",
    tone: "orange",
    module: "investment_management"
  }
];

export function ReportsAnalyticsPage({ role, me }: Props) {
  const modules = me?.subscribedModules;
  const hasSusu = hasTenantModule(modules, "susu_management");
  const hasBanking = hasTenantModule(modules, "banking");
  const hasLoans = hasTenantModule(modules, "loans_credit");
  const hasTreasury = hasTenantModule(modules, "treasury");
  const hasInvestments = hasTenantModule(modules, "investment_management");
  const canInvestmentsRead = hasAnyPermission(me?.permissions, ["investments.read"]);
  const canLoansRead = hasAnyPermission(me?.permissions, ["loans.read"]);
  const canReportsRead = hasAnyPermission(me?.permissions, ["reports.read"]);
  const canLoad = me?.reportsAnalytics !== false && canReportsRead;

  useReportsAnalyticsLiveSync(canLoad);
  useInvestmentsLiveSync(hasInvestments && canInvestmentsRead && canLoad);

  const investmentKpis = useInvestmentStore(useShallow(selectInvestmentKpis));
  const { showToast } = useToast();
  const data = useReportsAnalyticsStore((s) => s.data);
  const loading = useReportsAnalyticsStore((s) => s.loading);
  const error = useReportsAnalyticsStore((s) => s.error);
  const branchFilter = useReportsAnalyticsStore((s) => s.branchFilter);
  const setBranchFilter = useReportsAnalyticsStore((s) => s.setBranchFilter);
  const fromDate = useReportsAnalyticsStore((s) => s.fromDate);
  const toDate = useReportsAnalyticsStore((s) => s.toDate);
  const setDateRange = useReportsAnalyticsStore((s) => s.setDateRange);
  const refresh = useReportsAnalyticsStore((s) => s.refresh);

  const [period, setPeriod] = useState<PeriodKey>("weekly");
  const [productFilter, setProductFilter] = useState<"all" | TenantProductModule>("all");
  const [loanSummary, setLoanSummary] = useState<{
    pendingApproval: number;
    disbursed: number;
    totalOutstanding: number;
    overdueInstallments: number;
  } | null>(null);
  const [reversalQuery, setReversalQuery] = useState("");
  const [reversals, setReversals] = useState<SusuReversalHistoryItem[]>([]);
  const [reversalsError, setReversalsError] = useState<string | null>(null);

  const branches = data?.branches ?? [];
  const summary = data?.summary;
  const agentNames = data?.agentNames ?? {};

  useEffect(() => {
    if (!hasLoans || !canLoansRead || !canLoad) {
      setLoanSummary(null);
      return;
    }
    let cancelled = false;
    void getLoansBootstrap()
      .then((boot) => {
        if (!cancelled) {
          setLoanSummary(boot.summary);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setLoanSummary(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [hasLoans, canLoansRead, canLoad]);

  useEffect(() => {
    if (!hasSusu || !canReportsRead) {
      return;
    }
    let cancelled = false;
    void listSusuReversals(branchFilter || undefined)
      .then((rows) => {
        if (!cancelled) {
          setReversals(rows);
          setReversalsError(null);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setReversals([]);
          setReversalsError(toUserFacingError(err, "Could not load reversal history"));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [hasSusu, canReportsRead, branchFilter]);

  const netCollections = useMemo(() => {
    if (!summary) {
      return 0;
    }
    return Math.max(0, summary.totalDeposits + summary.totalDailySusu - summary.totalWithdrawals);
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

  const periodDelta = useMemo(() => {
    const trend = data?.dailyTrend ?? [];
    if (trend.length < 4) {
      return null;
    }
    const mid = Math.floor(trend.length / 2);
    const first = trend.slice(0, mid).reduce((s, d) => s + d.net, 0);
    const second = trend.slice(mid).reduce((s, d) => s + d.net, 0);
    return trendDelta(second, first);
  }, [data?.dailyTrend]);

  const agentChart = useMemo(() => {
    const agents = data?.agents.slice(0, 5) ?? [];
    return agents.map((a) => ({
      id: a.fieldAgentId,
      name: selectAgentDisplayName(a.fieldAgentId, agentNames),
      value: a.totalCollections,
      susu: a.dailySusuCount,
      deposits: a.depositCount,
      withdrawals: a.withdrawalCount
    }));
  }, [data?.agents, agentNames]);

  const branchChart = useMemo(() => {
    const rows = data?.branchReports ?? [];
    return rows.map((b: BranchReport) => ({
      id: b.branchId,
      name: selectBranchDisplayName(b.branchId, branches),
      total: b.totalAmount,
      deposits: b.depositAmount ?? 0,
      withdrawals: b.withdrawalAmount ?? 0,
      susu: b.dailySusuAmount ?? 0,
      tx: b.transactionCount
    }));
  }, [data?.branchReports, branches]);

  const filteredReversals = useMemo(() => {
    const query = reversalQuery.trim().toLowerCase();
    if (!query) {
      return reversals.slice(0, 8);
    }
    return reversals
      .filter((row) =>
        [
          row.customerName,
          row.accountNumber,
          row.reversalReference,
          row.originalTransactionId,
          row.reason,
          row.postedByName,
          row.reversedByName
        ]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(query))
      )
      .slice(0, 8);
  }, [reversals, reversalQuery]);

  const canExport = role === "admin" || role === "accountant" || role === "auditor";
  const canFilterBranch =
    role === "admin" || role === "accountant" || role === "auditor" || role === "coordinator";

  const subscribed = useMemo(() => listSubscribedProductModules(modules), [modules]);

  const showSusu = hasSusu && (productFilter === "all" || productFilter === "susu_management");
  const showBanking = hasBanking && (productFilter === "all" || productFilter === "banking");
  const showLoans = hasLoans && (productFilter === "all" || productFilter === "loans_credit");
  const showTreasury = hasTreasury && (productFilter === "all" || productFilter === "treasury");
  const showInvestments =
    hasInvestments &&
    canInvestmentsRead &&
    (productFilter === "all" || productFilter === "investment_management");

  const quickActions = useMemo(
    () =>
      QUICK_ACTIONS.filter((action) => {
        if (action.module === "core") {
          return productFilter === "all";
        }
        if (!hasTenantModule(modules, action.module)) {
          return false;
        }
        return productFilter === "all" || productFilter === action.module;
      }),
    [modules, productFilter]
  );

  function applyPeriod(next: PeriodKey) {
    setPeriod(next);
    setDateRange(periodRange(next));
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
    <div className="analytics-dash">
      <header className="analytics-dash__hero">
        <div>
          <p className="analytics-dash__eyebrow">Analysis</p>
          <h1>Reports &amp; Analytics</h1>
          <p className="muted">
            Live insights for your subscribed products
            {me?.tenantName ? ` · ${me.tenantName}` : ""}.
          </p>
        </div>
        <div className="analytics-dash__hero-actions">
          <div className="analytics-period" role="group" aria-label="Report period">
            {(
              [
                ["daily", "Daily"],
                ["weekly", "Weekly"],
                ["monthly", "Monthly"],
                ["yearly", "Yearly"]
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                className={`analytics-period__btn${period === key ? " is-active" : ""}`}
                onClick={() => applyPeriod(key)}
              >
                {label}
              </button>
            ))}
          </div>
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

      <div className="analytics-dash__modules" role="group" aria-label="Filter by product">
        <button
          type="button"
          className={`analytics-dash__module-chip${productFilter === "all" ? " is-active" : ""}`}
          onClick={() => setProductFilter("all")}
        >
          All products
        </button>
        {subscribed.map((m) => (
          <button
            key={m}
            type="button"
            className={`analytics-dash__module-chip${productFilter === m ? " is-active" : ""}`}
            onClick={() => setProductFilter(m)}
          >
            {MODULE_LABELS[m]}
          </button>
        ))}
      </div>

      {quickActions.length > 0 ? (
        <section className="analytics-actions" aria-label="Quick actions">
          {quickActions.map((action) => (
            <Link
              key={action.key}
              to={action.to}
              className={`analytics-action analytics-action--${action.tone}`}
            >
              <span className="analytics-action__icon" aria-hidden>
                ◆
              </span>
              <span className="analytics-action__copy">
                <strong>{action.label}</strong>
                <small>{action.hint}</small>
              </span>
            </Link>
          ))}
        </section>
      ) : null}

      <div className="analytics-dash__filters">
        {canFilterBranch && branches.length > 0 ? (
          <label className="field">
            <span>Branch</span>
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
        <label className="field">
          <span>From</span>
          <input
            type="date"
            value={fromDate}
            max={toDate || undefined}
            onChange={(e) => setDateRange({ fromDate: e.target.value })}
          />
        </label>
        <label className="field">
          <span>To</span>
          <input
            type="date"
            value={toDate}
            min={fromDate || undefined}
            onChange={(e) => setDateRange({ toDate: e.target.value })}
          />
        </label>
      </div>

      {error ? <p className="overview-error">{error}</p> : null}

      <section className="analytics-kpis" aria-label="Key metrics">
        {showSusu ? (
          <>
            <article className="analytics-kpi">
              <p className="analytics-kpi__label">Net collections</p>
              <p className="analytics-kpi__value">
                {loading && !data ? "…" : formatMoney(netCollections)}
              </p>
              {periodDelta ? (
                <p className={`analytics-kpi__trend${periodDelta.up ? " is-up" : " is-down"}`}>
                  {periodDelta.label} vs prior half of range
                </p>
              ) : (
                <p className="analytics-kpi__meta">Deposits + Susu − withdrawals</p>
              )}
            </article>
            <article className="analytics-kpi">
              <p className="analytics-kpi__label">Active customers</p>
              <p className="analytics-kpi__value">
                {loading && !data ? "…" : data?.accountMix.totalActive ?? 0}
              </p>
              <p className="analytics-kpi__meta">
                {data?.accountMix.pending ?? 0} pending activation
              </p>
            </article>
            <article className="analytics-kpi">
              <p className="analytics-kpi__label">Transactions</p>
              <p className="analytics-kpi__value">
                {loading && !data ? "…" : summary?.totalTransactions ?? 0}
              </p>
              <p className="analytics-kpi__meta">In selected dates</p>
            </article>
            <article className="analytics-kpi">
              <p className="analytics-kpi__label">Pending registrations</p>
              <p className="analytics-kpi__value">{data?.pending.registrations ?? 0}</p>
              <Link className="analytics-kpi__link" to="/app/susu/pending-approvals">
                Review →
              </Link>
            </article>
            <article className="analytics-kpi">
              <p className="analytics-kpi__label">Withdrawals pending</p>
              <p className="analytics-kpi__value">{data?.withdrawals.pending ?? 0}</p>
              <p className="analytics-kpi__meta">
                {formatMoney(data?.withdrawals.pendingAmount ?? 0)}
              </p>
            </article>
            <article className="analytics-kpi">
              <p className="analytics-kpi__label">Agent requests</p>
              <p className="analytics-kpi__value">{data?.pending.agentRequests ?? 0}</p>
              <p className="analytics-kpi__meta">
                {data?.pending.withdrawals ?? 0} w/d · {data?.pending.balanceInquiries ?? 0} balance
              </p>
            </article>
          </>
        ) : null}

        {showBanking ? (
          <article className="analytics-kpi">
            <p className="analytics-kpi__label">Agency banking</p>
            <p className="analytics-kpi__value">Active</p>
            <Link className="analytics-kpi__link" to="/app/banking/teller">
              Open teller →
            </Link>
          </article>
        ) : null}

        {showLoans && loanSummary ? (
          <>
            <article className="analytics-kpi">
              <p className="analytics-kpi__label">Loan outstanding</p>
              <p className="analytics-kpi__value">{formatMoney(loanSummary.totalOutstanding)}</p>
              <p className="analytics-kpi__meta">{loanSummary.disbursed} disbursed</p>
            </article>
            <article className="analytics-kpi">
              <p className="analytics-kpi__label">Loan approvals</p>
              <p className="analytics-kpi__value">{loanSummary.pendingApproval}</p>
              <p className="analytics-kpi__meta">{loanSummary.overdueInstallments} overdue</p>
            </article>
          </>
        ) : null}

        {showInvestments ? (
          <>
            <article className="analytics-kpi">
              <p className="analytics-kpi__label">Active investments</p>
              <p className="analytics-kpi__value">{investmentKpis.active}</p>
              <p className="analytics-kpi__meta">{investmentKpis.matured} matured</p>
            </article>
            <article className="analytics-kpi">
              <p className="analytics-kpi__label">Portfolio principal</p>
              <p className="analytics-kpi__value">
                {formatInvestmentMoney(investmentKpis.totalPrincipal)}
              </p>
              <Link className="analytics-kpi__link" to="/app/investments/reports">
                Investment reports →
              </Link>
            </article>
          </>
        ) : null}

        {showTreasury ? (
          <article className="analytics-kpi">
            <p className="analytics-kpi__label">Treasury</p>
            <p className="analytics-kpi__value">Subscribed</p>
            <Link className="analytics-kpi__link" to="/app/treasury">
              Open treasury →
            </Link>
          </article>
        ) : null}
      </section>

      {showSusu ? (
        <>
          <div className="analytics-mid">
            <section className="analytics-panel analytics-panel--chart">
              <div className="analytics-panel__head">
                <div>
                  <h2>Collections overview</h2>
                  <p className="muted">Net collections by day in the selected range</p>
                </div>
              </div>
              {trendChart.length === 0 ? (
                <p className="muted">{loading ? "Loading…" : "No trend data yet."}</p>
              ) : (
                <div className="analytics-trend" role="img" aria-label="Collections trend">
                  {trendChart.map((day) => (
                    <div className="analytics-trend__col" key={day.date}>
                      <div className="analytics-trend__bar-wrap">
                        <div
                          className={`analytics-trend__bar${day.positive ? "" : " is-neg"}`}
                          style={{ height: `${Math.max(day.heightPct, 4)}%` }}
                          title={`${day.label}: ${formatMoney(day.net)}`}
                        />
                      </div>
                      <span>{day.label}</span>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className="analytics-panel">
              <div className="analytics-panel__head">
                <h2>Top agents</h2>
                <p className="muted">Last 5 by collections</p>
              </div>
              {agentChart.length === 0 ? (
                <p className="muted">No agent activity in this range.</p>
              ) : (
                <ul className="analytics-list">
                  {agentChart.map((row) => (
                    <li key={row.id}>
                      <div>
                        <strong>{row.name}</strong>
                        <small className="muted">
                          {row.susu} Susu · {row.deposits} dep · {row.withdrawals} w/d
                        </small>
                      </div>
                      <span className="analytics-list__amt">{formatMoney(row.value)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="analytics-panel">
              <div className="analytics-panel__head">
                <h2>Pipeline</h2>
                <p className="muted">Approvals & payouts</p>
              </div>
              <div className="analytics-pipeline">
                <div>
                  <span className="muted">Registrations</span>
                  <strong>{data?.pending.registrations ?? 0}</strong>
                </div>
                <div>
                  <span className="muted">W/D pending</span>
                  <strong>{data?.withdrawals.pending ?? 0}</strong>
                </div>
                <div>
                  <span className="muted">W/D approved</span>
                  <strong>{data?.withdrawals.approved ?? 0}</strong>
                </div>
                <div>
                  <span className="muted">Balance asks</span>
                  <strong>{data?.pending.balanceInquiries ?? 0}</strong>
                </div>
              </div>
            </section>
          </div>

          <section className="analytics-panel analytics-panel--wide">
            <div className="analytics-panel__head">
              <div>
                <h2>Branch performance</h2>
                <p className="muted">Deposits, Susu, and withdrawals by branch</p>
              </div>
            </div>
            {branchChart.length === 0 ? (
              <p className="muted">No branch activity yet.</p>
            ) : (
              <div className="admin-table-scroll">
                <table className="analytics-table">
                  <thead>
                    <tr>
                      <th>Branch</th>
                      <th>Transactions</th>
                      <th>Deposits</th>
                      <th>Susu</th>
                      <th>Withdrawals</th>
                      <th>Total</th>
                      <th>Mix</th>
                    </tr>
                  </thead>
                  <tbody>
                    {branchChart.map((row) => {
                      const mixTotal = row.deposits + row.susu + row.withdrawals || 1;
                      return (
                        <tr key={row.id}>
                          <td>
                            <strong>{row.name}</strong>
                          </td>
                          <td>{row.tx}</td>
                          <td>{formatMoney(row.deposits)}</td>
                          <td>{formatMoney(row.susu)}</td>
                          <td>{formatMoney(row.withdrawals)}</td>
                          <td>
                            <strong>{formatMoney(row.total)}</strong>
                          </td>
                          <td className="analytics-table__mix">
                            <div className="analytics-mix-bar">
                              <span
                                className="is-dep"
                                style={{ width: `${barPct(row.deposits, mixTotal)}%` }}
                              />
                              <span
                                className="is-susu"
                                style={{ width: `${barPct(row.susu, mixTotal)}%` }}
                              />
                              <span
                                className="is-wd"
                                style={{ width: `${barPct(row.withdrawals, mixTotal)}%` }}
                              />
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="analytics-panel analytics-panel--wide">
            <div className="analytics-panel__head">
              <div>
                <h2>Susu reversal history</h2>
                <p className="muted">Recent reversed collections</p>
              </div>
              <label className="field analytics-panel__search">
                <span className="sr-only">Filter reversals</span>
                <input
                  value={reversalQuery}
                  onChange={(event) => setReversalQuery(event.target.value)}
                  placeholder="Search customer, account, reason…"
                />
              </label>
            </div>
            {reversalsError ? <p className="overview-error">{reversalsError}</p> : null}
            {filteredReversals.length === 0 ? (
              <p className="muted">No reversed susu collections match this filter.</p>
            ) : (
              <div className="admin-table-scroll">
                <table className="analytics-table">
                  <thead>
                    <tr>
                      <th>Reversed</th>
                      <th>Customer</th>
                      <th>Amount</th>
                      <th>Reason</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredReversals.map((row) => (
                      <tr key={row.reversalTransactionId}>
                        <td>{formatWhen(row.reversedAt)}</td>
                        <td>
                          <strong>{row.customerName}</strong>
                          <div className="muted">{row.accountNumber ?? "—"}</div>
                        </td>
                        <td>{formatMoney(row.amount)}</td>
                        <td>{row.reason}</td>
                        <td>
                          <span className="analytics-badge analytics-badge--ok">Reversed</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      ) : subscribed.length > 0 ? (
        <p className="muted">
          Product summaries above reflect your subscription. Susu charts appear when Susu Management is
          enabled.
        </p>
      ) : (
        <p className="muted">Subscribe to a product module to unlock analytics.</p>
      )}
    </div>
  );
}
