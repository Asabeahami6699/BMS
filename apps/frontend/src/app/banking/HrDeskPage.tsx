import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { BUILTIN_ROLE_LABELS, tellerTypeLabel } from "@bms/shared";
import type { UserRecord } from "../api";
import { listBranches, listUsers } from "../api";
import { getRoleDeskConfig } from "./roleDeskConfig";
import { RoleDeskShell } from "./RoleDeskShell";

type Props = { displayName?: string };

export function HrDeskPage({ displayName }: Props) {
  const config = getRoleDeskConfig("hrm");
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [branchCount, setBranchCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [userRows, branches] = await Promise.all([listUsers(), listBranches().catch(() => [])]);
      setUsers(userRows);
      setBranchCount(branches.length);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load HR desk");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

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

  return (
    <RoleDeskShell
      config={config}
      displayName={displayName}
      error={error}
      loading={loading}
      kpis={loading ? undefined : kpis}
      onRefresh={() => void load()}
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
