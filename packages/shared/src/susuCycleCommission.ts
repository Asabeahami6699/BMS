import { z } from "zod";

export const susuCommissionBasisSchema = z.enum(["first_day", "fixed", "percentage", "none"]);
export type SusuCommissionBasis = z.infer<typeof susuCommissionBasisSchema>;

export const susuCommissionDeductionTimingSchema = z.enum([
  "first_collection",
  "cycle_maturity",
  "withdrawal"
]);
export type SusuCommissionDeductionTiming = z.infer<typeof susuCommissionDeductionTimingSchema>;

export const susuCommissionRolloverTreatmentSchema = z.enum(["deduct", "defer", "waive"]);
export type SusuCommissionRolloverTreatment = z.infer<typeof susuCommissionRolloverTreatmentSchema>;

export const susuCommissionPartialAllocationSchema = z.enum([
  "commission_first",
  "savings_first",
  "proportional"
]);
export type SusuCommissionPartialAllocation = z.infer<typeof susuCommissionPartialAllocationSchema>;

export const susuCommissionEarlyWithdrawalSchema = z.enum([
  "deduct_full",
  "deduct_pro_rata",
  "waive",
  "block"
]);
export type SusuCommissionEarlyWithdrawal = z.infer<typeof susuCommissionEarlyWithdrawalSchema>;

export const susuDailyContributionModeSchema = z.enum(["fixed", "flexible"]);
export type SusuDailyContributionMode = z.infer<typeof susuDailyContributionModeSchema>;

export const susuCycleStatusSchema = z.enum(["open", "matured", "closed", "rolled_over"]);
export type SusuCycleStatus = z.infer<typeof susuCycleStatusSchema>;

const money = z.number().nonnegative();

export const susuCommissionPolicySchema = z.object({
  id: z.string().uuid().optional(),
  tenantId: z.string().min(1),
  version: z.number().int().positive(),
  enabled: z.boolean(),
  currency: z.string().min(1).default("GHS"),
  dailyContributionMode: susuDailyContributionModeSchema,
  defaultDailyContributionGhs: money,
  cycleDays: z.number().int().positive().max(366),
  commissionBasis: susuCommissionBasisSchema,
  commissionFixedAmount: money,
  commissionPercent: z.number().min(0).max(100),
  deductionTiming: susuCommissionDeductionTimingSchema,
  rolloverTreatment: susuCommissionRolloverTreatmentSchema,
  partialAllocation: susuCommissionPartialAllocationSchema,
  earlyWithdrawalPolicy: susuCommissionEarlyWithdrawalSchema,
  effectiveFrom: z.string().min(1),
  createdByUserId: z.string().nullable().optional(),
  createdAt: z.string().optional()
});

export type SusuCommissionPolicy = z.infer<typeof susuCommissionPolicySchema>;

export const updateSusuCommissionPolicySchema = z.object({
  enabled: z.boolean(),
  dailyContributionMode: susuDailyContributionModeSchema,
  defaultDailyContributionGhs: money,
  cycleDays: z.number().int().positive().max(366),
  commissionBasis: susuCommissionBasisSchema,
  commissionFixedAmount: money.optional().default(0),
  commissionPercent: z.number().min(0).max(100).optional().default(0),
  deductionTiming: susuCommissionDeductionTimingSchema,
  rolloverTreatment: susuCommissionRolloverTreatmentSchema,
  partialAllocation: susuCommissionPartialAllocationSchema,
  earlyWithdrawalPolicy: susuCommissionEarlyWithdrawalSchema,
  effectiveFrom: z.string().min(1).optional()
});

export type UpdateSusuCommissionPolicyInput = z.infer<typeof updateSusuCommissionPolicySchema>;

export const susuCustomerCycleSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().min(1),
  customerId: z.string().min(1),
  branchId: z.string().min(1),
  policyId: z.string().uuid(),
  policyVersion: z.number().int().positive(),
  cycleNumber: z.number().int().positive(),
  status: susuCycleStatusSchema,
  dailyContributionAmount: money,
  cycleDays: z.number().int().positive(),
  commissionBasis: susuCommissionBasisSchema,
  commissionAgreedAmount: money,
  deductionTiming: susuCommissionDeductionTimingSchema,
  rolloverTreatment: susuCommissionRolloverTreatmentSchema,
  partialAllocation: susuCommissionPartialAllocationSchema,
  earlyWithdrawalPolicy: susuCommissionEarlyWithdrawalSchema,
  grossContributions: money,
  customerSavingsCredited: money,
  commissionEarned: money,
  commissionCollected: money,
  commissionOutstanding: money,
  collectionsCount: z.number().int().nonnegative(),
  contributionDays: z.number().int().nonnegative(),
  openedAt: z.string(),
  firstCollectionAt: z.string().nullable().optional(),
  maturedAt: z.string().nullable().optional(),
  closedAt: z.string().nullable().optional(),
  rolledFromCycleId: z.string().uuid().nullable().optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional()
});

export type SusuCustomerCycle = z.infer<typeof susuCustomerCycleSchema>;

export function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/** Agreed institutional fee for one cycle (never double-charged). */
export function computeAgreedCommissionAmount(
  policy: Pick<
    SusuCommissionPolicy,
    "commissionBasis" | "commissionFixedAmount" | "commissionPercent" | "cycleDays"
  >,
  dailyContributionAmount: number
): number {
  const daily = Math.max(0, dailyContributionAmount);
  switch (policy.commissionBasis) {
    case "none":
      return 0;
    case "first_day":
      return roundMoney(daily);
    case "fixed":
      return roundMoney(policy.commissionFixedAmount);
    case "percentage": {
      const expectedGross = daily * policy.cycleDays;
      return roundMoney((expectedGross * policy.commissionPercent) / 100);
    }
    default:
      return 0;
  }
}

export type CollectionAllocationInput = {
  paymentAmount: number;
  commissionOutstanding: number;
  commissionAgreedAmount: number;
  commissionCollected: number;
  deductionTiming: SusuCommissionDeductionTiming;
  partialAllocation: SusuCommissionPartialAllocation;
};

export type CollectionAllocationResult = {
  /** Amount credited to customer Susu savings ledger. */
  savingsCredit: number;
  /** Amount collected as institutional commission now. */
  commissionCollectNow: number;
  /** Gross contribution recorded on the cycle. */
  grossContribution: number;
};

/**
 * Allocate one Susu collection between customer savings and institutional commission.
 * First-day and maturity methods are alternatives for the same agreed fee — never both full fees.
 */
export function allocateSusuCollection(
  input: CollectionAllocationInput
): CollectionAllocationResult {
  const payment = roundMoney(Math.max(0, input.paymentAmount));
  if (payment <= 0) {
    return { savingsCredit: 0, commissionCollectNow: 0, grossContribution: 0 };
  }

  // Maturity / withdrawal: full payment to savings; commission realized later.
  if (
    input.deductionTiming === "cycle_maturity" ||
    input.deductionTiming === "withdrawal"
  ) {
    return {
      savingsCredit: payment,
      commissionCollectNow: 0,
      grossContribution: payment
    };
  }

  // first_collection: satisfy outstanding commission per partial rule.
  const outstanding = roundMoney(Math.max(0, input.commissionOutstanding));
  if (outstanding <= 0) {
    return {
      savingsCredit: payment,
      commissionCollectNow: 0,
      grossContribution: payment
    };
  }

  if (input.partialAllocation === "savings_first") {
    // Prefer savings; only leftover after "full day" intent goes to commission if still owed.
    // For underpayment, savings_first means customer keeps the partial — commission waits.
    return {
      savingsCredit: payment,
      commissionCollectNow: 0,
      grossContribution: payment
    };
  }

  if (input.partialAllocation === "proportional") {
    const agreed = Math.max(outstanding, roundMoney(input.commissionAgreedAmount));
    const remainingSavingsTarget = Math.max(0, agreed); // use outstanding as commission share weight
    const commissionShare = outstanding;
    const savingsShare = Math.max(remainingSavingsTarget, outstanding); // weight at least outstanding
    const totalWeight = commissionShare + savingsShare;
    if (totalWeight <= 0) {
      return { savingsCredit: payment, commissionCollectNow: 0, grossContribution: payment };
    }
    let commissionCollectNow = roundMoney((payment * commissionShare) / totalWeight);
    commissionCollectNow = Math.min(commissionCollectNow, outstanding, payment);
    const savingsCredit = roundMoney(payment - commissionCollectNow);
    return {
      savingsCredit,
      commissionCollectNow,
      grossContribution: payment
    };
  }

  // commission_first (default for traditional first-day model)
  const commissionCollectNow = roundMoney(Math.min(payment, outstanding));
  const savingsCredit = roundMoney(payment - commissionCollectNow);
  return {
    savingsCredit,
    commissionCollectNow,
    grossContribution: payment
  };
}

export function defaultSusuCommissionPolicy(tenantId: string): SusuCommissionPolicy {
  return {
    tenantId,
    version: 1,
    enabled: true,
    currency: "GHS",
    dailyContributionMode: "flexible",
    defaultDailyContributionGhs: 10,
    cycleDays: 31,
    commissionBasis: "first_day",
    commissionFixedAmount: 10,
    commissionPercent: 0,
    deductionTiming: "first_collection",
    rolloverTreatment: "defer",
    partialAllocation: "commission_first",
    earlyWithdrawalPolicy: "deduct_full",
    effectiveFrom: new Date().toISOString().slice(0, 10)
  };
}

export const SUSU_COMMISSION_BASIS_LABELS: Record<SusuCommissionBasis, string> = {
  first_day: "Customer’s registered daily amount (one day)",
  fixed: "Fixed amount (same for all)",
  percentage: "Percentage of cycle total",
  none: "No commission"
};

export const SUSU_DEDUCTION_TIMING_LABELS: Record<SusuCommissionDeductionTiming, string> = {
  first_collection: "First collection(s)",
  cycle_maturity: "Cycle maturity",
  withdrawal: "Customer withdrawal"
};
