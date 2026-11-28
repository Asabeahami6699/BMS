import { z } from "zod";

export const branchCapitalEntryTypeSchema = z.enum([
  "injection",
  "drawing",
  "income_allocation"
]);
export type BranchCapitalEntryType = z.infer<typeof branchCapitalEntryTypeSchema>;

export const manualBranchCapitalEntryTypeSchema = z.enum(["injection", "drawing"]);
export type ManualBranchCapitalEntryType = z.infer<typeof manualBranchCapitalEntryTypeSchema>;

export const createBranchCapitalEntrySchema = z.object({
  branchId: z.string().trim().min(1, "Select a branch"),
  businessDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD date"),
  entryType: manualBranchCapitalEntryTypeSchema,
  amount: z.coerce
    .number()
    .finite()
    .positive("Amount must be greater than zero")
    .max(1_000_000_000, "Amount is too large"),
  source: z.string().trim().max(120).optional(),
  reference: z.string().trim().max(120).optional(),
  notes: z.string().trim().max(500).optional()
});
export type CreateBranchCapitalEntryInput = z.infer<typeof createBranchCapitalEntrySchema>;

export const voidBranchCapitalEntrySchema = z.object({
  reason: z.string().trim().min(2, "Enter a reason for voiding").max(300)
});
export type VoidBranchCapitalEntryInput = z.infer<typeof voidBranchCapitalEntrySchema>;

export type BranchCapitalEntry = {
  id: string;
  tenantId: string;
  branchId: string;
  businessDate: string;
  entryType: BranchCapitalEntryType;
  amount: number;
  source?: string;
  reference?: string;
  notes?: string;
  incomeAccountId?: string;
  recordedBy: string;
  recordedByName?: string;
  voidedAt?: string;
  voidedBy?: string;
  voidReason?: string;
  createdAt: string;
};

export type BranchCapitalSummary = {
  storageReady: boolean;
  branchId?: string;
  businessDate: string;
  /** Company-wide cumulative totals across all branches (non-voided). */
  companyTotalInjected: number;
  companyTotalCashInjected?: number;
  companyTotalIncomeAllocated?: number;
  companyTotalDrawings: number;
  companyNetCapital: number;
  /** Selected branch cumulative totals (non-voided). */
  branchTotalInjected: number;
  branchTotalCashInjected?: number;
  branchTotalIncomeAllocated?: number;
  branchTotalDrawings: number;
  branchNetCapital: number;
  /** Selected branch + businessDate physical cash totals (non-voided; excludes non-cash income allocations). */
  dayInjections: number;
  dayDrawings: number;
  /** Selected branch + businessDate non-cash commission income allocations (informational only; zero vault cash impact). */
  dayIncomeAllocations?: number;
  /** Recent entries (newest first) for the selected branch (or all branches if branchId omitted). */
  entries: BranchCapitalEntry[];
};
