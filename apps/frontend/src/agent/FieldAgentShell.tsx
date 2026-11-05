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
  children: ReactNode;
};

export function FieldAgentShell({ onLogout, children }: Props) {
  const [profileOpen, setProfileOpen] = useState(false);
  const unread = useNotificationsStore(selectUnreadFieldAgentNotificationCount);
  const hydrate = useNotificationsStore((s) => s.hydrate);

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  return (
    <div className="agent-root">
      <header className="agent-header agent-header--compact">
        <button
          type="button"
          className={`agent-menu-btn${unread > 0 ? " agent-menu-btn--unread" : ""}`}
          onClick={() => setProfileOpen(true)}
          aria-label={
            unread > 0 ? `Open profile menu, ${unread} unread alerts` : "Open profile menu"
          }
        >
          <span className="agent-menu-icon" aria-hidden>
            ☰
          </span>
          {unread > 0 ? (
            <span className="agent-menu-badge" aria-hidden>
              {unread > 9 ? "9+" : unread}
            </span>
          ) : null}
        </button>
      </header>

      <AgentNetworkStatusBar />
      <main className="agent-main">{children}</main>

      <nav className="agent-bottom-nav" aria-label="Field agent navigation">
        <NavLink to="/app/agent/home" end className={({ isActive }) => `agent-tab${isActive ? " active" : ""}`}>
          <span aria-hidden>⌂</span>
          Home
        </NavLink>
        <NavLink to="/app/agent/customers" className={({ isActive }) => `agent-tab${isActive ? " active" : ""}`}>
          <span aria-hidden>☰</span>
          Customers
        </NavLink>
        <NavLink to="/app/agent/collect" className={({ isActive }) => `agent-tab${isActive ? " active" : ""}`}>
          <span aria-hidden>₵</span>
          Collect
        </NavLink>
        <NavLink to="/app/agent/callover" className={({ isActive }) => `agent-tab${isActive ? " active" : ""}`}>
          <span aria-hidden>✓</span>
          Call over
        </NavLink>
        <NavLink
          to="/app/agent/alerts"
          className={({ isActive }) => `agent-tab agent-tab--alerts${isActive ? " active" : ""}`}
        >
          <span className="agent-tab__icon-wrap" aria-hidden>
            🔔
            {unread > 0 ? (
              <span className="agent-tab__badge">{unread > 9 ? "9+" : unread}</span>
            ) : null}
          </span>
          Alerts
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
