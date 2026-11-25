import { useEffect } from "react";
import { useShallow } from "zustand/react/shallow";
import {
  APPROVAL_ASSIGNABLE_ROLES,
  BUILTIN_ROLE_LABELS,
  type ApprovalAssignableRole,
  type WithdrawalVerificationMode
} from "@bms/shared";
import { useAuth } from "../../auth/AuthContext";
import { useToast } from "../../components/Toast";
import { useSettingsWorkspaceStore } from "../stores/settingsWorkspaceStore";

const ROLE_DESCRIPTIONS: Record<ApprovalAssignableRole, string> = {
  admin: "Always included as company owner",
  coordinator: "Branch & field operations lead",
  customer_service: "KYC & withdrawal verification desk",
  accountant: "Finance & reconciliation oversight",
  teller: "Frontline branch cash operator",
  auditor: "Compliance & internal audit",
  back_officer: "Bank execution & back-office ops"
};

const VERIFICATION_OPTIONS: {
  value: WithdrawalVerificationMode;
  title: string;
  badge: string;
  description: string;
}[] = [
  {
    value: "optional",
    title: "Optional for Full KYC",
    badge: "Fastest",
    description:
      "Tellers can open Verify anytime, but home-branch and cross-branch Full KYC withdrawals are not blocked."
  },
  {
    value: "cross_branch_only",
    title: "Cross-branch only",
    badge: "Balanced",
    description:
      "Home-branch Full KYC withdrawals stay fast; customers withdrawing at another branch must be verified first."
  },
  {
    value: "always",
    title: "Always mandatory",
    badge: "Strictest",
    description:
      "Every walk-in cash withdrawal requires the teller to verify customer photo & ID before paying cash."
  }
];

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

function RoleApprovalPanel({
  eyebrow,
  title,
  hint,
  roles,
  onChange
}: {
  eyebrow: string;
  title: string;
  hint: string;
  roles: ApprovalAssignableRole[];
  onChange: (roles: ApprovalAssignableRole[]) => void;
}) {
  return (
    <section className="aw-panel">
      <header className="aw-panel__head">
        <div>
          <p className="aw-panel__eyebrow">{eyebrow}</p>
          <h3 className="aw-panel__title">{title}</h3>
          <p className="aw-panel__hint muted">{hint}</p>
        </div>
        <span className="aw-count-pill">
          {roles.length} {roles.length === 1 ? "role" : "roles"}
        </span>
      </header>

      <div className="aw-role-grid">
        {APPROVAL_ASSIGNABLE_ROLES.map((role) => {
          const checked = roles.includes(role);
          const locked = role === "admin";
          return (
            <label
              key={role}
              className={`aw-role-tile${checked ? " is-checked" : ""}${locked ? " is-locked" : ""}`}
            >
              <input
                type="checkbox"
                checked={checked}
                disabled={locked}
                onChange={(event) => onChange(toggleRole(roles, role, event.target.checked))}
              />
              <span className="aw-role-tile__check" aria-hidden>
                {checked ? "✓" : ""}
              </span>
              <span className="aw-role-tile__body">
                <span className="aw-role-tile__top">
                  <strong>{BUILTIN_ROLE_LABELS[role]}</strong>
                  {locked ? <span className="aw-lock-badge">Always on</span> : null}
                </span>
                <small className="muted">{ROLE_DESCRIPTIONS[role]}</small>
              </span>
            </label>
          );
        })}
      </div>
    </section>
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
      void import("../stores/branchCounterStore").then(({ useBranchCounterStore }) => {
        if (useBranchCounterStore.getState().lastFetchedAt != null) {
          void useBranchCounterStore.getState().refreshSilent();
        }
      });
      showToast("Approval workflows saved", "success");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to save approval workflows", "error");
    }
  }

  const verificationMode: WithdrawalVerificationMode =
    workflow.withdrawalVerificationMode ?? "optional";
  const crossBranchAllowed = workflow.allowCrossBranchWithdrawals !== false;
  const activeModeMeta =
    VERIFICATION_OPTIONS.find((opt) => opt.value === verificationMode) ?? VERIFICATION_OPTIONS[0]!;

  return (
    <article className="card aw-page">
      <header className="aw-hero">
        <div className="aw-hero__copy">
          <p className="aw-hero__eyebrow">Governance · Approvals &amp; Counter Controls</p>
          <h2 className="aw-hero__title">Approval Workflows</h2>
          <p className="muted aw-hero__sub">
            Decide which roles approve new customer accounts and withdrawal requests, and configure
            walk-in branch counter safeguards. Field agents submit requests and are never approvers.
          </p>
        </div>
        <div className="aw-hero__actions">
          <button
            type="button"
            className="button"
            disabled={saving || (loading && lastFetchedAt == null)}
            onClick={() => void handleSave()}
          >
            {saving ? "Saving…" : "Save changes"}
          </button>
        </div>
      </header>

      {loading && lastFetchedAt == null ? (
        <div className="aw-loading muted">Loading approval workflows…</div>
      ) : (
        <>
          <div className="aw-summary-strip" aria-label="Active workflow summary">
            <div className="aw-summary-item">
              <span>Account approvers</span>
              <strong>{workflow.registrationApproverRoles.length} roles</strong>
            </div>
            <div className="aw-summary-item">
              <span>Withdrawal approvers</span>
              <strong>{workflow.withdrawalApproverRoles.length} roles</strong>
            </div>
            <div className="aw-summary-item">
              <span>Cross-branch withdrawals</span>
              <strong className={crossBranchAllowed ? "aw-tone-ok" : "aw-tone-warn"}>
                {crossBranchAllowed ? "Allowed" : "Home branch only"}
              </strong>
            </div>
            <div className="aw-summary-item">
              <span>Walk-in verification</span>
              <strong>{activeModeMeta.title}</strong>
            </div>
          </div>

          <div className="aw-two-col">
            <RoleApprovalPanel
              eyebrow="Onboarding gate"
              title="New account approval"
              hint="Roles authorised to approve or reject a new registration and assign the customer's account number."
              roles={workflow.registrationApproverRoles}
              onChange={(registrationApproverRoles) =>
                setApprovalWorkflow({ ...workflow, registrationApproverRoles })
              }
            />
            <RoleApprovalPanel
              eyebrow="Payout gate"
              title="Withdrawal request approval"
              hint="Roles authorised to approve or decline customer withdrawal requests before teller cash payout."
              roles={workflow.withdrawalApproverRoles}
              onChange={(withdrawalApproverRoles) =>
                setApprovalWorkflow({ ...workflow, withdrawalApproverRoles })
              }
            />
          </div>

          <section className="aw-panel aw-panel--counter">
            <header className="aw-panel__head">
              <div>
                <p className="aw-panel__eyebrow">Frontline safeguards</p>
                <h3 className="aw-panel__title">Branch counter rules</h3>
                <p className="aw-panel__hint muted">
                  Control inter-branch walk-in cash payouts and customer identity checks on the
                  Branch Counter.
                </p>
              </div>
            </header>

            <div className="aw-switch-card">
              <div className="aw-switch-card__copy">
                <strong>Allow cross-branch walk-in withdrawals</strong>
                <p className="muted">
                  When enabled, a customer registered at Branch A can withdraw walk-in cash at
                  Branch B. Cash leaves the paying branch&apos;s till while Susu commission income
                  remains credited to the customer&apos;s home branch. Walk-in deposits stay allowed
                  at any branch.
                </p>
              </div>
              <label className={`aw-switch${crossBranchAllowed ? " is-on" : ""}`}>
                <input
                  type="checkbox"
                  checked={crossBranchAllowed}
                  onChange={(event) =>
                    setApprovalWorkflow({
                      ...workflow,
                      allowCrossBranchWithdrawals: event.target.checked
                    })
                  }
                />
                <span className="aw-switch__track" aria-hidden>
                  <span className="aw-switch__knob" />
                </span>
                <span className="aw-switch__label">
                  {crossBranchAllowed ? "Allowed" : "Home branch only"}
                </span>
              </label>
            </div>

            <div className="aw-verify-section">
              <div className="aw-verify-section__head">
                <h4>Walk-in withdrawal customer verification</h4>
                <p className="muted">
                  Choose when tellers must open <strong>Verify</strong> to confirm customer photo,
                  ID document, and account details before posting a walk-in withdrawal.
                </p>
              </div>

              <div
                className="aw-mode-grid"
                role="radiogroup"
                aria-label="Walk-in withdrawal customer verification mode"
              >
                {VERIFICATION_OPTIONS.map((option) => {
                  const selected = verificationMode === option.value;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      className={`aw-mode-card${selected ? " is-selected" : ""}`}
                      onClick={() =>
                        setApprovalWorkflow({
                          ...workflow,
                          withdrawalVerificationMode: option.value
                        })
                      }
                    >
                      <span className="aw-mode-card__top">
                        <span className="aw-mode-card__radio" aria-hidden />
                        <strong>{option.title}</strong>
                        <span className="aw-mode-card__badge">{option.badge}</span>
                      </span>
                      <span className="aw-mode-card__desc muted">{option.description}</span>
                    </button>
                  );
                })}
              </div>

              <div className="aw-rules-footnote" role="note">
                <div className="aw-rules-footnote__pill">
                  <strong>Simplified KYC (Tier 1)</strong>
                  <span>Always verified on walk-in withdrawals (photo &amp; introducer)</span>
                </div>
                <div className="aw-rules-footnote__pill">
                  <strong>Deposits &amp; Daily Susu</strong>
                  <span>Never require verification</span>
                </div>
                <div className="aw-rules-footnote__pill">
                  <strong>Pay now (approved requests)</strong>
                  <span>Exempt — already approved in the withdrawal queue</span>
                </div>
              </div>
            </div>
          </section>

          <footer className="aw-footer">
            <p className="muted">
              Changes take effect immediately for all branch counters and approval queues across
              your company.
            </p>
            <button
              type="button"
              className="button"
              disabled={saving}
              onClick={() => void handleSave()}
            >
              {saving ? "Saving…" : "Save approval workflows"}
            </button>
          </footer>
        </>
      )}
    </article>
  );
}
