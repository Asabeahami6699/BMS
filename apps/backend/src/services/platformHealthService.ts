import { getSupabaseAdminClient } from "../config/supabaseClient.js";

export type PlatformTenantHealth = {
  tenantId: string;
  activeUsers: number;
  activeCustomers: number;
  priorOpenTills: number;
  smsEnabled: boolean;
  smsSenderId?: string;
  lastActivityAt: string | null;
};

/**
 * Returns per-tenant operational health indicators for Super Admin Companies dashboard.
 */
export async function listPlatformTenantHealth(
  tenantIds: string[]
): Promise<Record<string, PlatformTenantHealth>> {
  const result: Record<string, PlatformTenantHealth> = {};
  for (const id of tenantIds) {
    result[id] = {
      tenantId: id,
      activeUsers: 0,
      activeCustomers: 0,
      priorOpenTills: 0,
      smsEnabled: false,
      lastActivityAt: null
    };
  }
  if (tenantIds.length === 0) {
    return result;
  }

  const supabase = getSupabaseAdminClient();
  if (!supabase) {
    return result;
  }

  const today = new Date().toISOString().slice(0, 10);

  const [usersRes, customersRes, tillsRes, smsRes, auditRes] = await Promise.all([
    supabase
      .from("users")
      .select("tenant_id, status")
      .in("tenant_id", tenantIds),
    supabase
      .from("customers")
      .select("tenant_id, status")
      .in("tenant_id", tenantIds)
      .eq("status", "active"),
    supabase
      .from("branch_float_sessions")
      .select("tenant_id")
      .in("tenant_id", tenantIds)
      .eq("status", "open")
      .lt("business_date", today),
    supabase
      .from("tenant_sms_settings")
      .select("tenant_id, enabled, sender_id")
      .in("tenant_id", tenantIds),
    supabase
      .from("audit_logs")
      .select("tenant_id, created_at")
      .in("tenant_id", tenantIds)
      .order("created_at", { ascending: false })
      .limit(Math.max(100, tenantIds.length * 15))
  ]);

  if (!usersRes.error && usersRes.data) {
    for (const row of usersRes.data) {
      if (row.status === "inactive") continue;
      const entry = result[String(row.tenant_id)];
      if (entry) entry.activeUsers += 1;
    }
  }

  if (!customersRes.error && customersRes.data) {
    for (const row of customersRes.data) {
      const entry = result[String(row.tenant_id)];
      if (entry) entry.activeCustomers += 1;
    }
  }

  if (!tillsRes.error && tillsRes.data) {
    for (const row of tillsRes.data) {
      const entry = result[String(row.tenant_id)];
      if (entry) entry.priorOpenTills += 1;
    }
  }

  if (!smsRes.error && smsRes.data) {
    for (const row of smsRes.data) {
      const entry = result[String(row.tenant_id)];
      if (entry) {
        entry.smsEnabled = row.enabled === true;
        if (typeof row.sender_id === "string" && row.sender_id.trim()) {
          entry.smsSenderId = row.sender_id.trim();
        }
      }
    }
  }

  if (!auditRes.error && auditRes.data) {
    for (const row of auditRes.data) {
      const entry = result[String(row.tenant_id)];
      if (entry && !entry.lastActivityAt && row.created_at) {
        entry.lastActivityAt = String(row.created_at);
      }
    }
  }

  return result;
}
