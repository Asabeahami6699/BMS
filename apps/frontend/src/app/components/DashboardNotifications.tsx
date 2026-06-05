import { useCallback, useEffect, useRef, useState } from "react";
import type { AgentNotification } from "../api";
import { listAgentNotifications, markAgentNotificationRead } from "../api";
import { subscribeToTenantRealtime } from "../realtime";
import { getTenantId } from "../api";

function formatWhen(iso: string): string {
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

type Props = {
  enabled: boolean;
};

export function DashboardNotifications({ enabled }: Props) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<AgentNotification[]>([]);
  const [loading, setLoading] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    if (!enabled) {
      return;
    }
    setLoading(true);
    try {
      setItems(await listAgentNotifications());
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!enabled) {
      return;
    }
    const tenantId = getTenantId();
    const unsub = subscribeToTenantRealtime({
      tenantId,
      tables: ["agent_notifications"],
      onChange: () => void load()
    });
    return unsub;
  }, [enabled, load]);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!panelRef.current?.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const unread = items.filter((n) => !n.readAt).length;

  async function markRead(notification: AgentNotification) {
    if (notification.readAt) {
      return;
    }
    try {
      await markAgentNotificationRead(notification.id);
      setItems((prev) =>
        prev.map((n) => (n.id === notification.id ? { ...n, readAt: new Date().toISOString() } : n))
      );
    } catch {
      /* ignore */
    }
  }

  if (!enabled) {
    return null;
  }

  return (
    <div className="dash-notifications" ref={panelRef}>
      <button
        type="button"
        className={`dash-icon-btn dash-notifications__trigger${unread > 0 ? " has-unread" : ""}`}
        aria-label={`Notifications${unread > 0 ? `, ${unread} unread` : ""}`}
        aria-expanded={open}
        onClick={() => {
          setOpen((v) => !v);
          if (!open) {
            void load();
          }
        }}
      >
        <span aria-hidden>🔔</span>
        {unread > 0 ? <span className="dash-notifications__badge">{unread > 9 ? "9+" : unread}</span> : null}
      </button>
      {open ? (
        <div className="dash-notifications__panel" role="dialog" aria-label="Notifications">
          <header className="dash-notifications__head">
            <h3>Notifications</h3>
            {unread > 0 ? (
              <button
                type="button"
                className="button-link"
                onClick={() => {
                  void Promise.all(items.filter((n) => !n.readAt).map((n) => markRead(n)));
                }}
              >
                Mark all read
              </button>
            ) : null}
          </header>
          <div className="dash-notifications__list">
            {loading && items.length === 0 ? <p className="muted">Loading…</p> : null}
            {!loading && items.length === 0 ? (
              <p className="muted">You&apos;re all caught up — no notifications yet.</p>
            ) : null}
            {items.map((n) => (
              <button
                key={n.id}
                type="button"
                className={`dash-notifications__item${n.readAt ? " is-read" : ""}`}
                onClick={() => void markRead(n)}
              >
                <span className="dash-notifications__item-title">{n.title}</span>
                <span className="dash-notifications__item-body muted">{n.body}</span>
                <span className="dash-notifications__item-time muted">{formatWhen(n.createdAt)}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
