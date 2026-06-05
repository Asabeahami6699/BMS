import { useState, type ReactNode } from "react";
import { NavLink } from "react-router-dom";
import { AgentNetworkStatusBar } from "./components/AgentNetworkStatusBar";
import { AgentProfileDrawer } from "./AgentProfileDrawer";

type Props = {
  onLogout: () => void;
  children: ReactNode;
};

export function FieldAgentShell({ onLogout, children }: Props) {
  const [profileOpen, setProfileOpen] = useState(false);

  return (
    <div className="agent-root">
      <header className="agent-header agent-header--compact">
        <button
          type="button"
          className="agent-menu-btn"
          onClick={() => setProfileOpen(true)}
          aria-label="Open profile menu"
        >
          <span className="agent-menu-icon" aria-hidden>
            ☰
          </span>
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
        <NavLink to="/app/agent/alerts" className={({ isActive }) => `agent-tab${isActive ? " active" : ""}`}>
          <span aria-hidden>🔔</span>
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
