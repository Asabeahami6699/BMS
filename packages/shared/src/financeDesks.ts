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
  rejectedReason: z.string().optional(),
  reviewedBy: z.string().optional(),
  reviewedAt: z.string().optional(),
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
  checkOut: z.string().nullable().optional(),
  checkInPhotoUrl: z.string().optional(),
  checkOutPhotoUrl: z.string().optional(),
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
  checkOut: z.string().optional(),
  checkInPhotoUrl: z.string().max(4_500_000).optional(),
  checkOutPhotoUrl: z.string().max(4_500_000).optional(),
  notes: z.string().max(300).optional()
});

export const hrAttendanceCheckSchema = z.object({
  photoUrl: z.string().max(4_500_000).optional(),
  branchId: z.string().optional()
});

export const hrLeaveSummarySchema = z.object({
  annualEntitlement: z.number().int(),
  usedDays: z.number().int(),
  availableDays: z.number().int(),
  pendingCount: z.number().int(),
  approvedCount: z.number().int()
});

export type HrLeaveSummary = z.infer<typeof hrLeaveSummarySchema>;

export const updateHrLeaveStatusSchema = z.object({
  status: z.enum(["approved", "rejected"]),
  rejectedReason: z.string().max(300).optional()
});

export const hrRoleLeaveEntitlementSchema = z.object({
  roleKey: z.string(),
  roleLabel: z.string(),
  annualLeaveDays: z.number().int().min(0)
});

export type HrRoleLeaveEntitlement = z.infer<typeof hrRoleLeaveEntitlementSchema>;

export const hrPoliciesSchema = z.object({
  lateCheckInTime: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/),
  defaultAnnualLeaveDays: z.number().int().min(0),
  roleLeaveEntitlements: z.array(hrRoleLeaveEntitlementSchema)
});

export type HrPolicies = z.infer<typeof hrPoliciesSchema>;

export const updateHrPoliciesSchema = z.object({
  lateCheckInTime: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/),
  defaultAnnualLeaveDays: z.number().int().min(0).optional(),
  roleLeaveEntitlements: z.array(
    z.object({
      roleKey: z.string().min(1),
      annualLeaveDays: z.number().int().min(0)
    })
  )
});

export const updateStaffLoanStatusSchema = z.object({
  status: z.enum(["approved", "declined"]),
  monthlyDeduction: z.number().positive().optional()
});

export const createHrTrainingSchema = z.object({
  userId: z.string().min(1),
  trainingTitle: z.string().min(1).max(120),
  completedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  expiresOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  status: z.enum(["due", "completed", "expired"]).optional(),
  notes: z.string().max(300).optional()
});
