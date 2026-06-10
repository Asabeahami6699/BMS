import { z } from "zod";

export const accountantBranchSummaryRowSchema = z.object({
  branchId: z.string(),
  branchName: z.string().optional(),
  branchCode: z.string().optional(),
  deposits: z.number(),
  withdrawals: z.number(),
  netFlow: z.number(),
  transactionCount: z.number()
});

export const accountantDashboardSchema = z.object({
  totals: z.object({
    totalDeposits: z.number(),
    totalWithdrawals: z.number(),
    cashInVault: z.number(),
    cashInBank: z.number(),
    totalExpenses: z.number(),
    commissionIncome: z.number(),
    loanPortfolio: z.number(),
    fixedDepositPortfolio: z.number(),
    tellerCash: z.number(),
    netCashPosition: z.number()
  }),
  branchSummary: z.array(accountantBranchSummaryRowSchema),
  pendingApprovals: z.number().int(),
  unbalancedBranches: z.number().int()
});

export type AccountantDashboard = z.infer<typeof accountantDashboardSchema>;

export const auditorDashboardSchema = z.object({
  transactionsNeedingReview: z.number().int(),
  cashDifferences: z.number().int(),
  vaultDifference: z.number().int(),
  reversedTransactions: z.number().int(),
  highValueTransactions: z.number().int(),
  userActivityLogs: z.number().int(),
  complianceExceptions: z.number().int(),
  fraudAlerts: z.number().int(),
  highValueThreshold: z.number(),
  reviewQueue: z.array(
    z.object({
      id: z.string(),
      kind: z.string(),
      label: z.string(),
      amount: z.number().optional(),
      branchName: z.string().optional()
    })
  )
});

export type AuditorDashboard = z.infer<typeof auditorDashboardSchema>;

export const hrLeaveRequestSchema = z.object({
  id: z.string(),
  userId: z.string(),
  userName: z.string().optional(),
  leaveType: z.string(),
  startDate: z.string(),
  endDate: z.string(),
  status: z.enum(["pending", "approved", "rejected"]),
  notes: z.string().optional(),
  createdAt: z.string()
});

export type HrLeaveRequest = z.infer<typeof hrLeaveRequestSchema>;

export const hrAttendanceRecordSchema = z.object({
  id: z.string(),
  userId: z.string(),
  userName: z.string().optional(),
  branchId: z.string().nullable().optional(),
  businessDate: z.string(),
  status: z.enum(["present", "absent", "late", "leave"]),
  checkIn: z.string().nullable().optional(),
  notes: z.string().optional()
});

export type HrAttendanceRecord = z.infer<typeof hrAttendanceRecordSchema>;

export const hrTrainingRecordSchema = z.object({
  id: z.string(),
  userId: z.string(),
  userName: z.string().optional(),
  trainingTitle: z.string(),
  completedOn: z.string().nullable().optional(),
  expiresOn: z.string().nullable().optional(),
  status: z.enum(["due", "completed", "expired"]),
  notes: z.string().optional()
});

export type HrTrainingRecord = z.infer<typeof hrTrainingRecordSchema>;

export const createHrLeaveRequestSchema = z.object({
  userId: z.string().min(1),
  leaveType: z.string().min(1).max(80),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  notes: z.string().max(300).optional()
});

export const createHrAttendanceSchema = z.object({
  userId: z.string().min(1),
  branchId: z.string().optional(),
  businessDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  status: z.enum(["present", "absent", "late", "leave"]),
  checkIn: z.string().optional(),
  notes: z.string().max(300).optional()
});

export const createHrTrainingSchema = z.object({
  userId: z.string().min(1),
  trainingTitle: z.string().min(1).max(120),
  completedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  expiresOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  status: z.enum(["due", "completed", "expired"]).optional(),
  notes: z.string().max(300).optional()
});
