import { useEffect, useState } from "react";
import { useAuth } from "../auth/AuthContext";
import { getFieldAgentDashboard, type FieldAgentDashboard } from "../app/api";
import { isOfflineOrNetworkError } from "../lib/useNetworkStatus";
import { toUserFacingError } from "../lib/networkError";

type Props = {
  open: boolean;
  onClose: () => void;
  onLogout: () => void;
};

function formatMoney(value: number): string {
  return `GHS ${value.toFixed(2)}`;
}

function statDisplay(value: number, asMoney = false): string {
  if (value === 0) {
    return "—";
  }
  return asMoney ? formatMoney(value) : String(value);
}

export function AgentProfileDrawer({ open, onClose, onLogout }: Props) {
  const { user } = useAuth();
  const [dashboard, setDashboard] = useState<FieldAgentDashboard | null>(null);
  const [status, setStatus] = useState("");

  useEffect(() => {
    if (!open) {
      return;
    }
    setStatus("Loading…");
    void getFieldAgentDashboard()
      .then((data) => {
        setDashboard(data);
        setStatus("");
      })
      .catch((error) => {
        setDashboard(null);
        if (isOfflineOrNetworkError(error)) {
          setStatus("Offline — showing saved profile. Stats refresh when online.");
        } else {
          setStatus(toUserFacingError(error, "Could not load profile"));
        }
      });
  }, [open]);

  if (!open) {
    return null;
  }

  const displayName = user?.fullName ?? dashboard?.profile.fullName ?? "Agent";
  const email = user?.email ?? dashboard?.profile.email ?? "";

  return (
    <div className="agent-drawer-backdrop" role="presentation" onClick={onClose}>
      <aside
        className="agent-drawer"
        role="dialog"
        aria-label="Agent menu"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="agent-drawer-head">
          <h2>Menu</h2>
          <button type="button" className="button secondary" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>

        {status ? <p className="muted agent-drawer-status">{status}</p> : null}

        <div className="agent-drawer-body agent-drawer-accordion">
          <details className="agent-drawer-panel" open>
            <summary>Details</summary>
            <div className="agent-drawer-panel-body">
              <p>
                <strong>{displayName}</strong>
              </p>
              <p className="muted">{email}</p>
              {dashboard?.profile.tenantName ? (
                <p className="muted">{dashboard.profile.tenantName}</p>
              ) : null}
              {dashboard?.profile.branchId ? (
                <p className="muted">Branch: {dashboard.profile.branchId}</p>
              ) : null}
              {dashboard ? <p className="muted">Period: {dashboard.period.label}</p> : null}
            </div>
          </details>

          {dashboard ? (
            <>
              <details className="agent-drawer-panel">
                <summary>This month</summary>
                <div className="agent-drawer-panel-body">
                  <div className="agent-drawer-metrics">
                    <div>
                      <span className="agent-drawer-metric-label">Accounts created</span>
                      <strong>{statDisplay(dashboard.accountsCreatedThisMonth)}</strong>
                    </div>
                    <div>
                      <span className="agent-drawer-metric-label">Total collected</span>
                      <strong>{statDisplay(dashboard.totalCollectedThisMonth, true)}</strong>
                    </div>
                  </div>
                </div>
              </details>

              <details className="agent-drawer-panel">
                <summary>Commission</summary>
                <div className="agent-drawer-panel-body">
                  <p className="muted">
                    {dashboard.commission.enabled
                      ? `${dashboard.commission.percent}% on ${dashboard.commission.basis.replace(/_/g, " ")}`
                      : "Commission policy is disabled"}
                  </p>
                  <p className="agent-drawer-highlight">
                    Projected: {statDisplay(dashboard.commission.projectedAmount, true)}
                  </p>
                </div>
              </details>

              <details className="agent-drawer-panel">
                <summary>Payroll (end of month)</summary>
                <div className="agent-drawer-panel-body">
                  <p className="muted">
                    {dashboard.payroll.fromPayslip
                      ? `Official payslip · ${dashboard.payroll.periodId}`
                      : `Estimate · ${dashboard.payroll.periodId}`}
                  </p>
                  {dashboard.payroll.lines.map((line) => (
                    <div className="agent-drawer-line" key={line.key}>
                      <span>{line.label}</span>
                      <strong>{statDisplay(line.amount, true)}</strong>
                    </div>
                  ))}
                  <div className="agent-drawer-line agent-drawer-line--total">
                    <span>Projected net pay</span>
                    <strong>{statDisplay(dashboard.payroll.projectedNetPay, true)}</strong>
                  </div>
                </div>
              </details>

              <details className="agent-drawer-panel">
                <summary>Performance</summary>
                <div className="agent-drawer-panel-body">
                  <div className="agent-drawer-metrics">
                    <div>
                      <span className="agent-drawer-metric-label">Today&apos;s rate</span>
                      <strong>
                        {dashboard.performance.activeCustomers === 0
                          ? "—"
                          : `${dashboard.performance.collectionRateToday}%`}
                      </strong>
                    </div>
                    <div>
                      <span className="agent-drawer-metric-label">Collected today</span>
                      <strong>{statDisplay(dashboard.performance.collectedToday)}</strong>
                    </div>
                    <div>
                      <span className="agent-drawer-metric-label">Still to collect</span>
                      <strong>{statDisplay(dashboard.performance.pendingToday)}</strong>
                    </div>
                    <div>
                      <span className="agent-drawer-metric-label">Month progress</span>
                      <strong>
                        {dashboard.performance.monthCollectionTarget === 0
                          ? "—"
                          : `${dashboard.performance.monthProgressPercent}%`}
                      </strong>
                    </div>
                  </div>
                </div>
              </details>
            </>
          ) : null}

          <details className="agent-drawer-panel">
            <summary>Account</summary>
            <div className="agent-drawer-panel-body">
              <button
                type="button"
                className="button secondary agent-drawer-logout"
                onClick={() => {
                  onClose();
                  onLogout();
                }}
              >
                Sign out
              </button>
            </div>
          </details>
        </div>
      </aside>
    </div>
  );
}
