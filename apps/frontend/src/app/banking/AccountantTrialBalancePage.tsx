import { useCallback, useEffect, useState } from "react";
import type { TreasuryBootstrap } from "@bms/shared";
import { useAuth } from "../../auth/AuthContext";
import { getAccountantTrialBalance } from "../api";
import { useBranchesLiveSync } from "../hooks/useBranchesLiveSync";
import { useBranchesStore } from "../stores/branchesStore";
import { getRoleDeskConfig } from "./roleDeskConfig";
import { RoleDeskShell } from "./RoleDeskShell";
import { formatDeskMoney } from "./DeskMetricGrid";

type BranchTrialBalance = {
  branchId: string;
  branchName: string;
  branchCode?: string;
  bootstrap: TreasuryBootstrap;
};

type Props = { displayName?: string };

export function AccountantTrialBalancePage({ displayName }: Props) {
  const config = getRoleDeskConfig("accountant");
  const { user } = useAuth();
  useBranchesLiveSync();
  const branches = useBranchesStore((s) => s.branches);
  const [branchId, setBranchId] = useState(
    user?.scopeType === "head_office" ? "all" : user?.branchId ?? ""
  );
  const [single, setSingle] = useState<TreasuryBootstrap | null>(null);
  const [allBranches, setAllBranches] = useState<BranchTrialBalance[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getAccountantTrialBalance(
        branchId && branchId !== "all" ? { branchId } : { branchId: "all" }
      );
      if ("branches" in data && Array.isArray(data.branches)) {
        setAllBranches(data.branches as BranchTrialBalance[]);
        setSingle(null);
      } else {
        setSingle(data as TreasuryBootstrap);
        setAllBranches([]);
      }
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load trial balance");
    } finally {
      setLoading(false);
    }
  }, [branchId]);

  useEffect(() => {
    void load();
  }, [load]);

  function renderTrialBalance(bootstrap: TreasuryBootstrap, title?: string) {
    return (
      <article className="card desk-trial-balance" key={title ?? "single"}>
        {title ? <h3>{title}</h3> : <h3>Trial balance</h3>}
        <p className="muted">
          Credit = debit when institutional cash is balanced. Variance signals missing entries or
          control gaps.
        </p>
        <p>
          Status:{" "}
          <strong className={bootstrap.trialBalance.isBalanced ? "text-ok" : "text-warn"}>
            {bootstrap.trialBalance.isBalanced ? "Balanced" : "Out of balance — review movements"}
          </strong>
        </p>
        <div className="treasury-kpi-grid desk-trial-balance__kpis">
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
        </div>
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
                  <td className="desk-data-table__num">{formatDeskMoney(line.balance)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th>Totals</th>
                <th className="desk-data-table__num">{formatDeskMoney(bootstrap.trialBalance.totalDebit)}</th>
                <th className="desk-data-table__num">{formatDeskMoney(bootstrap.trialBalance.totalCredit)}</th>
                <th />
              </tr>
            </tfoot>
          </table>
        </div>
      </article>
    );
  }

  return (
    <RoleDeskShell
      config={{ ...config, title: "Trial balance", subtitle: "Vault, teller, and bank reconciliation." }}
      displayName={displayName}
      error={error}
      loading={loading}
      onRefresh={() => void load()}
      refreshing={loading}
    >
      <section className="card role-workspace__panel">
        <label className="field">
          <span>Branch</span>
          <select value={branchId} onChange={(e) => setBranchId(e.target.value)}>
            {user?.scopeType === "head_office" ? <option value="all">All branches</option> : null}
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name} ({b.code})
              </option>
            ))}
          </select>
        </label>
      </section>

      {single ? renderTrialBalance(single) : null}
      {allBranches.map((entry) =>
        renderTrialBalance(
          entry.bootstrap,
          entry.branchCode ? `${entry.branchName} (${entry.branchCode})` : entry.branchName
        )
      )}
    </RoleDeskShell>
  );
}
