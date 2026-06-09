import type { TellerReconciliationRow } from "@bms/shared";

type Props = {
  rows: TellerReconciliationRow[];
  loading?: boolean;
  compact?: boolean;
};

function money(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) {
    return "—";
  }
  return `GHS ${value.toFixed(2)}`;
}

function diffTone(value: number | null): string {
  if (value == null || Math.abs(value) < 0.01) return "neutral";
  return value > 0 ? "over" : "short";
}

export function TellerReconciliationTable({ rows, loading, compact }: Props) {
  if (loading && rows.length === 0) {
    return <p className="muted">Loading reconciliation…</p>;
  }
  if (rows.length === 0) {
    return (
      <p className="muted">
        No teller float session for this date. Open a drawer or request float to start reconciliation.
      </p>
    );
  }

  return (
    <div className={`teller-recon-table-wrap${compact ? " teller-recon-table-wrap--compact" : ""}`}>
      <table className="teller-recon-table">
        <thead>
          <tr>
            <th>Teller</th>
            <th>Opening</th>
            <th>Deposits</th>
            <th>Withdrawals</th>
            <th>Closing</th>
            <th>Difference</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={`${row.tellerId}-${row.businessDate}`}>
              <td>
                <strong>{row.tellerName}</strong>
                {!compact ? (
                  <span className="muted teller-recon-table__meta">{row.transactionCount} txn</span>
                ) : null}
              </td>
              <td>{money(row.opening)}</td>
              <td className="teller-recon-table__in">{money(row.deposits)}</td>
              <td className="teller-recon-table__out">{money(row.withdrawals)}</td>
              <td>{money(row.closing ?? row.expectedClosing)}</td>
              <td>
                <span className={`teller-recon-diff teller-recon-diff--${diffTone(row.difference)}`}>
                  {money(row.difference)}
                </span>
              </td>
              <td>
                <span className={`teller-recon-status teller-recon-status--${row.status}`}>
                  {row.status}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
