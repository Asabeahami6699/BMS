import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { AgentNotification } from "../api";
import { notificationTargetPath } from "../notificationRoutes";
import {
  selectUnreadNotificationCount,
  useNotificationsStore
} from "../stores/notificationsStore";

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
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  const items = useNotificationsStore((s) => s.items);
  const loading = useNotificationsStore((s) => s.loading);
  const hydrate = useNotificationsStore((s) => s.hydrate);
  const refreshSilent = useNotificationsStore((s) => s.refreshSilent);
  const startLiveSync = useNotificationsStore((s) => s.startLiveSync);
  const stopLiveSync = useNotificationsStore((s) => s.stopLiveSync);
  const markRead = useNotificationsStore((s) => s.markRead);
  const markAllRead = useNotificationsStore((s) => s.markAllRead);
  const unread = useNotificationsStore(selectUnreadNotificationCount);

  useEffect(() => {
    if (!enabled) {
      stopLiveSync();
      return;
    }
    hydrate();
    startLiveSync();
    return () => stopLiveSync();
  }, [enabled, hydrate, startLiveSync, stopLiveSync]);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!panelRef.current?.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  async function handleNotificationClick(notification: AgentNotification) {
    await markRead(notification.id);
    const target = notificationTargetPath(notification);
    setOpen(false);
    if (target) {
      navigate(target);
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
            void refreshSilent();
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
              <button type="button" className="button-link" onClick={() => void markAllRead()}>
                Mark all read
              </button>
            ) : null}
          </header>
          <div className="dash-notifications__list">
            {loading && items.length === 0 ? <p className="muted">Loading…</p> : null}
            {!loading && items.length === 0 ? (
              <p className="muted">You&apos;re all caught up — no notifications yet.</p>
            ) : null}
            {items.map((n) => {
              const target = notificationTargetPath(n);
              return (
                <button
                  key={n.id}
                  type="button"
                  className={`dash-notifications__item${n.readAt ? " is-read" : ""}${target ? " dash-notifications__item--link" : ""}`}
                  onClick={() => void handleNotificationClick(n)}
                >
                  <span className="dash-notifications__item-title">{n.title}</span>
                  <span className="dash-notifications__item-body muted">{n.body}</span>
                  <span className="dash-notifications__item-meta">
                    <span className="dash-notifications__item-time muted">{formatWhen(n.createdAt)}</span>
                    {target ? <span className="dash-notifications__item-go">Open →</span> : null}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}
