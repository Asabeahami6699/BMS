import { FormEvent, useEffect, useMemo } from "react";
import { Link } from "react-router-dom";
import type { AppRole } from "./api";
import { useToast } from "../components/Toast";
import { usePageLoading } from "./hooks/usePageLoading";
import { formatBranchLabel } from "./branchDisplay";
import { useSusuClosingBalancesStore } from "./stores/susuClosingBalancesStore";

type Props = { role: AppRole };

function formatMoney(amount: number): string {
  return `GHS ${amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function SusuClosingBalancesPage({ role }: Props) {
  const { showToast } = useToast();
  const canEdit = role === "admin" || role === "coordinator" || role === "accountant";

  const branches = useSusuClosingBalancesStore((s) => s.branches);
  const branchId = useSusuClosingBalancesStore((s) => s.branchId);
  const businessDate = useSusuClosingBalancesStore((s) => s.businessDate);
  const snapshot = useSusuClosingBalancesStore((s) => s.snapshot);
  const openingVault = useSusuClosingBalancesStore((s) => s.openingVault);
  const cashToBank = useSusuClosingBalancesStore((s) => s.cashToBank);
  const susuExpenses = useSusuClosingBalancesStore((s) => s.susuExpenses);
  const closingVaultCounted = useSusuClosingBalancesStore((s) => s.closingVaultCounted);
  const notes = useSusuClosingBalancesStore((s) => s.notes);
  const loading = useSusuClosingBalancesStore((s) => s.loading);
  const saving = useSusuClosingBalancesStore((s) => s.saving);
  const error = useSusuClosingBalancesStore((s) => s.error);
  const hydrate = useSusuClosingBalancesStore((s) => s.hydrate);
  const refresh = useSusuClosingBalancesStore((s) => s.refresh);
  const startLiveSync = useSusuClosingBalancesStore((s) => s.startLiveSync);
  const stopLiveSync = useSusuClosingBalancesStore((s) => s.stopLiveSync);
  const setBranchId = useSusuClosingBalancesStore((s) => s.setBranchId);
  const setBusinessDate = useSusuClosingBalancesStore((s) => s.setBusinessDate);
  const setOpeningVault = useSusuClosingBalancesStore((s) => s.setOpeningVault);
  const setCashToBank = useSusuClosingBalancesStore((s) => s.setCashToBank);
  const setSusuExpenses = useSusuClosingBalancesStore((s) => s.setSusuExpenses);
  const setClosingVaultCounted = useSusuClosingBalancesStore((s) => s.setClosingVaultCounted);
  const setNotes = useSusuClosingBalancesStore((s) => s.setNotes);
  const resetFromSuggestion = useSusuClosingBalancesStore((s) => s.resetFromSuggestion);
  const save = useSusuClosingBalancesStore((s) => s.save);

  usePageLoading(loading || saving, "susu-closing-balances");

  useEffect(() => {
    hydrate({ force: true });
    startLiveSync();
    return () => stopLiveSync();
  }, [hydrate, startLiveSync, stopLiveSync]);

  useEffect(() => {
    if (error) {
      showToast(error, "error");
    }
  }, [error, showToast]);

  const branchLabel = useMemo(
    () => formatBranchLabel(branchId, branches),
    [branches, branchId]
  );

  const liveOpeningDelta = useMemo(() => {
    if (!snapshot) {
      return 0;
    }
    const value = Number(openingVault);
    if (!Number.isFinite(value)) {
      return 0;
    }
    return Math.round((value - snapshot.suggestedOpeningVault) * 100) / 100;
  }, [openingVault, snapshot]);

  async function handleSave(event: FormEvent) {
    event.preventDefault();
    if (!canEdit) {
      return;
    }
    try {
      await save();
      showToast("Branch vault closing saved", "success");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to save", "error");
    }
  }

  return (
    <div className="agents-page">
      <header className="agents-page__header">
        <div>
          <h2>Susu activity closing balances</h2>
          <p className="muted">
            Branch vault day-close: opening safe, till issues, field callover, cash to bank, and
            vault remaining. Teller drawer OS stays on{" "}
            <Link to="/app/susu/overages-shortages#os-branch-till">Overages/Shortages</Link>.
          </p>
        </div>
        <button
          type="button"
          className="button secondary"
          disabled={loading || !branchId}
          onClick={() => void refresh()}
        >
          {loading ? "Loading…" : "Refresh"}
        </button>
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
          <input
            type="date"
            value={businessDate}
            onChange={(e) => setBusinessDate(e.target.value)}
          />
        </label>
      </div>

      {loading && !snapshot ? (
        <p className="muted">Loading closing balance…</p>
      ) : snapshot ? (
        <>
          <div className="kpi-grid agents-page__kpis">
            <article className="kpi-card kpi-card--primary">
              <span className="kpi-label">Opening vault</span>
              <p className="kpi-value">{formatMoney(snapshot.openingVault)}</p>
              <p className="kpi-meta muted">
                Suggested {formatMoney(snapshot.suggestedOpeningVault)}
                {Math.abs(snapshot.openingVaultDelta) >= 0.005
                  ? ` · Δ ${formatMoney(snapshot.openingVaultDelta)}`
                  : ""}
              </p>
            </article>
            <article className="kpi-card kpi-card--success">
              <span className="kpi-label">Expected closing vault</span>
              <p className="kpi-value">{formatMoney(snapshot.expectedClosingVault)}</p>
              <p className="kpi-meta muted">{branchLabel} · in safe</p>
            </article>
            <article className="kpi-card kpi-card--warning">
              <span className="kpi-label">Cash to bank</span>
              <p className="kpi-value">{formatMoney(snapshot.cashToBank)}</p>
              <p className="kpi-meta muted">Susu worksheet only</p>
            </article>
            <article className="kpi-card">
              <span className="kpi-label">Still in open tills</span>
              <p className="kpi-value">{formatMoney(snapshot.cashStillInOpenTills)}</p>
              <p className="kpi-meta muted">
                {snapshot.tillSessionCount} till session(s) · position{" "}
                {formatMoney(snapshot.branchCashPosition)}
              </p>
            </article>
          </div>

          {snapshot.vaultCountVariance != null &&
          Math.abs(snapshot.vaultCountVariance) >= 0.005 ? (
            <p
              className={`branch-float__eod-flag ${
                snapshot.vaultCountVariance > 0
                  ? "branch-float__eod-flag--overage"
                  : "branch-float__eod-flag--shortage"
              }`}
              role="status"
            >
              <strong>
                Vault count {snapshot.vaultCountVariance > 0 ? "over" : "short"}{" "}
                {formatMoney(Math.abs(snapshot.vaultCountVariance))}
              </strong>{" "}
              — counted {formatMoney(snapshot.closingVaultCounted ?? 0)} vs expected{" "}
              {formatMoney(snapshot.expectedClosingVault)}.
            </p>
          ) : null}

          <section className="card susu-closing-till-source">
            <h3>From branch tills</h3>
            <p className="muted">
              Physical cash issued to tellers (not float capacity). Closed/settled tills are treated
              as returned to vault; open tills stay outside the safe.
            </p>
            <div className="susu-closing-formula__grid">
              <div>
                <span className="muted">Cash issued to tills</span>
                <strong>{formatMoney(snapshot.tillPhysicalCash)}</strong>
              </div>
              <div>
                <span className="muted">Till expenses</span>
                <strong>{formatMoney(snapshot.tillExpenses)}</strong>
              </div>
              <div>
                <span className="muted">Returned from closed tills</span>
                <strong>{formatMoney(snapshot.cashReturnedFromClosedTills)}</strong>
              </div>
              <div>
                <span className="muted">Still in open tills</span>
                <strong>{formatMoney(snapshot.cashStillInOpenTills)}</strong>
              </div>
            </div>
            <p className="muted">
              Manage tills on <Link to="/app/susu/till-float">Susu → Till float</Link>.
            </p>
          </section>

          <section className="card susu-closing-formula">
            <h3>Field vs walk-in activity</h3>
            <div className="susu-closing-formula__grid">
              <div>
                <span className="muted">Field agent deposits (into vault)</span>
                <strong>{formatMoney(snapshot.fieldAgentDeposits)}</strong>
              </div>
              <div>
                <span className="muted">Field agent withdrawals (from vault)</span>
                <strong>− {formatMoney(snapshot.fieldAgentWithdrawals)}</strong>
              </div>
              <div>
                <span className="muted">Walk-in deposits (in tills)</span>
                <strong>{formatMoney(snapshot.walkInDeposits)}</strong>
              </div>
              <div>
                <span className="muted">Walk-in withdrawals (in tills)</span>
                <strong>− {formatMoney(snapshot.walkInWithdrawals)}</strong>
              </div>
            </div>
            <p className="susu-closing-formula__equation muted">
              Walk-in activity stays inside till cash (issued → activity → return). Field callover
              cash moves the vault directly.
            </p>
          </section>

          <section className="card susu-closing-formula">
            <h3>Vault formula</h3>
            <div className="susu-closing-formula__grid">
              <div>
                <span className="muted">Opening vault</span>
                <strong>{formatMoney(snapshot.openingVault)}</strong>
              </div>
              <div>
                <span className="muted">Issued to tills</span>
                <strong>− {formatMoney(snapshot.tillPhysicalCash)}</strong>
              </div>
              <div>
                <span className="muted">Field deposits</span>
                <strong>+ {formatMoney(snapshot.fieldAgentDeposits)}</strong>
              </div>
              <div>
                <span className="muted">Field withdrawals</span>
                <strong>− {formatMoney(snapshot.fieldAgentWithdrawals)}</strong>
              </div>
              <div>
                <span className="muted">Returned closed tills</span>
                <strong>+ {formatMoney(snapshot.cashReturnedFromClosedTills)}</strong>
              </div>
              <div>
                <span className="muted">Cash to bank</span>
                <strong>− {formatMoney(snapshot.cashToBank)}</strong>
              </div>
              <div>
                <span className="muted">Extra branch expenses</span>
                <strong>
                  − {formatMoney(Math.max(0, snapshot.susuExpenses - snapshot.tillExpenses))}
                </strong>
              </div>
              <div>
                <span className="muted">Expected closing vault</span>
                <strong>{formatMoney(snapshot.expectedClosingVault)}</strong>
              </div>
            </div>
          </section>

          {canEdit ? (
            <form className="card susu-closing-editor" onSubmit={(e) => void handleSave(e)}>
              <div className="susu-closing-editor__head">
                <div>
                  <p className="susu-closing-editor__eyebrow">Coordinator close</p>
                  <h3>Record vault closing</h3>
                  <p className="muted susu-closing-editor__lead">
                    Opening comes from yesterday. End-of-day: bank remittance, expenses, and optional
                    safe count.
                  </p>
                </div>
                <div className="susu-closing-editor__actions">
                  <button
                    type="button"
                    className="button secondary"
                    disabled={saving}
                    onClick={resetFromSuggestion}
                  >
                    Reset
                  </button>
                  <button type="submit" className="button" disabled={saving}>
                    {saving ? "Saving…" : "Save closing"}
                  </button>
                </div>
              </div>

              <div className="susu-closing-editor__blocks">
                <section className="susu-closing-editor__block">
                  <div className="susu-closing-editor__block-head">
                    <h4>Opening</h4>
                    <span
                      className={`susu-closing-editor__pill${
                        Math.abs(liveOpeningDelta) >= 0.005
                          ? " susu-closing-editor__pill--delta"
                          : " susu-closing-editor__pill--ok"
                      }`}
                    >
                      {Math.abs(liveOpeningDelta) >= 0.005
                        ? `Δ ${formatMoney(liveOpeningDelta)}`
                        : "Matches suggestion"}
                    </span>
                  </div>
                  <label className="field">
                    <span>Opening vault (GHS)</span>
                    <input
                      type="number"
                      className="input-no-spin"
                      min="0"
                      step="0.01"
                      value={openingVault}
                      onChange={(e) => setOpeningVault(e.target.value)}
                      required
                      autoFocus
                    />
                  </label>
                  <p className="muted susu-closing-editor__meta">
                    Suggested {formatMoney(snapshot.suggestedOpeningVault)} from prior close.
                    Adjustments notify admin/coordinator.
                  </p>
                </section>

                <section className="susu-closing-editor__block">
                  <div className="susu-closing-editor__block-head">
                    <h4>Remittance &amp; expenses</h4>
                  </div>
                  <div className="susu-closing-editor__pair">
                    <label className="field">
                      <span>Cash to bank (GHS)</span>
                      <input
                        type="number"
                        className="input-no-spin"
                        min="0"
                        step="0.01"
                        value={cashToBank}
                        onChange={(e) => setCashToBank(e.target.value)}
                        placeholder="0.00"
                      />
                    </label>
                    <label className="field">
                      <span>Branch expenses (GHS)</span>
                      <input
                        type="number"
                        className="input-no-spin"
                        min="0"
                        step="0.01"
                        value={susuExpenses}
                        onChange={(e) => setSusuExpenses(e.target.value)}
                        placeholder="0.00"
                      />
                    </label>
                  </div>
                  <p className="muted susu-closing-editor__meta">
                    Bank amount is Susu worksheet only. Expenses default to till{" "}
                    {formatMoney(snapshot.tillExpenses)}; only the extra above that hits the vault
                    again.
                  </p>
                </section>

                <section className="susu-closing-editor__block">
                  <div className="susu-closing-editor__block-head">
                    <h4>Safe count</h4>
                    <span className="susu-closing-editor__pill">Optional</span>
                  </div>
                  <label className="field">
                    <span>Vault counted (GHS)</span>
                    <input
                      type="number"
                      className="input-no-spin"
                      min="0"
                      step="0.01"
                      value={closingVaultCounted}
                      onChange={(e) => setClosingVaultCounted(e.target.value)}
                      placeholder={formatMoney(snapshot.expectedClosingVault).replace("GHS ", "")}
                    />
                  </label>
                  <p className="muted susu-closing-editor__meta">
                    Expected {formatMoney(snapshot.expectedClosingVault)}. Counted value becomes
                    tomorrow&apos;s opening; variance is notified.
                  </p>
                </section>

                <section className="susu-closing-editor__block susu-closing-editor__block--notes">
                  <div className="susu-closing-editor__block-head">
                    <h4>Notes</h4>
                  </div>
                  <label className="field">
                    <span className="visually-hidden">Notes</span>
                    <textarea
                      rows={3}
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      placeholder="Bank slip ref, vault remarks…"
                    />
                  </label>
                </section>
              </div>
            </form>
          ) : null}
        </>
      ) : (
        <p className="muted">Select a branch to view closing balance.</p>
      )}
    </div>
  );
}
