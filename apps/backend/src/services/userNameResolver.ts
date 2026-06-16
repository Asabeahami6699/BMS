import { getSupabaseAdminClient } from "../config/supabaseClient.js";
import { isSupabaseAuthNetworkError } from "../lib/networkError.js";
import { findUserById, listUsersByTenant } from "./authStore.js";

const USER_NAME_BATCH_SIZE = 100;

export function userDisplayName(
  fullName: string | null | undefined,
  email: string | null | undefined,
  id: string
): string {
  const name = fullName?.trim();
  if (name) {
    return name;
  }
  const mail = email?.trim();
  if (mail) {
    return mail;
  }
  return id;
}

/** One query — all staff names for a tenant (back office, statements, reconciliation). */
export async function fetchTenantUserNameMap(tenantId: string): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const supabase = getSupabaseAdminClient();
  if (supabase) {
    try {
      const { data, error } = await supabase
        .from("users")
        .select("id, full_name, email")
        .eq("tenant_id", tenantId);
      if (error) {
        console.warn(`[userNameResolver] Tenant user lookup failed: ${error.message}`);
      } else {
        for (const row of data ?? []) {
          const id = String(row.id);
          map.set(id, userDisplayName(row.full_name, row.email, id));
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[userNameResolver] Could not load tenant users: ${message}`);
    }
  }
  for (const user of listUsersByTenant(tenantId)) {
    if (!map.has(user.id)) {
      map.set(user.id, userDisplayName(user.fullName, user.email, user.id));
    }
  }
  return map;
}

export async function fetchUserNameMap(tenantId: string, userIds: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(userIds.filter((id) => id.length > 0))];
  const map = new Map<string, string>();
  if (unique.length === 0) {
    return map;
  }

  for (const id of unique) {
    map.set(id, id.slice(0, 8));
  }

  const supabase = getSupabaseAdminClient();
  if (!supabase) {
    for (const id of unique) {
      const user = findUserById(id) ?? listUsersByTenant(tenantId).find((entry) => entry.id === id);
      if (user) {
        map.set(id, userDisplayName(user.fullName, user.email, id));
      }
    }
    return map;
  }

  try {
    for (let offset = 0; offset < unique.length; offset += USER_NAME_BATCH_SIZE) {
      const batch = unique.slice(offset, offset + USER_NAME_BATCH_SIZE);
      const { data, error } = await supabase
        .from("users")
        .select("id, full_name, email")
        .eq("tenant_id", tenantId)
        .in("id", batch);
      if (error) {
        console.warn(`[userNameResolver] User lookup batch failed: ${error.message}`);
        continue;
      }
      for (const row of data ?? []) {
        map.set(String(row.id), userDisplayName(row.full_name, row.email, String(row.id)));
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (isSupabaseAuthNetworkError(error)) {
      console.warn("[userNameResolver] Network error resolving user names; using id fallbacks.");
    } else {
      console.warn(`[userNameResolver] Could not resolve user names: ${message}`);
    }
  }

  return map;
}

export async function buildAgentNamesRecord(
  tenantId: string,
  fieldAgentIds: string[]
): Promise<Record<string, string>> {
  const unique = [...new Set(fieldAgentIds.filter((id) => id.length > 0))];
  const nameMap = await fetchUserNameMap(tenantId, unique);
  const out: Record<string, string> = {};
  for (const id of unique) {
    out[id] = nameMap.get(id) ?? id.slice(0, 8);
  }
  return out;
}

export function ledgerPerformerLabel(input: {
  recordedByName?: string;
  fieldAgentName?: string;
  recordedByUserId?: string;
  fieldAgentId?: string;
}): string | undefined {
  const recorded = input.recordedByName?.trim();
  const agent = input.fieldAgentName?.trim();
  if (!recorded && !agent) {
    return undefined;
  }
  if (
    !agent ||
    recorded === agent ||
    (input.recordedByUserId && input.fieldAgentId && input.recordedByUserId === input.fieldAgentId)
  ) {
    return recorded ?? agent;
  }
  if (!recorded) {
    return agent;
  }
  return `${recorded} · Agent: ${agent}`;
}
