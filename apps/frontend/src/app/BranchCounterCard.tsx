import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useShallow } from "zustand/react/shallow";
import { SAVINGS_INITIAL_DEPOSIT_GHS } from "@bms/shared";
import type { AppRole } from "./api";
import { BranchCounterFloatPanel } from "./BranchCounterFloatPanel";
import { BranchCounterCashCalculator } from "./BranchCounterCashCalculator";
import { BranchCounterStatementPanel } from "./BranchCounterStatement";
import { filterRowsBySearch } from "../components/AdminDataTable";
import { useToast } from "../components/Toast";
import { balancesFromLedger } from "../lib/customerBalance";
import {
  checkTillFloatForTransaction,
  projectedFloatBalance,
  roleRequiresBranchFloat
} from "../lib/branchFloatBalance";
import { downloadCustomerLedgerCsv } from "../lib/customerLedgerCsv";
import { toUserFacingError } from "../lib/networkError";
import {
  selectActiveCustomers,
  selectLedgerForCustomer,
  useBranchCounterStore
} from "./stores/branchCounterStore";

type TxType = "daily_susu" | "deposit" | "withdrawal";

const TX_LABELS: Record<TxType, string> = {
  deposit: "Deposit",
  withdrawal: "Withdrawal",
  daily_susu: "Daily Susu"
};

const QUICK_AMOUNTS = [20, 50, 100, 200, 500];

function allowedTransactionTypes(role: AppRole): TxType[] {
  if (role === "teller") {
    return ["deposit", "withdrawal"];
  }
  if (role === "coordinator" || role === "admin" || role === "field_agent") {
    return ["deposit", "withdrawal", "daily_susu"];
  }
  return [];
}

function formatLedgerDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    });
  } catch {
    return iso;
  }
}

type Props = { role: AppRole };

export function BranchCounterCard({ role }: Props) {
  const { showToast } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const txTypes = allowedTransactionTypes(role);
  const isHeadOfficeRole = role === "admin" || role === "auditor" || role === "accountant";

  const [search, setSearch] = useState("");
  const [type, setType] = useState<TxType>(txTypes[0] ?? "deposit");
  const [amount, setAmount] = useState("");
  const [notes, setNotes] = useState("");
  const [confirmWithdraw, setConfirmWithdraw] = useState(false);
  const [calculatorOpen, setCalculatorOpen] = useState(false);

  const {
    customers,
    branches,
    statement,
    statementBranchId,
    statementDate,
    transactionBranchId,
    selectedCustomerId,
    loading,
    refreshing,
    statementLoading,
    ledgerLoading,
    posting,
    error,
    sessionExpired,
    lastFetchedAt,
    liveSyncActive,
    hydrate,
    startLiveSync,
    stopLiveSync,
    initBranchScope,
    setStatementBranchId,
    setStatementDate,
    setTransactionBranchId,
    selectCustomer,
    postTransaction,
    floatSession,
    floatSummary,
    pendingFloatRequests,
    refresh
  } = useBranchCounterStore(
    useShallow((s) => ({
      customers: s.customers,
      branches: s.branches,
      statement: s.statement,
      statementBranchId: s.statementBranchId,
      statementDate: s.statementDate,
      transactionBranchId: s.transactionBranchId,
      selectedCustomerId: s.selectedCustomerId,
      loading: s.loading,
      refreshing: s.refreshing,
      statementLoading: s.statementLoading,
      ledgerLoading: s.ledgerLoading,
      posting: s.posting,
      error: s.error,
      sessionExpired: s.sessionExpired,
      lastFetchedAt: s.lastFetchedAt,
      liveSyncActive: s.liveSyncActive,
      hydrate: s.hydrate,
      startLiveSync: s.startLiveSync,
      stopLiveSync: s.stopLiveSync,
      initBranchScope: s.initBranchScope,
      setStatementBranchId: s.setStatementBranchId,
      setStatementDate: s.setStatementDate,
      setTransactionBranchId: s.setTransactionBranchId,
      selectCustomer: s.selectCustomer,
      postTransaction: s.postTransaction,
      floatSession: s.floatSession,
      floatSummary: s.floatSummary,
      pendingFloatRequests: s.pendingFloatRequests,
      refresh: s.refresh
    }))
  );

  const tillBlocksPosting =
    roleRequiresBranchFloat(role) &&
    floatSummary != null &&
    !floatSummary.canTransact;

  const parsedAmount = Number(amount);
  const amountValid = Number.isFinite(parsedAmount) && parsedAmount > 0;
  const floatCheck =
    amountValid && floatSummary
      ? checkTillFloatForTransaction({ role, type, amount: parsedAmount, floatSummary })
      : null;
  const floatInsufficient = floatCheck != null && !floatCheck.ok;
  const projectedTillBalance =
    amountValid && floatSummary
      ? projectedFloatBalance(floatSummary, type, parsedAmount)
      : null;
  const showFloatBalance = roleRequiresBranchFloat(role) && floatSummary?.canTransact;

  const ledger = useBranchCounterStore(
    useShallow((s) => selectLedgerForCustomer(s, selectedCustomerId))
  );

  useEffect(() => {
    initBranchScope(isHeadOfficeRole);
    hydrate();
    startLiveSync();
    return () => stopLiveSync();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount lifecycle
  }, []);

  useEffect(() => {
    const paramId = searchParams.get("customerId");
    if (paramId) {
      selectCustomer(paramId);
    }
  }, [searchParams, selectCustomer]);

  useEffect(() => {
    if (!txTypes.includes(type)) {
      setType(txTypes[0] ?? "deposit");
    }
  }, [txTypes, type]);

  const activeCustomers = useMemo(() => selectActiveCustomers(customers), [customers]);

  const filteredCustomers = useMemo(
    () =>
      filterRowsBySearch(activeCustomers, search, [
        "fullName",
        "phone",
        "accountNumber",
        "idCardNumber"
      ] as (keyof (typeof activeCustomers)[0])[]).slice(0, 10),
    [activeCustomers, search]
  );

  const selectedCustomer = useMemo(
    () => activeCustomers.find((c) => c.id === selectedCustomerId) ?? null,
    [activeCustomers, selectedCustomerId]
  );

  const balances = useMemo(
    () =>
      selectedCustomer
        ? balancesFromLedger(selectedCustomer, ledger)
        : { accountBalance: 0, withdrawableBalance: 0, lockedAmount: 0, isSavings: false },
    [selectedCustomer, ledger]
  );

  function handleSelectCustomer(id: string) {
    selectCustomer(id);
    setConfirmWithdraw(false);
    setSearchParams(id ? { customerId: id } : {}, { replace: true });
  }

  function applyQuickAmount(value: number) {
    setAmount(String(value));
    setConfirmWithdraw(false);
  }

  function applyCalculatorAmount(value: number) {
    setAmount(value.toFixed(2));
    setConfirmWithdraw(false);
    setCalculatorOpen(false);
    showToast(`Amount set to GHS ${value.toFixed(2)}`, "success");
  }

  async function handlePost() {
    if (sessionExpired) {
      showToast("Sign in again to post transactions", "error");
      return;
    }
    if (!selectedCustomer) {
      showToast("Select an active customer first", "error");
      return;
    }
    const parsedAmount = Number(amount);
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      showToast("Enter a valid amount greater than zero", "error");
      return;
    }
    if (!transactionBranchId) {
      showToast("Select the branch where this transaction is handled", "error");
      return;
    }
    const floatGate = checkTillFloatForTransaction({
      role,
      type,
      amount: parsedAmount,
      floatSummary
    });
    if (!floatGate.ok) {
      showToast(floatGate.message, "error");
      return;
    }
    if (type === "withdrawal" && parsedAmount > balances.withdrawableBalance) {
      showToast(
        `Insufficient withdrawable balance (GHS ${balances.withdrawableBalance.toFixed(2)} available)`,
        "error"
      );
      return;
    }
    if (type === "withdrawal" && !confirmWithdraw) {
      setConfirmWithdraw(true);
      return;
    }

    try {
      await postTransaction({
        customerId: selectedCustomer.id,
        type,
        amount: parsedAmount,
        transactionBranchId,
        notes: notes.trim() || undefined
      });
      showToast(
        `${TX_LABELS[type]} of GHS ${parsedAmount.toFixed(2)} posted for ${selectedCustomer.fullName}`,
        "success"
      );
      setAmount("");
      setNotes("");
      setConfirmWithdraw(false);
    } catch (err) {
      showToast(toUserFacingError(err, "Failed to post transaction"), "error");
    }
  }

  const recentLedger = [...ledger].reverse().slice(0, 15);
  const canDownloadLedger = Boolean(selectedCustomer && ledger.length > 0);

  function handleDownloadLedger() {
    if (!selectedCustomer || ledger.length === 0) {
      return;
    }
    try {
      downloadCustomerLedgerCsv(selectedCustomer, ledger);
      showToast("Ledger CSV downloaded", "success");
    } catch {
      showToast("Failed to download ledger CSV", "error");
    }
  }

  const showCatalogLoader = loading && customers.length === 0;
  const updatedLabel = lastFetchedAt
    ? `Updated ${new Date(lastFetchedAt).toLocaleTimeString()}${refreshing ? " · syncing" : ""}${liveSyncActive ? "" : ""}`
    : "Loading…";

  return (
    <div className="branch-counter">
      <header className="branch-counter__toolbar">
        <div>
          <h2>Branch counter</h2>
          <p className="muted branch-counter__subtitle">
            Susu teller desk — walk-in deposits, withdrawals &amp; daily Susu · {updatedLabel}
          </p>
        </div>
        <div className="branch-counter__toolbar-actions">
          <button
            type="button"
            className="button secondary branch-counter__calc-btn"
            disabled={sessionExpired}
            onClick={() => setCalculatorOpen(true)}
            aria-label="Open cash calculator"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
              <rect x="4" y="2" width="16" height="20" rx="2" />
              <path d="M8 6h8M8 10h2M12 10h2M16 10h0M8 14h2M12 14h2M16 14h0M8 18h2M12 18h4" />
            </svg>
            Calculator
          </button>
          <button
            type="button"
            className="button secondary"
            disabled={showCatalogLoader || refreshing || sessionExpired}
            onClick={() => {
              void useBranchCounterStore.getState().refreshSilent().then(() => {
                showToast("Refreshed", "success");
              });
            }}
          >
            {refreshing ? "Syncing…" : "Refresh"}
          </button>
        </div>
      </header>

      <BranchCounterCashCalculator
        open={calculatorOpen}
        onClose={() => setCalculatorOpen(false)}
        onApply={applyCalculatorAmount}
      />

      {sessionExpired || error ? (
        <div className="branch-counter__alert" role="alert">
          <p>{error ?? "Something went wrong loading data."}</p>
          {sessionExpired ? (
            <Link to="/login" className="button">
              Sign in again
            </Link>
          ) : (
            <button
              type="button"
              className="button secondary"
              onClick={() => void useBranchCounterStore.getState().refresh()}
            >
              Retry
            </button>
          )}
        </div>
      ) : null}

      {!sessionExpired ? (
        <BranchCounterFloatPanel
          role={role}
          branches={branches}
          transactionBranchId={transactionBranchId}
          floatSession={floatSession}
          floatSummary={floatSummary}
          pendingFloatRequests={pendingFloatRequests}
          onUpdated={() => void refresh()}
        />
      ) : null}

      <div className="branch-counter__workspace">
        <section className="branch-counter__find card">
          <div className="branch-counter__section-head">
            <span className="branch-counter__step">1</span>
            <h3>Find customer</h3>
          </div>

          <label className="field branch-counter__search">
            <span className="sr-only">Search</span>
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Name, phone, or account number…"
              autoComplete="off"
              disabled={sessionExpired}
            />
          </label>

          <div className="branch-counter__results" aria-busy={showCatalogLoader}>
            {showCatalogLoader ? (
              <div className="branch-counter__skeleton-list">
                {[1, 2, 3].map((n) => (
                  <div key={n} className="branch-counter__skeleton-row" />
                ))}
              </div>
            ) : filteredCustomers.length === 0 ? (
              <p className="muted branch-counter__empty">No active customers match your search.</p>
            ) : (
              <ul className="branch-counter__pick-list" role="listbox" aria-label="Customers">
                {filteredCustomers.map((c) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={c.id === selectedCustomerId}
                      className={`branch-counter__pick${c.id === selectedCustomerId ? " branch-counter__pick--active" : ""}`}
                      onClick={() => handleSelectCustomer(c.id)}
                    >
                      <span className="branch-counter__pick-main">
                        <strong>{c.fullName}</strong>
                        <span className="branch-counter__pick-acct">
                          {c.accountNumber ?? "Pending acct"}
                        </span>
                      </span>
                      <span className="muted branch-counter__pick-phone">{c.phone}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        <section className="branch-counter__main">
          {selectedCustomer ? (
            <div className="branch-counter__hero card">
              <div className="branch-counter__hero-top">
                <div>
                  <p className="branch-counter__hero-eyebrow">Selected account</p>
                  <h3 className="branch-counter__hero-name">{selectedCustomer.fullName}</h3>
                  <p className="muted">
                    {selectedCustomer.accountNumber ?? "—"} ·{" "}
                    {selectedCustomer.accountType?.replace(/_/g, " ") ?? "Account"}
                  </p>
                </div>
                <button
                  type="button"
                  className="button secondary branch-counter__clear"
                  onClick={() => handleSelectCustomer("")}
                >
                  Clear
                </button>
              </div>
              <div className="branch-counter__hero-balances">
                <div className="branch-counter__hero-balance branch-counter__hero-balance--primary">
                  <span>Account balance</span>
                  <strong>{ledgerLoading ? "…" : `GHS ${balances.accountBalance.toFixed(2)}`}</strong>
                </div>
                {balances.isSavings ? (
                  <>
                    <div className="branch-counter__hero-balance">
                      <span>Withdrawable</span>
                      <strong>
                        {ledgerLoading ? "…" : `GHS ${balances.withdrawableBalance.toFixed(2)}`}
                      </strong>
                    </div>
                    <div className="branch-counter__hero-balance">
                      <span>Locked</span>
                      <strong>
                        GHS {(selectedCustomer.lockedBalance ?? SAVINGS_INITIAL_DEPOSIT_GHS).toFixed(2)}
                      </strong>
                    </div>
                  </>
                ) : null}
              </div>
            </div>
          ) : (
            <div className="branch-counter__hero branch-counter__hero--empty card">
              <p className="branch-counter__hero-placeholder">
                Search and select a customer to see balance and post a transaction.
              </p>
            </div>
          )}

          <div className="branch-counter__post card">
            <div className="branch-counter__section-head">
              <span className="branch-counter__step">2</span>
              <h3>Post transaction</h3>
            </div>

            <div className="branch-counter__type-tabs" role="tablist" aria-label="Transaction type">
              {txTypes.map((tx) => (
                <button
                  key={tx}
                  type="button"
                  role="tab"
                  aria-selected={type === tx}
                  disabled={!selectedCustomer || posting || sessionExpired}
                  className={`branch-counter__type-tab branch-counter__type-tab--${tx}${type === tx ? " branch-counter__type-tab--active" : ""}`}
                  onClick={() => {
                    setType(tx);
                    setConfirmWithdraw(false);
                  }}
                >
                  {TX_LABELS[tx]}
                </button>
              ))}
            </div>

            <div className="branch-counter__amount-row">
              {showFloatBalance ? (
                <div
                  className={`branch-counter__float-balance${floatSummary.isLowFloat ? " branch-counter__float-balance--low" : ""}`}
                  role="status"
                >
                  <div className="branch-counter__float-balance-head">
                    <span>Float balance</span>
                    <strong>GHS {floatSummary.floatBalance.toFixed(2)}</strong>
                  </div>
                  {floatSummary.isLowFloat ? (
                    <p className="branch-counter__float-reminder">
                      Low float — request more from admin before large deposits or Susu collections.
                    </p>
                  ) : null}
                  {projectedTillBalance != null ? (
                    <p className="muted branch-counter__float-projected">
                      Float after this {TX_LABELS[type].toLowerCase()}: GHS{" "}
                      {projectedTillBalance.toFixed(2)}
                      {type === "withdrawal"
                        ? ` · Cash in till: GHS ${(floatSummary.expectedCash - parsedAmount).toFixed(2)}`
                        : null}
                    </p>
                  ) : null}
                  {floatInsufficient && floatCheck && !floatCheck.ok ? (
                    <p className="branch-counter__float-warn">{floatCheck.message}</p>
                  ) : null}
                </div>
              ) : null}
              <label className="field branch-counter__amount-field">
                <span>Amount (GHS)</span>
                <input
                  className="input-no-spin"
                  type="number"
                  min={0.01}
                  step={0.01}
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => {
                    setAmount(e.target.value);
                    setConfirmWithdraw(false);
                  }}
                  placeholder="0.00"
                  disabled={!selectedCustomer || posting || sessionExpired}
                />
              </label>
              <div className="branch-counter__quick-amounts" aria-label="Quick amounts">
                {QUICK_AMOUNTS.map((q) => (
                  <button
                    key={q}
                    type="button"
                    className="branch-counter__quick-btn"
                    disabled={!selectedCustomer || posting || sessionExpired}
                    onClick={() => applyQuickAmount(q)}
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>

            <div className="branch-counter__post-grid">
              <label className="field">
                <span>Branch</span>
                <select
                  value={transactionBranchId}
                  disabled={
                    sessionExpired || (!isHeadOfficeRole && branches.length <= 1) || !selectedCustomer
                  }
                  onChange={(e) => setTransactionBranchId(e.target.value)}
                >
                  <option value="">Select branch</option>
                  {branches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name} ({b.code})
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Notes (optional)</span>
                <input
                  type="text"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Walk-in cash, hall counter…"
                  disabled={!selectedCustomer || posting || sessionExpired}
                />
              </label>
            </div>

            {type === "withdrawal" && confirmWithdraw && selectedCustomer ? (
              <p className="branch-counter__confirm" role="status">
                Confirm withdrawal of <strong>GHS {Number(amount).toFixed(2)}</strong> for{" "}
                {selectedCustomer.fullName}? Available: GHS {balances.withdrawableBalance.toFixed(2)}.
              </p>
            ) : null}

            <div className="branch-counter__actions">
              {confirmWithdraw ? (
                <button
                  type="button"
                  className="button secondary"
                  disabled={posting}
                  onClick={() => setConfirmWithdraw(false)}
                >
                  Cancel
                </button>
              ) : null}
              <button
                type="button"
                className={`button branch-counter__submit branch-counter__submit--${type}`}
                disabled={
                  !selectedCustomer ||
                  posting ||
                  sessionExpired ||
                  txTypes.length === 0 ||
                  tillBlocksPosting ||
                  floatInsufficient
                }
                onClick={() => void handlePost()}
              >
                {posting
                  ? "Posting…"
                  : confirmWithdraw
                    ? "Confirm withdrawal"
                    : type === "withdrawal"
                      ? "Review withdrawal"
                      : `Post ${TX_LABELS[type].toLowerCase()}`}
              </button>
            </div>
          </div>
        </section>
      </div>

      <section className="card branch-counter__ledger-section">
        <div className="branch-counter__section-head branch-counter__ledger-section-head">
          <span className="branch-counter__step">3</span>
          <h3>Ledger history</h3>
          <span className="muted branch-counter__ledger-meta">
            {selectedCustomer ? selectedCustomer.fullName : "No customer selected"}
          </span>
          <button
            type="button"
            className="button secondary branch-counter__export-btn cif-ledger-toolbar__download"
            disabled={!canDownloadLedger || ledgerLoading}
            onClick={handleDownloadLedger}
          >
            Download CSV
          </button>
        </div>

        {!selectedCustomer ? (
          <p className="muted branch-counter__empty">Select a customer to view ledger entries.</p>
        ) : ledgerLoading && recentLedger.length === 0 ? (
          <div className="branch-counter__skeleton-table">
            {[1, 2, 3, 4].map((n) => (
              <div key={n} className="branch-counter__skeleton-row" />
            ))}
          </div>
        ) : recentLedger.length === 0 ? (
          <p className="muted branch-counter__empty">No ledger entries yet for this account.</p>
        ) : (
          <div className="cif-ledger branch-counter__ledger" role="table">
            <div className="cif-ledger__head cif-ledger__head--bold" role="row">
              <span role="columnheader">
                <strong>Date</strong>
              </span>
              <span role="columnheader">
                <strong>Type</strong>
              </span>
              <span role="columnheader">
                <strong>Amount</strong>
              </span>
              <span role="columnheader">
                <strong>Recorded by</strong>
              </span>
              <span role="columnheader">
                <strong>Balance</strong>
              </span>
            </div>
            {recentLedger.map((entry) => (
              <div className="cif-ledger__row" role="row" key={entry.id}>
                <span>{formatLedgerDate(entry.createdAt)}</span>
                <span className={`cif-ledger__type--${entry.entryType}`}>
                  {entry.entryType === "credit" ? "Credit" : "Debit"}
                </span>
                <span className="branch-counter__ledger-amt">GHS {entry.amount.toFixed(2)}</span>
                <span className="cif-ledger__by" title={entry.performedByName ?? undefined}>
                  {entry.performedByName ?? entry.recordedByName ?? "—"}
                </span>
                <span className="branch-counter__ledger-bal">GHS {entry.balanceAfter.toFixed(2)}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      <BranchCounterStatementPanel />
    </div>
  );
}
