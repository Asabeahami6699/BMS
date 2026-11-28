import { z } from "zod";

export const institutionalIncomeSourceSchema = z.enum([
  "susu_commission",
  "savings_fee",
  "current_fee",
  "meba_daakye_fee",
  "other"
]);

export type InstitutionalIncomeSource = z.infer<typeof institutionalIncomeSourceSchema>;

export const INSTITUTIONAL_INCOME_SOURCE_LABELS: Record<InstitutionalIncomeSource, string> = {
  susu_commission: "Susu commission",
  savings_fee: "Savings fixed fee",
  current_fee: "Current account fixed fee",
  meba_daakye_fee: "Meba Daakye fee",
  other: "Other income"
};

export const incomeReportPeriodSchema = z.enum(["daily", "weekly", "monthly", "yearly"]);
export type IncomeReportPeriod = z.infer<typeof incomeReportPeriodSchema>;

export const branchIncomeAccountSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().min(1),
  branchId: z.string().min(1),
  label: z.string().min(1),
  currency: z.string().default("GHS"),
  balance: z.number().nonnegative(),
  isActive: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string().optional()
});

export type BranchIncomeAccount = z.infer<typeof branchIncomeAccountSchema>;

export const institutionalIncomeEntrySchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().min(1),
  branchId: z.string().min(1),
  incomeAccountId: z.string().uuid(),
  source: institutionalIncomeSourceSchema,
  amount: z.number().positive(),
  businessDate: z.string(),
  customerId: z.string().nullable().optional(),
  customerName: z.string().nullable().optional(),
  customerAccountNumber: z.string().nullable().optional(),
  transactionId: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  idempotencyKey: z.string().min(1),
  recordedByUserId: z.string().min(1),
  reversesEntryId: z.string().uuid().nullable().optional(),
  reversedAt: z.string().nullable().optional(),
  reversedByEntryId: z.string().uuid().nullable().optional(),
  reversalReason: z.string().nullable().optional(),
  createdAt: z.string()
});

export type InstitutionalIncomeEntry = z.infer<typeof institutionalIncomeEntrySchema>;

export const postInstitutionalIncomeSchema = z.object({
  branchId: z.string().min(1),
  source: institutionalIncomeSourceSchema,
  amount: z.number().positive(),
  businessDate: z.string().optional(),
  customerId: z.string().optional(),
  transactionId: z.string().optional(),
  notes: z.string().max(500).optional(),
  idempotencyKey: z.string().min(1).max(200)
});

export type PostInstitutionalIncomeInput = z.infer<typeof postInstitutionalIncomeSchema>;

export const reverseInstitutionalIncomeSchema = z.object({
  entryId: z.string().uuid(),
  reason: z.string().trim().min(3).max(500)
});

export type ReverseInstitutionalIncomeInput = z.infer<typeof reverseInstitutionalIncomeSchema>;

export const institutionalIncomeCapitalTransferSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().min(1),
  branchId: z.string().min(1),
  branchName: z.string().nullable().optional(),
  incomeAccountId: z.string().uuid(),
  incomeAccountLabel: z.string().nullable().optional(),
  capitalEntryId: z.string().uuid(),
  amount: z.number().positive(),
  businessDate: z.string(),
  reference: z.string().min(1),
  idempotencyKey: z.string().min(1),
  notes: z.string().nullable().optional(),
  authorizedByUserId: z.string().min(1),
  authorizedByName: z.string().nullable().optional(),
  reversedAt: z.string().nullable().optional(),
  reversedByUserId: z.string().nullable().optional(),
  reversedByName: z.string().nullable().optional(),
  reversalReason: z.string().nullable().optional(),
  createdAt: z.string()
});

export type InstitutionalIncomeCapitalTransfer = z.infer<
  typeof institutionalIncomeCapitalTransferSchema
>;

export const transferInstitutionalIncomeToCapitalSchema = z.object({
  branchId: z.string().trim().min(1, "Select a branch"),
  amount: z.coerce
    .number()
    .finite()
    .positive("Amount must be greater than zero")
    .max(1_000_000_000, "Amount is too large"),
  businessDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD date")
    .optional(),
  reference: z.string().trim().max(120).optional(),
  notes: z.string().trim().max(500).optional(),
  idempotencyKey: z.string().trim().min(1).max(200)
});

export type TransferInstitutionalIncomeToCapitalInput = z.infer<
  typeof transferInstitutionalIncomeToCapitalSchema
>;

export const reverseInstitutionalIncomeCapitalTransferSchema = z.object({
  reason: z.string().trim().min(3, "Enter a reason (at least 3 characters)").max(500)
});

export type ReverseInstitutionalIncomeCapitalTransferInput = z.infer<
  typeof reverseInstitutionalIncomeCapitalTransferSchema
>;

export const incomeCapitalAllocationSummarySchema = z.object({
  storageReady: z.boolean(),
  totalEarnedAllTime: z.number().nonnegative(),
  availableBalance: z.number().nonnegative(),
  totalTransferredToCapital: z.number().nonnegative(),
  transfers: z.array(institutionalIncomeCapitalTransferSchema)
});

export type IncomeCapitalAllocationSummary = z.infer<
  typeof incomeCapitalAllocationSummarySchema
>;

export const incomeSourceBreakdownSchema = z.object({
  source: institutionalIncomeSourceSchema,
  label: z.string(),
  amount: z.number(),
  entryCount: z.number().int().nonnegative()
});

export const incomeBranchBreakdownSchema = z.object({
  branchId: z.string(),
  branchName: z.string(),
  amount: z.number(),
  entryCount: z.number().int().nonnegative(),
  accountBalance: z.number().nonnegative(),
  totalEarnedAllTime: z.number().nonnegative().optional(),
  totalTransferredToCapital: z.number().nonnegative().optional(),
  bySource: z.array(incomeSourceBreakdownSchema)
});

export const institutionalIncomeReportSchema = z.object({
  period: incomeReportPeriodSchema,
  fromDate: z.string(),
  toDate: z.string(),
  currency: z.string().default("GHS"),
  totalAmount: z.number(),
  entryCount: z.number().int().nonnegative(),
  bySource: z.array(incomeSourceBreakdownSchema),
  byBranch: z.array(incomeBranchBreakdownSchema),
  accounts: z.array(branchIncomeAccountSchema),
  recentEntries: z.array(institutionalIncomeEntrySchema),
  capitalAllocation: incomeCapitalAllocationSummarySchema.optional(),
  /** True when caller may only see the daily period. */
  dailyOnly: z.boolean(),
  allowedPeriods: z.array(incomeReportPeriodSchema)
});

export type InstitutionalIncomeReport = z.infer<typeof institutionalIncomeReportSchema>;

export function incomePeriodDateRange(
  period: IncomeReportPeriod,
  asOf: Date = new Date()
): { fromDate: string; toDate: string } {
  const to = new Date(Date.UTC(asOf.getFullYear(), asOf.getMonth(), asOf.getDate()));
  const from = new Date(to);
  if (period === "daily") {
    // same day
  } else if (period === "weekly") {
    const day = from.getUTCDay();
    const mondayOffset = day === 0 ? 6 : day - 1;
    from.setUTCDate(from.getUTCDate() - mondayOffset);
  } else if (period === "monthly") {
    from.setUTCDate(1);
  } else {
    from.setUTCMonth(0, 1);
  }
  return {
    fromDate: from.toISOString().slice(0, 10),
    toDate: to.toISOString().slice(0, 10)
  };
}
