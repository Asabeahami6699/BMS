import {
  formatAccountAmount,
  SUSU_COMMISSION_DEBIT_TAG,
  SUSU_COMMISSION_REFUND_TAG
} from "@bms/shared";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useShallow } from "zustand/react/shallow";
import {
  AccountingAmountInput,
  formatAccountingInput,
  parseAccountingAmount
} from "../components/AccountingAmountInput";
import { useToast } from "../components/Toast";
import { toUserFacingError } from "../lib/networkError";
import type { AppRole, BranchCounterStatementLine } from "./api";
import { closeBranchFloat, settleBranchFloat } from "./api";
import { formatBranchLabel } from "./branchDisplay";
import { useBranchCounterStore } from "./stores/branchCounterStore";
import { usePageLoading } from "./hooks/usePageLoading";

type Props = {
  role: AppRole;
};

const REQUIRES_FLOAT = new Set<AppRole>(["teller", "coordinator"]);

function formatMoney(n: number): string {
  return `GHS ${formatAccountAmount(n)}`;
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit"
    });
  } catch {
    return "";
  }
}

function isFieldPayoutLine(line: BranchCounterStatementLine): boolean {
  const notes = (line.notes ?? "").toLowerCase();
  return (
    notes.includes("teller cash payout") ||
    notes.includes("agency withdrawal") ||
    notes.includes("teller payout")
  );
}

export function TellerCalloverPage({ role }: Props) {
  const { showToast } = useToast();
  const isHeadOfficeRole = role === "admin" || role === "accountant" || role === "auditor";
  const isAdminLike = role === "admin" || role === "coordinator";
  const needsFloat = REQUIRES_FLOAT.has(role);

  const {
    branches,
    statement,
    tellerTodayStatement,
    statementBranchId,
    statementDate,
    floatSession,
    floatSummary,
    loading,
    refreshing,
    statementLoading,
    error,
    tellerCalloverCheckedBySession,
    tellerCalloverConfirmedBySession,
    initBranchScope,
    hydrate,
    refresh,
    startLiveSync,
    stopLiveSync,
    setStatementBranchId,
    setStatementDate,
    toggleTellerCalloverTx,
    setTellerCalloverMany,
    setTellerCalloverConfirmed,
    clearTellerCallover
  } = useBranchCounterStore(
    useShallow((s) => ({
      branches: s.branches,
      statement: s.statement,
      tellerTodayStatement: s.tellerTodayStatement,
      statementBranchId: s.statementBranchId,
      statementDate: s.statementDate,
      floatSession: s.floatSession,
      floatSummary: s.floatSummary,
      loading: s.loading,
      refreshing: s.refreshing,
      statementLoading: s.statementLoading,
      error: s.error,
      tellerCalloverCheckedBySession: s.tellerCalloverCheckedBySession,
      tellerCalloverConfirmedBySession: s.tellerCalloverConfirmedBySession,
      initBranchScope: s.initBranchScope,
      hydrate: s.hydrate,
      refresh: s.refresh,
      startLiveSync: s.startLiveSync,
      stopLiveSync: s.stopLiveSync,
      setStatementBranchId: s.setStatementBranchId,
      setStatementDate: s.setStatementDate,
      toggleTellerCalloverTx: s.toggleTellerCalloverTx,
      setTellerCalloverMany: s.setTellerCalloverMany,
      setTellerCalloverConfirmed: s.setTellerCalloverConfirmed,
      clearTellerCallover: s.clearTellerCallover
    }))
  );

  const [search, setSearch] = useState("");
  const [staffFilter, setStaffFilter] = useState("all");
  const [actualClosing, setActualClosing] = useState("");
  const [varianceNote, setVarianceNote] = useState("");
  const [busy, setBusy] = useState(false);

  usePageLoading(loading || busy, "susu-teller-callover");

  useEffect(() => {
    initBranchScope(isHeadOfficeRole);
    hydrate({ force: true });
    startLiveSync();
    return () => stopLiveSync();
  }, [initBranchScope, isHeadOfficeRole, hydrate, startLiveSync, stopLiveSync]);

  useEffect(() => {
    if (error) {
      showToast(error, "error");
    }
  }, [error, showToast]);

  const tillOpen = floatSession?.status === "open";
  const isPersonalTillMode = Boolean(needsFloat && floatSession);

  const activeBranchId = isPersonalTillMode
    ? floatSession!.branchId
    : statementBranchId || branches[0]?.id || "";
  const activeDate = isPersonalTillMode ? floatSession!.businessDate : statementDate;
  const branchLabel = useMemo(
    () => formatBranchLabel(activeBranchId, branches),
    [activeBranchId, branches]
  );

  const activeStatement = useMemo(() => {
    if (isPersonalTillMode) {
      if (tellerTodayStatement) {
        return tellerTodayStatement;
      }
      if (
        statement &&
        statement.summary.branchId === floatSession!.branchId &&
        statement.summary.date === floatSession!.businessDate
      ) {
        return statement;
      }
      return null;
    }
    return statement;
  }, [isPersonalTillMode, tellerTodayStatement, statement, floatSession]);

  const sessionKey = isPersonalTillMode
    ? floatSession!.id
    : `review:${activeBranchId || "branch"}:${activeDate}:${staffFilter}`;

  const staffOptions = useMemo(() => {
    return activeStatement?.summary.byStaff ?? [];
  }, [activeStatement]);

  const callover = useMemo(() => {
    const rawLines = activeStatement?.lines ?? [];
    const cashierFilter = isPersonalTillMode
      ? floatSession!.cashierUserId
      : staffFilter !== "all"
        ? staffFilter
        : null;

    const deposits: BranchCounterStatementLine[] = [];
    const withdrawals: BranchCounterStatementLine[] = [];

    for (const line of rawLines) {
      if (cashierFilter && line.recordedByUserId !== cashierFilter) {
        continue;
      }
      if (line.type === "susu_reversal" || line.reversedAt) {
        continue;
      }
      if (
        line.notes?.includes(SUSU_COMMISSION_DEBIT_TAG) ||
        line.notes?.includes(SUSU_COMMISSION_REFUND_TAG)
      ) {
        continue;
      }
      if (line.type === "deposit" || line.type === "daily_susu") {
        deposits.push(line);
      } else if (line.type === "withdrawal") {
        withdrawals.push(line);
      }
    }

    const q = search.trim().toLowerCase();
    const matchesSearch = (line: BranchCounterStatementLine) => {
      if (!q) {
        return true;
      }
      return (
        line.customerName.toLowerCase().includes(q) ||
        (line.customerAccountNumber ?? "").toLowerCase().includes(q) ||
        (line.notes ?? "").toLowerCase().includes(q) ||
        line.recordedByName.toLowerCase().includes(q)
      );
    };

    const visibleDeposits = deposits.filter(matchesSearch);
    const visibleWithdrawals = withdrawals.filter(matchesSearch);

    const checkedIds = new Set(tellerCalloverCheckedBySession[sessionKey] ?? []);
    const depositIds = deposits.map((d) => d.id);
    const withdrawalIds = withdrawals.map((w) => w.id);
    const checkedDepositsCount = depositIds.filter((id) => checkedIds.has(id)).length;
    const checkedWithdrawalsCount = withdrawalIds.filter((id) => checkedIds.has(id)).length;
    const totalCount = depositIds.length + withdrawalIds.length;
    const checkedCount = checkedDepositsCount + checkedWithdrawalsCount;
    const allItemsChecked = totalCount === 0 || checkedCount === totalCount;
    const confirmed = Boolean(tellerCalloverConfirmedBySession[sessionKey]);

    const depositTotal = Math.round(deposits.reduce((sum, l) => sum + l.amount, 0) * 100) / 100;
    const withdrawalTotal =
      Math.round(withdrawals.reduce((sum, l) => sum + l.amount, 0) * 100) / 100;

    return {
      deposits,
      withdrawals,
      visibleDeposits,
      visibleWithdrawals,
      depositIds,
      withdrawalIds,
      checkedIds,
      checkedDepositsCount,
      checkedWithdrawalsCount,
      totalCount,
      checkedCount,
      allItemsChecked,
      confirmed,
      readyToClose: allItemsChecked && confirmed,
      depositTotal,
      withdrawalTotal
    };
  }, [
    activeStatement,
    isPersonalTillMode,
    floatSession,
    staffFilter,
    search,
    tellerCalloverCheckedBySession,
    tellerCalloverConfirmedBySession,
    sessionKey
  ]);

  const initialCash = floatSession?.initialCash ?? floatSummary?.initialCash ?? 0;
  const extraCash = floatSession?.extraCash ?? floatSummary?.extraCash ?? 0;
  const totalExpenses = floatSession?.totalExpenses ?? floatSummary?.totalExpenses ?? 0;
  const expectedCash = floatSummary?.expectedCash ?? 0;

  const closeVariancePreview = useMemo(() => {
    const raw = actualClosing.trim();
    if (!raw) {
      return null;
    }
    const actual = parseAccountingAmount(raw);
    if (!Number.isFinite(actual) || actual < 0) {
      return null;
    }
    const variance = Math.round((actual - expectedCash) * 100) / 100;
    if (Math.abs(variance) < 0.005) {
      return { type: "balanced" as const, amount: 0, signed: 0 };
    }
    if (variance > 0) {
      return { type: "overage" as const, amount: variance, signed: variance };
    }
    return { type: "shortage" as const, amount: Math.abs(variance), signed: variance };
  }, [actualClosing, expectedCash]);

  async function handleCloseTill(e: FormEvent) {
    e.preventDefault();
    if (!floatSession || floatSession.status !== "open") {
      return;
    }
    if (!callover.allItemsChecked) {
      showToast(
        "Check off all today's deposits and withdrawals before closing your till",
        "error"
      );
      return;
    }
    if (!callover.confirmed) {
      showToast("Tick the call-over verification checkbox before closing your till", "error");
      return;
    }
    const actual = parseAccountingAmount(actualClosing);
    if (!Number.isFinite(actual) || actual < 0) {
      showToast("Enter the physical cash counted in your drawer", "error");
      return;
    }
    const variance = Math.round((actual - expectedCash) * 100) / 100;
    const absVariance = Math.abs(variance);
    if (absVariance >= 0.005 && !varianceNote.trim()) {
      showToast(
        variance > 0
          ? "Add a note explaining the overage before closing"
          : "Add a note explaining the shortage before closing",
        "error"
      );
      return;
    }
    setBusy(true);
    try {
      await closeBranchFloat(floatSession.id, {
        actualClosing: actual,
        varianceNote: varianceNote.trim() || undefined
      });
      if (absVariance < 0.005) {
        showToast("Till closed — drawer balanced", "success");
      } else if (variance > 0) {
        showToast(
          `Till closed — overage ${formatMoney(absVariance)} flagged on Overages/Shortages (Branch till)`,
          "success"
        );
      } else {
        showToast(
          `Till closed — shortage ${formatMoney(absVariance)} flagged on Overages/Shortages (Branch till)`,
          "success"
        );
      }
      clearTellerCallover(floatSession.id);
      setActualClosing("");
      setVarianceNote("");
      await refresh();
    } catch (err) {
      showToast(toUserFacingError(err, "Close till failed"), "error");
    } finally {
      setBusy(false);
    }
  }

  async function handleSettleTill() {
    if (!floatSession || floatSession.status !== "closed") {
      return;
    }
    setBusy(true);
    try {
      await settleBranchFloat(floatSession.id);
      showToast("Till session settled", "success");
      await refresh();
    } catch (err) {
      showToast(toUserFacingError(err, "Settle failed"), "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="susu-closing-page teller-callover-page">
      <div className="page-head">
        <div>
          <p className="susu-closing-editor__eyebrow">Branch counter end-of-day</p>
          <h1>Teller call-over</h1>
          <p className="muted">
            Check every deposit slip and withdrawal voucher for{" "}
            <strong>{branchLabel}</strong> ({activeDate}) before closing your till for the day.
          </p>
        </div>
        <div className="teller-callover-page__head-actions">
          <Link to="/app/susu/collections" className="button secondary">
            Branch counter
          </Link>
          <button
            type="button"
            className="button secondary"
            disabled={loading || refreshing}
            onClick={() => void refresh()}
          >
            {refreshing ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </div>

      {!isPersonalTillMode ? (
        <section className="card susu-closing-filters">
          {branches.length > 1 ? (
            <label className="field">
              <span>Branch</span>
              <select
                value={statementBranchId}
                onChange={(e) => {
                  setStatementBranchId(e.target.value);
                  setStaffFilter("all");
                }}
              >
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name} ({b.code})
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <label className="field">
            <span>Business date</span>
            <input
              type="date"
              value={statementDate}
              onChange={(e) => {
                setStatementDate(e.target.value);
                setStaffFilter("all");
              }}
            />
          </label>
          <label className="field">
            <span>Teller / staff</span>
            <select value={staffFilter} onChange={(e) => setStaffFilter(e.target.value)}>
              <option value="all">All branch counter staff</option>
              {staffOptions.map((s) => (
                <option key={s.userId} value={s.userId}>
                  {s.name} ({s.count})
                </option>
              ))}
            </select>
          </label>
        </section>
      ) : null}

      {isPersonalTillMode ? (
        <section className="kpi-grid susu-closing-kpis" aria-label="Teller drawer summary">
          <article className="kpi-card">
            <span className="kpi-label">Opening + extra cash</span>
            <p className="kpi-value">{formatMoney(initialCash + extraCash)}</p>
            <p className="kpi-meta muted">
              Initial {formatMoney(initialCash)} · Extra {formatMoney(extraCash)}
            </p>
          </article>
          <article className="kpi-card kpi-card--success">
            <span className="kpi-label">Deposits today</span>
            <p className="kpi-value">+ {formatMoney(callover.depositTotal)}</p>
            <p className="kpi-meta muted">
              {callover.checkedDepositsCount}/{callover.deposits.length} checked
            </p>
          </article>
          <article className="kpi-card kpi-card--warning">
            <span className="kpi-label">Withdrawals today</span>
            <p className="kpi-value">− {formatMoney(callover.withdrawalTotal)}</p>
            <p className="kpi-meta muted">
              {callover.checkedWithdrawalsCount}/{callover.withdrawals.length} checked
            </p>
          </article>
          <article className="kpi-card">
            <span className="kpi-label">Till expenses</span>
            <p className="kpi-value">− {formatMoney(totalExpenses)}</p>
            <p className="kpi-meta muted">Approved drawer expenses</p>
          </article>
          <article className="kpi-card kpi-card--success">
            <span className="kpi-label">Expected drawer cash</span>
            <p className="kpi-value">{formatMoney(expectedCash)}</p>
            <p className="kpi-meta muted">
              Till status: <strong>{floatSummary?.statusLabel ?? floatSession?.status}</strong>
            </p>
          </article>
        </section>
      ) : (
        <section className="kpi-grid susu-closing-kpis" aria-label="Counter call-over summary">
          <article className="kpi-card kpi-card--success">
            <span className="kpi-label">Deposits</span>
            <p className="kpi-value">+ {formatMoney(callover.depositTotal)}</p>
            <p className="kpi-meta muted">
              {callover.checkedDepositsCount}/{callover.deposits.length} checked
            </p>
          </article>
          <article className="kpi-card kpi-card--warning">
            <span className="kpi-label">Withdrawals</span>
            <p className="kpi-value">− {formatMoney(callover.withdrawalTotal)}</p>
            <p className="kpi-meta muted">
              {callover.checkedWithdrawalsCount}/{callover.withdrawals.length} checked
            </p>
          </article>
          <article className="kpi-card">
            <span className="kpi-label">Net counter flow</span>
            <p className="kpi-value">
              {formatMoney(callover.depositTotal - callover.withdrawalTotal)}
            </p>
            <p className="kpi-meta muted">
              {callover.checkedCount}/{callover.totalCount} total items checked
            </p>
          </article>
        </section>
      )}

      <section className="card teller-callover-page__board">
        <div className="teller-callover__head">
          <div>
            <p className="susu-closing-editor__eyebrow">Step 1 · Slip &amp; voucher verification</p>
            <h3>Deposits &amp; withdrawals checklist</h3>
            <p className="muted teller-callover__lead">
              Tick off each customer deposit slip and withdrawal voucher below as you verify your
              physical records.
            </p>
          </div>
          <div className="teller-callover-page__toolbar">
            <input
              type="search"
              className="teller-callover-page__search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search customer or account…"
              aria-label="Filter transactions by customer or account"
            />
            <span
              className={`susu-closing-editor__pill ${
                callover.allItemsChecked
                  ? "susu-closing-editor__pill--ok"
                  : "susu-closing-editor__pill--delta"
              }`}
            >
              {callover.totalCount === 0
                ? "No entries today"
                : `${callover.checkedCount}/${callover.totalCount} checked`}
            </span>
          </div>
        </div>

        {statementLoading && !activeStatement ? (
          <p className="muted">Loading today&apos;s counter transactions…</p>
        ) : (
          <div className="teller-callover__grid teller-callover__grid--page">
            <div className="teller-callover__col">
              <div className="teller-callover__col-head">
                <div>
                  <h4>
                    Deposits ({callover.checkedDepositsCount}/{callover.deposits.length})
                  </h4>
                  <span className="muted teller-callover__col-total">
                    Total: + {formatMoney(callover.depositTotal)}
                  </span>
                </div>
                {callover.deposits.length > 0 ? (
                  <button
                    type="button"
                    className="button secondary teller-callover__toggle-all"
                    onClick={() =>
                      setTellerCalloverMany(
                        sessionKey,
                        callover.depositIds,
                        callover.checkedDepositsCount < callover.deposits.length
                      )
                    }
                  >
                    {callover.checkedDepositsCount === callover.deposits.length
                      ? "Uncheck all"
                      : "Check all"}
                  </button>
                ) : null}
              </div>

              {callover.visibleDeposits.length === 0 ? (
                <p className="muted teller-callover__empty">
                  {callover.deposits.length === 0
                    ? "No counter deposits recorded for this day."
                    : "No deposits match your search."}
                </p>
              ) : (
                <ul className="teller-callover__list teller-callover__list--tall">
                  {callover.visibleDeposits.map((line) => {
                    const checked = callover.checkedIds.has(line.id);
                    return (
                      <li
                        key={line.id}
                        className={`teller-callover__row${checked ? " teller-callover__row--checked" : ""}`}
                      >
                        <label className="teller-callover__row-label">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleTellerCalloverTx(sessionKey, line.id)}
                          />
                          <span className="teller-callover__row-main">
                            <strong>{line.customerName}</strong>
                            <span className="muted teller-callover__row-meta">
                              {line.customerAccountNumber ? `${line.customerAccountNumber} · ` : ""}
                              {formatTime(line.createdAt)} ·{" "}
                              {line.type === "daily_susu" ? "Daily Susu" : "Deposit"}
                              {!isPersonalTillMode ? ` · ${line.recordedByName}` : ""}
                            </span>
                          </span>
                          <span className="teller-callover__row-amt teller-callover__val--in">
                            + {formatMoney(line.amount)}
                          </span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            <div className="teller-callover__col">
              <div className="teller-callover__col-head">
                <div>
                  <h4>
                    Withdrawals ({callover.checkedWithdrawalsCount}/{callover.withdrawals.length})
                  </h4>
                  <span className="muted teller-callover__col-total">
                    Total: − {formatMoney(callover.withdrawalTotal)}
                  </span>
                </div>
                {callover.withdrawals.length > 0 ? (
                  <button
                    type="button"
                    className="button secondary teller-callover__toggle-all"
                    onClick={() =>
                      setTellerCalloverMany(
                        sessionKey,
                        callover.withdrawalIds,
                        callover.checkedWithdrawalsCount < callover.withdrawals.length
                      )
                    }
                  >
                    {callover.checkedWithdrawalsCount === callover.withdrawals.length
                      ? "Uncheck all"
                      : "Check all"}
                  </button>
                ) : null}
              </div>

              {callover.visibleWithdrawals.length === 0 ? (
                <p className="muted teller-callover__empty">
                  {callover.withdrawals.length === 0
                    ? "No counter withdrawals or cash payouts recorded for this day."
                    : "No withdrawals match your search."}
                </p>
              ) : (
                <ul className="teller-callover__list teller-callover__list--tall">
                  {callover.visibleWithdrawals.map((line) => {
                    const checked = callover.checkedIds.has(line.id);
                    const isField = isFieldPayoutLine(line);
                    return (
                      <li
                        key={line.id}
                        className={`teller-callover__row${checked ? " teller-callover__row--checked" : ""}`}
                      >
                        <label className="teller-callover__row-label">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleTellerCalloverTx(sessionKey, line.id)}
                          />
                          <span className="teller-callover__row-main">
                            <strong>{line.customerName}</strong>
                            <span className="muted teller-callover__row-meta">
                              {line.customerAccountNumber ? `${line.customerAccountNumber} · ` : ""}
                              {formatTime(line.createdAt)} ·{" "}
                              {isField ? "Field payout" : "Walk-in"}
                              {!isPersonalTillMode ? ` · ${line.recordedByName}` : ""}
                            </span>
                          </span>
                          <span className="teller-callover__row-amt teller-callover__val--out">
                            − {formatMoney(line.amount)}
                          </span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        )}
      </section>

      {needsFloat ? (
        tillOpen ? (
          <form className="card teller-callover-page__close" onSubmit={(e) => void handleCloseTill(e)}>
            <div className="teller-callover__head">
              <div>
                <p className="susu-closing-editor__eyebrow">Step 2 · Drawer count &amp; close</p>
                <h3>Confirm call-over &amp; close till for today</h3>
                <p className="muted teller-callover__lead">
                  Count physical cash in your drawer. Expected cash:{" "}
                  <strong>{formatMoney(expectedCash)}</strong>
                </p>
              </div>
              {closeVariancePreview ? (
                <span
                  className={`susu-closing-editor__pill ${
                    closeVariancePreview.type === "balanced"
                      ? "susu-closing-editor__pill--ok"
                      : closeVariancePreview.type === "overage"
                        ? "susu-closing-editor__pill--delta"
                        : "susu-closing-editor__pill--shortage"
                  }`}
                >
                  {closeVariancePreview.type === "balanced"
                    ? "Balanced"
                    : closeVariancePreview.type === "overage"
                      ? `Overage + ${formatMoney(closeVariancePreview.amount)}`
                      : `Shortage − ${formatMoney(closeVariancePreview.amount)}`}
                </span>
              ) : null}
            </div>

            <label
              className={`teller-callover__confirm${
                !callover.allItemsChecked ? " teller-callover__confirm--disabled" : ""
              }`}
            >
              <input
                type="checkbox"
                checked={callover.confirmed}
                disabled={!callover.allItemsChecked}
                onChange={(e) => setTellerCalloverConfirmed(sessionKey, e.target.checked)}
              />
              <span>
                {callover.totalCount === 0
                  ? "I confirm I had no counter deposits or withdrawals today and am ready to close my till."
                  : callover.allItemsChecked
                    ? "I have called over and verified all today's deposits and withdrawals against my slips and vouchers."
                    : `Check all ${callover.totalCount - callover.checkedCount} remaining item(s) in Step 1 above before confirming.`}
              </span>
            </label>

            <div className="teller-callover-page__close-grid">
              <label className="field">
                <span>Actual cash counted</span>
                <AccountingAmountInput
                  value={actualClosing}
                  onChange={setActualClosing}
                  allowEmpty
                  placeholder={formatAccountingInput(expectedCash)}
                />
              </label>

              <label className="field">
                <span>
                  {closeVariancePreview?.type === "overage"
                    ? "Overage note (required)"
                    : closeVariancePreview?.type === "shortage"
                      ? "Shortage note (required)"
                      : "Variance note (optional)"}
                </span>
                <input
                  value={varianceNote}
                  onChange={(e) => setVarianceNote(e.target.value)}
                  placeholder={
                    closeVariancePreview?.type === "overage"
                      ? "Why is there extra cash?"
                      : closeVariancePreview?.type === "shortage"
                        ? "Why is cash short?"
                        : "Optional closing remark"
                  }
                  required={
                    closeVariancePreview?.type === "overage" ||
                    closeVariancePreview?.type === "shortage"
                  }
                />
              </label>
            </div>

            {closeVariancePreview ? (
              <p
                className={`susu-closing-editor__diff ${
                  closeVariancePreview.type === "balanced"
                    ? "susu-closing-editor__diff--ok"
                    : closeVariancePreview.type === "overage"
                      ? "susu-closing-editor__diff--surplus"
                      : "susu-closing-editor__diff--shortage"
                }`}
                role="status"
              >
                {closeVariancePreview.type === "balanced" ? (
                  <>
                    <strong>Difference: {formatMoney(0)}</strong> — Drawer matches expected cash. No
                    Overages/Shortages case will open.
                  </>
                ) : closeVariancePreview.type === "overage" ? (
                  <>
                    <strong>
                      Difference (Overage): + {formatMoney(closeVariancePreview.amount)}
                    </strong>{" "}
                    — Will be flagged automatically on Overages/Shortages (Branch till) when you
                    close.
                  </>
                ) : (
                  <>
                    <strong>
                      Difference (Shortage): − {formatMoney(closeVariancePreview.amount)}
                    </strong>{" "}
                    — Will be flagged automatically on Overages/Shortages (Branch till) when you
                    close.
                  </>
                )}
              </p>
            ) : null}

            <div className="teller-callover-page__close-actions">
              <button
                type="submit"
                className="button"
                disabled={busy || !callover.readyToClose || !actualClosing.trim()}
                title={
                  !callover.readyToClose
                    ? "Complete and confirm Step 1 (Teller call-over) above before closing"
                    : undefined
                }
              >
                {busy ? "Closing till…" : "Close till for today"}
              </button>
            </div>
          </form>
        ) : floatSession?.status === "closed" ? (
          <section className="card teller-callover-page__status-card">
            <h3>Till closed for {floatSession.businessDate}</h3>
            <p className="muted">
              Expected {formatMoney(floatSession.expectedClosing ?? expectedCash)} · Counted{" "}
              {formatMoney(floatSession.actualClosing ?? 0)}
              {floatSession.variance != null && Math.abs(floatSession.variance) >= 0.005
                ? ` · Variance ${floatSession.variance > 0 ? "+" : "−"} ${formatMoney(Math.abs(floatSession.variance))}`
                : " · Balanced"}
            </p>
            {isAdminLike ? (
              <div>
                <button
                  type="button"
                  className="button"
                  disabled={busy}
                  onClick={() => void handleSettleTill()}
                >
                  {busy ? "Settling…" : "Settle & approve balancing"}
                </button>
              </div>
            ) : (
              <p className="muted">Waiting for admin or coordinator settlement approval.</p>
            )}
          </section>
        ) : floatSession?.status === "settled" ? (
          <section className="card teller-callover-page__status-card">
            <h3>Till settled for {floatSession.businessDate}</h3>
            <p className="muted">
              Your till closing for today has been approved and returned to vault.
            </p>
          </section>
        ) : (
          <section className="card teller-callover-page__status-card">
            <h3>No open till for today</h3>
            <p className="muted">
              Request or open your daily branch float on{" "}
              <Link to="/app/susu/collections">Susu → Branch counter</Link> before posting counter
              transactions or closing a till.
            </p>
          </section>
        )
      ) : null}
    </div>
  );
}
