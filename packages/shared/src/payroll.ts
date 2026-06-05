import { z } from "zod";
import { roleSchema } from "./auth.js";

export const payrollPeriodSchema = z.object({
  id: z.string().min(1),
  tenantId: z.string().min(1),
  startDate: z.string().min(1),
  endDate: z.string().min(1)
});

export const cashCollectionSchema = z.object({
  userId: z.string().min(1),
  role: roleSchema,
  amount: z.number().nonnegative()
});

export const payslipLineSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  amount: z.number()
});

export const payslipSchema = z.object({
  id: z.string().min(1),
  tenantId: z.string().min(1),
  userId: z.string().min(1),
  role: roleSchema,
  periodId: z.string().min(1),
  lines: z.array(payslipLineSchema),
  deductionLines: z.array(payslipLineSchema).default([]),
  grossPay: z.number(),
  totalDeductions: z.number().nonnegative().default(0),
  netPay: z.number(),
  runAt: z.string().optional()
});

export const runPayrollInputSchema = z.object({
  tenantId: z.string().min(1),
  period: payrollPeriodSchema,
  collections: z.array(cashCollectionSchema),
  baseSalaryByUser: z.record(z.number()),
  bonusByUser: z.record(z.number()).default({})
});

export const payrollDeductionsSchema = z.object({
  ssnitRatePercent: z.number().min(0).max(100).nullable().optional(),
  ssnitFixedAmount: z.number().nonnegative().default(0),
  welfareDeduction: z.number().nonnegative().default(0),
  loanDeduction: z.number().nonnegative().default(0)
});

export const userPayrollProfileSchema = payrollDeductionsSchema.extend({
  tenantId: z.string().min(1),
  userId: z.string().min(1),
  baseSalary: z.number().nonnegative().default(0),
  commissionPercentOverride: z.number().min(0).max(100).nullable().optional(),
  monthlyBonus: z.number().nonnegative().default(0),
  customPayroll: z.boolean().default(false)
});

export const updateUserPayrollProfileSchema = payrollDeductionsSchema.partial().extend({
  baseSalary: z.number().nonnegative().optional(),
  commissionPercentOverride: z.number().min(0).max(100).nullable().optional(),
  monthlyBonus: z.number().nonnegative().optional(),
  customPayroll: z.boolean().optional(),
  loanDeduction: z.number().nonnegative().optional()
});

/** Tenant roles that receive payroll (excludes platform super_admin). */
export const TENANT_PAYROLL_ROLES = [
  "admin",
  "field_agent",
  "coordinator",
  "auditor",
  "accountant",
  "teller",
  "customer_service"
] as const;

export type TenantPayrollRole = (typeof TENANT_PAYROLL_ROLES)[number];

export const rolePayrollDefaultSchema = payrollDeductionsSchema.extend({
  tenantId: z.string().min(1),
  role: roleSchema,
  baseSalary: z.number().nonnegative().default(0),
  monthlyBonus: z.number().nonnegative().default(0)
});

export const updateRolePayrollDefaultSchema = payrollDeductionsSchema.partial().extend({
  baseSalary: z.number().nonnegative().optional(),
  monthlyBonus: z.number().nonnegative().optional()
});

export type RolePayrollDefault = z.infer<typeof rolePayrollDefaultSchema>;
export type UpdateRolePayrollDefault = z.infer<typeof updateRolePayrollDefaultSchema>;

export const staffPayrollSetupRowSchema = z.object({
  userId: z.string().min(1),
  email: z.string().optional(),
  fullName: z.string().optional(),
  role: roleSchema,
  status: z.enum(["active", "inactive"]),
  baseSalary: z.number().nonnegative(),
  commissionPercentOverride: z.number().min(0).max(100).nullable().optional(),
  monthlyBonus: z.number().nonnegative(),
  ssnitRatePercent: z.number().min(0).max(100).nullable().optional(),
  ssnitFixedAmount: z.number().nonnegative(),
  welfareDeduction: z.number().nonnegative(),
  loanDeduction: z.number().nonnegative(),
  effectiveCommissionPercent: z.number().min(0).max(100),
  commissionsApply: z.boolean(),
  defaultCommissionPercent: z.number().min(0).max(100),
  collectionsThisPeriod: z.number().nonnegative(),
  projectedCommission: z.number().nonnegative(),
  projectedTierBonus: z.number().nonnegative(),
  projectedGross: z.number().nonnegative(),
  projectedDeductions: z.number().nonnegative(),
  projectedNet: z.number().nonnegative(),
  usesRoleDefaults: z.boolean(),
  customPayroll: z.boolean()
});

export type UserPayrollProfile = z.infer<typeof userPayrollProfileSchema>;
export type UpdateUserPayrollProfile = z.infer<typeof updateUserPayrollProfileSchema>;
export type StaffPayrollSetupRow = z.infer<typeof staffPayrollSetupRowSchema>;
export type PayrollDeductions = z.infer<typeof payrollDeductionsSchema>;

export type PayrollPeriod = z.infer<typeof payrollPeriodSchema>;
export type CashCollection = z.infer<typeof cashCollectionSchema>;
export type PayslipLine = z.infer<typeof payslipLineSchema>;
export type Payslip = z.infer<typeof payslipSchema>;
export type RunPayrollInput = z.infer<typeof runPayrollInputSchema>;

export function currentPayrollPeriod(date = new Date()): {
  id: string;
  label: string;
  startDate: string;
  endDate: string;
  startIso: string;
  endIso: string;
} {
  const year = date.getFullYear();
  const month = date.getMonth();
  const start = new Date(year, month, 1);
  const end = new Date(year, month + 1, 0, 23, 59, 59, 999);
  const monthName = start.toLocaleString("en-US", { month: "long" });
  const id = `${year}-${String(month + 1).padStart(2, "0")}`;
  return {
    id,
    label: `${monthName} ${year}`,
    startDate: start.toISOString().slice(0, 10),
    endDate: end.toISOString().slice(0, 10),
    startIso: start.toISOString(),
    endIso: end.toISOString()
  };
}

export function roleReceivesCommission(role: z.infer<typeof roleSchema>): boolean {
  return role === "field_agent" || role === "coordinator";
}

const EMPTY_ROLE_DEFAULT: Omit<RolePayrollDefault, "tenantId" | "role"> = {
  baseSalary: 0,
  monthlyBonus: 0,
  ssnitRatePercent: null,
  ssnitFixedAmount: 0,
  welfareDeduction: 0,
  loanDeduction: 0
};

/** Suggested starter amounts when a tenant has no role template yet. */
export function seedRolePayrollDefault(
  tenantId: string,
  role: z.infer<typeof roleSchema>
): RolePayrollDefault {
  const seeds: Partial<Record<z.infer<typeof roleSchema>, Partial<typeof EMPTY_ROLE_DEFAULT>>> = {
    field_agent: { baseSalary: 1500, ssnitRatePercent: 5.5, welfareDeduction: 50 },
    coordinator: { baseSalary: 2200, ssnitRatePercent: 5.5, welfareDeduction: 75, monthlyBonus: 100 },
    teller: { baseSalary: 1800, ssnitRatePercent: 5.5, welfareDeduction: 50 },
    accountant: { baseSalary: 2800, ssnitRatePercent: 5.5, welfareDeduction: 60 },
    admin: { baseSalary: 3500, ssnitRatePercent: 5.5, welfareDeduction: 80 },
    auditor: { baseSalary: 2400, ssnitRatePercent: 5.5, welfareDeduction: 60 },
    customer_service: { baseSalary: 1600, ssnitRatePercent: 5.5, welfareDeduction: 45 }
  };
  const patch = seeds[role] ?? {};
  return rolePayrollDefaultSchema.parse({
    tenantId,
    role,
    ...EMPTY_ROLE_DEFAULT,
    ...patch
  });
}

export type EffectivePayrollCompensation = {
  baseSalary: number;
  monthlyBonus: number;
  ssnitRatePercent: number | null;
  ssnitFixedAmount: number;
  welfareDeduction: number;
  loanDeduction: number;
  usesRoleDefaults: boolean;
  customPayroll: boolean;
};

/** Role template is the default; per-user profile overrides only when customPayroll is true. Loan can always be overridden per user. */
export function resolveEffectivePayroll(
  roleDefault: RolePayrollDefault,
  profile?: Pick<
    UserPayrollProfile,
    | "baseSalary"
    | "monthlyBonus"
    | "ssnitRatePercent"
    | "ssnitFixedAmount"
    | "welfareDeduction"
    | "loanDeduction"
    | "customPayroll"
  >
): EffectivePayrollCompensation {
  const customPayroll = profile?.customPayroll === true;
  const usesRoleDefaults = !customPayroll;

  if (customPayroll && profile) {
    return {
      baseSalary: profile.baseSalary,
      monthlyBonus: profile.monthlyBonus,
      ssnitRatePercent: profile.ssnitRatePercent ?? null,
      ssnitFixedAmount: profile.ssnitFixedAmount,
      welfareDeduction: profile.welfareDeduction,
      loanDeduction: profile.loanDeduction,
      usesRoleDefaults: false,
      customPayroll: true
    };
  }

  const loanOverride = profile?.loanDeduction ?? 0;
  return {
    baseSalary: roleDefault.baseSalary,
    monthlyBonus: roleDefault.monthlyBonus,
    ssnitRatePercent: roleDefault.ssnitRatePercent ?? null,
    ssnitFixedAmount: roleDefault.ssnitFixedAmount,
    welfareDeduction: roleDefault.welfareDeduction,
    loanDeduction: loanOverride > 0 ? loanOverride : roleDefault.loanDeduction,
    usesRoleDefaults: true,
    customPayroll: false
  };
}

export function calculateTierBonus(
  collections: number,
  rules: Array<{ threshold: number; amount: number }>
): number {
  return rules.reduce((sum, rule) => (collections >= rule.threshold ? sum + rule.amount : sum), 0);
}

export function computeSsnitDeduction(
  baseSalary: number,
  deductions: Pick<PayrollDeductions, "ssnitRatePercent" | "ssnitFixedAmount">
): number {
  if (deductions.ssnitRatePercent != null && deductions.ssnitRatePercent > 0) {
    return (baseSalary * deductions.ssnitRatePercent) / 100;
  }
  return deductions.ssnitFixedAmount ?? 0;
}

export function buildDeductionLines(
  baseSalary: number,
  deductions: PayrollDeductions
): PayslipLine[] {
  const lines: PayslipLine[] = [];
  const ssnit = computeSsnitDeduction(baseSalary, deductions);
  if (ssnit > 0) {
    const label =
      deductions.ssnitRatePercent != null && deductions.ssnitRatePercent > 0
        ? `SSNIT (${deductions.ssnitRatePercent}% of basic)`
        : "SSNIT";
    lines.push({ key: "ded_ssnit", label, amount: ssnit });
  }
  if (deductions.welfareDeduction > 0) {
    lines.push({ key: "ded_welfare", label: "Welfare", amount: deductions.welfareDeduction });
  }
  if (deductions.loanDeduction > 0) {
    lines.push({ key: "ded_loan", label: "Loan repayment", amount: deductions.loanDeduction });
  }
  return lines;
}

export function sumDeductionLines(lines: PayslipLine[]): number {
  return lines.reduce((sum, line) => sum + line.amount, 0);
}

export type StaffPayrollPreviewInput = {
  baseSalary: number;
  monthlyBonus: number;
  collections: number;
  commissionPercent: number;
  commissionsApply: boolean;
  policyEnabled: boolean;
  bonusRules: Array<{ threshold: number; amount: number }>;
  deductions: PayrollDeductions;
};

export function computeStaffPayrollPreview(input: StaffPayrollPreviewInput): {
  projectedCommission: number;
  projectedTierBonus: number;
  projectedGross: number;
  deductionLines: PayslipLine[];
  projectedDeductions: number;
  projectedNet: number;
} {
  const projectedCommission =
    input.policyEnabled && input.commissionsApply
      ? (input.collections * input.commissionPercent) / 100
      : 0;
  const projectedTierBonus =
    input.policyEnabled && input.commissionsApply
      ? calculateTierBonus(input.collections, input.bonusRules)
      : 0;
  const projectedGross =
    input.baseSalary + projectedCommission + projectedTierBonus + input.monthlyBonus;
  const deductionLines = buildDeductionLines(input.baseSalary, input.deductions);
  const projectedDeductions = sumDeductionLines(deductionLines);
  const projectedNet = Math.max(0, projectedGross - projectedDeductions);

  return {
    projectedCommission,
    projectedTierBonus,
    projectedGross,
    deductionLines,
    projectedDeductions,
    projectedNet
  };
}
