import { useState } from "react";
import type { TellerDepositStatus } from "@bms/shared";
import { isTellerDepositPending } from "@bms/shared";
import { RowActionsMenu } from "../../components/RowActionsMenu";
import { tellerDepositStatusLabel, tellerDepositStatusTone } from "./tellerDepositStatus";

type Props = {
  deposits: TellerDepositStatus[];
  loading?: boolean;
  businessDate?: string;
  onEdit?: (deposit: TellerDepositStatus) => Promise<void>;
  onCancel?: (deposit: TellerDepositStatus, reason: string) => Promise<void>;
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

export function TellerDepositStatusList({ deposits, loading, businessDate, onEdit, onCancel }: Props) {
  const dateLabel = businessDate ?? new Date().toISOString().slice(0, 10);
  const pendingCount = deposits.filter((row) => isTellerDepositPending(row.executionStatus)).length;
  const doneCount = deposits.filter((row) => row.executionStatus === "completed").length;

  const [editTarget, setEditTarget] = useState<TellerDepositStatus | null>(null);
  const [cancelTarget, setCancelTarget] = useState<TellerDepositStatus | null>(null);
  const [editAmount, setEditAmount] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [cancelReason, setCancelReason] = useState("");
  const [busy, setBusy] = useState(false);

  function openEdit(row: TellerDepositStatus) {
    setEditTarget(row);
    setEditAmount(String(row.amount));
    setEditNotes(row.notes ?? "");
  }

  function openCancel(row: TellerDepositStatus) {
    setCancelTarget(row);
    setCancelReason("");
  }

  async function submitEdit() {
    if (!editTarget || !onEdit) {
      return;
    }
    const amount = Number(editAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      return;
    }
    setBusy(true);
    try {
      await onEdit({
        ...editTarget,
        amount,
        notes: editNotes.trim() || undefined
      });
      setEditTarget(null);
    } finally {
      setBusy(false);
    }
  }

  async function submitCancel() {
    if (!cancelTarget || !onCancel || cancelReason.trim().length < 3) {
      return;
    }
    setBusy(true);
    try {
      await onCancel(cancelTarget, cancelReason.trim());
      setCancelTarget(null);
      setCancelReason("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <section className="card agency-deposit-table-card teller-deposit-status">
        <header className="agency-deposit-table-card__head teller-deposit-status__head">
          <div>
            <p className="agency-deposit-table-card__eyebrow">Reconciliation</p>
            <h3>Today&apos;s deposits</h3>
            <p className="muted">
              Pending rows can be edited or removed · Done rows are locked · {dateLabel}
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
                  <th>Account holder</th>
                  <th>Depositor&apos;s name</th>
                  <th>Account</th>
                  <th>Bank product</th>
                  <th className="agency-deposit-table__num">Amount</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {deposits.map((row) => {
                  const tone = tellerDepositStatusTone(row.executionStatus);
                  const editable = isTellerDepositPending(row.executionStatus);
                  return (
                    <tr
                      key={row.id}
                      className={
                        editable
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
                      <td className="muted">{row.depositorName ?? "—"}</td>
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
                      <td className="agency-deposit-table__actions">
                        {editable ? (
                          <RowActionsMenu
                            ariaLabel={`Actions for ${row.customerName}`}
                            items={[
                              {
                                label: "Modify",
                                onClick: () => openEdit(row)
                              },
                              {
                                label: "Delete",
                                danger: true,
                                onClick: () => openCancel(row)
                              }
                            ]}
                          />
                        ) : (
                          <span className="muted">—</span>
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

      {editTarget ? (
        <div className="session-expiry-backdrop" role="presentation">
          <div className="modal-panel" role="dialog" aria-modal="true" aria-labelledby="edit-deposit-title">
            <header className="modal-header">
              <h2 id="edit-deposit-title">Modify pending deposit</h2>
              <p className="muted modal-subtitle">{editTarget.customerName}</p>
            </header>
            <div className="modal-body">
              <label className="field">
                <span>Amount (GHS)</span>
                <input
                  className="input-no-spin"
                  type="number"
                  min={0.01}
                  step={0.01}
                  value={editAmount}
                  disabled={busy}
                  onChange={(e) => setEditAmount(e.target.value)}
                />
              </label>
              <label className="field">
                <span>Notes</span>
                <input
                  type="text"
                  value={editNotes}
                  disabled={busy}
                  onChange={(e) => setEditNotes(e.target.value)}
                  placeholder="Optional remark"
                />
              </label>
            </div>
            <footer className="modal-footer">
              <button type="button" className="button secondary" disabled={busy} onClick={() => setEditTarget(null)}>
                Cancel
              </button>
              <button type="button" className="button primary" disabled={busy} onClick={() => void submitEdit()}>
                {busy ? "Saving…" : "Save changes"}
              </button>
            </footer>
          </div>
        </div>
      ) : null}

      {cancelTarget ? (
        <div className="session-expiry-backdrop" role="presentation">
          <div className="modal-panel" role="dialog" aria-modal="true" aria-labelledby="cancel-deposit-title">
            <header className="modal-header">
              <h2 id="cancel-deposit-title">Delete pending deposit</h2>
              <p className="muted modal-subtitle">
                {cancelTarget.customerName} · {money(cancelTarget.amount)}
              </p>
            </header>
            <div className="modal-body">
              <label className="field">
                <span>Reason for deletion *</span>
                <textarea
                  rows={3}
                  value={cancelReason}
                  disabled={busy}
                  onChange={(e) => setCancelReason(e.target.value)}
                  placeholder="Explain why this deposit is being removed"
                />
              </label>
            </div>
            <footer className="modal-footer">
              <button
                type="button"
                className="button secondary"
                disabled={busy}
                onClick={() => setCancelTarget(null)}
              >
                Keep deposit
              </button>
              <button
                type="button"
                className="button primary"
                disabled={busy || cancelReason.trim().length < 3}
                onClick={() => void submitCancel()}
              >
                {busy ? "Deleting…" : "Delete deposit"}
              </button>
            </footer>
          </div>
        </div>
      ) : null}
    </>
  );
}
