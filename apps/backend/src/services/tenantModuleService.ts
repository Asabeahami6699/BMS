import {
  normalizeTenantModule,
  TENANT_PRODUCT_MODULES,
  tenantProductModuleSchema,
  type TenantProductModule
} from "@bms/shared";
import { getSupabaseAdminClient } from "../config/supabaseClient.js";
import { getTenantFromStore, upsertTenantInStore, type StoredTenant } from "./authStore.js";
import { getTenantAddonsFromStore } from "./tenantAddonService.js";

const modulesByTenant = new Map<string, TenantProductModule[]>();

export function getTenantModulesFromStore(tenantId: string): TenantProductModule[] | undefined {
  const tenant = getTenantFromStore(tenantId);
  if (tenant?.subscribedModules) {
    return tenant.subscribedModules;
  }
  return modulesByTenant.get(tenantId);
}

export function setTenantModulesInStore(tenantId: string, modules: TenantProductModule[]): TenantProductModule[] {
  const parsed = modules
    .map((m) => normalizeTenantModule(String(m)) ?? m)
    .filter((m): m is TenantProductModule => tenantProductModuleSchema.safeParse(m).success);
  const unique = [...new Set(parsed)] as TenantProductModule[];
  if (unique.length === 0) {
    throw new Error("At least one product module is required");
  }
  modulesByTenant.set(tenantId, unique);
  const tenant = getTenantFromStore(tenantId);
  if (tenant) {
    upsertTenantInStore({ ...tenant, subscribedModules: unique });
  }
  return unique;
}

export async function loadTenantModules(tenantId: string): Promise<TenantProductModule[]> {
  const cached = getTenantModulesFromStore(tenantId);
  if (cached && cached.length > 0) {
    return cached;
  }

  const supabase = getSupabaseAdminClient();
  if (supabase) {
    const { data, error } = await supabase
      .from("tenant_modules")
      .select("module_key")
      .eq("tenant_id", tenantId);
    if (!error && data && data.length > 0) {
      const modules = data
        .map((row) => normalizeTenantModule(row.module_key) ?? row.module_key)
        .filter((key): key is TenantProductModule => tenantProductModuleSchema.safeParse(key).success);
      return setTenantModulesInStore(tenantId, modules);
    }
  }

  return setTenantModulesInStore(tenantId, ["susu_management"]);
}

export async function saveTenantModules(
  tenantId: string,
  modules: TenantProductModule[]
): Promise<TenantProductModule[]> {
  const unique = setTenantModulesInStore(tenantId, modules);

  const supabase = getSupabaseAdminClient();
  if (supabase) {
    await supabase.from("tenant_modules").delete().eq("tenant_id", tenantId);
    const { error } = await supabase.from("tenant_modules").insert(
      unique.map((module_key) => ({ tenant_id: tenantId, module_key }))
    );
    if (error) {
      throw new Error(`Failed to save tenant modules: ${error.message}`);
    }
  }

  return unique;
}

export function toTenantRecord(tenant: StoredTenant): StoredTenant & {
  subscribedModules: TenantProductModule[];
  subscribedAddons: import("@bms/shared").TenantAddon[];
  reportsAnalytics: boolean;
} {
  const subscribedModules =
    tenant.subscribedModules ?? getTenantModulesFromStore(tenant.id) ?? ["susu_management"];
  const subscribedAddons =
    tenant.subscribedAddons ?? getTenantAddonsFromStore(tenant.id) ?? [];
  return {
    ...tenant,
    subscribedModules,
    subscribedAddons,
    reportsAnalytics: tenant.subscriptionStatus === "active"
  };
}

export function listAllProductModuleOptions(): typeof TENANT_PRODUCT_MODULES {
  return TENANT_PRODUCT_MODULES;
}
