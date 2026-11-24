import { z } from "zod";

export const commissionBasisSchema = z.enum(["gross_collections", "net_collections"]);
export const fieldAgentCommissionMethodSchema = z.enum(["cycle_share", "percentage"]);

export type FieldAgentCommissionMethod = z.infer<typeof fieldAgentCommissionMethodSchema>;

export const bonusRuleSchema = z.object({
  threshold: z.number().nonnegative(),
  amount: z.number().nonnegative()
});

export const commissionPolicySchema = z.object({
  tenantId: z.string().min(1),
  currency: z.string().min(1),
  enabled: z.boolean(),
  fieldAgentCommissionMethod: fieldAgentCommissionMethodSchema.default("cycle_share"),
  fieldAgentCycleDays: z.number().min(1).max(366).default(31),
  fieldAgentCycleMultiplier: z.number().min(0).max(10).default(0.5),
  fieldAgentCommissionPercent: z.number().min(0).max(100),
  coordinatorCommissionPercent: z.number().min(0).max(100),
  basis: commissionBasisSchema,
  bonusRules: z.array(bonusRuleSchema).default([])
});

export type CommissionPolicy = z.infer<typeof commissionPolicySchema>;

export function computeFieldAgentBaseCommission(
  collections: number,
  policy: Pick<
    CommissionPolicy,
    | "fieldAgentCommissionMethod"
    | "fieldAgentCycleDays"
    | "fieldAgentCycleMultiplier"
    | "fieldAgentCommissionPercent"
  >
): number {
  if (!Number.isFinite(collections) || collections <= 0) {
    return 0;
  }
  if (policy.fieldAgentCommissionMethod === "cycle_share") {
    const days = policy.fieldAgentCycleDays > 0 ? policy.fieldAgentCycleDays : 31;
    const mult = policy.fieldAgentCycleMultiplier >= 0 ? policy.fieldAgentCycleMultiplier : 0.5;
    return Math.round(((collections / days) * mult) * 100) / 100;
  }
  return Math.round(((collections * policy.fieldAgentCommissionPercent) / 100) * 100) / 100;
}

export function effectiveFieldAgentPercentFromPolicy(
  policy: Pick<
    CommissionPolicy,
    | "fieldAgentCommissionMethod"
    | "fieldAgentCycleDays"
    | "fieldAgentCycleMultiplier"
    | "fieldAgentCommissionPercent"
  >
): number {
  if (policy.fieldAgentCommissionMethod === "cycle_share") {
    const days = policy.fieldAgentCycleDays > 0 ? policy.fieldAgentCycleDays : 31;
    const mult = policy.fieldAgentCycleMultiplier >= 0 ? policy.fieldAgentCycleMultiplier : 0.5;
    return Math.round(((mult / days) * 100) * 10000) / 10000;
  }
  return policy.fieldAgentCommissionPercent;
}

