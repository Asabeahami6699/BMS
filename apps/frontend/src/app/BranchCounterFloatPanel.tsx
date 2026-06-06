import { FormEvent, useState } from "react";
import { Link } from "react-router-dom";
import type { AppRole, Branch, BranchFloatSession, BranchFloatSummary } from "./api";
import {
  allocateBranchFloat,
  closeBranchFloat,
  requestBranchFloat,
  settleBranchFloat
} from "./api";
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

function formatMoney(n: number): string {
  return `GHS ${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const REQUIRES_FLOAT = new Set<AppRole>(["teller", "coordinator"]);

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
  const [requestAmount, setRequestAmount] = useState("500");
  const [requestNote, setRequestNote] = useState("");
  const [actualClosing, setActualClosing] = useState("");
  const [varianceNote, setVarianceNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [allocateAmount, setAllocateAmount] = useState<Record<string, string>>({});

  const isAdminLike = role === "admin" || role === "coordinator";
  const needsFloat = REQUIRES_FLOAT.has(role);
  const branchLabel = branches.find((b) => b.id === transactionBranchId)?.name ?? "Branch";

  async function handleRequest(e: FormEvent) {
    e.preventDefault();
    if (!transactionBranchId) {
      showToast("Select a branch first", "error");
      return;
    }
    setBusy(true);
    try {
      await requestBranchFloat({
        branchId: transactionBranchId,
        requestedAmount: Number(requestAmount),
        note: requestNote.trim() || undefined
      });
      showToast("Float request sent to admin", "success");
      onUpdated();
    } catch (error) {
      showToast(toUserFacingError(error, "Request failed"), "error");
    } finally {
      setBusy(false);
    }
  }

  async function handleAllocate(session: BranchFloatSession) {
    const amount = Number(allocateAmount[session.id] ?? session.openingFloat);
    setBusy(true);
    try {
      await allocateBranchFloat(session.id, amount);
      showToast("Float released — till is open", "success");
      onUpdated();
    } catch (error) {
      showToast(toUserFacingError(error, "Could not release float"), "error");
    } finally {
      setBusy(false);
    }
  }

  async function handleClose(e: FormEvent) {
    e.preventDefault();
    if (!floatSession) {
      return;
    }
    setBusy(true);
    try {
      await closeBranchFloat(floatSession.id, {
        actualClosing: Number(actualClosing),
        varianceNote: varianceNote.trim() || undefined
      });
      showToast("Till closed for end of day", "success");
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

  return (
    <section className={`branch-float card branch-float--${expanded ? "expanded" : "collapsed"}`}>
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
              {expanded ? "Click to minimize" : "Click to expand float details & balancing"}
            </p>
          </div>
          <div className="branch-float__toggle-meta">
            {floatSummary?.canTransact ? (
              <span
                className={`branch-float__toggle-balance${floatSummary.isLowFloat ? " branch-float__toggle-balance--low" : ""}`}
              >
                Float {formatMoney(floatSummary.floatBalance)}
              </span>
            ) : null}
            {floatSummary ? (
              <span
                className={`branch-float__status branch-float__status--${floatSession?.status ?? "none"}`}
              >
                {floatSummary.statusLabel}
              </span>
            ) : needsFloat ? (
              <span className="branch-float__status branch-float__status--requested">No float today</span>
            ) : null}
          </div>
        </div>
        <span className="branch-float__chevron" aria-hidden>
          {expanded ? "▾" : "▸"}
        </span>
      </button>

      {expanded ? (
        <div className="branch-float__body">
          <p className="muted branch-float__sub">
            Daily float for tellers. Deposits &amp; Susu reduce float; withdrawals restore float. Field
            agents collect in the field — not this till.
          </p>

          {floatSummary && floatSession?.status === "open" ? (
            <div
              className={`branch-float__balance-card${floatSummary.isLowFloat ? " branch-float__balance-card--low" : ""}`}
            >
              <div className="branch-float__balance-main">
                <div>
                  <span className="branch-float__balance-label">Float balance remaining</span>
                  <strong className="branch-float__balance-value">
                    {formatMoney(floatSummary.floatBalance)}
                  </strong>
                </div>
                <div className="branch-float__balance-stats">
                  <div>
                    <span>Opening float</span>
                    <strong>{formatMoney(floatSummary.openingFloat)}</strong>
                  </div>
                  <div>
                    <span>Deposits + Susu</span>
                    <strong>
                      − {formatMoney(floatSummary.totalDeposits + floatSummary.totalDailySusu)}
                    </strong>
                  </div>
                  <div>
                    <span>Withdrawals</span>
                    <strong>+ {formatMoney(floatSummary.totalWithdrawals)}</strong>
                  </div>
                  <div>
                    <span>Cash in till</span>
                    <strong>{formatMoney(floatSummary.expectedCash)}</strong>
                  </div>
                </div>
              </div>
              {floatSummary.isLowFloat ? (
                <p className="branch-float__balance-warn" role="status">
                  Float is running low (below GHS {floatSummary.lowFloatThreshold.toFixed(2)}). Request
                  additional float from admin before large deposits.
                </p>
              ) : null}
            </div>
          ) : null}

          {needsFloat && !floatSession ? (
            <div className="branch-float__alert">
              <p>
                <strong>No float for today.</strong> Request opening cash from admin before customer
                deposits or withdrawals.
              </p>
              <form className="branch-float__request-form" onSubmit={(e) => void handleRequest(e)}>
                <label className="field">
                  <span>Amount needed (GHS)</span>
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    value={requestAmount}
                    onChange={(e) => setRequestAmount(e.target.value)}
                    required
                  />
                </label>
                <label className="field">
                  <span>Note (optional)</span>
                  <input value={requestNote} onChange={(e) => setRequestNote(e.target.value)} />
                </label>
                <button type="submit" className="button" disabled={busy}>
                  Request daily float
                </button>
              </form>
            </div>
          ) : null}

          {floatSession ? (
            <div className="branch-float__metrics">
              <div>
                <span className="muted">Opening float</span>
                <strong>{formatMoney(floatSession.openingFloat)}</strong>
              </div>
              <div>
                <span className="muted">Cash in (dep + Susu)</span>
                <strong>
                  {formatMoney(floatSession.totalDeposits + floatSession.totalDailySusu)}
                </strong>
              </div>
              <div>
                <span className="muted">Cash out</span>
                <strong>{formatMoney(floatSession.totalWithdrawals)}</strong>
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
                  <span className="muted">Variance</span>
                  <strong className={floatSession.variance !== 0 ? "branch-float__variance" : ""}>
                    {formatMoney(floatSession.variance)}
                  </strong>
                </div>
              ) : null}
            </div>
          ) : null}

          {floatSession?.status === "requested" && needsFloat ? (
            <p className="muted">Waiting for admin or coordinator to release your float.</p>
          ) : null}

          {floatSession?.status === "open" && needsFloat ? (
            <form className="branch-float__close-form" onSubmit={(e) => void handleClose(e)}>
              <h3>End of day balancing</h3>
              <p className="muted">
                Count physical cash in your drawer. Expected:{" "}
                <strong>{formatMoney(floatSummary?.expectedCash ?? 0)}</strong>
              </p>
              <label className="field">
                <span>Actual cash counted (GHS)</span>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={actualClosing}
                  onChange={(e) => setActualClosing(e.target.value)}
                  required
                />
              </label>
              <label className="field">
                <span>Variance note (if any)</span>
                <input value={varianceNote} onChange={(e) => setVarianceNote(e.target.value)} />
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
              <h3>Pending float requests (quick approve)</h3>
              <ul className="branch-float__pending-list">
                {pendingFloatRequests.map((s) => (
                  <li key={s.id} className="branch-float__pending-item">
                    <span>
                      Cashier {s.cashierUserId.slice(0, 8)}… · {s.businessDate} · requested{" "}
                      {formatMoney(s.openingFloat)}
                    </span>
                    <div className="branch-float__pending-actions">
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        className="branch-float__allocate-input"
                        placeholder="Release amount"
                        value={allocateAmount[s.id] ?? String(s.openingFloat)}
                        onChange={(e) =>
                          setAllocateAmount((prev) => ({ ...prev, [s.id]: e.target.value }))
                        }
                      />
                      <button
                        type="button"
                        className="button"
                        disabled={busy}
                        onClick={() => void handleAllocate(s)}
                      >
                        Release float
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {needsFloat && floatSummary && !floatSummary.canTransact ? (
            <p className="branch-float__block muted">
              Customer cash transactions are blocked until your till float is open.
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
