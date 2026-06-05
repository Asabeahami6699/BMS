import { getSupabaseAdminClient } from "../config/supabaseClient.js";
import { findUserById, listUsersByTenant } from "./authStore.js";

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

export async function fetchUserNameMap(tenantId: string, userIds: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(userIds.filter((id) => id.length > 0))];
  const map = new Map<string, string>();
  if (unique.length === 0) {
    return map;
  }

  const supabase = getSupabaseAdminClient();
  if (supabase) {
    const { data, error } = await supabase
      .from("users")
      .select("id, full_name, email")
      .eq("tenant_id", tenantId)
      .in("id", unique);
    if (error) {
      throw new Error(`Failed to resolve user names: ${error.message}`);
    }
    for (const row of data ?? []) {
      map.set(String(row.id), userDisplayName(row.full_name, row.email, String(row.id)));
    }
    return map;
  }

  for (const id of unique) {
    const user = findUserById(id) ?? listUsersByTenant(tenantId).find((entry) => entry.id === id);
    if (user) {
      map.set(id, userDisplayName(user.fullName, user.email, id));
    }
  }
  return map;
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
