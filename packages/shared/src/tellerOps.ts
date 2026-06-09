import { z } from "zod";
import { agencyExecutionStatusSchema } from "./agencyBanking.js";

export const tellerReconciliationRowSchema = z.object({
  tellerId: z.string().min(1),
  tellerName: z.string().min(1),
  businessDate: z.string().min(1),
  branchId: z.string().min(1),
  opening: z.number(),
  deposits: z.number(),
  withdrawals: z.number(),
  closing: z.number().nullable(),
  expectedClosing: z.number(),
  difference: z.number().nullable(),
  status: z.string(),
  transactionCount: z.number().int().nonnegative()
});

export type TellerReconciliationRow = z.infer<typeof tellerReconciliationRowSchema>;

export const tellerTransactionRecordSchema = z.object({
  id: z.string().min(1),
  createdAt: z.string().min(1),
  type: z.enum(["deposit", "withdrawal", "daily_susu"]),
  amount: z.number(),
  customerName: z.string(),
  customerAccountNumber: z.string().optional(),
  partnerAccountNumber: z.string().optional(),
  bankProductId: z.string().uuid().optional(),
  bankProductName: z.string().optional(),
  bankLabel: z.string().optional(),
  recordedByName: z.string(),
  recordedByUserId: z.string(),
  notes: z.string().optional(),
  executionStatus: z.string().optional()
});

export const tellerReconciliationTabSchema = z.enum([
  "opening",
  "deposits",
  "withdrawals",
  "closing",
  "difference"
]);

export type TellerReconciliationTab = z.infer<typeof tellerReconciliationTabSchema>;

export type TellerTransactionRecord = z.infer<typeof tellerTransactionRecordSchema>;

export const tellerDepositStatusSchema = z.object({
  id: z.string().min(1),
  createdAt: z.string().min(1),
  amount: z.number(),
  customerName: z.string(),
  executionStatus: agencyExecutionStatusSchema,
  bankLabel: z.string().optional(),
  bankProductName: z.string().optional(),
  partnerAccountNumber: z.string().optional()
});

export type TellerDepositStatus = z.infer<typeof tellerDepositStatusSchema>;

export const tellerAgencyDepositsSchema = z.object({
  businessDate: z.string(),
  branchId: z.string(),
  deposits: z.array(tellerDepositStatusSchema)
});

export type TellerAgencyDeposits = z.infer<typeof tellerAgencyDepositsSchema>;

export const tellerTillEntryTypeSchema = z.enum([
  "cash_to_bank",
  "expense",
  "opening_drawer",
  "extra_cash",
  "till_count",
  "other"
]);

export type TellerTillEntryType = z.infer<typeof tellerTillEntryTypeSchema>;

export const TELLER_TILL_ENTRY_LABELS: Record<TellerTillEntryType, string> = {
  cash_to_bank: "Cash to bank",
  expense: "Expense / petty cash",
  opening_drawer: "Opening drawer",
  extra_cash: "Extra cash from vault",
  till_count: "Till count adjustment",
  other: "Other movement"
};

export const tellerTillJournalEntrySchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().min(1),
  branchId: z.string().min(1),
  tellerUserId: z.string().min(1),
  businessDate: z.string().min(1),
  entryType: tellerTillEntryTypeSchema,
  amount: z.number(),
  notes: z.string().optional(),
  createdAt: z.string().min(1),
  createdByUserId: z.string().min(1),
  createdByName: z.string().optional()
});

export type TellerTillJournalEntry = z.infer<typeof tellerTillJournalEntrySchema>;

export const createTellerTillJournalEntrySchema = z.object({
  branchId: z.string().min(1),
  businessDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  entryType: tellerTillEntryTypeSchema,
  amount: z.number().positive("Amount must be greater than zero"),
  notes: z.string().max(300).optional()
});

export type CreateTellerTillJournalEntryInput = z.infer<typeof createTellerTillJournalEntrySchema>;

export const tellerReconciliationBootstrapSchema = z.object({
  businessDate: z.string(),
  branchId: z.string(),
  rows: z.array(tellerReconciliationRowSchema),
  transactions: z.array(tellerTransactionRecordSchema)
});

export type TellerReconciliationBootstrap = z.infer<typeof tellerReconciliationBootstrapSchema>;
