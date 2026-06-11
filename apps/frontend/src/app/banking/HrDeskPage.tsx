import { useEffect, useMemo } from "react";
import { Link } from "react-router-dom";
import { useShallow } from "zustand/react/shallow";
import { BUILTIN_ROLE_LABELS, tellerTypeLabel } from "@bms/shared";
import { useBranchesLiveSync } from "../hooks/useBranchesLiveSync";
import { useBranchesStore } from "../stores/branchesStore";
import { useHrDeskStore } from "../stores/hrDeskStore";
import { getRoleDeskConfig } from "./roleDeskConfig";
import { RoleDeskShell } from "./RoleDeskShell";

type Props = { displayName?: string };

export function HrDeskPage({ displayName }: Props) {
  const config = getRoleDeskConfig("hrm");
  useBranchesLiveSync();
  const branchCount = useBranchesStore((s) => s.branches.length);
  const {
    users,
    loading,
    error,
    lastFetchedAt,
    hydrateRoster,
    refreshRoster,
    startLiveSync,
    stopLiveSync
  } = useHrDeskStore(
    useShallow((s) => ({
      users: s.users,
      loading: s.rosterLoading,
      error: s.rosterError,
      lastFetchedAt: s.lastRosterAt,
      hydrateRoster: s.hydrateRoster,
      refreshRoster: s.refreshRoster,
      startLiveSync: s.startLiveSync,
      stopLiveSync: s.stopLiveSync
    }))
  );

  useEffect(() => {
    hydrateRoster({ force: true });
    startLiveSync();
    return () => stopLiveSync();
  }, [hydrateRoster, startLiveSync, stopLiveSync]);

  const activeStaff = users.filter((u) => u.status === "active");
  const tellers = activeStaff.filter((u) => u.role === "teller");

  const kpis = useMemo(
    () => [
      { label: "Active staff", value: activeStaff.length, tone: "primary" as const },
      { label: "Tellers", value: tellers.length, tone: "success" as const },
      { label: "Branches", value: branchCount, tone: "neutral" as const },
      {
        label: "Inactive",
        value: users.length - activeStaff.length,
        tone: "warning" as const
      }
    ],
    [activeStaff.length, branchCount, tellers.length, users.length]
  );

  const updatedLabel = lastFetchedAt
    ? `Updated ${new Date(lastFetchedAt).toLocaleTimeString()}`
    : undefined;

  return (
    <RoleDeskShell
      config={config}
      displayName={displayName}
      updatedLabel={updatedLabel}
      error={error}
      loading={loading && users.length === 0}
      kpis={loading && users.length === 0 ? undefined : kpis}
      onRefresh={() => void refreshRoster()}
      refreshing={loading}
    >
      <section className="card role-workspace__panel desk-hero-panel desk-hero-panel--hr">
        <div className="desk-hero-panel__row">
          <div>
            <p className="desk-hero-panel__eyebrow">Human resources</p>
            <h3>People operations hub</h3>
            <p className="muted">
              Profiles, branch placement, attendance, leave, appointments, payroll, and compliance.
            </p>
          </div>
        </div>
        <div className="desk-link-grid">
          <Link className="desk-link-card" to="/app/banking/hrm/profiles">
            <strong>Employee profiles</strong>
            <span>{activeStaff.length} active</span>
          </Link>
          <Link className="desk-link-card" to="/app/banking/hrm/branches">
            <strong>Branch assignments</strong>
            <span>{branchCount} branches</span>
          </Link>
          <Link className="desk-link-card" to="/app/banking/hrm/attendance">
            <strong>Attendance</strong>
            <span>Daily register</span>
          </Link>
          <Link className="desk-link-card" to="/app/banking/hrm/leave">
            <strong>Leave management</strong>
            <span>Requests &amp; approvals</span>
          </Link>
          <Link className="desk-link-card" to="/app/banking/hrm/appointments">
            <strong>Appointment letters</strong>
            <span>Employment dates</span>
          </Link>
          <Link className="desk-link-card" to="/app/banking/hrm/payroll">
            <strong>Payroll</strong>
            <span>Runs &amp; payslips</span>
          </Link>
          <Link className="desk-link-card" to="/app/banking/hrm/staff-loans">
            <strong>Staff loans</strong>
            <span>Applications &amp; approvals</span>
          </Link>
          <Link className="desk-link-card" to="/app/banking/hrm/policies">
            <strong>HR policies</strong>
            <span>Late time &amp; leave days</span>
          </Link>
          <Link className="desk-link-card" to="/app/banking/hrm/roles">
            <strong>Roles &amp; permissions</strong>
            <span>Job titles</span>
          </Link>
          <Link className="desk-link-card" to="/app/banking/hrm/training">
            <strong>Training &amp; compliance</strong>
            <span>Renewals &amp; due dates</span>
          </Link>
        </div>
      </section>

      {tellers.length > 0 ? (
        <section className="card role-workspace__panel">
          <h3>Teller roster</h3>
          <ul className="role-workspace__feature-list">
            {tellers.slice(0, 8).map((teller) => (
              <li key={teller.userId}>
                {teller.fullName ?? teller.email}
                {teller.tellerType ? ` — ${tellerTypeLabel(teller.tellerType)}` : ""}
                {" · "}
                {BUILTIN_ROLE_LABELS.teller}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </RoleDeskShell>
  );
}
