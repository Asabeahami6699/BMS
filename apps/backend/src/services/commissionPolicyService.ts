import { commissionPolicySchema, type CommissionPolicy } from "@bms/shared";
import { getSupabaseAdminClient } from "../config/supabaseClient.js";

const policies = new Map<string, CommissionPolicy>();
let warnedMissingTable = false;

function isMissingTable(message: string): boolean {
  return /relation|table|schema cache|does not exist|commission_policies/i.test(message);
}

function defaultPolicyFor(tenantId: string): CommissionPolicy {
  return {
    tenantId,
    currency: "GHS",
    enabled: true,
    fieldAgentCommissionMethod: "cycle_share",
    fieldAgentCycleDays: 31,
    fieldAgentCycleMultiplier: 0.5,
    fieldAgentCommissionPercent: 2.5,
    coordinatorCommissionPercent: 1,
    basis: "gross_collections",
    bonusRules: []
  };
}

function mapDbRow(row: Record<string, unknown>): CommissionPolicy {
  const bonusRaw = Array.isArray(row.bonus_rules) ? row.bonus_rules : [];
  return commissionPolicySchema.parse({
    tenantId: String(row.tenant_id),
    currency: String(row.currency ?? "GHS"),
    enabled: row.enabled !== false,
    fieldAgentCommissionMethod:
      row.field_agent_commission_method === "percentage" ? "percentage" : "cycle_share",
    fieldAgentCycleDays:
      row.field_agent_cycle_days != null ? Number(row.field_agent_cycle_days) : 31,
    fieldAgentCycleMultiplier:
      row.field_agent_cycle_multiplier != null ? Number(row.field_agent_cycle_multiplier) : 0.5,
    fieldAgentCommissionPercent:
      row.field_agent_commission_percent != null ? Number(row.field_agent_commission_percent) : 2.5,
    coordinatorCommissionPercent:
      row.coordinator_commission_percent != null ? Number(row.coordinator_commission_percent) : 1,
    basis: row.basis === "net_collections" ? "net_collections" : "gross_collections",
    bonusRules: bonusRaw.map((item) => {
      const r = item as Record<string, unknown>;
      return {
        threshold: Number(r.threshold ?? 0),
        amount: Number(r.amount ?? 0)
      };
    })
  });
}

export async function getCommissionPolicy(tenantId: string): Promise<CommissionPolicy> {
  const supabase = getSupabaseAdminClient();
  if (supabase) {
    const { data, error } = await supabase
      .from("commission_policies")
      .select("*")
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (error) {
      if (isMissingTable(error.message)) {
        if (!warnedMissingTable) {
          warnedMissingTable = true;
          console.warn(
            "[commissionPolicy] commission_policies table missing — using memory fallback. Apply migration 101_agent_commission_policies.sql."
          );
        }
      } else {
        throw new Error(`Failed to load commission policy: ${error.message}`);
      }
    } else if (data) {
      const parsed = mapDbRow(data as Record<string, unknown>);
      policies.set(tenantId, parsed);
      return parsed;
    }
  }

  const existing = policies.get(tenantId);
  if (existing) {
    return existing;
  }

  const fallback = defaultPolicyFor(tenantId);
  policies.set(tenantId, fallback);
  return fallback;
}

export async function upsertCommissionPolicy(input: unknown): Promise<CommissionPolicy> {
  const policy = commissionPolicySchema.parse(input);
  policies.set(policy.tenantId, policy);

  const supabase = getSupabaseAdminClient();
  if (supabase) {
    const { error } = await supabase.from("commission_policies").upsert(
      {
        tenant_id: policy.tenantId,
        currency: policy.currency,
        enabled: policy.enabled,
        field_agent_commission_method: policy.fieldAgentCommissionMethod,
        field_agent_cycle_days: policy.fieldAgentCycleDays,
        field_agent_cycle_multiplier: policy.fieldAgentCycleMultiplier,
        field_agent_commission_percent: policy.fieldAgentCommissionPercent,
        coordinator_commission_percent: policy.coordinatorCommissionPercent,
        basis: policy.basis,
        bonus_rules: policy.bonusRules,
        updated_at: new Date().toISOString()
      },
      { onConflict: "tenant_id" }
    );
    if (error) {
      if (isMissingTable(error.message)) {
        if (!warnedMissingTable) {
          warnedMissingTable = true;
          console.warn(
            "[commissionPolicy] commission_policies table missing — saved in memory only. Apply migration 101_agent_commission_policies.sql."
          );
        }
      } else {
        throw new Error(`Failed to save commission policy: ${error.message}`);
      }
    }
  }

  return policy;
}
