import { z } from "zod";

export const aiHelpRequestSchema = z.object({
  message: z.string().min(1).max(2000),
  /** When true, always attach live platform snapshot (default for /analyze). */
  includeData: z.boolean().optional()
});

export const aiPlatformSnapshotScopeSchema = z.object({
  type: z.enum(["head_office", "branch"]),
  branchId: z.string().optional(),
  branchName: z.string().optional()
});

export const aiPlatformSnapshotSchema = z.object({
  generatedAt: z.string(),
  periodDays: z.number().int().positive(),
  periodStart: z.string(),
  scope: aiPlatformSnapshotScopeSchema,
  subscribedModules: z.array(z.string()),
  susuManagement: z
    .object({
      collections: z.object({
        transactionCount: z.number(),
        totalDailySusu: z.number(),
        totalDeposits: z.number(),
        totalWithdrawals: z.number(),
        netFlow: z.number()
      }),
      agents: z.object({
        activeCount: z.number(),
        topPerformers: z.array(
          z.object({
            name: z.string(),
            totalCollections: z.number(),
            dailySusuCount: z.number()
          })
        ),
        bottomPerformers: z.array(
          z.object({
            name: z.string(),
            totalCollections: z.number(),
            dailySusuCount: z.number()
          })
        )
      }),
      pending: z.object({
        registrations: z.number(),
        withdrawals: z.number(),
        balanceInquiries: z.number(),
        withdrawalAmount: z.number()
      }),
      customers: z.object({
        active: z.number(),
        pendingActivation: z.number(),
        susu: z.number(),
        savings: z.number(),
        group: z.number()
      }),
      recentDailyTrend: z.array(
        z.object({
          date: z.string(),
          dailySusu: z.number(),
          deposits: z.number(),
          withdrawals: z.number()
        })
      )
    })
    .optional(),
  agencyBanking: z
    .object({
      queues: z.object({
        depositsPendingBank: z.number(),
        withdrawalsPendingCs: z.number(),
        withdrawalsPendingTeller: z.number()
      }),
      pendingDepositAmount: z.number(),
      periodDeposits: z.number(),
      periodWithdrawals: z.number()
    })
    .optional(),
  loansCredit: z
    .object({
      portfolio: z.object({
        pendingApproval: z.number(),
        approved: z.number(),
        disbursed: z.number(),
        closed: z.number(),
        rejected: z.number(),
        totalOutstandingPrincipal: z.number(),
        totalRepaid: z.number()
      }),
      lastPeriod: z.object({
        newApplications: z.number(),
        disbursedCount: z.number(),
        disbursedAmount: z.number()
      })
    })
    .optional(),
  treasury: z
    .object({
      branchCount: z.number(),
      vaultCash: z.number(),
      tellerCash: z.number(),
      bankCash: z.number(),
      totalCashPosition: z.number()
    })
    .optional()
});

export const aiLoanReviewRequestSchema = z.object({
  loanType: z.enum(["individual", "group_solidarity"]).optional(),
  groupName: z.string().optional(),
  productName: z.string().min(1),
  principalAmount: z.number().positive(),
  interestRatePercent: z.number().min(0),
  termMonths: z.number().int().positive(),
  repaymentFrequency: z.enum(["weekly", "monthly"]),
  installmentAmount: z.number().optional(),
  totalRepayable: z.number().optional(),
  applicantName: z.string().min(1),
  occupation: z.string().optional(),
  monthlyIncome: z.number().optional(),
  monthlyExpenses: z.number().optional(),
  existingLoanBalance: z.number().optional(),
  loanPurpose: z.string().optional(),
  guarantorName: z.string().optional(),
  guarantorRelationship: z.string().optional(),
  hasPassportPhoto: z.boolean().optional(),
  hasIdPhoto: z.boolean().optional()
});

export const aiAssistResponseSchema = z.object({
  reply: z.string(),
  model: z.string(),
  provider: z.literal("ollama"),
  escalated: z.boolean().optional(),
  snapshotIncluded: z.boolean().optional()
});

export const aiAnalyzeResponseSchema = aiAssistResponseSchema.extend({
  snapshot: aiPlatformSnapshotSchema
});

export const aiStatusResponseSchema = z.object({
  available: z.boolean(),
  model: z.string(),
  provider: z.literal("ollama"),
  hint: z.string().optional()
});

export type AiHelpRequest = z.infer<typeof aiHelpRequestSchema>;
export type AiPlatformSnapshot = z.infer<typeof aiPlatformSnapshotSchema>;
export type AiLoanReviewRequest = z.infer<typeof aiLoanReviewRequestSchema>;
export type AiAssistResponse = z.infer<typeof aiAssistResponseSchema>;
export type AiAnalyzeResponse = z.infer<typeof aiAnalyzeResponseSchema>;
export type AiStatusResponse = z.infer<typeof aiStatusResponseSchema>;
