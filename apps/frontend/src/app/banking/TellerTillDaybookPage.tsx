import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { roleRequiresTransactionPin } from "@bms/shared";
import {
  TELLER_TILL_ENTRY_LABELS,
  type TellerTillEntryType,
  type TellerTillJournalEntry
} from "@bms/shared";
import { useAuth } from "../../auth/AuthContext";
import { useTransactionPin } from "../../auth/TransactionPinProvider";
import { createTellerTillJournalEntry, getRuntimeBranchId, listTellerTillJournalEntries } from "../api";
import { useToast } from "../../components/Toast";
import { ensureTransactionStepUpForRole } from "../../lib/ensureTransactionStepUp";
import { toUserFacingError } from "../../lib/networkError";
import { usePageLoading } from "../hooks/usePageLoading";

const ENTRY_TYPES = Object.keys(TELLER_TILL_ENTRY_LABELS) as TellerTillEntryType[];

const ENTRY_HINTS: Record<TellerTillEntryType, string> = {
  cash_to_bank: "Cash you are lodging at the partner bank — not a customer deposit.",
  expense: "Approved petty cash, transport, or branch expense paid from the till.",
  opening_drawer: "Opening float received when the drawer was opened.",
  extra_cash: "Additional cash received from vault or supervisor.",
  till_count: "Adjustment after a physical till count.",
  other: "Any other cash movement worth noting."
};

export function TellerTillDaybookPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { requestStepUp } = useTransactionPin();
  const { showToast } = useToast();
  const [pinReady, setPinReady] = useState(() => !roleRequiresTransactionPin(user?.role ?? ""));
  const [businessDate, setBusinessDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [entries, setEntries] = useState<TellerTillJournalEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [posting, setPosting] = useState(false);
  const [entryType, setEntryType] = useState<TellerTillEntryType>("cash_to_bank");
  const [amount, setAmount] = useState("");
  const [notes, setNotes] = useState("");

  const branchId = getRuntimeBranchId() ?? "";

  usePageLoading(loading || posting, "teller-till-daybook");

  useEffect(() => {
    if (!user || !roleRequiresTransactionPin(user.role)) {
      setPinReady(true);
      return;
    }

    let cancelled = false;
    void ensureTransactionStepUpForRole(user.role, requestStepUp)
      .then(() => {
        if (!cancelled) {
          setPinReady(true);
        }
      })
      .catch(() => {
        if (!cancelled) {
          showToast("Transaction PIN required to open till daybook", "error");
          navigate("/app/banking/teller", { replace: true });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [navigate, requestStepUp, showToast, user]);

  async function loadEntries() {
    if (!branchId || !pinReady) {
      return;
    }
    setLoading(true);
    try {
      const rows = await listTellerTillJournalEntries({ branchId, date: businessDate });
      setEntries(rows);
    } catch (err) {
      showToast(toUserFacingError(err, "Could not load till daybook"), "error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadEntries();
  }, [branchId, businessDate, pinReady]);

  const totals = useMemo(() => {
    const sum = entries.reduce((acc, row) => acc + row.amount, 0);
    const byType = new Map<TellerTillEntryType, number>();
    for (const row of entries) {
      byType.set(row.entryType, (byType.get(row.entryType) ?? 0) + row.amount);
    }
    return { sum, byType };
  }, [entries]);

  async function handlePost() {
    const parsed = Number(amount);
    if (!branchId) {
      showToast("Select a branch first", "error");
      return;
    }
    if (!Number.isFinite(parsed) || parsed <= 0) {
      showToast("Enter a valid amount", "error");
      return;
    }
    setPosting(true);
    try {
      await createTellerTillJournalEntry({
        branchId,
        businessDate,
        entryType,
        amount: parsed,
        notes: notes.trim() || undefined
      });
      showToast("Till movement recorded", "success");
      setAmount("");
      setNotes("");
      await loadEntries();
    } catch (err) {
      showToast(toUserFacingError(err, "Failed to record movement"), "error");
    } finally {
      setPosting(false);
    }
  }

  if (!pinReady) {
    return (
      <div className="agency-banking-page role-workspace teller-daybook-page">
        <p className="muted">Verifying transaction PIN…</p>
      </div>
    );
  }

  return (
    <div className="agency-banking-page role-workspace teller-daybook-page">
      <header className="card role-workspace__hero workspace-animate-in">
        <p className="role-workspace__eyebrow">Agency banking · Till</p>
        <div className="role-workspace__hero-row">
          <div>
            <h2>Till daybook</h2>
            <p className="muted role-workspace__subtitle">
              Log cash to bank, expenses, drawer opening, extra float, till counts, and other movements —
              separate from vault treasury.
            </p>
          </div>
          <Link to="/app/banking/teller" className="button secondary">
            ← Teller desk
          </Link>
        </div>
      </header>

      <section className="teller-daybook-grid workspace-animate-in workspace-animate-in--2">
        <div className="card teller-daybook-form">
          <h3>Record movement</h3>
          <p className="muted teller-daybook-form__hint">{ENTRY_HINTS[entryType]}</p>

          <div className="teller-daybook-chips">
            {ENTRY_TYPES.map((type) => (
              <button
                key={type}
                type="button"
                className={`teller-daybook-chip${entryType === type ? " is-active" : ""}`}
                onClick={() => setEntryType(type)}
              >
                {TELLER_TILL_ENTRY_LABELS[type]}
              </button>
            ))}
          </div>

          <label className="field">
            <span>Business date</span>
            <input type="date" value={businessDate} onChange={(e) => setBusinessDate(e.target.value)} />
          </label>

          <label className="field">
            <span>Amount (GHS)</span>
            <input
              type="number"
              min="0"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
            />
          </label>

          <label className="field">
            <span>Notes</span>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Reference, payee, or reason"
            />
          </label>

          <button type="button" className="button primary" disabled={posting} onClick={() => void handlePost()}>
            {posting ? "Saving…" : "Add to daybook"}
          </button>
        </div>

        <div className="card teller-daybook-summary">
          <h3>Today&apos;s movements</h3>
          <p className="teller-daybook-summary__total">
            Total logged <strong>GHS {totals.sum.toFixed(2)}</strong>
          </p>
          <ul className="teller-daybook-summary__types">
            {ENTRY_TYPES.filter((type) => (totals.byType.get(type) ?? 0) > 0).map((type) => (
              <li key={type}>
                <span>{TELLER_TILL_ENTRY_LABELS[type]}</span>
                <strong>GHS {(totals.byType.get(type) ?? 0).toFixed(2)}</strong>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="card workspace-animate-in workspace-animate-in--3">
        <h3>Daybook ledger</h3>
        {loading ? (
          <p className="muted">Loading…</p>
        ) : entries.length === 0 ? (
          <p className="muted">No till movements logged for this date.</p>
        ) : (
          <div className="teller-daybook-ledger-wrap">
            <table className="teller-daybook-ledger">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Type</th>
                  <th>Amount</th>
                  <th>Notes</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((row) => (
                  <tr key={row.id}>
                    <td>{new Date(row.createdAt).toLocaleString()}</td>
                    <td>{TELLER_TILL_ENTRY_LABELS[row.entryType]}</td>
                    <td>GHS {row.amount.toFixed(2)}</td>
                    <td>{row.notes ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
