import { useEffect, useMemo, useState } from "react";
import type { TreasuryBootstrap } from "@bms/shared";
import { useShallow } from "zustand/react/shallow";
import { useAuth } from "../../auth/AuthContext";
import { useBranchesLiveSync } from "../hooks/useBranchesLiveSync";
import { useBranchesStore } from "../stores/branchesStore";
import { useAccountantDeskStore } from "../stores/accountantDeskStore";
import { AccountantCompanyBalanceModal } from "./AccountantCompanyBalanceModal";
import { getRoleDeskConfig } from "./roleDeskConfig";
import { RoleDeskShell } from "./RoleDeskShell";
import { formatDeskMoney } from "./DeskMetricGrid";

type Props = { displayName?: string };

function TrialBalanceCard({
  bootstrap,
  title,
  dateFrom,
  dateTo
}: {
  bootstrap: TreasuryBootstrap;
  title?: string;
  dateFrom: string;
  dateTo: string;
}) {
  const balanced = bootstrap.trialBalance.isBalanced;
  const cashTotal =
    bootstrap.branchCashPosition.vaultCash +
    bootstrap.branchCashPosition.tellerCash +
    bootstrap.branchCashPosition.bankCash;

  return (
    <article className="card trial-balance-card">
      <header className="trial-balance-card__head">
        <div>
          {title ? <p className="trial-balance-card__eyebrow">{title}</p> : null}
          <h3>Cash trial balance</h3>
          <p className="muted">
            Period {dateFrom} to {dateTo} · positions as of now
          </p>
        </div>
        <span className={`trial-balance-status trial-balance-status--${balanced ? "ok" : "warn"}`}>
          {balanced ? "Balanced" : "Out of balance"}
        </span>
      </header>

      <div className="treasury-kpi-grid trial-balance-card__kpis">
        <div className="treasury-kpi treasury-kpi--highlight">
          <span className="muted">Total cash</span>
          <strong>{formatDeskMoney(cashTotal)}</strong>
        </div>
        <div className="treasury-kpi">
          <span className="muted">Vault</span>
          <strong>{formatDeskMoney(bootstrap.branchCashPosition.vaultCash)}</strong>
        </div>
        <div className="treasury-kpi">
          <span className="muted">Tellers</span>
          <strong>{formatDeskMoney(bootstrap.branchCashPosition.tellerCash)}</strong>
        </div>
        <div className="treasury-kpi">
          <span className="muted">Bank</span>
          <strong>{formatDeskMoney(bootstrap.branchCashPosition.bankCash)}</strong>
        </div>
        <div className="treasury-kpi">
          <span className="muted">Total debit</span>
          <strong>{formatDeskMoney(bootstrap.trialBalance.totalDebit)}</strong>
        </div>
        <div className="treasury-kpi">
          <span className="muted">Total credit</span>
          <strong>{formatDeskMoney(bootstrap.trialBalance.totalCredit)}</strong>
        </div>
      </div>

      <div className="desk-data-table desk-data-table--trial">
        <div className="desk-data-table__scroll">
          <table className="desk-data-table__grid">
            <thead>
              <tr>
                <th>Account</th>
                <th className="desk-data-table__num">Debit</th>
                <th className="desk-data-table__num">Credit</th>
                <th className="desk-data-table__num">Balance</th>
              </tr>
            </thead>
            <tbody>
              {bootstrap.trialBalance.lines.map((line) => (
                <tr key={line.accountId}>
                  <td>{line.label}</td>
                  <td className="desk-data-table__num">{formatDeskMoney(line.debit)}</td>
                  <td className="desk-data-table__num">{formatDeskMoney(line.credit)}</td>
                  <td
                    className={`desk-data-table__num ${
                      line.balance !== 0 ? "desk-data-table__neg" : ""
                    }`}
                  >
                    {formatDeskMoney(line.balance)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th>Totals</th>
                <th className="desk-data-table__num">
                  {formatDeskMoney(bootstrap.trialBalance.totalDebit)}
                </th>
                <th className="desk-data-table__num">
                  {formatDeskMoney(bootstrap.trialBalance.totalCredit)}
                </th>
                <th />
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </article>
  );
}

export function AccountantTrialBalancePage({ displayName }: Props) {
  const config = getRoleDeskConfig("accountant");
  const { user } = useAuth();
  useBranchesLiveSync();
  const branches = useBranchesStore((s) => s.branches);
  const [companyModalOpen, setCompanyModalOpen] = useState(false);

  const {
    trialBranchId,
    trialDateFrom,
    trialDateTo,
    single,
    allBranches,
    loading,
    error,
    lastFetchedAt,
    setTrialBranchId,
    setTrialDateRange,
    hydrateTrialBalance,
    refreshTrialBalance,
    startLiveSync,
    stopLiveSync
  } = useAccountantDeskStore(
    useShallow((s) => ({
      trialBranchId: s.trialBranchId,
      trialDateFrom: s.trialDateFrom,
      trialDateTo: s.trialDateTo,
      single: s.trialSingle,
      allBranches: s.trialBranches,
      loading: s.trialLoading,
      error: s.trialError,
      lastFetchedAt: s.lastTrialAt,
      setTrialBranchId: s.setTrialBranchId,
      setTrialDateRange: s.setTrialDateRange,
      hydrateTrialBalance: s.hydrateTrialBalance,
      refreshTrialBalance: s.refreshTrialBalance,
      startLiveSync: s.startLiveSync,
      stopLiveSync: s.stopLiveSync
    }))
  );

  useEffect(() => {
    const defaultBranch =
      user?.scopeType === "head_office" ? "all" : user?.branchId ?? "all";
    hydrateTrialBalance({ force: true, branchId: defaultBranch });
    startLiveSync();
    return () => stopLiveSync();
  }, [hydrateTrialBalance, startLiveSync, stopLiveSync, user?.branchId, user?.scopeType]);

  const updatedLabel = lastFetchedAt
    ? `Updated ${new Date(lastFetchedAt).toLocaleTimeString()}`
    : undefined;

  const summary = useMemo(() => {
    const entries = allBranches.length > 0 ? allBranches : single ? [{ bootstrap: single }] : [];
    const unbalanced = entries.filter((e) => !e.bootstrap.trialBalance.isBalanced).length;
    return { branches: entries.length, unbalanced };
  }, [allBranches, single]);

  return (
    <RoleDeskShell
      config={{ ...config, title: "Trial balance", subtitle: "Vault, teller, and bank reconciliation." }}
      displayName={displayName}
      updatedLabel={updatedLabel}
      error={error}
      loading={loading && !single && allBranches.length === 0}
      onRefresh={() => void refreshTrialBalance()}
      refreshing={loading}
    >
      <section className="card role-workspace__panel trial-balance-filters">
        <div className="trial-balance-filters__row">
          <label className="field">
            <span>Branch</span>
            <select value={trialBranchId} onChange={(e) => setTrialBranchId(e.target.value)}>
              {user?.scopeType === "head_office" ? <option value="all">All branches</option> : null}
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name} ({b.code})
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>From</span>
            <input
              type="date"
              value={trialDateFrom}
              max={trialDateTo}
              onChange={(e) => setTrialDateRange(e.target.value, trialDateTo)}
            />
          </label>
          <label className="field">
            <span>To</span>
            <input
              type="date"
              value={trialDateTo}
              min={trialDateFrom}
              onChange={(e) => setTrialDateRange(trialDateFrom, e.target.value)}
            />
          </label>
          <button
            type="button"
            className="button primary trial-balance-filters__company-btn"
            onClick={() => setCompanyModalOpen(true)}
          >
            Company overview
          </button>
        </div>
        {summary.branches > 0 ? (
          <p className="muted trial-balance-filters__hint">
            {summary.branches} branch view
            {summary.unbalanced > 0
              ? ` · ${summary.unbalanced} need review`
              : " · all balanced"}
          </p>
        ) : null}
      </section>

      {single ? (
        <TrialBalanceCard
          bootstrap={single}
          dateFrom={trialDateFrom}
          dateTo={trialDateTo}
        />
      ) : null}

      {allBranches.map((entry) => (
        <TrialBalanceCard
          key={entry.branchId}
          bootstrap={entry.bootstrap}
          title={entry.branchCode ? `${entry.branchName} (${entry.branchCode})` : entry.branchName}
          dateFrom={trialDateFrom}
          dateTo={trialDateTo}
        />
      ))}

      <AccountantCompanyBalanceModal
        open={companyModalOpen}
        onClose={() => setCompanyModalOpen(false)}
        branches={allBranches}
        single={single}
        dateFrom={trialDateFrom}
        dateTo={trialDateTo}
      />
    </RoleDeskShell>
  );
}
