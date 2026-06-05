import { useCallback, useEffect, useState } from "react";
import type { AgentNotification } from "../../app/api";
import { listAgentNotifications, markAgentNotificationRead } from "../../app/api";
import { AGENT_LIVE_REFRESH_EVENT } from "../agentLiveSync";
import { toUserFacingError } from "../../lib/networkError";

function isApprovedKind(kind: AgentNotification["kind"]): boolean {
  return (
    kind === "registration_approved" ||
    kind === "balance_disclosure_approved" ||
    kind === "withdrawal_request_approved" ||
    kind === "withdrawal_momo_sent"
  );
}

function pillLabel(kind: AgentNotification["kind"]): string {
  if (kind === "withdrawal_momo_sent") {
    return "MoMo sent";
  }
  if (isApprovedKind(kind)) {
    return "Approved";
  }
  return "Declined";
}

export function AgentAlertsPage() {
  const [items, setItems] = useState<AgentNotification[]>([]);
  const [status, setStatus] = useState("Loading…");

  const load = useCallback(async () => {
    try {
      setItems(await listAgentNotifications());
      setStatus("");
    } catch (error) {
      setStatus(toUserFacingError(error, "Failed to load alerts"));
    }
  }, []);

  useEffect(() => {
    void load();
    function onLiveRefresh() {
      void load();
    }
    window.addEventListener(AGENT_LIVE_REFRESH_EVENT, onLiveRefresh);
    return () => window.removeEventListener(AGENT_LIVE_REFRESH_EVENT, onLiveRefresh);
  }, [load]);

  async function markRead(notification: AgentNotification) {
    if (notification.readAt) {
      return;
    }
    try {
      await markAgentNotificationRead(notification.id);
      await load();
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="agent-page">
      <h2>Alerts</h2>
      <p className="muted">Registrations, balance, withdrawals, and MoMo receipts.</p>
      {status ? <p className="muted">{status}</p> : null}
      <div className="agent-list">
        {items.length === 0 && !status ? (
          <p className="muted">No notifications yet.</p>
        ) : (
          items.map((n) => (
            <article
              key={n.id}
              className={`agent-list-item${n.readAt ? "" : " agent-list-item--unread"}`}
              onClick={() => void markRead(n)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => e.key === "Enter" && void markRead(n)}
            >
              <strong>{n.title}</strong>
              <span
                className={`status-pill status-pill--${isApprovedKind(n.kind) ? "active" : "inactive"}`}
              >
                {pillLabel(n.kind)}
              </span>
              <p>{n.body}</p>
              {n.imageUrl ? (
                <div className="agent-alert-receipt" onClick={(e) => e.stopPropagation()}>
                  <img src={n.imageUrl} alt="Payout receipt" />
                </div>
              ) : null}
              <p className="muted">{new Date(n.createdAt).toLocaleString()}</p>
            </article>
          ))
        )}
      </div>
    </div>
  );
}
