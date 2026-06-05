import { FormEvent, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { AppRole, AuthMe, Branch } from "./api";
import { changeMyPassword, getMyPayslips } from "./api";
import type { Payslip } from "./api";
import { PayslipViewer } from "./PayslipViewer";
import { useToast } from "../components/Toast";
import { toUserFacingError } from "../lib/networkError";

type Props = {
  me: AuthMe | null;
  branches: Branch[];
  role: AppRole;
};

const ROLE_LABELS: Record<AppRole, string> = {
  super_admin: "Super admin",
  admin: "Administrator",
  field_agent: "Field agent",
  coordinator: "Coordinator",
  auditor: "Auditor",
  accountant: "Accountant",
  teller: "Teller",
  customer_service: "Customer service"
};

export function UserProfilePage({ me, branches, role }: Props) {
  const { showToast } = useToast();
  const [payslips, setPayslips] = useState<Payslip[]>([]);
  const [payslipLoading, setPayslipLoading] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordBusy, setPasswordBusy] = useState(false);

  const branchLabel = useMemo(() => {
    if (!me?.branchId) {
      return me?.scopeType === "head_office" ? "Head office (all branches)" : "—";
    }
    const match = branches.find((b) => b.id === me.branchId);
    return match ? `${match.name} (${match.code})` : me.branchId;
  }, [me, branches]);

  useEffect(() => {
    let cancelled = false;
    setPayslipLoading(true);
    void getMyPayslips()
      .then((rows) => {
        if (!cancelled) {
          setPayslips(rows);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setPayslips([]);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setPayslipLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const latestPayslip = payslips[0];
  const canPayrollAdmin = role === "admin" || role === "accountant";

  async function handlePasswordSubmit(e: FormEvent) {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      showToast("New passwords do not match", "error");
      return;
    }
    if (newPassword.length < 8) {
      showToast("Password must be at least 8 characters", "error");
      return;
    }
    setPasswordBusy(true);
    try {
      await changeMyPassword(currentPassword, newPassword);
      showToast("Password updated successfully", "success");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (error) {
      showToast(toUserFacingError(error, "Failed to change password"), "error");
    } finally {
      setPasswordBusy(false);
    }
  }

  return (
    <div className="profile-page">
      <header className="overview-hero">
        <div>
          <p className="overview-hero__eyebrow">Account</p>
          <h1 className="overview-hero__title">My profile</h1>
          <p className="overview-hero__sub muted">
            {me?.fullName ?? me?.email ?? "Signed-in user"} · {ROLE_LABELS[role] ?? role}
          </p>
        </div>
      </header>

      <div className="profile-grid">
        <section className="overview-panel">
          <h2 className="overview-panel__title">User details</h2>
          <dl className="profile-dl">
            <div>
              <dt>Full name</dt>
              <dd>{me?.fullName ?? "—"}</dd>
            </div>
            <div>
              <dt>Email</dt>
              <dd>{me?.email ?? "—"}</dd>
            </div>
            <div>
              <dt>Role</dt>
              <dd>{ROLE_LABELS[role] ?? role}</dd>
            </div>
            <div>
              <dt>Scope</dt>
              <dd>{me?.scopeType === "head_office" ? "Head office" : "Branch"}</dd>
            </div>
            <div>
              <dt>Branch</dt>
              <dd>{branchLabel}</dd>
            </div>
            <div>
              <dt>Company</dt>
              <dd>{me?.tenantName ?? me?.tenantId ?? "—"}</dd>
            </div>
          </dl>
        </section>

        <section className="overview-panel" id="role">
          <h2 className="overview-panel__title">Role &amp; permissions</h2>
          <p className="overview-panel__lead muted">
            Your access is determined by your assigned role. Contact an administrator to change role or
            scope.
          </p>
          <p className="profile-role-pill">{ROLE_LABELS[role] ?? role}</p>
          {me?.permissions?.length ? (
            <ul className="profile-permissions">
              {me.permissions.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          ) : (
            <p className="muted">No permission list available.</p>
          )}
          {role === "admin" ? (
            <Link className="overview-panel__footer-link" to="/app/settings/roles">
              Manage roles &amp; permissions →
            </Link>
          ) : null}
        </section>

        <section className="overview-panel profile-panel--wide" id="payslip">
          <h2 className="overview-panel__title">Payslip</h2>
          <p className="overview-panel__lead muted">Your latest published payslip from payroll.</p>
          {canPayrollAdmin ? (
            <p className="muted">
              You manage payroll as {ROLE_LABELS[role]}.{" "}
              <Link to="/app/susu/payroll">Open payroll workspace →</Link>
            </p>
          ) : null}
          {payslipLoading ? <p className="muted">Loading payslip…</p> : null}
          {!payslipLoading && latestPayslip ? (
            <PayslipViewer payslip={latestPayslip} subtitle="Latest published payslip" />
          ) : null}
          {!payslipLoading && !latestPayslip ? (
            <p className="muted">No payslip published for your account yet.</p>
          ) : null}
          {payslips.length > 1 ? (
            <details className="profile-payslip-history">
              <summary>Previous payslips ({payslips.length - 1})</summary>
              <div className="profile-payslip-history__list">
                {payslips.slice(1, 4).map((p) => (
                  <PayslipViewer key={p.id} payslip={p} title={`Period ${p.periodId}`} />
                ))}
              </div>
            </details>
          ) : null}
        </section>

        <section className="overview-panel profile-panel--wide" id="password">
          <h2 className="overview-panel__title">Change password</h2>
          <p className="overview-panel__lead muted">Enter your current password, then choose a new one (min. 8 characters).</p>
          <form className="stack-form profile-password-form" onSubmit={(e) => void handlePasswordSubmit(e)}>
            <label className="field">
              <span>Current password</span>
              <input
                type="password"
                autoComplete="current-password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                required
              />
            </label>
            <label className="field">
              <span>New password</span>
              <input
                type="password"
                autoComplete="new-password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                minLength={8}
                required
              />
            </label>
            <label className="field">
              <span>Confirm new password</span>
              <input
                type="password"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                minLength={8}
                required
              />
            </label>
            <button type="submit" className="button" disabled={passwordBusy}>
              {passwordBusy ? "Updating…" : "Update password"}
            </button>
          </form>
        </section>
      </div>
    </div>
  );
}
