import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import type { AppRole, Branch, SusuClosingBalanceSnapshot } from "./api";
import { getSusuClosingBalance, listBranches, saveSusuClosingBalance } from "./api";
import { useToast } from "../components/Toast";
import { toUserFacingError } from "../lib/networkError";

type Props = { role: AppRole };

function formatMoney(amount: number): string {
  return `GHS ${amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function SusuClosingBalancesPage({ role }: Props) {
  const { showToast } = useToast();
  const canEdit = role === "admin" || role === "coordinator" || role === "accountant";

  const [branches, setBranches] = useState<Branch[]>([]);
  const [branchId, setBranchId] = useState("");
  const [businessDate, setBusinessDate] = useState(todayIso());
  const [snapshot, setSnapshot] = useState<SusuClosingBalanceSnapshot | null>(null);
  const [initialCash, setInitialCash] = useState("");
  const [susuExpenses, setSusuExpenses] = useState("");
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void listBranches()
      .then((rows) => {
        const active = rows.filter((b) => b.status !== "inactive");
        setBranches(active);
        if (active.length > 0 && !branchId) {
          setBranchId(active[0]!.id);
        }
      })
      .catch(() => setBranches([]));
  }, [branchId]);

  const load = useCallback(async () => {
    if (!branchId) {
      return;
    }
    setLoading(true);
    try {
      const data = await getSusuClosingBalance(branchId, businessDate);
      setSnapshot(data);
      setInitialCash(String(data.initialCash));
      setSusuExpenses(String(data.susuExpenses));
      setNotes(data.notes ?? "");
    } catch (error) {
      showToast(toUserFacingError(error, "Failed to load closing balance"), "error");
      setSnapshot(null);
    } finally {
      setLoading(false);
    }
  }, [branchId, businessDate, showToast]);

  useEffect(() => {
    void load();
  }, [load]);

  const branchLabel = useMemo(() => {
    const match = branches.find((b) => b.id === branchId);
    return match ? `${match.name} (${match.code})` : branchId;
  }, [branches, branchId]);

  async function handleSave(event: FormEvent) {
    event.preventDefault();
    if (!canEdit || !branchId) {
      return;
    }
    setSaving(true);
    try {
      const saved = await saveSusuClosingBalance({
        branchId,
        businessDate,
        initialCash: Number(initialCash) || 0,
        susuExpenses: Number(susuExpenses) || 0,
        notes: notes.trim() || undefined
      });
      setSnapshot(saved);
      showToast("Closing balance saved", "success");
    } catch (error) {
      showToast(toUserFacingError(error, "Failed to save"), "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="agents-page">
      <header className="agents-page__header">
        <div>
          <h2>Susu activity closing balances</h2>
          <p className="muted">
            Daily cash reconciliation for Susu Management tenants: opening cash plus field and
            walk-in deposits, minus field and walk-in withdrawals and susu expenses.
          </p>
        </div>
      </header>

      <div className="agents-page__filters">
        <label className="field agents-page__branch-filter">
          <span>Branch</span>
          <select value={branchId} onChange={(e) => setBranchId(e.target.value)}>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name} ({b.code})
              </option>
            ))}
          </select>
        </label>
        <label className="field agents-page__branch-filter">
          <span>Business date</span>
          <input type="date" value={businessDate} onChange={(e) => setBusinessDate(e.target.value)} />
        </label>
      </div>

      {loading ? (
        <p className="muted">Loading closing balance…</p>
      ) : snapshot ? (
        <>
          <div className="kpi-grid agents-page__kpis">
            <article className="kpi-card kpi-card--primary">
              <span className="kpi-label">Cash remaining</span>
              <p className="kpi-value">{formatMoney(snapshot.cashRemaining)}</p>
              <p className="kpi-meta muted">{branchLabel} · {businessDate}</p>
            </article>
            <article className="kpi-card kpi-card--success">
              <span className="kpi-label">Total inflows</span>
              <p className="kpi-value">{formatMoney(snapshot.totalInflows)}</p>
            </article>
            <article className="kpi-card kpi-card--warning">
              <span className="kpi-label">Total outflows</span>
              <p className="kpi-value">{formatMoney(snapshot.totalOutflows)}</p>
            </article>
          </div>

          <section className="card susu-closing-formula">
            <h3>Closing formula</h3>
            <div className="susu-closing-formula__grid">
              <div>
                <span className="muted">Initial susu cash</span>
                <strong>{formatMoney(snapshot.initialCash)}</strong>
              </div>
              <div>
                <span className="muted">Field agent deposits</span>
                <strong>{formatMoney(snapshot.fieldAgentDeposits)}</strong>
              </div>
              <div>
                <span className="muted">Walk-in deposits (branch counter)</span>
                <strong>{formatMoney(snapshot.walkInDeposits)}</strong>
              </div>
              <div>
                <span className="muted">Field agent withdrawals</span>
                <strong>− {formatMoney(snapshot.fieldAgentWithdrawals)}</strong>
              </div>
              <div>
                <span className="muted">Walk-in withdrawals (branch counter)</span>
                <strong>− {formatMoney(snapshot.walkInWithdrawals)}</strong>
              </div>
              <div>
                <span className="muted">Susu expenses</span>
                <strong>− {formatMoney(snapshot.susuExpenses)}</strong>
              </div>
            </div>
            <p className="susu-closing-formula__equation muted">
              Cash remaining = initial susu cash + field agent deposits + walk-in deposits − field
              agent withdrawals − walk-in withdrawals − susu expenses
            </p>
          </section>

          {canEdit ? (
            <form className="card susu-closing-editor" onSubmit={(e) => void handleSave(e)}>
              <h3>Editable inputs</h3>
              <p className="muted">
                Set opening cash and susu expenses for the day. Transaction totals are computed from
                posted coordinator-approved activity.
              </p>
              <div className="susu-closing-editor__grid">
                <label className="field">
                  <span>Initial susu cash (GHS)</span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={initialCash}
                    onChange={(e) => setInitialCash(e.target.value)}
                  />
                </label>
                <label className="field">
                  <span>Susu expenses (GHS)</span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={susuExpenses}
                    onChange={(e) => setSusuExpenses(e.target.value)}
                  />
                </label>
                <label className="field susu-closing-editor__notes">
                  <span>Notes</span>
                  <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
                </label>
              </div>
              <button type="submit" className="button" disabled={saving}>
                {saving ? "Saving…" : "Save closing inputs"}
              </button>
            </form>
          ) : null}
        </>
      ) : (
        <p className="muted">Select a branch to view closing balance.</p>
      )}
    </div>
  );
}
