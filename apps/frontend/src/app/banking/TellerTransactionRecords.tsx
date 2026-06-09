import type { TellerTransactionRecord } from "@bms/shared";
import { tellerDepositStatusLabel, tellerDepositStatusTone } from "./tellerDepositStatus";

type Props = {
  transactions: TellerTransactionRecord[];
  loading?: boolean;
  title?: string;
};

function downloadCsv(transactions: TellerTransactionRecord[], date: string) {
  const headers = [
    "Date/time",
    "Type",
    "Amount (GHS)",
    "Partner account",
    "Bank product",
    "Customer",
    "Teller",
    "Notes",
    "Status"
  ];
  const rows = transactions.map((tx) => [
    tx.createdAt,
    tx.type,
    tx.amount.toFixed(2),
    tx.partnerAccountNumber ?? tx.customerAccountNumber ?? "",
    tx.bankLabel ? `${tx.bankLabel} (${tx.bankProductName ?? ""})` : "",
    tx.customerName,
    tx.recordedByName,
    tx.notes ?? "",
    tx.executionStatus ?? ""
  ]);
  const csv = [headers, ...rows]
    .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","))
    .join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `teller-transactions-${date}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

export function TellerTransactionRecords({ transactions, loading, title = "Transaction records" }: Props) {
  const date = transactions[0]?.createdAt.slice(0, 10) ?? new Date().toISOString().slice(0, 10);

  return (
    <section className="teller-txn-records">
      <header className="teller-txn-records__head">
        <div>
          <h3>{title}</h3>
          <p className="muted">{transactions.length} record(s) for download and audit</p>
        </div>
        <button
          type="button"
          className="button secondary"
          disabled={loading || transactions.length === 0}
          onClick={() => downloadCsv(transactions, date)}
        >
          Download CSV
        </button>
      </header>

      {loading && transactions.length === 0 ? (
        <p className="muted">Loading transactions…</p>
      ) : transactions.length === 0 ? (
        <p className="muted">No teller transactions recorded for this date.</p>
      ) : (
        <div className="teller-txn-records__table-wrap">
          <table className="teller-txn-records__table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Type</th>
                <th>Amount</th>
                <th>Partner account</th>
                <th>Product</th>
                <th>Customer</th>
                <th>Teller</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {transactions.map((tx) => {
                const status = tx.executionStatus ?? (tx.type === "deposit" ? "completed" : "");
                const tone = status ? tellerDepositStatusTone(status) : "neutral";
                return (
                  <tr key={tx.id}>
                    <td>{new Date(tx.createdAt).toLocaleString()}</td>
                    <td>{tx.type.replace(/_/g, " ")}</td>
                    <td>GHS {tx.amount.toFixed(2)}</td>
                    <td>{tx.partnerAccountNumber ?? tx.customerAccountNumber ?? "—"}</td>
                    <td>{tx.bankLabel ?? "—"}</td>
                    <td>{tx.customerName}</td>
                    <td>{tx.recordedByName}</td>
                    <td>
                      {status ? (
                        <span
                          className={`teller-deposit-status__badge teller-deposit-status__badge--${tone}`}
                        >
                          {tellerDepositStatusLabel(status)}
                        </span>
                      ) : (
                        "—"
                      )}
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
