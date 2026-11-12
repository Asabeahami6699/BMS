import { z } from "zod";

export const loanQualificationPeriodMonthsSchema = z.union([
  z.literal(1),
  z.literal(3),
  z.literal(6)
]);
export type LoanQualificationPeriodMonths = z.infer<typeof loanQualificationPeriodMonthsSchema>;

export const loanQualificationSetupSchema = z.object({
  enabled: z.boolean().default(true),
  /** Consistency lookback: 1, 3, or 6 months. */
  periodMonths: loanQualificationPeriodMonthsSchema.default(3),
  /** Minimum Susu/daily collections in the period. */
  minCollectionDays: z.number().int().min(0).max(366).default(15),
  /** Minimum average end-of-day style balance proxy (ledger balance now). */
  minAccountBalanceGhs: z.number().min(0).max(10_000_000).default(100),
  /** Minimum total Susu collected in the period. */
  minSusuTotalGhs: z.number().min(0).max(10_000_000).default(200),
  /**
   * Share of Susu/savings balance locked as passbook collateral when a loan is disbursed.
   * Example: 30 = lock 30% of withdrawable (before installment reserve).
   */
  collateralPercent: z.number().min(0).max(100).default(30),
  /** Suggested max loan as a multiple of account balance (display / soft cap). */
  maxLoanMultipleOfBalance: z.number().min(0).max(50).default(3),
  /** Credit principal into Susu on disbursement so the customer can withdraw at the counter. */
  disburseToSusu: z.boolean().default(true),
  /** Send SMS when a customer newly qualifies. */
  notifyOnQualifySms: z.boolean().default(true),
  badgeLabel: z.string().trim().min(1).max(40).default("Loan ready")
});

export type LoanQualificationSetup = z.infer<typeof loanQualificationSetupSchema>;

export function defaultLoanQualificationSetup(): LoanQualificationSetup {
  return loanQualificationSetupSchema.parse({});
}

export function parseLoanQualificationSetup(value: unknown): LoanQualificationSetup {
  const parsed = loanQualificationSetupSchema.safeParse(value ?? {});
  return parsed.success ? parsed.data : defaultLoanQualificationSetup();
}

export type LoanQualificationResult = {
  qualified: boolean;
  badgeLabel?: string;
  periodMonths: LoanQualificationPeriodMonths;
  collectionDays: number;
  accountBalance: number;
  susuTotal: number;
  suggestedMaxLoanGhs: number;
  collateralPercent: number;
  reasons: string[];
};

export function evaluateLoanQualification(input: {
  setup: LoanQualificationSetup;
  accountBalance: number;
  collectionDays: number;
  susuTotal: number;
}): LoanQualificationResult {
  const setup = input.setup;
  const reasons: string[] = [];
  if (!setup.enabled) {
    return {
      qualified: false,
      periodMonths: setup.periodMonths,
      collectionDays: input.collectionDays,
      accountBalance: input.accountBalance,
      susuTotal: input.susuTotal,
      suggestedMaxLoanGhs: 0,
      collateralPercent: setup.collateralPercent,
      reasons: ["Loan qualification is turned off for this company."]
    };
  }
  if (input.collectionDays < setup.minCollectionDays) {
    reasons.push(
      `Need at least ${setup.minCollectionDays} Susu collections in ${setup.periodMonths} month(s) (has ${input.collectionDays}).`
    );
  }
  if (input.accountBalance < setup.minAccountBalanceGhs) {
    reasons.push(
      `Need account balance of at least GHS ${setup.minAccountBalanceGhs.toFixed(2)} (has GHS ${input.accountBalance.toFixed(2)}).`
    );
  }
  if (input.susuTotal < setup.minSusuTotalGhs) {
    reasons.push(
      `Need Susu total of at least GHS ${setup.minSusuTotalGhs.toFixed(2)} in the period (has GHS ${input.susuTotal.toFixed(2)}).`
    );
  }
  const qualified = reasons.length === 0;
  const suggestedMaxLoanGhs = qualified
    ? Math.round(input.accountBalance * setup.maxLoanMultipleOfBalance * 100) / 100
    : 0;
  return {
    qualified,
    badgeLabel: qualified ? setup.badgeLabel : undefined,
    periodMonths: setup.periodMonths,
    collectionDays: input.collectionDays,
    accountBalance: input.accountBalance,
    susuTotal: input.susuTotal,
    suggestedMaxLoanGhs,
    collateralPercent: setup.collateralPercent,
    reasons
  };
}
