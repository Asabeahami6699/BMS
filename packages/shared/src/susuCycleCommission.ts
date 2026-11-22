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

export const susuPassbookBoxStatusSchema = z.enum(["empty", "partial", "checked"]);
export type SusuPassbookBoxStatus = z.infer<typeof susuPassbookBoxStatusSchema>;

export const susuPassbookBoxSchema = z.object({
  boxNumber: z.number().int().positive(),
  targetAmount: money,
  filledAmount: money,
  status: susuPassbookBoxStatusSchema,
  isFeeBox: z.boolean(),
  feeAmount: money,
  savingsAmount: money,
  filledAt: z.string().nullable(),
  transactionIds: z.array(z.string())
});
export type SusuPassbookBox = z.infer<typeof susuPassbookBoxSchema>;

export const susuPassbookCardSchema = z.object({
  cycleId: z.string().uuid().nullable().optional(),
  cycleNumber: z.number().int().positive(),
  status: susuCycleStatusSchema,
  dailyContributionAmount: money,
  cycleDays: z.number().int().positive(),
  commissionBasis: susuCommissionBasisSchema,
  deductionTiming: susuCommissionDeductionTimingSchema,
  commissionAgreedAmount: money,
  commissionCollected: money,
  commissionOutstanding: money,
  grossContributions: money,
  customerSavingsCredited: money,
  expectedGross: money,
  checkedBoxes: z.number().int().nonnegative(),
  partialBoxNumber: z.number().int().positive().nullable(),
  partialBoxAmount: money,
  openedAt: z.string().nullable(),
  maturedAt: z.string().nullable(),
  boxes: z.array(susuPassbookBoxSchema)
});
export type SusuPassbookCard = z.infer<typeof susuPassbookCardSchema>;

export const susuCustomerPassbookSchema = z.object({
  customerId: z.string().min(1),
  dailyContributionAmount: money,
  pendingDailyContributionAmount: z.number().positive().nullable().optional(),
  cycleDays: z.number().int().positive(),
  activeCardNumber: z.number().int().positive(),
  cards: z.array(susuPassbookCardSchema),
  totalGrossCollected: money.optional(),
  totalCommissionCollected: money.optional(),
  totalNetCredited: money.optional(),
  totalWithdrawalsAndCharges: money.optional(),
  otherCredits: money.optional(),
  accountBalance: z.number().optional()
});
export type SusuCustomerPassbook = z.infer<typeof susuCustomerPassbookSchema>;

export const susuCustomerCycleSummarySchema = z.object({
  openCycle: susuCustomerCycleSchema.nullable(),
  cycles: z.array(susuCustomerCycleSchema).default([]),
  policy: susuCommissionPolicySchema,
  passbook: susuCustomerPassbookSchema
});
export type SusuCustomerCycleSummary = z.infer<typeof susuCustomerCycleSummarySchema>;

/**
 * Recover the gross customer payment for a daily_susu transaction.
 * When first-day commission was deducted on posting, transaction.amount holds net savings
 * while notes preserve `gross GHS X.XX`.
 */
export function extractGrossSusuContribution(amount: number, notes?: string | null): number {
  if (notes) {
    const match = /gross\s+GHS\s+([0-9]+(?:\.[0-9]+)?)/i.exec(notes);
    if (match?.[1]) {
      const parsed = Number(match[1]);
      if (Number.isFinite(parsed) && parsed > 0) {
        return roundMoney(parsed);
      }
    }
  }
  return roundMoney(Math.max(0, amount));
}

export type SusuPassbookCollectionInput = {
  id: string;
  grossAmount: number;
  /** Actual amount credited to the customer's savings ledger (when loaded from real transactions). */
  ledgerAmount?: number;
  createdAt: string;
};

/**
 * Build a customer's full virtual Susu passbook (Page #1, Page #2, ...) from
 * chronological non-reversed Susu collections and persisted cycles.
 *
 * - Converts each payment into auto-checked boxes: boxes = gross / daily.
 * - Handles non-multiples by leaving a partial fill on the next box (e.g. 10/20).
 * - Handles overflow past box `cycleDays` by maturing the current page and rolling
 *   the remaining amount into the next page (starting at Box 1).
 * - When `ledgerAmount` is supplied from actual transactions, uses the real deducted
 *   commission (`grossAmount - ledgerAmount`) instead of fabricating retroactive fees on
 *   historical pre-policy transactions.
 * - Excluding reversed transactions automatically unchecks the boxes they filled.
 */
export function buildSusuCustomerPassbook(input: {
  customerId: string;
  dailyContributionAmount: number;
  pendingDailyContributionAmount?: number | null;
  policy: SusuCommissionPolicy;
  cycles?: SusuCustomerCycle[];
  collections: SusuPassbookCollectionInput[];
  reconciliation?: {
    totalWithdrawalsAndCharges: number;
    otherCredits: number;
    accountBalance: number;
  };
}): SusuCustomerPassbook {
  const persistedByNumber = new Map<number, SusuCustomerCycle>();
  for (const cycle of input.cycles ?? []) {
    persistedByNumber.set(cycle.cycleNumber, cycle);
  }

  const baseDaily = roundMoney(
    input.dailyContributionAmount > 0
      ? input.dailyContributionAmount
      : input.cycles?.[0]?.dailyContributionAmount && input.cycles[0].dailyContributionAmount > 0
        ? input.cycles[0].dailyContributionAmount
        : input.policy.defaultDailyContributionGhs
  );

  const defaultCycleDays = Math.max(1, input.policy.cycleDays || 31);

  type MutableCard = {
    cycleId: string | null;
    cycleNumber: number;
    status: SusuCycleStatus;
    daily: number;
    cycleDays: number;
    commissionBasis: SusuCommissionBasis;
    deductionTiming: SusuCommissionDeductionTiming;
    partialAllocation: SusuCommissionPartialAllocation;
    commissionAgreedAmount: number;
    commissionCollected: number;
    commissionOutstanding: number;
    grossContributions: number;
    customerSavingsCredited: number;
    openedAt: string | null;
    maturedAt: string | null;
    boxes: SusuPassbookBox[];
  };

  function feeBoxIndexFor(
    cycleDays: number,
    timing: SusuCommissionDeductionTiming,
    agreed: number
  ): number | null {
    if (!(agreed > 0)) {
      return null;
    }
    if (timing === "first_collection") {
      return 1;
    }
    if (timing === "cycle_maturity") {
      return cycleDays;
    }
    return null;
  }

  function createCard(cycleNumber: number, openedAt: string | null): MutableCard {
    const persisted = persistedByNumber.get(cycleNumber);
    const cycleDays = Math.max(1, persisted?.cycleDays ?? defaultCycleDays);
    const daily = roundMoney(
      persisted?.dailyContributionAmount && persisted.dailyContributionAmount > 0
        ? persisted.dailyContributionAmount
        : baseDaily
    );
    const commissionBasis = persisted?.commissionBasis ?? input.policy.commissionBasis;
    const deductionTiming = persisted?.deductionTiming ?? input.policy.deductionTiming;
    const partialAllocation = persisted?.partialAllocation ?? input.policy.partialAllocation;
    const commissionAgreedAmount =
      persisted != null
        ? roundMoney(persisted.commissionAgreedAmount)
        : input.policy.enabled
          ? computeAgreedCommissionAmount(
              {
                commissionBasis,
                commissionFixedAmount: input.policy.commissionFixedAmount,
                commissionPercent: input.policy.commissionPercent,
                cycleDays
              },
              daily
            )
          : 0;
    const feeBoxNo = feeBoxIndexFor(cycleDays, deductionTiming, commissionAgreedAmount);
    const boxes: SusuPassbookBox[] = Array.from({ length: cycleDays }, (_, idx) => {
      const boxNumber = idx + 1;
      return {
        boxNumber,
        targetAmount: daily,
        filledAmount: 0,
        status: "empty",
        isFeeBox: feeBoxNo === boxNumber,
        feeAmount: 0,
        savingsAmount: 0,
        filledAt: null,
        transactionIds: []
      };
    });

    return {
      cycleId: persisted?.id ?? null,
      cycleNumber,
      status: persisted?.status === "closed" ? "closed" : "open",
      daily,
      cycleDays,
      commissionBasis,
      deductionTiming,
      partialAllocation,
      commissionAgreedAmount,
      commissionCollected: 0,
      commissionOutstanding: commissionAgreedAmount,
      grossContributions: 0,
      customerSavingsCredited: 0,
      openedAt: persisted?.openedAt ?? openedAt,
      maturedAt: null,
      boxes
    };
  }

  const cards: MutableCard[] = [];
  const sortedCollections = [...input.collections]
    .filter((c) => c.grossAmount > 0)
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

  let currentCard = createCard(1, sortedCollections[0]?.createdAt ?? null);
  cards.push(currentCard);

  const EPS = 0.005;

  for (const col of sortedCollections) {
    let remaining = roundMoney(col.grossAmount);
    const hasActualLedger = typeof col.ledgerAmount === "number" && Number.isFinite(col.ledgerAmount);
    let remainingActualFee = hasActualLedger
      ? roundMoney(Math.max(0, col.grossAmount - col.ledgerAmount!))
      : 0;
    let safety = 0;

    while (remaining > EPS && safety < 24) {
      safety += 1;

      if (currentCard.daily <= 0) {
        // Zero daily plan fallback: mark next empty box with the payment amount.
        const nextBox = currentCard.boxes.find((b) => b.status !== "checked");
        if (!nextBox) {
          currentCard.status = currentCard.status === "closed" ? "closed" : "matured";
          currentCard.maturedAt = currentCard.maturedAt ?? col.createdAt;
          currentCard = createCard(currentCard.cycleNumber + 1, col.createdAt);
          cards.push(currentCard);
          continue;
        }
        const sliceCommission = hasActualLedger
          ? roundMoney(Math.min(remaining, remainingActualFee))
          : allocateSusuCollection({
              paymentAmount: remaining,
              commissionOutstanding: currentCard.commissionOutstanding,
              commissionAgreedAmount: currentCard.commissionAgreedAmount,
              commissionCollected: currentCard.commissionCollected,
              deductionTiming: currentCard.deductionTiming,
              partialAllocation: currentCard.partialAllocation
            }).commissionCollectNow;
        const sliceSavings = roundMoney(remaining - sliceCommission);
        if (hasActualLedger) {
          remainingActualFee = roundMoney(Math.max(0, remainingActualFee - sliceCommission));
        }
        nextBox.targetAmount = remaining;
        nextBox.filledAmount = remaining;
        nextBox.status = "checked";
        nextBox.feeAmount = roundMoney(nextBox.feeAmount + sliceCommission);
        nextBox.savingsAmount = roundMoney(nextBox.savingsAmount + sliceSavings);
        nextBox.filledAt = col.createdAt;
        if (!nextBox.transactionIds.includes(col.id)) {
          nextBox.transactionIds.push(col.id);
        }
        currentCard.grossContributions = roundMoney(currentCard.grossContributions + remaining);
        currentCard.commissionCollected = roundMoney(
          currentCard.commissionCollected + sliceCommission
        );
        currentCard.commissionOutstanding = roundMoney(
          Math.max(0, currentCard.commissionAgreedAmount - currentCard.commissionCollected)
        );
        currentCard.customerSavingsCredited = roundMoney(
          currentCard.customerSavingsCredited + sliceSavings
        );
        if (currentCard.boxes.every((b) => b.status === "checked")) {
          currentCard.status = currentCard.status === "closed" ? "closed" : "matured";
          currentCard.maturedAt = currentCard.maturedAt ?? col.createdAt;
        }
        remaining = 0;
        break;
      }

      const cardCapacity = roundMoney(currentCard.daily * currentCard.cycleDays);
      const cardRemaining = roundMoney(Math.max(0, cardCapacity - currentCard.grossContributions));

      if (cardRemaining <= EPS) {
        currentCard.status = currentCard.status === "closed" ? "closed" : "matured";
        currentCard.maturedAt = currentCard.maturedAt ?? col.createdAt;
        currentCard = createCard(currentCard.cycleNumber + 1, col.createdAt);
        cards.push(currentCard);
        continue;
      }

      const slice = roundMoney(Math.min(remaining, cardRemaining));
      let sliceCommission = 0;
      let sliceSavings = slice;

      if (hasActualLedger) {
        // Use real commission actually withheld from this transaction (never fabricate retroactive fees).
        // Respect each page's remaining commissionOutstanding so overflow fees land on the new page's Box 1.
        const isLastSliceOfTx = remaining - slice <= EPS;
        const cardFeeCap = isLastSliceOfTx
          ? remainingActualFee
          : Math.max(0, currentCard.commissionOutstanding);
        sliceCommission = roundMoney(Math.min(slice, remainingActualFee, cardFeeCap));
        sliceSavings = roundMoney(slice - sliceCommission);
        remainingActualFee = roundMoney(Math.max(0, remainingActualFee - sliceCommission));
      } else {
        const alloc = allocateSusuCollection({
          paymentAmount: slice,
          commissionOutstanding: currentCard.commissionOutstanding,
          commissionAgreedAmount: currentCard.commissionAgreedAmount,
          commissionCollected: currentCard.commissionCollected,
          deductionTiming: currentCard.deductionTiming,
          partialAllocation: currentCard.partialAllocation
        });
        sliceCommission = alloc.commissionCollectNow;
        sliceSavings = alloc.savingsCredit;
      }

      const nextGross = roundMoney(currentCard.grossContributions + slice);
      const reachedMaturity = nextGross >= cardCapacity - EPS;

      if (!hasActualLedger && reachedMaturity && currentCard.deductionTiming === "cycle_maturity") {
        const stillOwed = roundMoney(
          Math.max(
            0,
            currentCard.commissionAgreedAmount - (currentCard.commissionCollected + sliceCommission)
          )
        );
        if (stillOwed > 0) {
          const withheld = roundMoney(Math.min(sliceSavings, stillOwed));
          sliceSavings = roundMoney(sliceSavings - withheld);
          sliceCommission = roundMoney(sliceCommission + withheld);
        }
      }

      // Distribute slice across boxes sequentially (1..cycleDays).
      let boxRem = slice;
      let feeRem = sliceCommission;
      for (const box of currentCard.boxes) {
        if (boxRem <= EPS) {
          break;
        }
        const need = roundMoney(Math.max(0, box.targetAmount - box.filledAmount));
        if (need <= EPS) {
          continue;
        }
        const add = roundMoney(Math.min(boxRem, need));
        box.filledAmount = roundMoney(box.filledAmount + add);
        if (box.targetAmount - box.filledAmount <= EPS) {
          box.filledAmount = box.targetAmount;
          box.status = "checked";
        } else if (box.filledAmount > EPS) {
          box.status = "partial";
        }
        // Attribute fee onto fee box first (or earliest filled boxes if fee spans > 1 box).
        let feeHere = 0;
        if (feeRem > EPS) {
          if (box.isFeeBox || currentCard.deductionTiming === "first_collection") {
            feeHere = roundMoney(Math.min(feeRem, add));
            feeRem = roundMoney(feeRem - feeHere);
          }
        }
        box.feeAmount = roundMoney(box.feeAmount + feeHere);
        box.savingsAmount = roundMoney(box.savingsAmount + roundMoney(add - feeHere));
        box.filledAt = col.createdAt;
        if (!box.transactionIds.includes(col.id)) {
          box.transactionIds.push(col.id);
        }
        boxRem = roundMoney(boxRem - add);
      }

      // If maturity fee was withheld on last box, ensure feeAmount reflects it cleanly.
      if (feeRem > EPS) {
        const feeBox =
          currentCard.boxes.find((b) => b.isFeeBox) ??
          currentCard.boxes[currentCard.boxes.length - 1];
        if (feeBox) {
          const shift = roundMoney(Math.min(feeRem, feeBox.savingsAmount));
          feeBox.feeAmount = roundMoney(feeBox.feeAmount + shift);
          feeBox.savingsAmount = roundMoney(feeBox.savingsAmount - shift);
        }
      }

      currentCard.grossContributions = nextGross;
      currentCard.commissionCollected = roundMoney(
        currentCard.commissionCollected + sliceCommission
      );
      currentCard.commissionOutstanding = roundMoney(
        Math.max(0, currentCard.commissionAgreedAmount - currentCard.commissionCollected)
      );
      currentCard.customerSavingsCredited = roundMoney(
        currentCard.customerSavingsCredited + sliceSavings
      );

      if (reachedMaturity) {
        currentCard.status = currentCard.status === "closed" ? "closed" : "matured";
        currentCard.maturedAt = currentCard.maturedAt ?? col.createdAt;
      }

      remaining = roundMoney(remaining - slice);
      if (remaining > EPS && reachedMaturity) {
        currentCard = createCard(currentCard.cycleNumber + 1, col.createdAt);
        cards.push(currentCard);
      }
    }
  }

  // Reconcile closed status from persisted cycles (e.g. settled at withdrawal) without losing boxes.
  const usedActualLedger = sortedCollections.some(
    (c) => typeof c.ledgerAmount === "number" && Number.isFinite(c.ledgerAmount)
  );
  for (const card of cards) {
    const persisted = persistedByNumber.get(card.cycleNumber);
    if (persisted?.status === "closed") {
      card.status = "closed";
      if (persisted.commissionCollected > card.commissionCollected) {
        card.commissionCollected = roundMoney(persisted.commissionCollected);
        card.commissionOutstanding = roundMoney(
          Math.max(0, card.commissionAgreedAmount - card.commissionCollected)
        );
      }
    } else if (usedActualLedger && !persisted && card.commissionCollected === 0) {
      // Historical pre-policy page with no persisted cycle row: don't claim an unpaid fee.
      card.commissionOutstanding = 0;
    }
  }

  const finalCards: SusuPassbookCard[] = cards.map((card) => {
    const checkedBoxes = card.boxes.filter((b) => b.status === "checked").length;
    const partialBox = card.boxes.find((b) => b.status === "partial") ?? null;
    return {
      cycleId: card.cycleId,
      cycleNumber: card.cycleNumber,
      status: card.status,
      dailyContributionAmount: card.daily,
      cycleDays: card.cycleDays,
      commissionBasis: card.commissionBasis,
      deductionTiming: card.deductionTiming,
      commissionAgreedAmount: card.commissionAgreedAmount,
      commissionCollected: card.commissionCollected,
      commissionOutstanding: card.commissionOutstanding,
      grossContributions: card.grossContributions,
      customerSavingsCredited: card.customerSavingsCredited,
      expectedGross: roundMoney(card.daily * card.cycleDays),
      checkedBoxes,
      partialBoxNumber: partialBox?.boxNumber ?? null,
      partialBoxAmount: partialBox?.filledAmount ?? 0,
      openedAt: card.openedAt,
      maturedAt: card.maturedAt,
      boxes: card.boxes
    };
  });

  const openCard = finalCards.find((c) => c.status === "open");
  const activeCardNumber =
    openCard?.cycleNumber ?? finalCards[finalCards.length - 1]?.cycleNumber ?? 1;

  const totalGrossCollected = roundMoney(
    finalCards.reduce((sum, c) => sum + c.grossContributions, 0)
  );
  const totalCommissionCollected = roundMoney(
    finalCards.reduce((sum, c) => sum + c.commissionCollected, 0)
  );
  const totalNetCredited = roundMoney(
    finalCards.reduce((sum, c) => sum + c.customerSavingsCredited, 0)
  );

  return {
    customerId: input.customerId,
    dailyContributionAmount: baseDaily,
    ...(input.pendingDailyContributionAmount && input.pendingDailyContributionAmount > 0
      ? { pendingDailyContributionAmount: roundMoney(input.pendingDailyContributionAmount) }
      : {}),
    cycleDays: defaultCycleDays,
    activeCardNumber,
    cards: finalCards,
    totalGrossCollected,
    totalCommissionCollected,
    totalNetCredited,
    ...(input.reconciliation
      ? {
          totalWithdrawalsAndCharges: roundMoney(input.reconciliation.totalWithdrawalsAndCharges),
          otherCredits: roundMoney(input.reconciliation.otherCredits),
          accountBalance: roundMoney(input.reconciliation.accountBalance)
        }
      : {})
  };
}
