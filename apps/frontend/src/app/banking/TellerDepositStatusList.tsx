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

export function TellerDepositStatusList({ deposits, loading, businessDate }: Props) {
  const dateLabel = businessDate ?? new Date().toISOString().slice(0, 10);

  return (
    <section className="card teller-deposit-status">
      <header className="teller-deposit-status__head">
        <div>
          <h3>Today&apos;s deposits</h3>
          <p className="muted">
            Live status — updates when back office marks a deposit done ({dateLabel})
          </p>
        </div>
        {loading ? <span className="muted teller-deposit-status__sync">Syncing…</span> : null}
      </header>

      {loading && deposits.length === 0 ? (
        <p className="muted">Loading deposits…</p>
      ) : deposits.length === 0 ? (
        <p className="muted">No deposits recorded today.</p>
      ) : (
        <ul className="teller-deposit-status__list">
          {deposits.map((row) => {
            const tone = tellerDepositStatusTone(row.executionStatus);
            return (
              <li key={row.id} className="teller-deposit-status__row">
                <div className="teller-deposit-status__main">
                  <strong>{row.customerName}</strong>
                  <span className="teller-deposit-status__amount">{money(row.amount)}</span>
                </div>
                <div className="teller-deposit-status__meta">
                  <span className={`teller-deposit-status__badge teller-deposit-status__badge--${tone}`}>
                    {tellerDepositStatusLabel(row.executionStatus)}
                  </span>
                  {row.partnerAccountNumber ? (
                    <span className="muted">Acct {row.partnerAccountNumber}</span>
                  ) : null}
                  {row.bankLabel ? (
                    <span className="muted">
                      {row.bankLabel}
                      {row.bankProductName ? ` — ${row.bankProductName}` : ""}
                    </span>
                  ) : null}
                  <span className="muted">
                    {new Date(row.createdAt).toLocaleTimeString(undefined, {
                      hour: "2-digit",
                      minute: "2-digit"
                    })}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
