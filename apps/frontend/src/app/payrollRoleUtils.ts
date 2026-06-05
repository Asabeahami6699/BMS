import { computeStaffPayrollPreview, type TenantPayrollRole } from "@bms/shared";
import type { RolePayrollDefault, StaffPayrollSetupRow } from "./api";

export const ROLE_LABELS: Record<TenantPayrollRole, string> = {
  admin: "Admin",
  field_agent: "Field agent",
  coordinator: "Coordinator",
  auditor: "Auditor",
  accountant: "Accountant",
  teller: "Teller",
  customer_service: "Customer service"
};

export type RoleDraft = RolePayrollDefault & {
  draftBaseSalary: string;
  draftMonthlyBonus: string;
  draftSsnitRate: string;
  draftSsnitFixed: string;
  draftWelfare: string;
  draftLoan: string;
  saving: boolean;
};

export type StaffRow = StaffPayrollSetupRow & {
  draftLoan: string;
  draftCommissionOverride: string;
  saving: boolean;
};

export type PayrollPolicy = {
  enabled: boolean;
  currency: string;
  bonusRules: Array<{ threshold: number; amount: number }>;
};

export function formatRoleLabel(role: string): string {
  return ROLE_LABELS[role as TenantPayrollRole] ?? role.replace(/_/g, " ");
}

export function parseOptionalPercent(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  const n = Number(trimmed);
  return Number.isNaN(n) ? null : n;
}

export function parseMoney(raw: string): number {
  const n = Number(raw.trim());
  return Number.isNaN(n) ? 0 : Math.max(0, n);
}

export function toRoleDraft(row: RolePayrollDefault): RoleDraft {
  return {
    ...row,
    draftBaseSalary: String(row.baseSalary),
    draftMonthlyBonus: String(row.monthlyBonus),
    draftSsnitRate: row.ssnitRatePercent != null ? String(row.ssnitRatePercent) : "",
    draftSsnitFixed: String(row.ssnitFixedAmount),
    draftWelfare: String(row.welfareDeduction),
    draftLoan: String(row.loanDeduction),
    saving: false
  };
}

export function toStaffRow(row: StaffPayrollSetupRow): StaffRow {
  return {
    ...row,
    draftLoan: String(row.loanDeduction),
    draftCommissionOverride:
      row.commissionPercentOverride != null ? String(row.commissionPercentOverride) : "",
    saving: false
  };
}

export function roleDraftPayload(draft: RoleDraft) {
  return {
    baseSalary: parseMoney(draft.draftBaseSalary),
    monthlyBonus: parseMoney(draft.draftMonthlyBonus),
    ssnitRatePercent: parseOptionalPercent(draft.draftSsnitRate),
    ssnitFixedAmount: parseMoney(draft.draftSsnitFixed),
    welfareDeduction: parseMoney(draft.draftWelfare),
    loanDeduction: parseMoney(draft.draftLoan)
  };
}

/** Instant gross/net update while editing (no API round-trip). */
export function recomputeStaffRowLive(
  row: StaffRow,
  roleDraft: RoleDraft | undefined,
  policy: PayrollPolicy
): StaffRow {
  if (!roleDraft) {
    return row;
  }

  const commissionPercent = row.commissionsApply
    ? (parseOptionalPercent(row.draftCommissionOverride) ?? row.defaultCommissionPercent)
    : 0;
  const loanDeduction = parseMoney(row.draftLoan) || parseMoney(roleDraft.draftLoan);

  const preview = computeStaffPayrollPreview({
    baseSalary: parseMoney(roleDraft.draftBaseSalary),
    monthlyBonus: parseMoney(roleDraft.draftMonthlyBonus),
    collections: row.collectionsThisPeriod,
    commissionPercent,
    commissionsApply: row.commissionsApply,
    policyEnabled: policy.enabled,
    bonusRules: policy.bonusRules,
    deductions: {
      ssnitRatePercent: parseOptionalPercent(roleDraft.draftSsnitRate),
      ssnitFixedAmount: parseMoney(roleDraft.draftSsnitFixed),
      welfareDeduction: parseMoney(roleDraft.draftWelfare),
      loanDeduction
    }
  });

  return {
    ...row,
    baseSalary: parseMoney(roleDraft.draftBaseSalary),
    monthlyBonus: parseMoney(roleDraft.draftMonthlyBonus),
    ssnitRatePercent: parseOptionalPercent(roleDraft.draftSsnitRate),
    ssnitFixedAmount: parseMoney(roleDraft.draftSsnitFixed),
    welfareDeduction: parseMoney(roleDraft.draftWelfare),
    loanDeduction,
    effectiveCommissionPercent: commissionPercent,
    projectedCommission: preview.projectedCommission,
    projectedTierBonus: preview.projectedTierBonus,
    projectedGross: preview.projectedGross,
    projectedDeductions: preview.projectedDeductions,
    projectedNet: preview.projectedNet
  };
}

export function recomputeStaffRowsForRole(
  staffRows: StaffRow[],
  role: string,
  roleDraft: RoleDraft,
  policy: PayrollPolicy
): StaffRow[] {
  return staffRows.map((row) =>
    row.role === role ? recomputeStaffRowLive(row, roleDraft, policy) : row
  );
}
