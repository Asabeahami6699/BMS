import { formatAccountAmount } from "@bms/shared";
import { FormEvent, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { AppRole, Branch, BranchFloatSession, BranchFloatSummary } from "./api";
import { isFloatTopUpRequest, pendingFloatAmount } from "./api";
import {
  allocateBranchFloat,
  approveBranchFloatExpense,
  approveBranchFloatExtraCash,
  closeBranchFloat,
  collectBranchFloatExtraCash,
  recordBranchFloatExpense,
  requestBranchFloat,
  settleBranchFloat
} from "./api";
import { Modal } from "../components/Modal";
import { useToast } from "../components/Toast";
import { toUserFacingError } from "../lib/networkError";
import { useBranchCounterStore } from "./stores/branchCounterStore";

type Props = {
  role: AppRole;
  branches: Branch[];
  transactionBranchId: string;
  floatSession: BranchFloatSession | null;
  floatSummary: BranchFloatSummary;
  pendingFloatRequests: BranchFloatSession[];
  onUpdated: () => void;
};

type TillAction = "request_float" | "extra_float" | "extra_cash" | "expense";

function formatMoney(n: number): string {
  return `GHS ${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const REQUIRES_FLOAT = new Set<AppRole>(["teller", "coordinator"]);

const ACTION_COPY: Record<
  TillAction,
  { label: string; hint: string; amountLabel: string; noteLabel: string; noteRequired: boolean; submit: string }
> = {
  request_float: {
    label: "Initial float",
    hint: "Request today's opening float capacity and the physical cash collected for the drawer. Admin releases both when opening the till.",
    amountLabel: "Initial float (GHS)",
    noteLabel: "Note (optional)",
    noteRequired: false,
    submit: "Request float & cash"
  },
  extra_float: {
    label: "Extra float",
    hint: "When deposits have used down float capacity, request more. Approved extra float adds to day capital (not physical cash).",
    amountLabel: "Extra float needed (GHS)",
    noteLabel: "Note (optional)",
    noteRequired: false,
    submit: "Request extra float"
  },
  extra_cash: {
    label: "Extra cash",
    hint: "If a withdrawal needs more than physical cash in the drawer, collect cash from vault/coordinator first. Adds to day capital and cash in till.",
    amountLabel: "Extra cash collected (GHS)",
    noteLabel: "Note (optional)",
    noteRequired: false,
    submit: "Add extra cash"
  },
  expense: {
    label: "Expense",
    hint: "Petty cash / till expense paid from the drawer. Deducted from expected cash so end-of-day can balance.",
    amountLabel: "Expense amount (GHS)",
    noteLabel: "Reason",
    noteRequired: true,
    submit: "Record expense"
  }
};

export function BranchCounterFloatPanel({
  role,
  branches,
  transactionBranchId,
  floatSession,
  floatSummary,
  pendingFloatRequests,
  onUpdated
}: Props) {
  const { showToast } = useToast();
  const [expanded, setExpanded] = useState(false);
  const [actualClosing, setActualClosing] = useState("");
  const [varianceNote, setVarianceNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [allocateAmount, setAllocateAmount] = useState<Record<string, string>>({});
  const [allocateInitialCash, setAllocateInitialCash] = useState<Record<string, string>>({});

  const [movementOpen, setMovementOpen] = useState(false);
  const [action, setAction] = useState<TillAction>("extra_float");
  const [amount, setAmount] = useState("500");
  const [initialCashAmount, setInitialCashAmount] = useState("0");
  const [note, setNote] = useState("");

  const isAdminLike = role === "admin" || role === "coordinator";
  const needsFloat = REQUIRES_FLOAT.has(role);
  const branchLabel = branches.find((b) => b.id === transactionBranchId)?.name ?? "Branch";
  const initialCash = floatSession?.initialCash ?? floatSummary?.initialCash ?? 0;
  const extraCash = floatSession?.extraCash ?? floatSummary?.extraCash ?? 0;
  const totalExpenses = floatSession?.totalExpenses ?? floatSummary?.totalExpenses ?? 0;
  const dayCapital =
    floatSummary?.dayCapital ??
    (floatSession
      ? floatSession.openingFloat + floatSession.initialCash + floatSession.extraCash
      : 0);

  const tillOpen = floatSession?.status === "open";
  const topUpWaiting = Boolean(tillOpen && isFloatTopUpRequest(floatSession!));

  const availableActions = useMemo((): TillAction[] => {
    if (!tillOpen) {
      return ["request_float"];
    }
    if (topUpWaiting) {
      return ["extra_cash", "expense"];
    }
    return ["extra_float", "extra_cash", "expense"];
  }, [tillOpen, topUpWaiting]);

  const closeVariancePreview = useMemo(() => {
    const raw = actualClosing.trim();
    if (!raw) {
      return null;
    }
    const actual = Number(raw);
    if (!Number.isFinite(actual) || actual < 0) {
      return null;
    }
    const expected = floatSummary?.expectedCash ?? 0;
    const variance = Math.round((actual - expected) * 100) / 100;
    if (Math.abs(variance) < 0.005) {
      return { type: "balanced" as const, amount: 0 };
    }
    if (variance > 0) {
      return { type: "overage" as const, amount: variance };
    }
    return { type: "shortage" as const, amount: Math.abs(variance) };
  }, [actualClosing, floatSummary?.expectedCash]);

  function openMovement(preferred?: TillAction) {
    const next = preferred && availableActions.includes(preferred) ? preferred : availableActions[0]!;
    setAction(next);
    setAmount(next === "expense" || next === "extra_cash" ? "" : "500");
    setInitialCashAmount("0");
    setNote("");
    setMovementOpen(true);
  }

  async function handleMovementSubmit(e: FormEvent) {
    e.preventDefault();
    const parsed = Number(amount);
    const parsedInitialCash = Number(initialCashAmount);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      showToast("Enter a valid amount", "error");
      return;
    }
    if (
      action === "request_float" &&
      (!Number.isFinite(parsedInitialCash) || parsedInitialCash < 0)
    ) {
      showToast("Enter initial cash collected (0 is allowed)", "error");
      return;
    }
    if (ACTION_COPY[action].noteRequired && !note.trim()) {
      showToast("Enter a reason for the expense", "error");
      return;
    }

    setBusy(true);
    try {
      if (action === "request_float" || action === "extra_float") {
        if (!transactionBranchId) {
          showToast("Select a branch first", "error");
          return;
        }
        await requestBranchFloat({
          branchId: transactionBranchId,
          requestedAmount: parsed,
          requestedInitialCash: action === "request_float" ? parsedInitialCash : undefined,
          note: note.trim() || undefined
        });
        showToast(
          action === "extra_float"
            ? "Extra float request sent for approval"
            : "Float & initial cash request sent for approval",
          "success"
        );
      } else if (action === "extra_cash") {
        if (!floatSession) {
          return;
        }
        await collectBranchFloatExtraCash(floatSession.id, {
          amount: parsed,
          note: note.trim() || undefined
        });
        showToast(
          isAdminLike
            ? "Extra cash applied to till and day capital"
            : "Extra cash request sent for approval",
          "success"
        );
        await useBranchCounterStore.getState().refreshSilent();
      } else {
        if (!floatSession) {
          return;
        }
        await recordBranchFloatExpense(floatSession.id, {
          amount: parsed,
          note: note.trim() || undefined
        });
        showToast(
          isAdminLike
            ? "Expense applied — deducted from cash in till"
            : "Expense request sent for approval",
          "success"
        );
        await useBranchCounterStore.getState().refreshSilent();
      }
      setMovementOpen(false);
      setAmount("");
      setNote("");
      onUpdated();
    } catch (error) {
      showToast(toUserFacingError(error, "Could not save till movement"), "error");
    } finally {
      setBusy(false);
    }
  }

  async function handleAllocate(session: BranchFloatSession) {
    const releaseAmount = Number(allocateAmount[session.id] ?? pendingFloatAmount(session));
    const cash = Number(allocateInitialCash[session.id] ?? "0");
    setBusy(true);
    try {
      await allocateBranchFloat(
        session.id,
        releaseAmount,
        isFloatTopUpRequest(session) ? undefined : cash
      );
      showToast(
        isFloatTopUpRequest(session)
          ? "Extra float released — day capital updated"
          : "Till opened with float + physical cash",
        "success"
      );
      await useBranchCounterStore.getState().refreshSilent();
      onUpdated();
    } catch (error) {
      showToast(toUserFacingError(error, "Could not release float"), "error");
    } finally {
      setBusy(false);
    }
  }

  async function handleApproveExtraCash(session: BranchFloatSession) {
    setBusy(true);
    try {
      await approveBranchFloatExtraCash(session.id);
      showToast("Extra cash approved", "success");
      await useBranchCounterStore.getState().refreshSilent();
      onUpdated();
    } catch (error) {
      showToast(toUserFacingError(error, "Could not approve extra cash"), "error");
    } finally {
      setBusy(false);
    }
  }

  async function handleApproveExpense(session: BranchFloatSession) {
    setBusy(true);
    try {
      await approveBranchFloatExpense(session.id);
      showToast("Expense approved", "success");
      await useBranchCounterStore.getState().refreshSilent();
      onUpdated();
    } catch (error) {
      showToast(toUserFacingError(error, "Could not approve expense"), "error");
    } finally {
      setBusy(false);
    }
  }

  async function handleClose(e: FormEvent) {
    e.preventDefault();
    if (!floatSession) {
      return;
    }
    const expected = floatSummary?.expectedCash ?? 0;
    const actual = Number(actualClosing);
    const variance = Math.round((actual - expected) * 100) / 100;
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
      setActualClosing("");
      setVarianceNote("");
      onUpdated();
    } catch (error) {
      showToast(toUserFacingError(error, "Close failed"), "error");
    } finally {
      setBusy(false);
    }
  }

  async function handleSettle(session: BranchFloatSession) {
    setBusy(true);
    try {
      await settleBranchFloat(session.id);
      showToast("Float session settled", "success");
      onUpdated();
    } catch (error) {
      showToast(toUserFacingError(error, "Settle failed"), "error");
    } finally {
      setBusy(false);
    }
  }

  const copy = ACTION_COPY[action];

  return (
    <section className={`branch-float card branch-float--${expanded ? "expanded" : "collapsed"}`}>
      <div className="branch-float__top">
        <button
          type="button"
          className="branch-float__toggle"
          onClick={() => setExpanded((open) => !open)}
          aria-expanded={expanded}
        >
          <div className="branch-float__toggle-main">
            <div>
              <h2 className="branch-float__title">Branch till · {branchLabel}</h2>
              <p className="branch-float__toggle-hint muted">
                {expanded ? "Click to minimize" : "Click to expand float, cash & balancing"}
              </p>
            </div>
            <div className="branch-float__toggle-meta">
              {floatSummary?.canTransact ? (
                <span
                  className={`branch-float__toggle-balance${floatSummary.isLowFloat ? " branch-float__toggle-balance--low" : ""}`}
                >
                  Capital {formatMoney(dayCapital)} · Cash {formatMoney(floatSummary.expectedCash)}
                </span>
              ) : null}
              {floatSummary ? (
                <span
                  className={`branch-float__status branch-float__status--${floatSession?.status ?? "none"}`}
                >
                  {floatSummary.statusLabel}
                </span>
              ) : needsFloat ? (
                <span className="branch-float__status branch-float__status--requested">No till today</span>
              ) : null}
            </div>
          </div>
          <span className="branch-float__chevron" aria-hidden>
            {expanded ? "▾" : "▸"}
          </span>
        </button>

        {needsFloat && tillOpen ? (
          <button
            type="button"
            className="button branch-float__top-action"
            disabled={busy}
            onClick={(e) => {
              e.stopPropagation();
              openMovement(
                floatSummary?.expectedCash != null && floatSummary.expectedCash <= 0
                  ? "extra_cash"
                  : "extra_float"
              );
            }}
          >
            Till movement
          </button>
        ) : null}

        {needsFloat && !floatSession ? (
          <button
            type="button"
            className="button branch-float__top-action"
            disabled={busy}
            onClick={(e) => {
              e.stopPropagation();
              openMovement("request_float");
            }}
          >
            Open till
          </button>
        ) : null}
      </div>

      {expanded ? (
        <div className="branch-float__body">
          <p className="muted branch-float__sub">
            Float is deposit capacity. Physical cash is what is actually in the drawer. Day capital =
            float + initial cash + extra cash. Expenses reduce cash so end-of-day can balance.
          </p>

          {floatSummary && floatSession?.status === "open" ? (
            <div
              className={`branch-float__balance-card${floatSummary.isLowFloat ? " branch-float__balance-card--low" : ""}`}
            >
              <div className="branch-float__balance-main">
                <div>
                  <span className="branch-float__balance-label">Day capital</span>
                  <strong className="branch-float__balance-value">{formatMoney(dayCapital)}</strong>
                </div>
                <div className="branch-float__balance-stats">
                  <div>
                    <span>Float remaining</span>
                    <strong>{formatMoney(floatSummary.floatBalance)}</strong>
                  </div>
                  <div>
                    <span>Physical cash in till</span>
                    <strong>{formatMoney(floatSummary.expectedCash)}</strong>
                  </div>
                  <div>
                    <span>Initial cash</span>
                    <strong>{formatMoney(initialCash)}</strong>
                  </div>
                  <div>
                    <span>Extra cash collected</span>
                    <strong>{formatMoney(extraCash)}</strong>
                  </div>
                  <div>
                    <span>Expenses</span>
                    <strong>− {formatMoney(totalExpenses)}</strong>
                  </div>
                  <div>
                    <span>Deposits + Susu</span>
                    <strong>
                      {formatMoney(floatSummary.totalDeposits + floatSummary.totalDailySusu)}
                    </strong>
                  </div>
                  <div>
                    <span>Withdrawals</span>
                    <strong>{formatMoney(floatSummary.totalWithdrawals)}</strong>
                  </div>
                </div>
              </div>
              {floatSummary.isLowFloat ? (
                <p className="branch-float__balance-warn" role="status">
                  {floatSummary.floatBalance <= 0
                    ? "Float capacity is used up. Request extra float before more deposits."
                    : `Float is running low (below GHS ${formatAccountAmount(floatSummary.lowFloatThreshold)}). Request extra float if needed.`}
                </p>
              ) : null}
              {floatSummary.expectedCash <= 0 ? (
                <p className="branch-float__balance-warn" role="status">
                  No physical cash in till. Collect extra cash before paying withdrawals.
                </p>
              ) : null}
            </div>
          ) : null}

          {needsFloat && !floatSession ? (
            <div className="branch-float__alert">
              <p>
                <strong>No till for today.</strong> Use <strong>Open till</strong> above to request
                float and initial cash. Admin or coordinator must approve before the till opens.
              </p>
            </div>
          ) : null}

          {needsFloat && topUpWaiting ? (
            <p className="muted">
              Waiting for approval: extra float{" "}
              <strong>{formatMoney(floatSession!.topUpRequested ?? 0)}</strong>.
              {floatSession!.topUpNote ? ` ${floatSession!.topUpNote}` : ""}
            </p>
          ) : null}
          {needsFloat && (floatSession?.extraCashRequested ?? 0) > 0 ? (
            <p className="muted">
              Waiting for approval: extra cash{" "}
              <strong>{formatMoney(floatSession!.extraCashRequested ?? 0)}</strong>.
              {floatSession!.extraCashRequestNote ? ` ${floatSession!.extraCashRequestNote}` : ""}
            </p>
          ) : null}
          {needsFloat && (floatSession?.expenseRequested ?? 0) > 0 ? (
            <p className="muted">
              Waiting for approval: expense{" "}
              <strong>{formatMoney(floatSession!.expenseRequested ?? 0)}</strong>
              {floatSession!.expenseRequestNote ? ` · ${floatSession!.expenseRequestNote}` : ""}.
            </p>
          ) : null}

          {floatSession ? (
            <div className="branch-float__metrics">
              <div>
                <span className="muted">Day capital</span>
                <strong>{formatMoney(dayCapital)}</strong>
              </div>
              <div>
                <span className="muted">Opening float</span>
                <strong>{formatMoney(floatSession.openingFloat)}</strong>
              </div>
              <div>
                <span className="muted">Initial + extra cash</span>
                <strong>{formatMoney(initialCash + extraCash)}</strong>
              </div>
              <div>
                <span className="muted">Cash in (dep + Susu)</span>
                <strong>
                  {formatMoney(floatSession.totalDeposits + floatSession.totalDailySusu)}
                </strong>
              </div>
              <div>
                <span className="muted">Cash out (withdrawals)</span>
                <strong>{formatMoney(floatSession.totalWithdrawals)}</strong>
              </div>
              <div>
                <span className="muted">Expenses</span>
                <strong>{formatMoney(totalExpenses)}</strong>
              </div>
              <div>
                <span className="muted">Expected in till</span>
                <strong>{formatMoney(floatSummary?.expectedCash ?? 0)}</strong>
              </div>
              <div>
                <span className="muted">Transactions</span>
                <strong>{floatSession.transactionCount}</strong>
              </div>
              {floatSession.variance != null ? (
                <div>
                  <span className="muted">
                    {Math.abs(floatSession.variance) < 0.005
                      ? "Result"
                      : floatSession.variance > 0
                        ? "Overage"
                        : "Shortage"}
                  </span>
                  <strong
                    className={
                      Math.abs(floatSession.variance) < 0.005
                        ? "branch-float__eod-flag--balanced"
                        : floatSession.variance > 0
                          ? "branch-float__eod-flag--overage"
                          : "branch-float__eod-flag--shortage"
                    }
                  >
                    {Math.abs(floatSession.variance) < 0.005
                      ? "Balanced"
                      : formatMoney(Math.abs(floatSession.variance))}
                  </strong>
                </div>
              ) : null}
            </div>
          ) : null}

          {floatSession?.status === "requested" && needsFloat ? (
            <p className="muted">Waiting for admin or coordinator to open your till (float + cash).</p>
          ) : null}

          {floatSession?.status === "open" && needsFloat ? (
            <form className="branch-float__close-form" onSubmit={(e) => void handleClose(e)}>
              <h3>End of day balancing</h3>
              <p className="muted">
                Count physical cash in your drawer. Expected after deposits, withdrawals and expenses:{" "}
                <strong>{formatMoney(floatSummary?.expectedCash ?? 0)}</strong>
              </p>
              <label className="field">
                <span>Actual cash counted (GHS)</span>
                <input
                  type="number"
                  className="input-no-spin"
                  min={0}
                  step="0.01"
                  value={actualClosing}
                  onChange={(e) => setActualClosing(e.target.value)}
                  required
                />
              </label>
              {closeVariancePreview ? (
                <p
                  className={`branch-float__eod-flag branch-float__eod-flag--${closeVariancePreview.type}`}
                  role="status"
                >
                  {closeVariancePreview.type === "balanced" ? (
                    <>
                      <strong>Balanced</strong> — drawer matches expected cash. No OS case will open.
                    </>
                  ) : closeVariancePreview.type === "overage" ? (
                    <>
                      <strong>Overage {formatMoney(closeVariancePreview.amount)}</strong> — will be
                      flagged automatically on Overages/Shortages (Branch till) when you close.
                    </>
                  ) : (
                    <>
                      <strong>Shortage {formatMoney(closeVariancePreview.amount)}</strong> — will be
                      flagged automatically on Overages/Shortages (Branch till) when you close.
                    </>
                  )}
                </p>
              ) : null}
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
                        : "Optional"
                  }
                  required={
                    closeVariancePreview?.type === "overage" ||
                    closeVariancePreview?.type === "shortage"
                  }
                />
              </label>
              <button type="submit" className="button secondary" disabled={busy}>
                Close till for today
              </button>
            </form>
          ) : null}

          {floatSession?.status === "closed" && isAdminLike ? (
            <button
              type="button"
              className="button"
              disabled={busy}
              onClick={() => void handleSettle(floatSession)}
            >
              Settle &amp; approve balancing
            </button>
          ) : null}

          {isAdminLike ? (
            <p className="branch-float__admin-link muted">
              Manage all requests and push float from{" "}
              <Link to="/app/susu/till-float">Susu → Till float</Link> in the sidebar.
            </p>
          ) : null}

          {isAdminLike && pendingFloatRequests.length > 0 ? (
            <div className="branch-float__pending">
              <h3>Pending till movements (approve)</h3>
              <ul className="branch-float__pending-list">
                {pendingFloatRequests.map((s) => (
                  <li key={s.id} className="branch-float__pending-item">
                    <span>
                      Cashier {s.cashierUserId.slice(0, 8)}… · {s.businessDate}
                      {s.status === "requested"
                        ? ` · open till float ${formatMoney(s.openingFloat)} / cash ${formatMoney(s.initialCash ?? 0)}`
                        : null}
                      {isFloatTopUpRequest(s)
                        ? ` · extra float ${formatMoney(s.topUpRequested ?? 0)}`
                        : null}
                      {(s.extraCashRequested ?? 0) > 0
                        ? ` · extra cash ${formatMoney(s.extraCashRequested ?? 0)}`
                        : null}
                      {(s.expenseRequested ?? 0) > 0
                        ? ` · expense ${formatMoney(s.expenseRequested ?? 0)}`
                        : null}
                    </span>
                    <div className="branch-float__pending-actions">
                      {s.status === "requested" || isFloatTopUpRequest(s) ? (
                        <>
                          <input
                            type="number"
                            min={0}
                            step="0.01"
                            className="input-no-spin branch-float__allocate-input"
                            placeholder="Float amount"
                            value={allocateAmount[s.id] ?? String(pendingFloatAmount(s))}
                            onChange={(e) =>
                              setAllocateAmount((prev) => ({ ...prev, [s.id]: e.target.value }))
                            }
                          />
                          {!isFloatTopUpRequest(s) ? (
                            <input
                              type="number"
                              min={0}
                              step="0.01"
                              className="input-no-spin branch-float__allocate-input"
                              placeholder="Initial cash"
                              value={allocateInitialCash[s.id] ?? String(s.initialCash ?? 0)}
                              onChange={(e) =>
                                setAllocateInitialCash((prev) => ({
                                  ...prev,
                                  [s.id]: e.target.value
                                }))
                              }
                            />
                          ) : null}
                          <button
                            type="button"
                            className="button"
                            disabled={busy}
                            onClick={() => void handleAllocate(s)}
                          >
                            {isFloatTopUpRequest(s) ? "Approve float" : "Open till"}
                          </button>
                        </>
                      ) : null}
                      {(s.extraCashRequested ?? 0) > 0 ? (
                        <button
                          type="button"
                          className="button"
                          disabled={busy}
                          onClick={() => void handleApproveExtraCash(s)}
                        >
                          Approve cash
                        </button>
                      ) : null}
                      {(s.expenseRequested ?? 0) > 0 ? (
                        <button
                          type="button"
                          className="button secondary"
                          disabled={busy}
                          onClick={() => void handleApproveExpense(s)}
                        >
                          Approve expense
                        </button>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {needsFloat && floatSummary && !floatSummary.canTransact ? (
            <p className="branch-float__block muted">
              Customer cash transactions are blocked until your till is open.
            </p>
          ) : null}
        </div>
      ) : null}

      <Modal
        open={movementOpen}
        onClose={() => !busy && setMovementOpen(false)}
        title="Till movement"
        subtitle={`${branchLabel} · choose an action`}
        panelClassName="modal-panel--till-movement"
        footer={
          <>
            <button
              type="button"
              className="button secondary"
              disabled={busy}
              onClick={() => setMovementOpen(false)}
            >
              Cancel
            </button>
            <button type="submit" form="till-movement-form" className="button" disabled={busy}>
              {busy ? "Saving…" : copy.submit}
            </button>
          </>
        }
      >
        <form id="till-movement-form" className="till-movement-form" onSubmit={(e) => void handleMovementSubmit(e)}>
          <div className="till-movement-form__chips" role="tablist" aria-label="Till action">
            {availableActions.map((key) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={action === key}
                className={`till-movement-form__chip${action === key ? " is-active" : ""}`}
                onClick={() => {
                  setAction(key);
                  setAmount(key === "expense" || key === "extra_cash" ? "" : "500");
                  setInitialCashAmount("0");
                  setNote("");
                }}
              >
                {ACTION_COPY[key].label}
              </button>
            ))}
          </div>

          <p className="muted till-movement-form__hint">{copy.hint}</p>

          <label className="field">
            <span>{copy.amountLabel}</span>
            <input
              type="number"
              className="input-no-spin"
              min={0.01}
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              required
              autoFocus
            />
          </label>

          {action === "request_float" ? (
            <label className="field">
              <span>Initial cash collected (GHS)</span>
              <input
                type="number"
                className="input-no-spin"
                min={0}
                step="0.01"
                value={initialCashAmount}
                onChange={(e) => setInitialCashAmount(e.target.value)}
                placeholder="0.00"
                required
              />
            </label>
          ) : null}

          <label className="field">
            <span>{copy.noteLabel}</span>
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={action === "expense" ? "Transport, stationery…" : "Optional reference"}
              required={copy.noteRequired}
            />
          </label>
        </form>
      </Modal>
    </section>
  );
}
