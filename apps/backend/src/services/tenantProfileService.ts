import {
  assertCompanyLogo,
  companyProfileSchema,
  updateCompanyProfileSchema,
  type CompanyProfile,
  type UpdateCompanyProfileInput
} from "@bms/shared";
import { getSupabaseAdminClient } from "../config/supabaseClient.js";
import { getTenantFromStore, upsertTenantInStore } from "./authStore.js";

const PROFILE_COLUMNS_BASE = "id, name, phone, email, address, tax_id, logo_url, brand_color";
const PROFILE_COLUMNS = `${PROFILE_COLUMNS_BASE}, font_size_step`;

const memoryProfiles = new Map<string, CompanyProfile>();

function optionalText(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function fontSizeStepFrom(value: unknown): number {
  const step = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(step) || step < 0 || step > 3) {
    return 0;
  }
  return step;
}

function mapRow(tenantId: string, row: Record<string, unknown>, fallbackName?: string): CompanyProfile {
  const email = optionalText(row.email);
  const brandColor = optionalText(row.brand_color);
  const logoUrl = optionalText(row.logo_url);
  return companyProfileSchema.parse({
    tenantId,
    name: optionalText(row.name) ?? fallbackName ?? tenantId,
    phone: optionalText(row.phone),
    email: email && email.includes("@") ? email : undefined,
    address: optionalText(row.address),
    taxId: optionalText(row.tax_id),
    logoUrl: logoUrl && logoUrl.startsWith("data:image/") ? logoUrl : undefined,
    brandColor: brandColor && /^#[0-9A-Fa-f]{6}$/.test(brandColor) ? brandColor : undefined,
    fontSizeStep: fontSizeStepFrom(row.font_size_step)
  });
}

function remember(profile: CompanyProfile): CompanyProfile {
  memoryProfiles.set(profile.tenantId, profile);
  const existing = getTenantFromStore(profile.tenantId);
  if (existing) {
    upsertTenantInStore({ ...existing, name: profile.name });
  }
  return profile;
}

export async function getCompanyProfile(tenantId: string): Promise<CompanyProfile> {
  const cached = memoryProfiles.get(tenantId);
  const stored = getTenantFromStore(tenantId);
  const supabase = getSupabaseAdminClient();
  if (!supabase) {
    return (
      cached ??
      companyProfileSchema.parse({
        tenantId,
        name: stored?.name ?? tenantId
      })
    );
  }

  let { data, error } = await supabase.from("tenants").select(PROFILE_COLUMNS).eq("id", tenantId).maybeSingle();
  if (error && /font_size_step/i.test(error.message)) {
    const retry = await supabase.from("tenants").select(PROFILE_COLUMNS_BASE).eq("id", tenantId).maybeSingle();
    data = retry.data;
    error = retry.error;
  }
  if (error) {
    if (/phone|email|address|tax_id|logo_url|brand_color|column/i.test(error.message) && stored) {
      return cached ?? companyProfileSchema.parse({ tenantId, name: stored.name });
    }
    throw new Error(`Failed to load company profile: ${error.message}`);
  }
  if (!data) {
    return cached ?? companyProfileSchema.parse({ tenantId, name: stored?.name ?? tenantId });
  }
  return remember(mapRow(tenantId, data as Record<string, unknown>, stored?.name));
}

export async function updateCompanyProfile(
  tenantId: string,
  input: UpdateCompanyProfileInput
): Promise<CompanyProfile> {
  const parsedResult = updateCompanyProfileSchema.safeParse(input);
  if (!parsedResult.success) {
    throw new Error(parsedResult.error.issues[0]?.message ?? "Invalid company profile");
  }
  const parsed = parsedResult.data;
  assertCompanyLogo(parsed.logoUrl);
  const current = await getCompanyProfile(tenantId);
  const next = companyProfileSchema.parse({
    tenantId,
    name: parsed.name.trim(),
    phone: parsed.phone === null ? undefined : (parsed.phone ?? current.phone),
    email: parsed.email === null ? undefined : (parsed.email ?? current.email),
    address: parsed.address === null ? undefined : (parsed.address ?? current.address),
    taxId: parsed.taxId === null ? undefined : (parsed.taxId ?? current.taxId),
    logoUrl: parsed.logoUrl === null ? undefined : (parsed.logoUrl ?? current.logoUrl),
    brandColor: parsed.brandColor === null ? undefined : (parsed.brandColor ?? current.brandColor),
    fontSizeStep: parsed.fontSizeStep ?? current.fontSizeStep
  });

  const supabase = getSupabaseAdminClient();
  if (supabase) {
    const profileUpdate = {
      name: next.name,
      phone: next.phone ?? null,
      email: next.email ?? null,
      address: next.address ?? null,
      tax_id: next.taxId ?? null,
      logo_url: next.logoUrl ?? null,
      brand_color: next.brandColor ?? null,
      font_size_step: next.fontSizeStep
    };
    let { error } = await supabase.from("tenants").update(profileUpdate).eq("id", tenantId);
    if (error && /font_size_step/i.test(error.message)) {
      if (next.fontSizeStep !== 0) {
        throw new Error(
          "Font size storage is not ready. Apply migration 068_tenant_font_size.sql in Supabase, then save again."
        );
      }
      const { font_size_step: _fontSizeStep, ...withoutFont } = profileUpdate;
      void _fontSizeStep;
      const retry = await supabase.from("tenants").update(withoutFont).eq("id", tenantId);
      error = retry.error;
    }
    if (error) {
      if (/phone|email|address|tax_id|logo_url|brand_color|column/i.test(error.message)) {
        throw new Error(
          "Company profile storage is not ready. Apply migration 065_tenant_company_profile.sql in Supabase, then save again."
        );
      }
      throw new Error(`Failed to save company profile: ${error.message}`);
    }
  }

  return remember(next);
}
