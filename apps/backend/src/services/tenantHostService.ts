import { isTenantSubdomain, tenantSubdomainSchema } from "@bms/shared";
import { getSupabaseAdminClient } from "../config/supabaseClient.js";
import { getTenantFromStore, listTenantsFromStore, upsertTenantInStore, type StoredTenant } from "./authStore.js";

export type TenantHostMatch = {
  id: string;
  name: string;
  subdomain: string;
  subscriptionStatus: "active" | "inactive";
};

function fromStored(tenant: StoredTenant, subdomain: string): TenantHostMatch {
  return {
    id: tenant.id,
    name: tenant.name,
    subdomain,
    subscriptionStatus: tenant.subscriptionStatus === "inactive" ? "inactive" : "active"
  };
}

function rememberSubdomain(match: TenantHostMatch): TenantHostMatch {
  const existing = getTenantFromStore(match.id);
  if (existing) {
    upsertTenantInStore({ ...existing, subdomain: match.subdomain });
  }
  return match;
}

export async function findTenantBySubdomain(raw: string): Promise<TenantHostMatch | null> {
  const parsed = tenantSubdomainSchema.safeParse(raw);
  if (!parsed.success) {
    return null;
  }
  const subdomain = parsed.data;
  const local = listTenantsFromStore().find(
    (tenant) => tenant.subdomain === subdomain || tenant.id.toLowerCase() === subdomain
  );
  const supabase = getSupabaseAdminClient();
  if (!supabase) {
    return local ? fromStored(local, local.subdomain ?? subdomain) : null;
  }

  const selected = await supabase
    .from("tenants")
    .select("id, name, subscription_status, subdomain")
    .eq("subdomain", subdomain)
    .maybeSingle();
  let row = selected.data as { id: string; name: string; subscription_status: string; subdomain?: string | null } | null;
  let error = selected.error;
  if (error && /subdomain/i.test(error.message)) {
    const retry = await supabase
      .from("tenants")
      .select("id, name, subscription_status")
      .eq("id", subdomain)
      .maybeSingle();
    row = retry.data;
    error = retry.error;
  }
  if (error) {
    throw new Error(`Failed to look up company address: ${error.message}`);
  }
  if (!row) {
    const byId = await supabase
      .from("tenants")
      .select("id, name, subscription_status")
      .eq("id", subdomain)
      .maybeSingle();
    if (byId.error && !/subdomain/i.test(byId.error.message)) {
      throw new Error(`Failed to look up company address: ${byId.error.message}`);
    }
    row = byId.data;
  }
  if (!row || row.id === "platform") {
    return local ? fromStored(local, local.subdomain ?? subdomain) : null;
  }
  return rememberSubdomain({
    id: row.id,
    name: row.name,
    subdomain: row.subdomain && isTenantSubdomain(row.subdomain) ? row.subdomain.toLowerCase() : subdomain,
    subscriptionStatus: row.subscription_status === "inactive" ? "inactive" : "active"
  });
}

export async function assertLoginMatchesHost(
  tenantId: string | null,
  rawSubdomain: string | undefined
): Promise<void> {
  if (!rawSubdomain?.trim()) {
    return;
  }
  const tenant = await findTenantBySubdomain(rawSubdomain);
  if (!tenant) {
    throw new Error("This company address is not set up yet.");
  }
  if (tenant.subscriptionStatus === "inactive") {
    throw new Error("Company subscription is inactive. Contact platform support.");
  }
  const userTenant = tenantId && tenantId !== "platform" ? tenantId : null;
  if (!userTenant || userTenant !== tenant.id) {
    throw new Error(`This sign-in is for ${tenant.name}. Open your own company address.`);
  }
}
