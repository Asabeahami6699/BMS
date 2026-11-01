import { useEffect, useState } from "react";
import {
  APPROVAL_ASSIGNABLE_ROLES,
  BUILTIN_ROLE_LABELS,
  parseApprovalWorkflow,
  type ApprovalAssignableRole,
  type ApprovalWorkflow
} from "@bms/shared";
import { useAuth } from "../../auth/AuthContext";
import { useToast } from "../../components/Toast";
import { getApprovalWorkflow, updateApprovalWorkflow } from "../api";

function toggleRole(
  roles: ApprovalAssignableRole[],
  role: ApprovalAssignableRole,
  checked: boolean
): ApprovalAssignableRole[] {
  if (role === "admin") {
    return roles.includes("admin") ? roles : ["admin", ...roles];
  }
  if (checked) {
    return roles.includes(role) ? roles : [...roles, role];
  }
  return roles.filter((item) => item !== role);
}

function RoleChecks({
  legend,
  hint,
  roles,
  onChange
}: {
  legend: string;
  hint: string;
  roles: ApprovalAssignableRole[];
  onChange: (roles: ApprovalAssignableRole[]) => void;
}) {
  return (
    <fieldset className="approval-workflow__group">
      <legend>{legend}</legend>
      <p className="muted">{hint}</p>
      {APPROVAL_ASSIGNABLE_ROLES.map((role) => (
        <label key={role} className="checkbox-row">
          <input
            type="checkbox"
            checked={roles.includes(role)}
            disabled={role === "admin"}
            onChange={(event) => onChange(toggleRole(roles, role, event.target.checked))}
          />
          <span>{BUILTIN_ROLE_LABELS[role]}</span>
        </label>
      ))}
    </fieldset>
  );
}

export function SettingsApprovalWorkflowsPage() {
  const { showToast } = useToast();
  const { refreshMe } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [workflow, setWorkflow] = useState<ApprovalWorkflow>(() => parseApprovalWorkflow(null));

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const loaded = await getApprovalWorkflow();
        if (!cancelled) {
          setWorkflow(loaded);
        }
      } catch (error) {
        if (!cancelled) {
          showToast(error instanceof Error ? error.message : "Failed to load approval workflows", "error");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [showToast]);

  async function handleSave() {
    setSaving(true);
    try {
      const saved = await updateApprovalWorkflow(workflow);
      setWorkflow(saved);
      await refreshMe();
      showToast("Approval workflows saved", "success");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Failed to save approval workflows", "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <article className="card">
      <h2>Approval Workflows</h2>
      <p className="muted">
        Choose which roles must approve a new account and which roles must approve a withdrawal. Company admin always
        stays on both. Field agents submit requests and are not approvers.
      </p>

      {loading ? (
        <p className="muted">Loading approval workflows…</p>
      ) : (
        <>
          <RoleChecks
            legend="New account"
            hint="These roles can approve or reject a registration and assign the account number."
            roles={workflow.registrationApproverRoles}
            onChange={(registrationApproverRoles) => setWorkflow({ ...workflow, registrationApproverRoles })}
          />
          <RoleChecks
            legend="Withdrawal"
            hint="These roles can approve or decline a customer withdrawal request."
            roles={workflow.withdrawalApproverRoles}
            onChange={(withdrawalApproverRoles) => setWorkflow({ ...workflow, withdrawalApproverRoles })}
          />
          <div className="form-actions">
            <button type="button" className="button" disabled={saving} onClick={() => void handleSave()}>
              {saving ? "Saving…" : "Save approval workflows"}
            </button>
          </div>
        </>
      )}
    </article>
  );
}
