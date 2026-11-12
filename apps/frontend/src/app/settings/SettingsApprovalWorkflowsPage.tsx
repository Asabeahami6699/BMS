import { useEffect } from "react";
import { useShallow } from "zustand/react/shallow";
import {
  APPROVAL_ASSIGNABLE_ROLES,
  BUILTIN_ROLE_LABELS,
  type ApprovalAssignableRole,
  type ApprovalWorkflow
} from "@bms/shared";
import { useAuth } from "../../auth/AuthContext";
import { useToast } from "../../components/Toast";
import { useSettingsWorkspaceStore } from "../stores/settingsWorkspaceStore";

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
  const {
    workflow,
    loading,
    saving,
    lastFetchedAt,
    error,
    hydrateSection,
    startLiveSync,
    stopLiveSync,
    setApprovalWorkflow,
    saveApprovalWorkflow
  } = useSettingsWorkspaceStore(
    useShallow((s) => ({
      workflow: s.approvalWorkflow,
      loading: s.section.approvalWorkflow.loading,
      saving: s.savingApproval,
      lastFetchedAt: s.section.approvalWorkflow.lastFetchedAt,
      error: s.section.approvalWorkflow.error,
      hydrateSection: s.hydrateSection,
      startLiveSync: s.startLiveSync,
      stopLiveSync: s.stopLiveSync,
      setApprovalWorkflow: s.setApprovalWorkflow,
      saveApprovalWorkflow: s.saveApprovalWorkflow
    }))
  );

  useEffect(() => {
    hydrateSection("approvalWorkflow");
    startLiveSync("approvalWorkflow");
    return () => stopLiveSync();
  }, [hydrateSection, startLiveSync, stopLiveSync]);

  useEffect(() => {
    if (error) {
      showToast(error, "error");
    }
  }, [error, showToast]);

  async function handleSave() {
    try {
      await saveApprovalWorkflow(workflow);
      await refreshMe();
      showToast("Approval workflows saved", "success");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to save approval workflows", "error");
    }
  }

  return (
    <article className="card">
      <h2>Approval Workflows</h2>
      <p className="muted">
        Choose which roles must approve a new account and which roles must approve a withdrawal. Company admin always
        stays on both. Field agents submit requests and are not approvers.
      </p>

      {loading && lastFetchedAt == null ? (
        <p className="muted">Loading approval workflows…</p>
      ) : (
        <>
          <RoleChecks
            legend="New account"
            hint="These roles can approve or reject a registration and assign the account number."
            roles={workflow.registrationApproverRoles}
            onChange={(registrationApproverRoles) =>
              setApprovalWorkflow({ ...workflow, registrationApproverRoles })
            }
          />
          <RoleChecks
            legend="Withdrawal"
            hint="These roles can approve or decline a customer withdrawal request."
            roles={workflow.withdrawalApproverRoles}
            onChange={(withdrawalApproverRoles) =>
              setApprovalWorkflow({ ...workflow, withdrawalApproverRoles })
            }
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
