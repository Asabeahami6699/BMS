import { useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { useToast } from "../components/Toast";
import { downloadBranchCounterStatementCsv } from "../lib/branchCounterCsv";
import { useBranchCounterStore } from "./stores/branchCounterStore";

const TX_LABELS: Record<string, string> = {
  deposit: "Deposit",
  withdrawal: "Withdrawal",
  daily_susu: "Daily Susu"
};

const ROLE_LABELS: Record<string, string> = {
  admin: "Admin",
  coordinator: "Coordinator",
  teller: "Teller",
  accountant: "Accountant",
  customer_service: "Customer service"
};

function formatMoney(amount: number): string {
  return `GHS ${amount.toFixed(2)}`;
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    });
  } catch {
    return iso;
  }
}

export function BranchCounterStatementPanel() {
  const { showToast } = useToast();
  const {
    branches,
    statementBranchId,
    statementDate,
    statement,
    statementLoading,
    setStatementBranchId,
    setStatementDate
  } = useBranchCounterStore(
    useShallow((s) => ({
      branches: s.branches,
      statementBranchId: s.statementBranchId,
      statementDate: s.statementDate,
      statement: s.statement,
      statementLoading: s.statementLoading,
      setStatementBranchId: s.setStatementBranchId,
      setStatementDate: s.setStatementDate
    }))
  );

  const branchLabel = useMemo(() => {
    const match = branches.find((b) => b.id === statementBranchId);
    return match ? `${match.name} (${match.code})` : statementBranchId || "—";
  }, [branches, statementBranchId]);

  const summary = statement?.summary;
  const lines = statement?.lines ?? [];
  const showStatementSkeleton = statementLoading && !statement;
  const canExport = Boolean(statementBranchId && statement && summary);

  function handleExportCsv() {
    if (!statement || !summary) {
      showToast("Load a branch statement before exporting", "error");
      return;
    }
    try {
      downloadBranchCounterStatementCsv(branchLabel, statement);
      showToast("Statement CSV downloaded", "success");
    } catch {
      showToast("Failed to export statement CSV", "error");
    }
  }

  return (
    <section className="card branch-counter__statement">
      <div className="branch-counter__section-head branch-counter__statement-head">
        <span className="branch-counter__step">4</span>
        <h3>Daily transaction statement</h3>
        <span className="muted branch-counter__ledger-meta">
          Hall / counter posts by staff (not field collections)
        </span>
        <button
          type="button"
          className="button secondary branch-counter__export-btn"
          disabled={!canExport || statementLoading}
          onClick={handleExportCsv}
        >
          Export CSV
        </button>
      </div>

      <div className="branch-counter__statement-filters">
        <label className="field">
          <span>Statement branch</span>
          <select
            value={statementBranchId}
            onChange={(e) => setStatementBranchId(e.target.value)}
          >
            <option value="">Select branch</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name} ({b.code})
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Date</span>
          <input
            type="date"
            value={statementDate}
            onChange={(e) => setStatementDate(e.target.value)}
          />
        </label>
      </div>

      {!statementBranchId ? (
        <p className="muted branch-counter__empty">Select a branch to view today&apos;s counter transactions.</p>
      ) : showStatementSkeleton ? (
        <div className="branch-counter__skeleton-table">
          {[1, 2, 3, 4].map((n) => (
            <div key={n} className="branch-counter__skeleton-row" />
          ))}
        </div>
      ) : (
        <>
          {summary ? (
            <div className="branch-counter__statement-summary">
              <p className="branch-counter__statement-summary-title">
                {branchLabel} · {summary.date}
              </p>
              <div className="branch-counter__statement-kpis">
                <div>
                  <span>Transactions</span>
                  <strong>{summary.transactionCount}</strong>
                </div>
                <div>
                  <span>Deposits</span>
                  <strong>{formatMoney(summary.totalDeposits)}</strong>
                </div>
                <div>
                  <span>Withdrawals</span>
                  <strong>{formatMoney(summary.totalWithdrawals)}</strong>
                </div>
                <div>
                  <span>Daily Susu</span>
                  <strong>{formatMoney(summary.totalDailySusu)}</strong>
                </div>
                <div className="branch-counter__statement-kpis--net">
                  <span>Net</span>
                  <strong>{formatMoney(summary.netAmount)}</strong>
                </div>
              </div>
              {summary.byStaff.length > 0 ? (
                <div className="branch-counter__statement-staff">
                  <p className="branch-counter__statement-staff-title">By staff member</p>
                  <ul>
                    {summary.byStaff.map((staff) => (
                      <li key={staff.userId}>
                        <span>
                          {staff.name}
                          <small className="muted">
                            {" "}
                            · {ROLE_LABELS[staff.role] ?? staff.role}
                          </small>
                        </span>
                        <span>
                          {staff.count} tx · {formatMoney(staff.totalAmount)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          ) : null}

          {lines.length === 0 ? (
            <p className="muted branch-counter__empty">
              No branch counter transactions for this date. Posts from coordinators and tellers appear
              here after you record them above.
            </p>
          ) : (
            <div
              className="cif-ledger branch-counter__statement-table"
              role="table"
              aria-label="Branch counter daily statement"
            >
              <div className="cif-ledger__head branch-counter__statement-head" role="row">
                <span role="columnheader">Time</span>
                <span role="columnheader">Customer</span>
                <span role="columnheader">Type</span>
                <span role="columnheader">Amount</span>
                <span role="columnheader">Posted by</span>
                <span role="columnheader">Notes</span>
              </div>
              {lines.map((line) => (
                <div className="cif-ledger__row branch-counter__statement-row" role="row" key={line.id}>
                  <span>{formatTime(line.createdAt)}</span>
                  <span className="branch-counter__statement-customer">
                    <strong>{line.customerName}</strong>
                    {line.customerAccountNumber ? (
                      <small className="muted">{line.customerAccountNumber}</small>
                    ) : null}
                  </span>
                  <span className={`branch-counter__tx--${line.type}`}>
                    {TX_LABELS[line.type] ?? line.type}
                  </span>
                  <span className="branch-counter__ledger-amt">{formatMoney(line.amount)}</span>
                  <span className="cif-ledger__by" title={line.recordedByRole}>
                    {line.recordedByName}
                    <small className="muted">
                      {ROLE_LABELS[line.recordedByRole] ?? line.recordedByRole}
                    </small>
                  </span>
                  <span className="branch-counter__statement-notes muted">
                    {line.notes ?? "—"}
                  </span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}
