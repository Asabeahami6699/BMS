import { normalizeTenantAddon, TENANT_ADDONS, tenantAddonSchema, type TenantAddon } from "@bms/shared";
import { getSupabaseAdminClient } from "../config/supabaseClient.js";
import { getTenantFromStore, upsertTenantInStore, type StoredTenant } from "./authStore.js";

const addonsByTenant = new Map<string, TenantAddon[]>();

export function getTenantAddonsFromStore(tenantId: string): TenantAddon[] | undefined {
  const tenant = getTenantFromStore(tenantId);
  return tenant?.subscribedAddons ?? addonsByTenant.get(tenantId);
}

export function setTenantAddonsInStore(tenantId: string, addons: TenantAddon[]): TenantAddon[] {
  const parsed = addons.filter((a) => normalizeTenantAddon(String(a)) !== undefined);
  const unique = [...new Set(parsed)] as TenantAddon[];
  addonsByTenant.set(tenantId, unique);
  const tenant = getTenantFromStore(tenantId);
  if (tenant) {
    upsertTenantInStore({ ...tenant, subscribedAddons: unique });
  }
  return unique;
}

export async function loadTenantAddons(tenantId: string): Promise<TenantAddon[]> {
  const cached = getTenantAddonsFromStore(tenantId);
  if (cached) {
    return cached;
  }

  const supabase = getSupabaseAdminClient();
  if (supabase) {
    const { data, error } = await supabase
      .from("tenant_addons")
      .select("addon_key")
      .eq("tenant_id", tenantId);
    if (!error && data) {
      const addons = data
        .map((row) => normalizeTenantAddon(row.addon_key))
        .filter((key): key is TenantAddon => key !== undefined);
      return setTenantAddonsInStore(tenantId, addons);
    }
  }

  return setTenantAddonsInStore(tenantId, []);
}

export async function saveTenantAddons(tenantId: string, addons: TenantAddon[]): Promise<TenantAddon[]> {
  const unique = setTenantAddonsInStore(tenantId, addons);

  const supabase = getSupabaseAdminClient();
  if (supabase) {
    await supabase.from("tenant_addons").delete().eq("tenant_id", tenantId);
    if (unique.length > 0) {
      const { error } = await supabase.from("tenant_addons").insert(
        unique.map((addon_key) => ({ tenant_id: tenantId, addon_key }))
      );
      if (error) {
        throw new Error(`Failed to save tenant add-ons in Supabase: ${error.message}`);
      }
    }
  }

  return unique;
}

export function listAllAddonOptions(): typeof TENANT_ADDONS {
  return TENANT_ADDONS;
}

export function toTenantRecordWithAddons(
  tenant: StoredTenant & { subscribedModules: import("@bms/shared").TenantProductModule[]; reportsAnalytics: boolean }
): StoredTenant & {
  subscribedModules: import("@bms/shared").TenantProductModule[];
  subscribedAddons: TenantAddon[];
  reportsAnalytics: boolean;
} {
  return {
    ...tenant,
    subscribedAddons: tenant.subscribedAddons ?? getTenantAddonsFromStore(tenant.id) ?? []
  };
}
