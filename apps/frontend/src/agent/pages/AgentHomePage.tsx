import { useState } from "react";
import { Link } from "react-router-dom";
import { useShallow } from "zustand/react/shallow";
import { submitCollectionBatchForApproval } from "../../app/api";
import { useToast } from "../../components/Toast";
import { toUserFacingError } from "../../lib/networkError";
import { AgentCashVariancePanel } from "../components/AgentCashVariancePanel";
import { OfflineSyncInspector } from "../components/OfflineSyncInspector";
import { useAgentCollectionStore } from "../stores/agentCollectionStore";
import { useAgentCustomerStore, selectCustomerStats } from "../stores/agentCustomerStore";

export function AgentHomePage() {
  const { showToast } = useToast();
  const online = typeof navigator === "undefined" ? true : navigator.onLine;
  const stats = useAgentCustomerStore(useShallow(selectCustomerStats));
  const hydrated = useAgentCustomerStore((s) => s.hydrated);
  const priorUnsubmittedBatches = useAgentCollectionStore((s) => s.priorUnsubmittedBatches);
  const refreshToday = useAgentCollectionStore((s) => s.refreshToday);
  const [submittingDate, setSubmittingDate] = useState<string | null>(null);

  async function handleSubmitPriorBatch(businessDate: string) {
    setSubmittingDate(businessDate);
    try {
      await submitCollectionBatchForApproval({
        businessDate,
        reportDate: businessDate,
        lines: [],
        agentNotes: `Late submission for ${businessDate} collection batch`
      });
      showToast(`Submitted ${businessDate} batch for coordinator approval`, "success");
      await refreshToday();
    } catch (error) {
      showToast(toUserFacingError(error, "Could not submit prior batch"), "error");
    } finally {
      setSubmittingDate(null);
    }
  }

  return (
    <div className="agent-page">
      <OfflineSyncInspector />
      {priorUnsubmittedBatches.length > 0 ? (
        <article className="card agent-card eod-guard-banner" role="alert">
          <div className="eod-guard-banner__body">
            <strong>Unsubmitted prior collections</strong>
            <p className="muted">
              You have collection batch(es) from earlier day(s) not yet sent to the coordinator.
              Submit them so customer accounts are credited.
            </p>
            <div className="eod-guard-list">
              {priorUnsubmittedBatches.map((b) => (
                <div key={b.id} className="eod-guard-list__row">
                  <span>
                    <strong>{b.businessDate}</strong> · GHS{" "}
                    {b.totalAmount.toLocaleString(undefined, {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2
                    })}{" "}
                    ({b.lineCount} line{b.lineCount === 1 ? "" : "s"})
                  </span>
                  <button
                    type="button"
                    className="button"
                    disabled={!online || submittingDate !== null}
                    onClick={() => void handleSubmitPriorBatch(b.businessDate)}
                  >
                    {submittingDate === b.businessDate
                      ? "Submitting…"
                      : `Submit ${b.businessDate}`}
                  </button>
                </div>
              ))}
            </div>
          </div>
        </article>
      ) : null}

      <article className="card agent-card">
        <h2>Field agent</h2>
        <p className="muted">Collect contributions, manage customers, and call over your day.</p>
        <div className="agent-status-row">
          <span className={`status-pill status-pill--${online ? "active" : "inactive"}`}>
            {online ? "Online" : "Offline"}
          </span>
        </div>
        {hydrated ? (
          <p className="muted agent-home-stats">
            <strong>{stats.active || "—"}</strong> ready to collect · <strong>{stats.pending || "—"}</strong>{" "}
            awaiting approval
          </p>
        ) : null}
      </article>

      <AgentCashVariancePanel />

      <div className="agent-action-grid">
        <Link to="/app/agent/customers" className="agent-action-card agent-action-card--primary">
          <strong>Customers</strong>
          <p className="muted">Browse, collect, and create new accounts</p>
        </Link>
        <Link to="/app/agent/collect" className="agent-action-card">
          <strong>Daily collection</strong>
          <p className="muted">Record collections and sync when online</p>
        </Link>
        <Link to="/app/agent/callover" className="agent-action-card">
          <strong>Call over</strong>
          <p className="muted">Check cash vs system — report only differences</p>
        </Link>
        <Link to="/app/agent/alerts" className="agent-action-card">
          <strong>Alerts</strong>
          <p className="muted">Approval and rejection updates</p>
        </Link>
        <Link to="/app/agent/withdrawals" className="agent-action-card">
          <strong>Withdrawals</strong>
          <p className="muted">Requested, approved, and cash from office</p>
        </Link>
      </div>
    </div>
  );
}
