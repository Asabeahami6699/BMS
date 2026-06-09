import type { TellerDepositStatus } from "@bms/shared";
import { tellerDepositStatusLabel, tellerDepositStatusTone } from "./tellerDepositStatus";

type Props = {
  deposits: TellerDepositStatus[];
  loading?: boolean;
  businessDate?: string;
};

function money(amount: number): string {
  return `GHS ${amount.toFixed(2)}`;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit"
  });
}

function branchLabel(row: TellerDepositStatus): string {
  if (row.branchName) {
    return row.branchCode ? `${row.branchName} (${row.branchCode})` : row.branchName;
  }
  return "—";
}

export function TellerDepositStatusList({ deposits, loading, businessDate }: Props) {
  const dateLabel = businessDate ?? new Date().toISOString().slice(0, 10);
  const pendingCount = deposits.filter((row) => row.executionStatus === "pending_bank").length;
  const doneCount = deposits.filter((row) => row.executionStatus === "completed").length;

  return (
    <section className="card agency-deposit-table-card teller-deposit-status">
      <header className="agency-deposit-table-card__head teller-deposit-status__head">
        <div>
          <p className="agency-deposit-table-card__eyebrow">Live feed</p>
          <h3>Today&apos;s deposits</h3>
          <p className="muted">
            Status updates when back office marks a deposit done · {dateLabel}
          </p>
        </div>
        <div className="agency-deposit-table-card__stats" aria-label="Deposit counts">
          <span className="agency-deposit-table-card__stat agency-deposit-table-card__stat--pending">
            {pendingCount} pending
          </span>
          <span className="agency-deposit-table-card__stat agency-deposit-table-card__stat--done">
            {doneCount} done
          </span>
          {loading ? <span className="muted teller-deposit-status__sync">Syncing…</span> : null}
        </div>
      </header>

      {loading && deposits.length === 0 ? (
        <p className="muted agency-deposit-table-card__empty">Loading deposits…</p>
      ) : deposits.length === 0 ? (
        <p className="muted agency-deposit-table-card__empty">No deposits recorded today.</p>
      ) : (
        <div className="agency-deposit-table-wrap">
          <table className="agency-deposit-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Branch</th>
                <th>Customer</th>
                <th>Account</th>
                <th>Bank product</th>
                <th className="agency-deposit-table__num">Amount</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {deposits.map((row) => {
                const tone = tellerDepositStatusTone(row.executionStatus);
                const isPending = row.executionStatus === "pending_bank";
                return (
                  <tr
                    key={row.id}
                    className={
                      isPending
                        ? "agency-deposit-table__row agency-deposit-table__row--pending"
                        : "agency-deposit-table__row"
                    }
                  >
                    <td className="agency-deposit-table__time">{formatTime(row.createdAt)}</td>
                    <td>
                      <span className="agency-deposit-table__branch">{branchLabel(row)}</span>
                    </td>
                    <td>
                      <strong className="agency-deposit-table__customer">{row.customerName}</strong>
                    </td>
                    <td className="muted agency-deposit-table__account">
                      {row.partnerAccountNumber ?? "—"}
                    </td>
                    <td className="muted">
                      {row.bankLabel
                        ? `${row.bankLabel}${row.bankProductName ? ` · ${row.bankProductName}` : ""}`
                        : "—"}
                    </td>
                    <td className="agency-deposit-table__num agency-deposit-table__amount">
                      {money(row.amount)}
                    </td>
                    <td>
                      <span
                        className={`teller-deposit-status__badge teller-deposit-status__badge--${tone}`}
                      >
                        {tellerDepositStatusLabel(row.executionStatus)}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
