import { Link } from "react-router-dom";
import { useShallow } from "zustand/react/shallow";
import { useAgentCustomerStore, selectCustomerStats } from "../stores/agentCustomerStore";

export function AgentHomePage() {
  const online = typeof navigator === "undefined" ? true : navigator.onLine;
  const stats = useAgentCustomerStore(useShallow(selectCustomerStats));
  const hydrated = useAgentCustomerStore((s) => s.hydrated);

  return (
    <div className="agent-page">
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

      <div className="agent-action-grid">
        <Link to="customers" className="agent-action-card agent-action-card--primary">
          <strong>Customers</strong>
          <p className="muted">Browse, collect, and create new accounts</p>
        </Link>
        <Link to="collect" className="agent-action-card">
          <strong>Daily collection</strong>
          <p className="muted">Record collections and sync when online</p>
        </Link>
        <Link to="callover" className="agent-action-card">
          <strong>Call over</strong>
          <p className="muted">Check cash vs system — report only differences</p>
        </Link>
        <Link to="alerts" className="agent-action-card">
          <strong>Alerts</strong>
          <p className="muted">Approval and rejection updates</p>
        </Link>
      </div>
    </div>
  );
}
