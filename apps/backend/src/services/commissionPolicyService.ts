import { commissionPolicySchema, type CommissionPolicy } from "@bms/shared";

const policies = new Map<string, CommissionPolicy>();

export function getCommissionPolicy(tenantId: string): CommissionPolicy {
  const existing = policies.get(tenantId);
  if (existing) {
    return existing;
  }

  const defaultPolicy: CommissionPolicy = {
    tenantId,
    currency: "GHS",
    enabled: true,
    fieldAgentCommissionPercent: 2.5,
    coordinatorCommissionPercent: 1,
    basis: "gross_collections",
    bonusRules: []
  };

  policies.set(tenantId, defaultPolicy);
  return defaultPolicy;
}

export function upsertCommissionPolicy(input: unknown): CommissionPolicy {
  const policy = commissionPolicySchema.parse(input);
  policies.set(policy.tenantId, policy);
  return policy;
}
