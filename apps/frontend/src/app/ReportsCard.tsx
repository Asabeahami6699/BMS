import { useShallow } from "zustand/react/shallow";
import type { AppRole } from "./api";
import { exportReportsCsv } from "./api";
import { useCoordinatorLiveSync } from "./hooks/useCoordinatorLiveSync";
import {
  selectTopAgents,
  selectTopBranches,
  useCoordinatorStore
} from "./stores/coordinatorStore";
import { useToast } from "../components/Toast";
import { toUserFacingError } from "../lib/networkError";

type Props = { role: AppRole };

export function ReportsCard({ role }: Props) {
  const { showToast } = useToast();
  useCoordinatorLiveSync(role === "coordinator" || role === "admin");

  const summary = useCoordinatorStore((s) => s.summary);
  const agents = useCoordinatorStore(useShallow(selectTopAgents));
  const branches = useCoordinatorStore(useShallow(selectTopBranches));
  const branchFilter = useCoordinatorStore((s) => s.branchFilter);
  const setBranchFilter = useCoordinatorStore((s) => s.setBranchFilter);
  const loading = useCoordinatorStore((s) => s.loading);
  const error = useCoordinatorStore((s) => s.error);
  const canExport = role === "admin" || role === "accountant" || role === "auditor";
  const canFilterBranch = role === "admin" || role === "accountant" || role === "auditor";

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
    } catch (error) {
      showToast(toUserFacingError(error, "Failed to export reports"), "error");
    }
  }

  return (
    <section className="card">
      <h2>Reports &amp; Analysis</h2>
      <p className="muted">
        Figures from your company ledger and collections. Updates automatically with coordinator
        live sync.
      </p>
      {canFilterBranch && (
        <label className="field">
          <span>Branch filter (optional)</span>
          <input
            value={branchFilter}
            onChange={(event) => setBranchFilter(event.target.value)}
            placeholder="e.g. branch UUID or leave empty for all"
          />
        </label>
      )}
      {canExport && (
        <button type="button" className="button secondary" onClick={() => void handleExportCsv()}>
          Export Reports CSV
        </button>
      )}
      {error ? <p className="muted">{error}</p> : null}
      {summary ? (
        <div className="lines">
          <div className="line">
            <span>Total Transactions</span>
            <strong>{summary.totalTransactions}</strong>
          </div>
          <div className="line">
            <span>Total Deposits</span>
            <strong>{summary.totalDeposits.toFixed(2)}</strong>
          </div>
          <div className="line">
            <span>Total Withdrawals</span>
            <strong>{summary.totalWithdrawals.toFixed(2)}</strong>
          </div>
          <div className="line">
            <span>Total Daily Susu</span>
            <strong>{summary.totalDailySusu.toFixed(2)}</strong>
          </div>
        </div>
      ) : (
        <p className="muted">{loading ? "Loading reports…" : "No report data yet."}</p>
      )}
      <hr />
      <h3>Branch Activity</h3>
      <div className="lines">
        {branches.map((branch) => (
          <div className="line" key={branch.branchId}>
            <span>{branch.branchId}</span>
            <small>
              {branch.transactionCount} tx | {branch.totalAmount.toFixed(2)}
            </small>
          </div>
        ))}
      </div>
      <hr />
      <h3>Top Agents</h3>
      <div className="lines">
        {agents.map((agent) => (
          <div className="line" key={agent.fieldAgentId}>
            <span>{agent.fieldAgentId}</span>
            <small>{agent.totalCollections.toFixed(2)}</small>
          </div>
        ))}
      </div>
    </section>
  );
}
