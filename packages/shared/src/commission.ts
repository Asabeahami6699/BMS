import { z } from "zod";

export const commissionBasisSchema = z.enum(["gross_collections", "net_collections"]);

export const bonusRuleSchema = z.object({
  threshold: z.number().nonnegative(),
  amount: z.number().nonnegative()
});

export const commissionPolicySchema = z.object({
  tenantId: z.string().min(1),
  currency: z.string().min(1),
  enabled: z.boolean(),
  fieldAgentCommissionPercent: z.number().min(0).max(100),
  coordinatorCommissionPercent: z.number().min(0).max(100),
  basis: commissionBasisSchema,
  bonusRules: z.array(bonusRuleSchema).default([])
});

export type CommissionPolicy = z.infer<typeof commissionPolicySchema>;
