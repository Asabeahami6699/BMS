import { computeStaffPayrollPreview, type TenantPayrollRole } from "@bms/shared";
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
  const exampleCoordinator = roleDrafts.find((d) => d.role === "coordinator");

  if (!policy) {
    return null;
  }

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
    <>
      <button type="button" className="secondary" onClick={onClose}>
        Close
      </button>
      <button
        type="button"
        className="primary"
        disabled={savingAll || roleDrafts.some((d) => d.saving)}
        onClick={() => void saveAll()}
      >
        {savingAll ? "Saving all…" : "Save all roles & apply"}
      </button>
    </>
  );

  return (
    <Modal
      open={open}
      title="Pay by role"
      subtitle="Set basic salary, SSNIT, and welfare once per role. Every user with that role receives these amounts automatically."
      onClose={onClose}
      footer={footer}
      panelClassName="modal-panel--70 role-payroll-modal"
    >
      <div className="role-payroll-modal__notice">
        <p>
          <strong>Example:</strong> set Coordinator basic salary to{" "}
          <strong>{exampleCoordinator ? parseMoneyDisplay(exampleCoordinator.draftBaseSalary) : "5,000"}</strong>{" "}
          — every coordinator on the platform uses that basic pay (plus commission from collections if
          applicable).
        </p>
      </div>

      <div className="role-payroll-grid">
        {roleDrafts.map((draft) => (
          <RolePayrollCard
            key={draft.role}
            draft={draft}
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

function parseMoneyDisplay(raw: string): string {
  const n = Number(raw);
  if (Number.isNaN(n)) return raw || "0";
  return n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

type CardProps = {
  draft: RoleDraft;
  policy: NonNullable<ReturnType<typeof usePayrollStore.getState>["policy"]>;
  staffCount: number;
  onChange: (patch: Partial<RoleDraft>) => void;
  onSave: () => void;
};

function RolePayrollCard({ draft, policy, staffCount, onChange, onSave }: CardProps) {
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
    <article className="role-payroll-card">
      <header className="role-payroll-card__head">
        <div>
          <h3>{formatRoleLabel(draft.role)}</h3>
          <p className="muted">
            {staffCount > 0
              ? `Applies to ${staffCount} staff`
              : "No active staff with this role yet"}
          </p>
        </div>
        <div className="role-payroll-card__basic-preview">
          <span className="muted">Basic</span>
          <strong>{parseMoneyDisplay(draft.draftBaseSalary)}</strong>
        </div>
      </header>

      <div className="role-payroll-card__fields">
        <label className="role-payroll-field">
          <span>Basic salary</span>
          <input
            className="input-no-spin"
            inputMode="decimal"
            placeholder="e.g. 5000"
            value={draft.draftBaseSalary}
            onChange={(e) => onChange({ draftBaseSalary: e.target.value })}
          />
        </label>
        <label className="role-payroll-field">
          <span>SSNIT % (of basic)</span>
          <input
            className="input-no-spin"
            inputMode="decimal"
            placeholder="e.g. 5.5"
            value={draft.draftSsnitRate}
            onChange={(e) => onChange({ draftSsnitRate: e.target.value })}
          />
        </label>
        <label className="role-payroll-field">
          <span>SSNIT fixed (if no %)</span>
          <input
            className="input-no-spin"
            inputMode="decimal"
            value={draft.draftSsnitFixed}
            onChange={(e) => onChange({ draftSsnitFixed: e.target.value })}
          />
        </label>
        <label className="role-payroll-field">
          <span>Welfare</span>
          <input
            className="input-no-spin"
            inputMode="decimal"
            value={draft.draftWelfare}
            onChange={(e) => onChange({ draftWelfare: e.target.value })}
          />
        </label>
        <label className="role-payroll-field">
          <span>Monthly bonus</span>
          <input
            className="input-no-spin"
            inputMode="decimal"
            value={draft.draftMonthlyBonus}
            onChange={(e) => onChange({ draftMonthlyBonus: e.target.value })}
          />
        </label>
        <label className="role-payroll-field">
          <span>Default loan deduction</span>
          <input
            className="input-no-spin"
            inputMode="decimal"
            value={draft.draftLoan}
            onChange={(e) => onChange({ draftLoan: e.target.value })}
          />
        </label>
      </div>

      <footer className="role-payroll-card__foot">
        <span className="muted">Est. deductions −{preview.projectedDeductions.toFixed(2)}</span>
        <button type="button" className="secondary small" disabled={draft.saving} onClick={onSave}>
          {draft.saving ? "Saving…" : "Save & apply"}
        </button>
      </footer>
    </article>
  );
}
