import { z } from "zod";

export const aiHelpRequestSchema = z.object({
  message: z.string().min(1).max(2000)
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
  escalated: z.boolean().optional()
});

export const aiStatusResponseSchema = z.object({
  available: z.boolean(),
  model: z.string(),
  provider: z.literal("ollama"),
  hint: z.string().optional()
});

export type AiHelpRequest = z.infer<typeof aiHelpRequestSchema>;
export type AiLoanReviewRequest = z.infer<typeof aiLoanReviewRequestSchema>;
export type AiAssistResponse = z.infer<typeof aiAssistResponseSchema>;
export type AiStatusResponse = z.infer<typeof aiStatusResponseSchema>;
