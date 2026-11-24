import {
  computeStaffPayrollPreview,
  formatAccountAmount,
  type TenantPayrollRole
} from "@bms/shared";
import { useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { Modal } from "../components/Modal";
import { formatRoleLabel, parseMoney, type RoleDraft } from "./payrollRoleUtils";
import { usePayrollStore, selectStaffCountByRole } from "./stores/payrollStore";
import { useToast } from "../components/Toast";

type Props = {
  open: boolean;
  onClose: () => void;
};

const COMMISSION_ELIGIBLE_ROLES = new Set<string>(["field_agent", "coordinator"]);

function roleBadgeInitials(role: string): string {
  const label = formatRoleLabel(role);
  const parts = label.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0]![0]}${parts[1]![0]}`.toUpperCase();
  }
  return label.slice(0, 2).toUpperCase();
}

export function RolePayrollDefaultsModal({ open, onClose }: Props) {
  const { showToast } = useToast();
  const [savingAll, setSavingAll] = useState(false);

  const {
    policy,
    roleDrafts,
    staffRows,
    patchRoleDraft,
    saveRoleDraft,
    saveAllRoleDrafts
  } = usePayrollStore(
    useShallow((s) => ({
      policy: s.policy,
      roleDrafts: s.roleDrafts,
      staffRows: s.staffRows,
      patchRoleDraft: s.patchRoleDraft,
      saveRoleDraft: s.saveRoleDraft,
      saveAllRoleDrafts: s.saveAllRoleDrafts
    }))
  );

  const staffCountByRole = useMemo(() => selectStaffCountByRole(staffRows), [staffRows]);

  const summary = useMemo(() => {
    let totalStaff = 0;
    let totalBase = 0;
    let configuredRoles = 0;
    for (const d of roleDrafts) {
      const count = staffCountByRole[d.role] ?? 0;
      const base = parseMoney(d.draftBaseSalary);
      totalStaff += count;
      totalBase += base * count;
      if (base > 0) configuredRoles += 1;
    }
    return { totalStaff, totalBase, configuredRoles };
  }, [roleDrafts, staffCountByRole]);

  if (!policy) {
    return null;
  }

  const currency = policy.currency || "GHS";

  async function saveOne(draft: RoleDraft) {
    try {
      await saveRoleDraft(draft.role as TenantPayrollRole);
      showToast(`${formatRoleLabel(draft.role)} template saved and applied`, "success");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Save failed", "error");
    }
  }

  async function saveAll() {
    setSavingAll(true);
    try {
      await saveAllRoleDrafts();
      showToast("All role templates saved — every staff member updated", "success");
      onClose();
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Save failed", "error");
    } finally {
      setSavingAll(false);
    }
  }

  const footer = (
    <div className="role-pay-footer">
      <span className="muted role-pay-footer__hint">
        Changes apply immediately to all {summary.totalStaff} staff member
        {summary.totalStaff === 1 ? "" : "s"} in the live payroll sheet.
      </span>
      <div className="role-pay-footer__actions">
        <button type="button" className="button secondary" onClick={onClose}>
          Close
        </button>
        <button
          type="button"
          className="button"
          disabled={savingAll || roleDrafts.some((d) => d.saving)}
          onClick={() => void saveAll()}
        >
          {savingAll ? "Saving all…" : "Save all roles & apply"}
        </button>
      </div>
    </div>
  );

  return (
    <Modal
      open={open}
      title="Pay by role"
      subtitle="Configure standard basic salary, monthly bonus, SSNIT, welfare, and default loan deductions per staff role."
      onClose={onClose}
      footer={footer}
      panelClassName="modal-panel--70 role-pay-modal"
    >
      {/* Top executive KPI strip */}
      <div className="role-pay-summary">
        <div className="role-pay-summary__stat">
          <span className="role-pay-summary__label">Roles configured</span>
          <strong>
            {summary.configuredRoles} / {roleDrafts.length}
          </strong>
        </div>
        <div className="role-pay-summary__stat">
          <span className="role-pay-summary__label">Staff covered</span>
          <strong>{summary.totalStaff}</strong>
        </div>
        <div className="role-pay-summary__stat">
          <span className="role-pay-summary__label">Monthly base payroll</span>
          <strong>
            {currency} {formatAccountAmount(summary.totalBase)}
          </strong>
        </div>
        <div className="role-pay-summary__tip">
          Updating any role automatically recalculates gross, deductions, and take-home pay for
          every staff member holding that role (plus collection commissions where eligible).
        </div>
      </div>

      {/* Role cards grid */}
      <div className="role-pay-grid">
        {roleDrafts.map((draft) => (
          <RolePayrollCard
            key={draft.role}
            draft={draft}
            currency={currency}
            policy={policy}
            staffCount={staffCountByRole[draft.role] ?? 0}
            onChange={(patch) => patchRoleDraft(draft.role as TenantPayrollRole, patch)}
            onSave={() => void saveOne(draft)}
          />
        ))}
      </div>
    </Modal>
  );
}

type CardProps = {
  draft: RoleDraft;
  currency: string;
  policy: NonNullable<ReturnType<typeof usePayrollStore.getState>["policy"]>;
  staffCount: number;
  onChange: (patch: Partial<RoleDraft>) => void;
  onSave: () => void;
};

function RolePayrollCard({ draft, currency, policy, staffCount, onChange, onSave }: CardProps) {
  const commissionEligible = COMMISSION_ELIGIBLE_ROLES.has(draft.role);

  const preview = useMemo(
    () =>
      computeStaffPayrollPreview({
        baseSalary: Number(draft.draftBaseSalary) || 0,
        monthlyBonus: Number(draft.draftMonthlyBonus) || 0,
        collections: 0,
        commissionPercent: 0,
        commissionsApply: false,
        policyEnabled: policy.enabled,
        bonusRules: policy.bonusRules,
        deductions: {
          ssnitRatePercent:
            draft.draftSsnitRate.trim() === "" ? null : Number(draft.draftSsnitRate) || null,
          ssnitFixedAmount: Number(draft.draftSsnitFixed) || 0,
          welfareDeduction: Number(draft.draftWelfare) || 0,
          loanDeduction: Number(draft.draftLoan) || 0
        }
      }),
    [draft, policy]
  );

  return (
    <article className="role-pay-card">
      <header className="role-pay-card__head">
        <div className="role-pay-card__identity">
          <span className="role-pay-card__avatar" aria-hidden>
            {roleBadgeInitials(draft.role)}
          </span>
          <div className="role-pay-card__title-wrap">
            <h3 className="role-pay-card__title">{formatRoleLabel(draft.role)}</h3>
            <div className="role-pay-card__badges">
              <span
                className={`role-pay-card__pill${staffCount > 0 ? " role-pay-card__pill--active" : ""}`}
              >
                {staffCount > 0 ? `${staffCount} staff` : "No active staff"}
              </span>
              {commissionEligible ? (
                <span className="role-pay-card__pill role-pay-card__pill--comm">
                  + Commission
                </span>
              ) : null}
            </div>
          </div>
        </div>
        <div className="role-pay-card__net-badge">
          <span className="role-pay-card__net-label">Est. base net</span>
          <strong className="role-pay-card__net-value">
            {currency} {formatAccountAmount(preview.projectedNet)}
          </strong>
        </div>
      </header>

      <div className="role-pay-card__fields">
        <label className="role-pay-field">
          <span>Basic salary ({currency})</span>
          <input
            className="input-no-spin"
            inputMode="decimal"
            placeholder="0.00"
            value={draft.draftBaseSalary}
            onChange={(e) => onChange({ draftBaseSalary: e.target.value })}
          />
        </label>
        <label className="role-pay-field">
          <span>Monthly bonus ({currency})</span>
          <input
            className="input-no-spin"
            inputMode="decimal"
            placeholder="0.00"
            value={draft.draftMonthlyBonus}
            onChange={(e) => onChange({ draftMonthlyBonus: e.target.value })}
          />
        </label>
        <label className="role-pay-field">
          <span>SSNIT rate (%)</span>
          <input
            className="input-no-spin"
            inputMode="decimal"
            placeholder="e.g. 5.5"
            value={draft.draftSsnitRate}
            onChange={(e) => onChange({ draftSsnitRate: e.target.value })}
          />
        </label>
        <label className="role-pay-field">
          <span>SSNIT fixed ({currency}, if no %)</span>
          <input
            className="input-no-spin"
            inputMode="decimal"
            placeholder="0.00"
            value={draft.draftSsnitFixed}
            onChange={(e) => onChange({ draftSsnitFixed: e.target.value })}
          />
        </label>
        <label className="role-pay-field">
          <span>Welfare deduction ({currency})</span>
          <input
            className="input-no-spin"
            inputMode="decimal"
            placeholder="0.00"
            value={draft.draftWelfare}
            onChange={(e) => onChange({ draftWelfare: e.target.value })}
          />
        </label>
        <label className="role-pay-field">
          <span>Default loan ded. ({currency})</span>
          <input
            className="input-no-spin"
            inputMode="decimal"
            placeholder="0.00"
            value={draft.draftLoan}
            onChange={(e) => onChange({ draftLoan: e.target.value })}
          />
        </label>
      </div>

      <footer className="role-pay-card__foot">
        <div className="role-pay-card__breakdown">
          <span>
            Gross <strong>{formatAccountAmount(preview.projectedGross)}</strong>
          </span>
          <span className="role-pay-card__sep" aria-hidden>
            ·
          </span>
          <span className="role-pay-card__ded">
            Ded. <strong>−{formatAccountAmount(preview.projectedDeductions)}</strong>
          </span>
        </div>
        <button
          type="button"
          className="button secondary payroll-modern-btn-sm"
          disabled={draft.saving}
          onClick={onSave}
        >
          {draft.saving ? "Saving…" : "Save & apply"}
        </button>
      </footer>
    </article>
  );
}
