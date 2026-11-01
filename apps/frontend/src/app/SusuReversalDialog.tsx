import { useEffect, useState } from "react";
import type { SusuCollectionDetail } from "./api";
import { getSusuCollectionDetail, reverseSusuCollection } from "./api";
import { Modal } from "../components/Modal";
import { useToast } from "../components/Toast";
import { toUserFacingError } from "../lib/networkError";

type Props = {
  open: boolean;
  transactionId: string | null;
  onClose: () => void;
  onCompleted: () => void;
};

function formatWhen(iso?: string): string {
  if (!iso) {
    return "—";
  }
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  return date.toLocaleString();
}

function formatMoney(amount: number): string {
  return `GHS ${amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function downloadReceipt(detail: SusuCollectionDetail): void {
  const blob = new Blob([detail.receiptText], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${detail.reversalReference ?? detail.transactionId}.txt`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function SusuReversalDialog({ open, transactionId, onClose, onCompleted }: Props) {
  const { showToast } = useToast();
  const [detail, setDetail] = useState<SusuCollectionDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState("");

  useEffect(() => {
    if (!open || !transactionId) {
      setDetail(null);
      setReason("");
      setError(null);
      return;
    }
    setIdempotencyKey(crypto.randomUUID());
    let cancelled = false;
    setLoading(true);
    setError(null);
    void getSusuCollectionDetail(transactionId)
      .then((next) => {
        if (!cancelled) {
          setDetail(next);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setDetail(null);
          setError(toUserFacingError(err, "Could not load this collection"));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [open, transactionId]);

  async function handleReverse() {
    if (!transactionId || !detail?.canReverse) {
      return;
    }
    const trimmed = reason.trim();
    if (trimmed.length < 3) {
      setError("Enter a reversal reason (at least 3 characters).");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const next = await reverseSusuCollection(detail.transactionId, trimmed, idempotencyKey);
      setDetail(next);
      setReason("");
      showToast("Susu collection reversed", "success");
      onCompleted();
    } catch (err) {
      setError(toUserFacingError(err, "Could not reverse this collection"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      title="Susu collection"
      subtitle="The original posting stays on the record. A reversal adds a separate debit."
      onClose={onClose}
      footer={
        <>
          <button type="button" className="button secondary" onClick={onClose} disabled={busy}>
            Close
          </button>
          {detail ? (
            <button type="button" className="button secondary" onClick={() => downloadReceipt(detail)}>
              Download record
            </button>
          ) : null}
          {detail?.canReverse ? (
            <button type="button" className="button" onClick={() => void handleReverse()} disabled={busy}>
              {busy ? "Reversing…" : "Reverse collection"}
            </button>
          ) : null}
        </>
      }
    >
      {loading ? <p className="muted">Loading collection…</p> : null}
      {error ? (
        <p className="overview-error" role="alert">
          {error}
        </p>
      ) : null}
      {detail ? (
        <div className="susu-reversal">
          <dl className="susu-reversal__facts">
            <div>
              <dt>Customer</dt>
              <dd>{detail.customerName}</dd>
            </div>
            <div>
              <dt>Account</dt>
              <dd>{detail.accountNumber ?? "Pending assignment"}</dd>
            </div>
            <div>
              <dt>Original reference</dt>
              <dd>{detail.transactionId}</dd>
            </div>
            <div>
              <dt>Amount</dt>
              <dd>{formatMoney(detail.amount)}</dd>
            </div>
            <div>
              <dt>Collection date</dt>
              <dd>{formatWhen(detail.collectedAt)}</dd>
            </div>
            <div>
              <dt>Posted by</dt>
              <dd>{detail.postedByName}</dd>
            </div>
            <div>
              <dt>Original status</dt>
              <dd>{detail.status === "reversed" ? "Reversed" : "Posted"}</dd>
            </div>
            <div>
              <dt>Reversal status</dt>
              <dd>{detail.status === "reversed" ? "Reversed" : "Not reversed"}</dd>
            </div>
            <div>
              <dt>Reversal reference</dt>
              <dd>{detail.reversalReference ?? "—"}</dd>
            </div>
            <div>
              <dt>Reversal reason</dt>
              <dd>{detail.reversalReason ?? (detail.canReverse ? "Required before confirm" : "—")}</dd>
            </div>
            <div>
              <dt>Reversed by</dt>
              <dd>{detail.reversedByName ?? "—"}</dd>
            </div>
            <div>
              <dt>Reversal date and time</dt>
              <dd>{formatWhen(detail.reversedAt)}</dd>
            </div>
          </dl>
          {detail.canReverse ? (
            <>
              <p className="muted">
                This corrects the customer susu balance. It does not refund cash from the till.
              </p>
              <label className="field">
                <span>Reversal reason</span>
                <textarea
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  rows={3}
                  required
                  maxLength={500}
                  placeholder="Why this collection should be reversed"
                />
              </label>
            </>
          ) : null}
        </div>
      ) : null}
    </Modal>
  );
}
