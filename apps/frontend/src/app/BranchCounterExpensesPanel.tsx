import { FormEvent, useCallback, useEffect, useState } from "react";
import { hasTenantModule, type TenantProductModule, type TellerTillJournalEntry } from "@bms/shared";
import type { AppRole, Branch } from "./api";
import { createTellerTillJournalEntry, listTellerTillJournalEntries } from "./api";
import { useToast } from "../components/Toast";
import { toUserFacingError } from "../lib/networkError";

type Props = {
  role: AppRole;
  branches: Branch[];
  transactionBranchId: string;
  modules?: TenantProductModule[];
};

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function formatMoney(n: number): string {
  return `GHS ${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  } catch {
    return iso;
  }
}

const CAN_LOG = new Set<AppRole>(["teller", "coordinator", "admin"]);

export function BranchCounterExpensesPanel({
  role,
  branches,
  transactionBranchId,
  modules
}: Props) {
  const { showToast } = useToast();
  const [amount, setAmount] = useState("");
  const [notes, setNotes] = useState("");
  const [businessDate, setBusinessDate] = useState(todayIso);
  const [entries, setEntries] = useState<TellerTillJournalEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const moduleEnabled =
    modules == null ||
    hasTenantModule(modules, "susu_management") ||
    hasTenantModule(modules, "banking");
  const canLog = CAN_LOG.has(role) && moduleEnabled;
  const branchLabel = branches.find((b) => b.id === transactionBranchId)?.name ?? "Branch";

  const refresh = useCallback(async () => {
    if (!transactionBranchId || !canLog) {
      setEntries([]);
      return;
    }
    setLoading(true);
    try {
      const rows = await listTellerTillJournalEntries({
        branchId: transactionBranchId,
        date: businessDate
      });
      setEntries(rows.filter((row) => row.entryType === "expense"));
    } catch (error) {
      showToast(toUserFacingError(error, "Could not load teller expenses"), "error");
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, [transactionBranchId, businessDate, canLog, showToast]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (!canLog) {
    return null;
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!transactionBranchId) {
      showToast("Select a branch first", "error");
      return;
    }
    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0) {
      showToast("Enter an expense amount greater than zero", "error");
      return;
    }
    setSaving(true);
    try {
      await createTellerTillJournalEntry({
        branchId: transactionBranchId,
        businessDate,
        entryType: "expense",
        amount: value,
        notes: notes.trim() || undefined
      });
      setAmount("");
      setNotes("");
      showToast("Expense recorded", "success");
      await refresh();
    } catch (error) {
      showToast(toUserFacingError(error, "Could not save expense"), "error");
    } finally {
      setSaving(false);
    }
  }

  const total = entries.reduce((sum, row) => sum + row.amount, 0);

  return (
    <section className="card branch-counter__expenses">
      <div className="branch-counter__section-head">
        <h3>Teller expenses</h3>
        <span className="muted branch-counter__ledger-meta">{branchLabel}</span>
      </div>
      <p className="muted">
        Log petty cash, transport, or other branch expenses paid from the till. These stay on the daybook for this
        branch and date.
      </p>

      <form className="branch-counter__expenses-form" onSubmit={(event) => void handleSubmit(event)}>
        <label className="field">
          <span>Date</span>
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
            required
          />
        </label>
        <label className="field branch-counter__expenses-notes">
          <span>Reason / payee</span>
          <input
            type="text"
            value={notes}
            maxLength={300}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="e.g. transport, stationery"
          />
        </label>
        <button type="submit" className="button" disabled={saving || !transactionBranchId}>
          {saving ? "Saving…" : "Add expense"}
        </button>
      </form>

      <div className="branch-counter__expenses-list">
        <div className="branch-counter__expenses-list-head">
          <strong>Expenses today</strong>
          <span className="muted">{loading ? "Loading…" : `Total ${formatMoney(total)}`}</span>
        </div>
        {entries.length === 0 && !loading ? (
          <p className="muted">No expenses recorded for this date.</p>
        ) : (
          <ul>
            {entries.map((entry) => (
              <li key={entry.id}>
                <span>{formatTime(entry.createdAt)}</span>
                <span>{entry.notes?.trim() || "Expense"}</span>
                <strong>{formatMoney(entry.amount)}</strong>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
