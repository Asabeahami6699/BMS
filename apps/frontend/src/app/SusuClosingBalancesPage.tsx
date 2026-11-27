import { FormEvent, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { AppRole, BranchCapitalEntry, BranchCapitalEntryType } from "./api";
import {
  AccountingAmountInput,
  formatAccountingInput,
  parseAccountingAmount
} from "../components/AccountingAmountInput";
import { Modal } from "../components/Modal";
import { useToast } from "../components/Toast";
import { useAuth } from "../auth/AuthContext";
import { printBranchEodSummary } from "./branchEodReportDocument";
import { usePageLoading } from "./hooks/usePageLoading";
import { formatBranchLabel } from "./branchDisplay";
import { useSusuClosingBalancesStore } from "./stores/susuClosingBalancesStore";

type Props = { role: AppRole };

function formatMoney(amount: number): string {
  return `GHS ${amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const CAPITAL_INJECTION_TOOLTIP =
  "Cash put INTO the business by the owner (e.g. Day 1 starting cash or liquidity top-up). Adds to Net Owner Capital and today's Expected Closing Vault.";
const CAPITAL_DRAWING_TOOLTIP =
  "Cash taken OUT of the vault by the owner for personal use or profit withdrawal. Reduces Net Owner Capital and today's Expected Closing Vault (do not use for branch expenses or customer payouts).";
const NET_CAPITAL_TOOLTIP =
  "Net owner capital = Total capital added minus Total owner drawings across all branches.";

const UNSAVED_CHANGES_TOOLTIP =
  "You have edited fields in this closing form that have not been saved yet. Click Save closing to record them for this date.";
const RESET_CLOSING_TOOLTIP =
  "Clears your entered amounts back to the suggested opening vault and blank end-of-day fields (does not change saved records until you click Save closing).";
const SAVE_CLOSING_TOOLTIP =
  "Saves today's vault closing figures (opening vault, cash to bank, branch expenses, safe count, and notes) and carries the closing vault forward to tomorrow.";

export function SusuClosingBalancesPage({ role }: Props) {
  const { showToast } = useToast();
  const { user } = useAuth();
  const canEdit = role === "admin" || role === "coordinator" || role === "accountant";
  const canManageCapital = role === "admin" || role === "accountant";

  const branches = useSusuClosingBalancesStore((s) => s.branches);
  const branchId = useSusuClosingBalancesStore((s) => s.branchId);
  const businessDate = useSusuClosingBalancesStore((s) => s.businessDate);
  const snapshot = useSusuClosingBalancesStore((s) => s.snapshot);
  const capitalSummary = useSusuClosingBalancesStore((s) => s.capitalSummary);
  const openingVault = useSusuClosingBalancesStore((s) => s.openingVault);
  const cashToBank = useSusuClosingBalancesStore((s) => s.cashToBank);
  const susuExpenses = useSusuClosingBalancesStore((s) => s.susuExpenses);
  const closingVaultCounted = useSusuClosingBalancesStore((s) => s.closingVaultCounted);
  const notes = useSusuClosingBalancesStore((s) => s.notes);
  const dirty = useSusuClosingBalancesStore((s) => s.dirty);
  const loading = useSusuClosingBalancesStore((s) => s.loading);
  const saving = useSusuClosingBalancesStore((s) => s.saving);
  const savingCapital = useSusuClosingBalancesStore((s) => s.savingCapital);
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
  const recordCapitalEntry = useSusuClosingBalancesStore((s) => s.recordCapitalEntry);
  const voidCapitalEntry = useSusuClosingBalancesStore((s) => s.voidCapitalEntry);

  const [capitalModalOpen, setCapitalModalOpen] = useState(false);
  const [capitalType, setCapitalType] = useState<BranchCapitalEntryType>("injection");
  const [capitalAmount, setCapitalAmount] = useState("");
  const [capitalSource, setCapitalSource] = useState("Owner cash");
  const [capitalReference, setCapitalReference] = useState("");
  const [capitalNotes, setCapitalNotes] = useState("");

  const [voidTarget, setVoidTarget] = useState<BranchCapitalEntry | null>(null);
  const [voidReason, setVoidReason] = useState("");

  usePageLoading(loading || saving || savingCapital, "susu-closing-balances");

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
    if (openingVault.trim() === "") {
      return 0;
    }
    const value = parseAccountingAmount(openingVault);
    if (!Number.isFinite(value)) {
      return 0;
    }
    return Math.round((value - snapshot.suggestedOpeningVault) * 100) / 100;
  }, [openingVault, snapshot]);

  const companyTotalAdded =
    capitalSummary?.companyTotalInjected ?? snapshot?.companyTotalCapitalAdded ?? 0;
  const companyTotalDrawings =
    capitalSummary?.companyTotalDrawings ?? snapshot?.companyTotalDrawings ?? 0;
  const companyNetCapital =
    capitalSummary?.companyNetCapital ?? snapshot?.companyNetCapital ?? 0;
  const branchTotalAdded =
    capitalSummary?.branchTotalInjected ?? snapshot?.branchTotalCapitalAdded ?? 0;
  const branchTotalDrawings =
    capitalSummary?.branchTotalDrawings ?? snapshot?.branchTotalDrawings ?? 0;
  const branchNetCapital =
    capitalSummary?.branchNetCapital ?? snapshot?.branchNetCapital ?? 0;
  const capitalInjectedToday =
    capitalSummary?.dayInjections ?? snapshot?.capitalInjectedToday ?? 0;
  const capitalDrawingsToday =
    capitalSummary?.dayDrawings ?? snapshot?.capitalDrawingsToday ?? 0;

  const liveExpectedClosingVault = useMemo(() => {
    if (!snapshot) {
      return 0;
    }
    const parsedOpening =
      openingVault.trim() !== "" ? parseAccountingAmount(openingVault) : Number.NaN;
    const effectiveOpening = Number.isFinite(parsedOpening)
      ? parsedOpening
      : snapshot.suggestedOpeningVault;

    const parsedCashToBank =
      cashToBank.trim() !== "" ? parseAccountingAmount(cashToBank) : Number.NaN;
    const effectiveCashToBank = Number.isFinite(parsedCashToBank)
      ? Math.max(0, parsedCashToBank)
      : 0;

    const parsedExpenses =
      susuExpenses.trim() !== "" ? parseAccountingAmount(susuExpenses) : Number.NaN;
    const effectiveExpenses = Number.isFinite(parsedExpenses)
      ? Math.max(0, parsedExpenses)
      : snapshot.tillExpenses;
    const extraBranchExpenses = Math.max(0, effectiveExpenses - snapshot.tillExpenses);

    const directToVaultDeposits = snapshot.directToVaultDeposits ?? 0;
    const directFromVaultWithdrawals = snapshot.directFromVaultWithdrawals ?? 0;

    return (
      Math.round(
        (effectiveOpening +
          capitalInjectedToday -
          capitalDrawingsToday -
          snapshot.tillPhysicalCash +
          snapshot.fieldAgentDeposits +
          directToVaultDeposits -
          snapshot.fieldAgentWithdrawals -
          directFromVaultWithdrawals +
          snapshot.cashReturnedFromClosedTills -
          effectiveCashToBank -
          extraBranchExpenses) *
          100
      ) / 100
    );
  }, [
    snapshot,
    openingVault,
    cashToBank,
    susuExpenses,
    capitalInjectedToday,
    capitalDrawingsToday
  ]);

  const liveVaultDifference = useMemo(() => {
    if (!snapshot || closingVaultCounted.trim() === "") {
      return null;
    }
    const counted = parseAccountingAmount(closingVaultCounted);
    if (!Number.isFinite(counted) || counted < 0) {
      return null;
    }
    return Math.round((counted - liveExpectedClosingVault) * 100) / 100;
  }, [snapshot, closingVaultCounted, liveExpectedClosingVault]);

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

  function openCapitalModal(type: BranchCapitalEntryType) {
    setCapitalType(type);
    setCapitalAmount("");
    setCapitalSource(type === "injection" ? "Owner cash" : "Owner drawing");
    setCapitalReference("");
    setCapitalNotes("");
    setCapitalModalOpen(true);
  }

  async function handleCapitalSubmit(event: FormEvent) {
    event.preventDefault();
    const amount = parseAccountingAmount(capitalAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      showToast("Enter a valid amount greater than zero", "error");
      return;
    }
    try {
      await recordCapitalEntry({
        entryType: capitalType,
        amount,
        source: capitalSource.trim() || undefined,
        reference: capitalReference.trim() || undefined,
        notes: capitalNotes.trim() || undefined
      });
      setCapitalModalOpen(false);
      showToast(
        capitalType === "injection"
          ? `Added ${formatMoney(amount)} business capital`
          : `Recorded ${formatMoney(amount)} owner drawing`,
        "success"
      );
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to save capital entry", "error");
    }
  }

  async function handleVoidSubmit(event: FormEvent) {
    event.preventDefault();
    if (!voidTarget) {
      return;
    }
    const reason = voidReason.trim();
    if (reason.length < 2) {
      showToast("Enter a short reason for voiding this entry", "error");
      return;
    }
    try {
      await voidCapitalEntry(voidTarget.id, reason);
      setVoidTarget(null);
      setVoidReason("");
      showToast("Capital entry voided", "success");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to void capital entry", "error");
    }
  }

  return (
    <div className="agents-page">
      <header className="agents-page__header">
        <div>
          <h2>Susu activity closing balances</h2>
          <p className="muted">
            Branch vault day-close: opening safe, business capital injections, till issues, field
            callover, cash to bank, and vault remaining. Teller drawer OS stays on{" "}
            <Link to="/app/susu/overages-shortages#os-branch-till">Overages/Shortages</Link>.
          </p>
        </div>
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
          <button
            type="button"
            className="button secondary"
            disabled={!snapshot || loading}
            onClick={() => {
              if (!snapshot) return;
              void printBranchEodSummary({
                snapshot,
                branchLabel,
                companyName: user?.tenantName,
                preparedBy: user?.fullName || user?.email
              }).catch((err) =>
                showToast(
                  err instanceof Error ? err.message : "Could not print EOD summary",
                  "error"
                )
              );
            }}
          >
            Print Daily EOD Summary
          </button>
          <button
            type="button"
            className="button secondary"
            disabled={loading || !branchId}
            onClick={() => void refresh()}
          >
            {loading ? "Loading…" : "Refresh"}
          </button>
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
          {snapshot.priorDayStatus &&
          (!snapshot.priorDayStatus.closingSaved ||
            snapshot.priorDayStatus.unclosedTillCount > 0 ||
            snapshot.priorDayStatus.unpostedBatchCount > 0 ||
            snapshot.priorDayStatus.unsubmittedDraftBatchCount > 0) ? (
            <div className="eod-guard-banner" role="alert">
              <div className="eod-guard-banner__body">
                <strong>
                  Prior-day items still open ({snapshot.priorDayStatus.businessDate})
                </strong>
                <ul className="eod-guard-banner__list">
                  {!snapshot.priorDayStatus.closingSaved ? (
                    <li>
                      Vault closing count for {snapshot.priorDayStatus.businessDate} was not saved
                      (opening vault is chained automatically from prior activity).
                    </li>
                  ) : null}
                  {snapshot.priorDayStatus.unclosedTillCount > 0 ? (
                    <li>
                      {snapshot.priorDayStatus.unclosedTillCount} prior teller till(s) still open —
                      cash has not been returned to vault.
                    </li>
                  ) : null}
                  {snapshot.priorDayStatus.unpostedBatchCount > 0 ? (
                    <li>
                      {snapshot.priorDayStatus.unpostedBatchCount} submitted field agent batch(es)
                      still waiting to be posted.
                    </li>
                  ) : null}
                  {snapshot.priorDayStatus.unsubmittedDraftBatchCount > 0 ? (
                    <li>
                      {snapshot.priorDayStatus.unsubmittedDraftBatchCount} field agent draft
                      batch(es) from {snapshot.priorDayStatus.businessDate} not yet submitted.
                    </li>
                  ) : null}
                </ul>
              </div>
              <div className="eod-guard-banner__actions">
                {!snapshot.priorDayStatus.closingSaved ? (
                  <button
                    type="button"
                    className="button"
                    onClick={() => setBusinessDate(snapshot.priorDayStatus!.businessDate)}
                  >
                    Open {snapshot.priorDayStatus.businessDate} &amp; close
                  </button>
                ) : null}
                {snapshot.priorDayStatus.unclosedTillCount > 0 ? (
                  <Link to="/app/susu/till-float" className="button secondary">
                    Review open tills
                  </Link>
                ) : null}
                {snapshot.priorDayStatus.unpostedBatchCount > 0 ? (
                  <Link to="/app/susu/callover-batches" className="button secondary">
                    Post pending batches
                  </Link>
                ) : null}
              </div>
            </div>
          ) : null}

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
            <article className="kpi-card">
              <span className="kpi-label">Net business capital</span>
              <p className="kpi-value">{formatMoney(companyNetCapital)}</p>
              <p className="kpi-meta muted">
                Added {formatMoney(companyTotalAdded)}
                {companyTotalDrawings > 0
                  ? ` · Drawings ${formatMoney(companyTotalDrawings)}`
                  : ""}
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
              {capitalInjectedToday > 0 ? (
                <div>
                  <span className="muted">Capital added today</span>
                  <strong>+ {formatMoney(capitalInjectedToday)}</strong>
                </div>
              ) : null}
              {capitalDrawingsToday > 0 ? (
                <div>
                  <span className="muted">Owner drawings today</span>
                  <strong>− {formatMoney(capitalDrawingsToday)}</strong>
                </div>
              ) : null}
              <div>
                <span className="muted">Issued to tills</span>
                <strong>− {formatMoney(snapshot.tillPhysicalCash)}</strong>
              </div>
              <div>
                <span className="muted">Field deposits</span>
                <strong>+ {formatMoney(snapshot.fieldAgentDeposits)}</strong>
              </div>
              {(snapshot.directToVaultDeposits ?? 0) > 0 ? (
                <div>
                  <span className="muted">Direct / approval deposits (off-till)</span>
                  <strong>+ {formatMoney(snapshot.directToVaultDeposits ?? 0)}</strong>
                </div>
              ) : null}
              <div>
                <span className="muted">Field withdrawals</span>
                <strong>− {formatMoney(snapshot.fieldAgentWithdrawals)}</strong>
              </div>
              {(snapshot.directFromVaultWithdrawals ?? 0) > 0 ? (
                <div>
                  <span className="muted">Direct withdrawals (off-till)</span>
                  <strong>− {formatMoney(snapshot.directFromVaultWithdrawals ?? 0)}</strong>
                </div>
              ) : null}
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

          <section className="card susu-capital-card">
            <div className="susu-capital-card__head">
              <div className="susu-capital-card__title">
                <p className="susu-closing-editor__eyebrow">Owner equity ledger</p>
                <h3>Business capital &amp; owner drawings</h3>
                <p className="muted susu-capital-card__lead">
                  Entries for <strong>{businessDate}</strong> automatically update today&apos;s
                  Expected Closing Vault and carry forward to tomorrow.
                </p>
              </div>
              {canManageCapital ? (
                <div className="susu-capital-card__actions">
                  <button
                    type="button"
                    className="button susu-tooltip susu-tooltip--end"
                    data-tooltip={CAPITAL_INJECTION_TOOLTIP}
                    disabled={savingCapital || capitalSummary?.storageReady === false}
                    onClick={() => openCapitalModal("injection")}
                  >
                    + Add capital
                  </button>
                  <button
                    type="button"
                    className="button secondary susu-tooltip susu-tooltip--end"
                    data-tooltip={CAPITAL_DRAWING_TOOLTIP}
                    disabled={savingCapital || capitalSummary?.storageReady === false}
                    onClick={() => openCapitalModal("drawing")}
                  >
                    Record drawing
                  </button>
                </div>
              ) : null}
            </div>

            {capitalSummary?.storageReady === false ? (
              <p className="branch-float__eod-flag branch-float__eod-flag--shortage" role="status">
                Business capital storage is not ready yet. Apply migration{" "}
                <code>098_branch_capital_entries.sql</code> in Supabase, then refresh.
              </p>
            ) : null}

            <div className="susu-capital-card__stats">
              <div
                className="susu-capital-stat susu-tooltip susu-tooltip--start"
                data-tooltip={CAPITAL_INJECTION_TOOLTIP}
                tabIndex={0}
              >
                <span className="susu-capital-stat__label">Total capital added</span>
                <strong className="susu-capital-stat__value susu-capital-stat__value--in">
                  {formatMoney(companyTotalAdded)}
                </strong>
                <span className="susu-capital-stat__meta muted">All branches</span>
              </div>
              <div
                className="susu-capital-stat susu-tooltip"
                data-tooltip={CAPITAL_DRAWING_TOOLTIP}
                tabIndex={0}
              >
                <span className="susu-capital-stat__label">Owner drawings</span>
                <strong className="susu-capital-stat__value susu-capital-stat__value--out">
                  {companyTotalDrawings > 0
                    ? `− ${formatMoney(companyTotalDrawings)}`
                    : formatMoney(0)}
                </strong>
                <span className="susu-capital-stat__meta muted">All branches</span>
              </div>
              <div
                className="susu-capital-stat susu-capital-stat--highlight susu-tooltip"
                data-tooltip={NET_CAPITAL_TOOLTIP}
                tabIndex={0}
              >
                <span className="susu-capital-stat__label">Net owner capital</span>
                <strong className="susu-capital-stat__value">
                  {formatMoney(companyNetCapital)}
                </strong>
                <span className="susu-capital-stat__meta muted">Company total</span>
              </div>
              <div
                className="susu-capital-stat susu-tooltip susu-tooltip--end"
                data-tooltip={`Cumulative capital added minus owner drawings recorded for ${branchLabel}.`}
                tabIndex={0}
              >
                <span className="susu-capital-stat__label">{branchLabel}</span>
                <strong className="susu-capital-stat__value">
                  {formatMoney(branchNetCapital)}
                </strong>
                <span className="susu-capital-stat__meta muted">
                  Branch net
                  {branchTotalDrawings > 0 ? ` · ${formatMoney(branchTotalAdded)} in` : ""}
                </span>
              </div>
            </div>

            <p className="susu-capital-card__tip">
              <strong>Day 1 tip:</strong> Record starting owner cash here and keep{" "}
              <strong>Opening vault</strong> at GHS 0.00 so the same cash is not counted twice.
            </p>

            {capitalSummary && capitalSummary.entries.length > 0 ? (
              <div className="admin-table-wrap susu-capital-card__table-wrap">
                <div className="admin-table-scroll">
                  <table className="admin-table susu-capital-table">
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Details</th>
                        <th className="susu-capital-col--num">Amount</th>
                        <th>Recorded by</th>
                        {canManageCapital ? (
                          <th className="admin-table-actions-col">Action</th>
                        ) : null}
                      </tr>
                    </thead>
                    <tbody>
                      {capitalSummary.entries.map((entry) => {
                        const isVoided = Boolean(entry.voidedAt);
                        const detailNote = isVoided
                          ? `Voided: ${entry.voidReason ?? "—"}`
                          : entry.notes;
                        return (
                          <tr
                            key={entry.id}
                            className={isVoided ? "susu-capital-row--voided" : undefined}
                          >
                            <td className="admin-table-mono susu-capital-col--date">
                              {entry.businessDate}
                            </td>
                            <td className="susu-capital-col--details">
                              <div className="susu-capital-entry__top">
                                <span
                                  className={`susu-capital-badge ${
                                    isVoided
                                      ? "susu-capital-badge--voided"
                                      : entry.entryType === "injection"
                                        ? "susu-capital-badge--in"
                                        : "susu-capital-badge--out"
                                  }`}
                                  title={
                                    isVoided
                                      ? `Voided entry${entry.voidReason ? `: ${entry.voidReason}` : ""}`
                                      : entry.entryType === "injection"
                                        ? CAPITAL_INJECTION_TOOLTIP
                                        : CAPITAL_DRAWING_TOOLTIP
                                  }
                                >
                                  {isVoided
                                    ? "Voided"
                                    : entry.entryType === "injection"
                                      ? "Capital added"
                                      : "Owner drawing"}
                                </span>
                                <span className="susu-capital-entry__source">
                                  {entry.source || "Business capital"}
                                  {entry.reference ? (
                                    <span className="muted"> · {entry.reference}</span>
                                  ) : null}
                                </span>
                              </div>
                              {detailNote ? (
                                <p className="susu-capital-entry__note muted" title={detailNote}>
                                  {detailNote}
                                </p>
                              ) : null}
                            </td>
                            <td
                              className={`susu-capital-col--num ${
                                isVoided
                                  ? ""
                                  : entry.entryType === "injection"
                                    ? "susu-capital-amount--in"
                                    : "susu-capital-amount--out"
                              }`}
                            >
                              {entry.entryType === "injection" ? "+" : "−"}{" "}
                              {formatMoney(entry.amount)}
                            </td>
                            <td className="susu-capital-col--by">
                              {entry.recordedByName || entry.recordedBy}
                            </td>
                            {canManageCapital ? (
                              <td className="admin-table-actions-col">
                                {isVoided ? (
                                  <span className="muted">—</span>
                                ) : (
                                  <button
                                    type="button"
                                    className="button secondary button--sm"
                                    disabled={savingCapital}
                                    onClick={() => {
                                      setVoidTarget(entry);
                                      setVoidReason("");
                                    }}
                                  >
                                    Void
                                  </button>
                                )}
                              </td>
                            ) : null}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              <p className="muted susu-capital-card__empty">
                No capital injections or owner drawings recorded yet for {branchLabel}.
              </p>
            )}
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
                  {dirty ? (
                    <span
                      className="susu-closing-editor__pill susu-closing-editor__pill--delta susu-tooltip susu-tooltip--end"
                      data-tooltip={UNSAVED_CHANGES_TOOLTIP}
                      tabIndex={0}
                    >
                      Unsaved changes
                    </span>
                  ) : null}
                  <button
                    type="button"
                    className="button secondary susu-tooltip susu-tooltip--end"
                    data-tooltip={RESET_CLOSING_TOOLTIP}
                    disabled={saving}
                    onClick={resetFromSuggestion}
                  >
                    Reset
                  </button>
                  <button
                    type="submit"
                    className="button susu-tooltip susu-tooltip--end"
                    data-tooltip={SAVE_CLOSING_TOOLTIP}
                    disabled={saving}
                  >
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
                          ? liveOpeningDelta > 0
                            ? " susu-closing-editor__pill--delta"
                            : " susu-closing-editor__pill--shortage"
                          : " susu-closing-editor__pill--ok"
                      }`}
                    >
                      {Math.abs(liveOpeningDelta) >= 0.005
                        ? `Diff ${liveOpeningDelta > 0 ? "+" : "−"} ${formatMoney(Math.abs(liveOpeningDelta))}`
                        : "Matches suggestion"}
                    </span>
                  </div>
                  <label className="field">
                    <span>Opening vault</span>
                    <AccountingAmountInput
                      value={openingVault}
                      onChange={setOpeningVault}
                      allowEmpty
                      placeholder={formatAccountingInput(snapshot.suggestedOpeningVault)}
                    />
                  </label>
                  {Math.abs(liveOpeningDelta) >= 0.005 ? (
                    <p
                      className={`susu-closing-editor__diff ${
                        liveOpeningDelta > 0
                          ? "susu-closing-editor__diff--surplus"
                          : "susu-closing-editor__diff--shortage"
                      }`}
                      role="status"
                    >
                      <strong>
                        Difference: {liveOpeningDelta > 0 ? "+" : "−"}{" "}
                        {formatMoney(Math.abs(liveOpeningDelta))}
                      </strong>{" "}
                      ({liveOpeningDelta > 0 ? "above" : "below"} suggested{" "}
                      {formatMoney(snapshot.suggestedOpeningVault)})
                    </p>
                  ) : null}
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
                      <span>Cash to bank</span>
                      <AccountingAmountInput
                        value={cashToBank}
                        onChange={setCashToBank}
                        allowEmpty
                        placeholder="0.00"
                      />
                    </label>
                    <label className="field">
                      <span>Branch expenses</span>
                      <AccountingAmountInput
                        value={susuExpenses}
                        onChange={setSusuExpenses}
                        allowEmpty
                        placeholder={formatAccountingInput(snapshot.tillExpenses)}
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
                    <span
                      className={`susu-closing-editor__pill${
                        liveVaultDifference == null
                          ? ""
                          : Math.abs(liveVaultDifference) < 0.005
                            ? " susu-closing-editor__pill--ok"
                            : liveVaultDifference > 0
                              ? " susu-closing-editor__pill--delta"
                              : " susu-closing-editor__pill--shortage"
                      }`}
                    >
                      {liveVaultDifference == null
                        ? "Optional"
                        : Math.abs(liveVaultDifference) < 0.005
                          ? "Balanced"
                          : liveVaultDifference > 0
                            ? `Surplus + ${formatMoney(liveVaultDifference)}`
                            : `Shortage − ${formatMoney(Math.abs(liveVaultDifference))}`}
                    </span>
                  </div>
                  <label className="field">
                    <span>Vault counted</span>
                    <AccountingAmountInput
                      value={closingVaultCounted}
                      onChange={setClosingVaultCounted}
                      allowEmpty
                      placeholder={formatAccountingInput(liveExpectedClosingVault)}
                    />
                  </label>
                  {liveVaultDifference != null ? (
                    <p
                      className={`susu-closing-editor__diff ${
                        Math.abs(liveVaultDifference) < 0.005
                          ? "susu-closing-editor__diff--ok"
                          : liveVaultDifference > 0
                            ? "susu-closing-editor__diff--surplus"
                            : "susu-closing-editor__diff--shortage"
                      }`}
                      role="status"
                    >
                      {Math.abs(liveVaultDifference) < 0.005 ? (
                        <>
                          <strong>Difference: {formatMoney(0)}</strong> — Counted cash matches
                          expected closing vault.
                        </>
                      ) : liveVaultDifference > 0 ? (
                        <>
                          <strong>Difference (Surplus): + {formatMoney(liveVaultDifference)}</strong>{" "}
                          — Counted cash is above expected {formatMoney(liveExpectedClosingVault)}.
                        </>
                      ) : (
                        <>
                          <strong>
                            Difference (Shortage): − {formatMoney(Math.abs(liveVaultDifference))}
                          </strong>{" "}
                          — Counted cash is below expected {formatMoney(liveExpectedClosingVault)}.
                        </>
                      )}
                    </p>
                  ) : null}
                  <p className="muted susu-closing-editor__meta">
                    Expected {formatMoney(liveExpectedClosingVault)}. Counted value becomes
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

      <Modal
        open={capitalModalOpen}
        title={capitalType === "injection" ? "Add business capital" : "Record owner drawing"}
        subtitle={`${branchLabel} · ${businessDate}`}
        onClose={() => !savingCapital && setCapitalModalOpen(false)}
      >
        <form className="form-stack" onSubmit={(e) => void handleCapitalSubmit(e)}>
          <div className="susu-capital-modal__toggle" role="group" aria-label="Entry type">
            <button
              type="button"
              className={`button susu-tooltip susu-tooltip--below susu-tooltip--start ${capitalType === "injection" ? "" : "secondary"}`}
              data-tooltip={CAPITAL_INJECTION_TOOLTIP}
              onClick={() => {
                setCapitalType("injection");
                if (capitalSource === "Owner drawing") {
                  setCapitalSource("Owner cash");
                }
              }}
            >
              + Capital added
            </button>
            <button
              type="button"
              className={`button susu-tooltip susu-tooltip--below susu-tooltip--end ${capitalType === "drawing" ? "" : "secondary"}`}
              data-tooltip={CAPITAL_DRAWING_TOOLTIP}
              onClick={() => {
                setCapitalType("drawing");
                if (capitalSource === "Owner cash") {
                  setCapitalSource("Owner drawing");
                }
              }}
            >
              − Owner drawing
            </button>
          </div>
          <p className="susu-capital-modal__hint muted">
            {capitalType === "injection" ? CAPITAL_INJECTION_TOOLTIP : CAPITAL_DRAWING_TOOLTIP}
          </p>

          <label className="field">
            <span>Amount</span>
            <AccountingAmountInput
              value={capitalAmount}
              onChange={setCapitalAmount}
              required
              autoFocus
              allowEmpty
              placeholder="0.00"
            />
          </label>

          <label className="field">
            <span>Source / description</span>
            <input
              type="text"
              maxLength={120}
              value={capitalSource}
              onChange={(e) => setCapitalSource(e.target.value)}
              placeholder={
                capitalType === "injection"
                  ? "Owner cash, bank transfer, partner equity…"
                  : "Owner drawing, profit withdrawal…"
              }
            />
          </label>

          <label className="field">
            <span>Reference (optional)</span>
            <input
              type="text"
              maxLength={120}
              value={capitalReference}
              onChange={(e) => setCapitalReference(e.target.value)}
              placeholder="Receipt or transfer ref…"
            />
          </label>

          <label className="field">
            <span>Notes (optional)</span>
            <textarea
              rows={2}
              maxLength={500}
              value={capitalNotes}
              onChange={(e) => setCapitalNotes(e.target.value)}
              placeholder="Any extra context for audit trail…"
            />
          </label>

          <div className="form-actions">
            <button
              type="button"
              className="button secondary"
              disabled={savingCapital}
              onClick={() => setCapitalModalOpen(false)}
            >
              Cancel
            </button>
            <button type="submit" className="button" disabled={savingCapital}>
              {savingCapital
                ? "Saving…"
                : capitalType === "injection"
                  ? "Save capital added"
                  : "Save owner drawing"}
            </button>
          </div>
        </form>
      </Modal>

      <Modal
        open={voidTarget != null}
        title="Void capital entry"
        subtitle={
          voidTarget
            ? `${voidTarget.businessDate} · ${formatMoney(voidTarget.amount)} (${
                voidTarget.entryType === "injection" ? "Capital added" : "Owner drawing"
              })`
            : undefined
        }
        onClose={() => !savingCapital && setVoidTarget(null)}
      >
        <form className="form-stack" onSubmit={(e) => void handleVoidSubmit(e)}>
          <p className="muted">
            Voiding removes this entry from total business capital and today&apos;s Expected Closing
            Vault while keeping it visible in the audit log.
          </p>
          <label className="field">
            <span>Reason for voiding</span>
            <input
              type="text"
              required
              autoFocus
              maxLength={300}
              value={voidReason}
              onChange={(e) => setVoidReason(e.target.value)}
              placeholder="e.g. Duplicate entry or wrong amount"
            />
          </label>
          <div className="form-actions">
            <button
              type="button"
              className="button secondary"
              disabled={savingCapital}
              onClick={() => setVoidTarget(null)}
            >
              Cancel
            </button>
            <button type="submit" className="button button--danger" disabled={savingCapital}>
              {savingCapital ? "Voiding…" : "Confirm void"}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
