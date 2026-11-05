import { useEffect, useMemo } from "react";
import type { AgentNotification } from "../../app/api";
import {
  selectUnreadFieldAgentNotificationCount,
  useNotificationsStore
} from "../../app/stores/notificationsStore";
import { FIELD_AGENT_ALERT_KINDS } from "../agentAlertKinds";

function isApprovedKind(kind: AgentNotification["kind"]): boolean {
  return (
    kind === "registration_approved" ||
    kind === "balance_disclosure_approved" ||
    kind === "withdrawal_request_approved" ||
    kind === "withdrawal_momo_sent" ||
    kind === "collection_batch_posted" ||
    kind === "cash_variance_settled" ||
    kind === "float_allocated"
  );
}

function isDeclinedKind(kind: AgentNotification["kind"]): boolean {
  return (
    kind === "registration_rejected" ||
    kind === "balance_disclosure_rejected" ||
    kind === "withdrawal_request_rejected"
  );
}

function pillLabel(kind: AgentNotification["kind"]): string {
  switch (kind) {
    case "withdrawal_momo_sent":
      return "MoMo sent";
    case "collection_batch_posted":
      return "Posted";
    case "collection_batch_pending":
      return "Pending approval";
    case "cash_shortage_opened":
      return "Shortage";
    case "cash_overage_opened":
      return "Overage";
    case "cash_variance_settled":
      return "Settled";
    case "float_allocated":
      return "Float released";
    case "float_requested":
      return "Float request";
    case "float_closed_pending_settlement":
      return "Float closed";
    case "registration_pending":
    case "balance_request_pending":
    case "withdrawal_request_pending":
      return "Pending";
    case "registration_approved":
    case "balance_disclosure_approved":
    case "withdrawal_request_approved":
      return "Approved";
    case "registration_rejected":
    case "balance_disclosure_rejected":
    case "withdrawal_request_rejected":
      return "Declined";
    default:
      break;
  }
  if (isApprovedKind(kind)) {
    return "Approved";
  }
  if (isDeclinedKind(kind)) {
    return "Declined";
  }
  return "Update";
}

function pillTone(kind: AgentNotification["kind"]): "active" | "pending" | "inactive" {
  if (isApprovedKind(kind)) {
    return "active";
  }
  if (isDeclinedKind(kind)) {
    return "inactive";
  }
  return "pending";
}

export function AgentAlertsPage() {
  const items = useNotificationsStore((s) => s.items);
  const loading = useNotificationsStore((s) => s.loading);
  const error = useNotificationsStore((s) => s.error);
  const hydrate = useNotificationsStore((s) => s.hydrate);
  const startLiveSync = useNotificationsStore((s) => s.startLiveSync);
  const stopLiveSync = useNotificationsStore((s) => s.stopLiveSync);
  const markRead = useNotificationsStore((s) => s.markRead);
  const unread = useNotificationsStore(selectUnreadFieldAgentNotificationCount);

  useEffect(() => {
    hydrate({ force: true });
    startLiveSync();
    return () => stopLiveSync();
  }, [hydrate, startLiveSync, stopLiveSync]);

  const agentItems = useMemo(
    () => items.filter((n) => FIELD_AGENT_ALERT_KINDS.has(n.kind)),
    [items]
  );

  const status = error ?? (loading && agentItems.length === 0 ? "Loading…" : "");

  return (
    <div className="agent-page">
      <h2>Alerts{unread > 0 ? ` (${unread})` : ""}</h2>
      <p className="muted">
        Your collections, approvals, float, and cash overage/shortage updates only.
      </p>
      {status ? <p className="muted">{status}</p> : null}
      <div className="agent-list">
        {agentItems.length === 0 && !status ? (
          <p className="muted">No notifications yet.</p>
        ) : (
          agentItems.map((n) => (
            <article
              key={n.id}
              className={`agent-list-item${n.readAt ? "" : " agent-list-item--unread"}`}
              onClick={() => void markRead(n.id)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => e.key === "Enter" && void markRead(n.id)}
            >
              <strong>{n.title}</strong>
              <span className={`status-pill status-pill--${pillTone(n.kind)}`}>
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
