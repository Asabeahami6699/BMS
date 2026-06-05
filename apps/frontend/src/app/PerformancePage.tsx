import { useMemo } from "react";
import type { AppRole } from "./api";
import { usePerformanceLiveSync } from "./hooks/usePerformanceLiveSync";
import {
  selectAgentDisplayName,
  selectBranchDisplayName,
  usePerformanceStore
} from "./stores/performanceStore";
import { useToast } from "../components/Toast";

type Props = { role: AppRole };

function formatMoney(amount: number): string {
  return `GHS ${amount.toFixed(2)}`;
}

export function PerformancePage({ role: _role }: Props) {
  usePerformanceLiveSync();
  const { showToast } = useToast();

  const summary = usePerformanceStore((s) => s.summary);
  const agents = usePerformanceStore((s) => s.agents);
  const branchReports = usePerformanceStore((s) => s.branchReports);
  const branches = usePerformanceStore((s) => s.branches);
  const agentNames = usePerformanceStore((s) => s.agentNames);
  const loading = usePerformanceStore((s) => s.loading);
  const error = usePerformanceStore((s) => s.error);
  const lastFetchedAt = usePerformanceStore((s) => s.lastFetchedAt);
  const branchFilter = usePerformanceStore((s) => s.branchFilter);
  const setBranchFilter = usePerformanceStore((s) => s.setBranchFilter);
  const refresh = usePerformanceStore((s) => s.refresh);

  const netCollections = useMemo(() => {
    if (!summary) {
      return 0;
    }
    return Math.max(
      0,
      summary.totalDeposits + summary.totalDailySusu - summary.totalWithdrawals
    );
  }, [summary]);

  const updatedLabel = lastFetchedAt
    ? `Updated ${new Date(lastFetchedAt).toLocaleTimeString()}`
    : "Loading…";

  const canFilterBranch =
    _role === "admin" || _role === "coordinator" || _role === "accountant";

  return (
    <div className="agents-page">
      <header className="agents-page__header">
        <div>
          <h2>Susu performance</h2>
          <p className="muted">
            Collections, withdrawals, and rankings by agent and branch. {updatedLabel}
            {error ? ` · ${error}` : ""}
          </p>
        </div>
        <button
          type="button"
          className="button secondary"
          disabled={loading}
          onClick={() => {
            void refresh().then(() => showToast("Performance refreshed", "success"));
          }}
        >
          {loading ? "…" : "↻"}
        </button>
      </header>

      {canFilterBranch && branches.length > 0 ? (
        <label className="field agents-page__branch-filter">
          <span>Filter by branch</span>
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

      <div className="kpi-grid agents-page__kpis">
        <article className="kpi-card kpi-card--primary">
          <p className="kpi-value">{summary?.totalTransactions ?? (loading ? "…" : 0)}</p>
          <span className="kpi-label">Transactions</span>
        </article>
        <article className="kpi-card kpi-card--success">
          <p className="kpi-value">
            {summary ? formatMoney(netCollections) : loading ? "…" : formatMoney(0)}
          </p>
          <span className="kpi-label">Net collections</span>
        </article>
        <article className="kpi-card">
          <p className="kpi-value">
            {summary ? formatMoney(summary.totalWithdrawals) : loading ? "…" : "—"}
          </p>
          <span className="kpi-label">Withdrawals</span>
        </article>
        <article className="kpi-card kpi-card--warning">
          <p className="kpi-value">
            {summary ? formatMoney(summary.totalDailySusu) : loading ? "…" : "—"}
          </p>
          <span className="kpi-label">Daily Susu</span>
        </article>
      </div>

      <div className="performance-panels">
        <section className="card">
          <h3>Top agents</h3>
          <p className="muted">Ranked by total collection amount.</p>
          {agents.length === 0 ? (
            <p className="muted">{loading ? "Loading…" : "No agent activity yet."}</p>
          ) : (
            <div className="lines">
              {agents.slice(0, 12).map((agent, index) => (
                <div className="line performance-line" key={agent.fieldAgentId}>
                  <span>
                    <strong>#{index + 1}</strong>{" "}
                    {selectAgentDisplayName(agent.fieldAgentId, agentNames)}
                  </span>
                  <small>
                    {formatMoney(agent.totalCollections)} · {agent.dailySusuCount} susu ·{" "}
                    {agent.withdrawalCount} wd
                  </small>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="card">
          <h3>Branch activity</h3>
          <p className="muted">Transaction volume by home branch.</p>
          {branchReports.length === 0 ? (
            <p className="muted">{loading ? "Loading…" : "No branch activity yet."}</p>
          ) : (
            <div className="lines">
              {branchReports.slice(0, 12).map((branch) => (
                <div className="line performance-line" key={branch.branchId}>
                  <span>{selectBranchDisplayName(branch.branchId, branches)}</span>
                  <small>
                    {branch.transactionCount} tx · {formatMoney(branch.totalAmount)} · wd{" "}
                    {formatMoney(branch.withdrawalAmount)}
                  </small>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      {summary ? (
        <section className="card">
          <h3>Ledger summary</h3>
          <div className="lines">
            <div className="line">
              <span>Deposits</span>
              <strong>{formatMoney(summary.totalDeposits)}</strong>
            </div>
            <div className="line">
              <span>Withdrawals</span>
              <strong>{formatMoney(summary.totalWithdrawals)}</strong>
            </div>
            <div className="line">
              <span>Daily Susu</span>
              <strong>{formatMoney(summary.totalDailySusu)}</strong>
            </div>
          </div>
        </section>
      ) : null}
    </div>
  );
}
