import { z } from "zod";
import { agencyExecutionStatusSchema } from "./agencyBanking.js";

export const backOfficeEcashRequestStatusSchema = z.enum(["pending", "approved", "rejected"]);

export const backOfficeDepositQueueItemSchema = z.object({
  id: z.string(),
  customerId: z.string(),
  customerName: z.string().optional(),
  amount: z.number(),
  transactionBranchId: z.string(),
  branchName: z.string().optional(),
  branchCode: z.string().optional(),
  recordedByUserId: z.string(),
  recordedByName: z.string().optional(),
  createdAt: z.string(),
  notes: z.string().optional(),
  bankProductId: z.string().optional(),
  bankProductName: z.string().optional(),
  bankLabel: z.string().optional(),
  partnerAccountNumber: z.string().optional(),
  executionStatus: agencyExecutionStatusSchema,
  workflowData: z.record(z.string(), z.unknown()).optional()
});

export type BackOfficeDepositQueueItem = z.infer<typeof backOfficeDepositQueueItemSchema>;

export const backOfficeAccountBalanceRowSchema = z.object({
  bankProductId: z.string(),
  accountName: z.string(),
  bankLabel: z.string(),
  branchId: z.string().optional(),
  branchName: z.string().optional(),
  branchCode: z.string().optional(),
  sessionOpen: z.boolean().optional(),
  openingBalance: z.number(),
  extraCash: z.number(),
  computedTotalEntries: z.number(),
  manualTotalEntries: z.number().nullable(),
  totalEntries: z.number(),
  closingBalance: z.number(),
  executionLimit: z.number().optional(),
  headroom: z.number().optional(),
  limitReached: z.boolean().optional()
});

export type BackOfficeAccountBalanceRow = z.infer<typeof backOfficeAccountBalanceRowSchema>;

export const backOfficeTellerReconRowSchema = z.object({
  tellerUserId: z.string(),
  tellerName: z.string(),
  branchId: z.string().optional(),
  branchName: z.string().optional(),
  branchCode: z.string().optional(),
  tellerDeposits: z.number(),
  backOfficeExecuted: z.number(),
  difference: z.number(),
  depositCount: z.number().int(),
  executedCount: z.number().int()
});

export type BackOfficeTellerReconRow = z.infer<typeof backOfficeTellerReconRowSchema>;

export const backOfficeEcashRequestSchema = z.object({
  id: z.string(),
  branchId: z.string(),
  bankProductId: z.string().nullable().optional(),
  amount: z.number(),
  status: backOfficeEcashRequestStatusSchema,
  notes: z.string().optional(),
  requestedByUserId: z.string(),
  requestedByName: z.string().optional(),
  createdAt: z.string()
});

export type BackOfficeEcashRequest = z.infer<typeof backOfficeEcashRequestSchema>;

export const backOfficeBootstrapSchema = z.object({
  businessDate: z.string(),
  branchId: z.string(),
  viewAllBranches: z.boolean().optional(),
  sessionId: z.string().nullable(),
  sessionOpen: z.boolean(),
  companyAccounts: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      bankLabel: z.string(),
      branchId: z.string().nullable().optional(),
      branchName: z.string().optional(),
      executionLimitAmount: z.number().nullable().optional()
    })
  ),
  depositQueue: z.array(backOfficeDepositQueueItemSchema),
  accountBalances: z.array(backOfficeAccountBalanceRowSchema),
  tellerReconciliation: z.array(backOfficeTellerReconRowSchema),
  ecashRequests: z.array(backOfficeEcashRequestSchema),
  pendingEcashCount: z.number().int(),
  pendingAccountantCount: z.number().int()
});

export type BackOfficeBootstrap = z.infer<typeof backOfficeBootstrapSchema>;

export const openBackOfficeDaySchema = z.object({
  branchId: z.string().uuid(),
  businessDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  openings: z.array(
    z.object({
      bankProductId: z.string().uuid(),
      openingBalance: z.number().nonnegative(),
      extraCash: z.number().nonnegative().default(0),
      notes: z.string().max(300).optional()
    })
  ).min(1)
});

export type OpenBackOfficeDayInput = z.infer<typeof openBackOfficeDaySchema>;

export const executeBackOfficeDepositSchema = z.object({
  executionBankProductId: z.string().uuid()
});

export const createBackOfficeEcashRequestSchema = z.object({
  branchId: z.string().uuid(),
  bankProductId: z.string().uuid().optional(),
  amount: z.number().positive(),
  notes: z.string().max(300).optional()
});

export const updateBackOfficeAccountEntriesSchema = z.object({
  bankProductId: z.string().uuid(),
  manualTotalEntries: z.number().nonnegative()
});
