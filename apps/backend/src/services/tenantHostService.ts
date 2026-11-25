import { isTenantSubdomain, tenantSubdomainSchema } from "@bms/shared";
import { getSupabaseAdminClient } from "../config/supabaseClient.js";
import { getTenantFromStore, listTenantsFromStore, upsertTenantInStore, type StoredTenant } from "./authStore.js";

export type TenantHostMatch = {
  id: string;
  name: string;
  subdomain: string;
  subscriptionStatus: "active" | "inactive";
  logoUrl?: string;
  brandColor?: string;
};

function validLogoUrl(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (
    trimmed.startsWith("data:image/") ||
    trimmed.startsWith("https://") ||
    trimmed.startsWith("http://")
  ) {
    return trimmed;
  }
  return undefined;
}

function validBrandColor(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return /^#[0-9A-Fa-f]{6}$/.test(trimmed) ? trimmed : undefined;
}

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

type TenantHostRow = {
  id: string;
  name: string;
  subscription_status: string;
  subdomain?: string | null;
  logo_url?: string | null;
  brand_color?: string | null;
};

async function selectTenantHostRow(
  supabase: NonNullable<ReturnType<typeof getSupabaseAdminClient>>,
  column: "subdomain" | "id",
  value: string
): Promise<TenantHostRow | null> {
  const full = await supabase
    .from("tenants")
    .select("id, name, subscription_status, subdomain, logo_url, brand_color")
    .eq(column, value)
    .maybeSingle();
  if (!full.error) {
    return (full.data as TenantHostRow | null) ?? null;
  }
  if (/logo_url|brand_color/i.test(full.error.message)) {
    const mid = await supabase
      .from("tenants")
      .select("id, name, subscription_status, subdomain")
      .eq(column, value)
      .maybeSingle();
    if (!mid.error) {
      return (mid.data as TenantHostRow | null) ?? null;
    }
    if (/subdomain/i.test(mid.error.message)) {
      const basic = await supabase
        .from("tenants")
        .select("id, name, subscription_status")
        .eq("id", value)
        .maybeSingle();
      if (basic.error) {
        throw new Error(`Failed to look up company address: ${basic.error.message}`);
      }
      return (basic.data as TenantHostRow | null) ?? null;
    }
    throw new Error(`Failed to look up company address: ${mid.error.message}`);
  }
  if (/subdomain/i.test(full.error.message)) {
    const basic = await supabase
      .from("tenants")
      .select("id, name, subscription_status, logo_url, brand_color")
      .eq("id", value)
      .maybeSingle();
    if (!basic.error) {
      return (basic.data as TenantHostRow | null) ?? null;
    }
    const minimal = await supabase
      .from("tenants")
      .select("id, name, subscription_status")
      .eq("id", value)
      .maybeSingle();
    if (minimal.error) {
      throw new Error(`Failed to look up company address: ${minimal.error.message}`);
    }
    return (minimal.data as TenantHostRow | null) ?? null;
  }
  throw new Error(`Failed to look up company address: ${full.error.message}`);
}

const HOST_CACHE_TTL_MS = 60_000;
const hostCache = new Map<string, { value: TenantHostMatch; expiresAt: number }>();

export function invalidateTenantHostCache(tenantIdOrSubdomain?: string): void {
  if (!tenantIdOrSubdomain) {
    hostCache.clear();
    return;
  }
  const needle = tenantIdOrSubdomain.trim().toLowerCase();
  for (const [key, entry] of hostCache.entries()) {
    if (
      key === needle ||
      entry.value.id.toLowerCase() === needle ||
      entry.value.subdomain.toLowerCase() === needle
    ) {
      hostCache.delete(key);
    }
  }
}

export async function findTenantBySubdomain(raw: string): Promise<TenantHostMatch | null> {
  const parsed = tenantSubdomainSchema.safeParse(raw);
  if (!parsed.success) {
    return null;
  }
  const subdomain = parsed.data;
  const cached = hostCache.get(subdomain);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }
  const local = listTenantsFromStore().find(
    (tenant) => tenant.subdomain === subdomain || tenant.id.toLowerCase() === subdomain
  );
  const supabase = getSupabaseAdminClient();
  if (!supabase) {
    return local ? fromStored(local, local.subdomain ?? subdomain) : null;
  }

  let row = await selectTenantHostRow(supabase, "subdomain", subdomain);
  if (!row) {
    row = await selectTenantHostRow(supabase, "id", subdomain);
  }
  if (!row || row.id === "platform") {
    return local ? fromStored(local, local.subdomain ?? subdomain) : null;
  }
  const match = rememberSubdomain({
    id: row.id,
    name: row.name,
    subdomain: row.subdomain && isTenantSubdomain(row.subdomain) ? row.subdomain.toLowerCase() : subdomain,
    subscriptionStatus: row.subscription_status === "inactive" ? "inactive" : "active",
    logoUrl: validLogoUrl(row.logo_url),
    brandColor: validBrandColor(row.brand_color)
  });
  hostCache.set(subdomain, { value: match, expiresAt: Date.now() + HOST_CACHE_TTL_MS });
  return match;
}

export async function findTenantForBranding(params: {
  subdomain?: string;
  tenantId?: string;
}): Promise<TenantHostMatch | null> {
  if (params.subdomain?.trim()) {
    const bySub = await findTenantBySubdomain(params.subdomain);
    if (bySub) {
      return bySub;
    }
  }
  const rawId = params.tenantId?.trim();
  if (!rawId || rawId === "platform") {
    return null;
  }
  const cacheKey = `id:${rawId.toLowerCase()}`;
  const cached = hostCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }
  const local = listTenantsFromStore().find((tenant) => tenant.id === rawId);
  const supabase = getSupabaseAdminClient();
  if (!supabase) {
    return local ? fromStored(local, local.subdomain ?? rawId.toLowerCase()) : null;
  }
  const row = await selectTenantHostRow(supabase, "id", rawId);
  if (!row || row.id === "platform") {
    return local ? fromStored(local, local.subdomain ?? rawId.toLowerCase()) : null;
  }
  const match = rememberSubdomain({
    id: row.id,
    name: row.name,
    subdomain:
      row.subdomain && isTenantSubdomain(row.subdomain)
        ? row.subdomain.toLowerCase()
        : rawId.toLowerCase(),
    subscriptionStatus: row.subscription_status === "inactive" ? "inactive" : "active",
    logoUrl: validLogoUrl(row.logo_url),
    brandColor: validBrandColor(row.brand_color)
  });
  hostCache.set(cacheKey, { value: match, expiresAt: Date.now() + HOST_CACHE_TTL_MS });
  return match;
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
