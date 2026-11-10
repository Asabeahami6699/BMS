import { useEffect, useState, type ReactNode } from "react";
import { NavLink } from "react-router-dom";
import {
  selectUnreadFieldAgentNotificationCount,
  useNotificationsStore
} from "../app/stores/notificationsStore";
import { AgentNetworkStatusBar } from "./components/AgentNetworkStatusBar";
import { AgentProfileDrawer } from "./AgentProfileDrawer";

type Props = {
  onLogout: () => void;
  onSync: () => void;
  syncing: boolean;
  pendingCount: number;
  online: boolean;
  onCreateAccount: () => void;
  children: ReactNode;
};

export function FieldAgentShell({
  onLogout,
  onSync,
  syncing,
  pendingCount,
  online,
  onCreateAccount,
  children
}: Props) {
  const [profileOpen, setProfileOpen] = useState(false);
  const unread = useNotificationsStore(selectUnreadFieldAgentNotificationCount);
  const hydrate = useNotificationsStore((s) => s.hydrate);

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  const syncDisabled = syncing || (!online && pendingCount === 0);
  const syncLabel = syncing
    ? "Syncing offline items"
    : pendingCount > 0
      ? `Sync ${pendingCount} pending item${pendingCount === 1 ? "" : "s"}`
      : online
        ? "Sync now"
        : "Offline — nothing to sync";

  return (
    <div className="agent-root">
      <header className="agent-topbar" aria-label="Field agent toolbar">
        <div className="agent-topbar__glass">
          <button
            type="button"
            className={`agent-topbar__icon-btn${unread > 0 ? " agent-topbar__icon-btn--badge" : ""}`}
            onClick={() => setProfileOpen(true)}
            aria-label={
              unread > 0 ? `Open profile menu, ${unread} unread alerts` : "Open profile menu"
            }
          >
            <span aria-hidden>☰</span>
            {unread > 0 ? (
              <span className="agent-topbar__badge" aria-hidden>
                {unread > 9 ? "9+" : unread}
              </span>
            ) : null}
          </button>

          <div className="agent-topbar__brand">
            <span className="agent-topbar__brand-title">Field agent</span>
            <span
              className={`agent-topbar__live${online ? " agent-topbar__live--on" : " agent-topbar__live--off"}`}
            >
              {online ? "Online" : "Offline"}
            </span>
          </div>

          <div className="agent-topbar__actions">
            <button
              type="button"
              className="agent-topbar__icon-btn agent-topbar__icon-btn--accent"
              onClick={onCreateAccount}
              aria-label="Create new account"
              title="Create new account"
            >
              <span aria-hidden>+</span>
            </button>
            <button
              type="button"
              className={`agent-topbar__icon-btn${pendingCount > 0 ? " agent-topbar__icon-btn--badge" : ""}${syncing ? " agent-topbar__icon-btn--busy" : ""}`}
              onClick={() => void onSync()}
              disabled={syncDisabled}
              aria-label={syncLabel}
              title={syncLabel}
            >
              <span aria-hidden>{syncing ? "…" : "↻"}</span>
              {pendingCount > 0 && !syncing ? (
                <span className="agent-topbar__badge" aria-hidden>
                  {pendingCount > 9 ? "9+" : pendingCount}
                </span>
              ) : null}
            </button>
          </div>
        </div>
      </header>

      <AgentNetworkStatusBar />
      <main className="agent-main">{children}</main>

      <nav className="agent-bottom-nav" aria-label="Field agent navigation">
        <div className="agent-bottom-nav__glass">
          <NavLink
            to="/app/agent/home"
            end
            className={({ isActive }) => `agent-tab${isActive ? " active" : ""}`}
          >
            <span className="agent-tab__glyph" aria-hidden>
              ⌂
            </span>
            Home
          </NavLink>
          <NavLink
            to="/app/agent/customers"
            className={({ isActive }) => `agent-tab${isActive ? " active" : ""}`}
          >
            <span className="agent-tab__glyph" aria-hidden>
              ☰
            </span>
            Customers
          </NavLink>
          <NavLink
            to="/app/agent/collect"
            className={({ isActive }) => `agent-tab${isActive ? " active" : ""}`}
          >
            <span className="agent-tab__glyph" aria-hidden>
              ₵
            </span>
            Collect
          </NavLink>
          <NavLink
            to="/app/agent/callover"
            className={({ isActive }) => `agent-tab${isActive ? " active" : ""}`}
          >
            <span className="agent-tab__glyph" aria-hidden>
              ✓
            </span>
            Call over
          </NavLink>
        </div>

        <NavLink
          to="/app/agent/alerts"
          className={({ isActive }) =>
            `agent-bottom-nav__fab${isActive ? " agent-bottom-nav__fab--active" : ""}`
          }
          aria-label={unread > 0 ? `Alerts, ${unread} unread` : "Alerts"}
        >
          <span className="agent-bottom-nav__fab-inner" aria-hidden>
            🔔
            {unread > 0 ? (
              <span className="agent-tab__badge">{unread > 9 ? "9+" : unread}</span>
            ) : null}
          </span>
        </NavLink>
      </nav>

      <AgentProfileDrawer
        open={profileOpen}
        onClose={() => setProfileOpen(false)}
        onLogout={onLogout}
      />
    </div>
  );
}
