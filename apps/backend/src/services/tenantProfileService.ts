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
const PROFILE_COLUMNS_FULL = `${PROFILE_COLUMNS}, savings_opening_fee_ghs`;

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

function savingsOpeningFeeFrom(value: unknown): number {
  const amount = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(amount) || amount < 0) {
    return 20;
  }
  return Math.round(amount * 100) / 100;
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
    fontSizeStep: fontSizeStepFrom(row.font_size_step),
    savingsOpeningFeeGhs: savingsOpeningFeeFrom(row.savings_opening_fee_ghs)
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

  const selected = await supabase.from("tenants").select(PROFILE_COLUMNS_FULL).eq("id", tenantId).maybeSingle();
  let data = selected.data as Record<string, unknown> | null;
  let error = selected.error;
  if (error && /savings_opening_fee_ghs/i.test(error.message)) {
    const retry = await supabase.from("tenants").select(PROFILE_COLUMNS).eq("id", tenantId).maybeSingle();
    data = retry.data;
    error = retry.error;
  }
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
  return remember(mapRow(tenantId, data, stored?.name));
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
    fontSizeStep: parsed.fontSizeStep ?? current.fontSizeStep,
    savingsOpeningFeeGhs: parsed.savingsOpeningFeeGhs ?? current.savingsOpeningFeeGhs
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
      font_size_step: next.fontSizeStep,
      savings_opening_fee_ghs: next.savingsOpeningFeeGhs
    };
    let payload: Record<string, unknown> = { ...profileUpdate };
    let { error } = await supabase.from("tenants").update(payload).eq("id", tenantId);
    if (error && /savings_opening_fee_ghs/i.test(error.message)) {
      if (next.savingsOpeningFeeGhs !== 20) {
        throw new Error(
          "Savings opening amount storage is not ready. Apply migration 072_savings_opening_fee.sql in Supabase, then save again."
        );
      }
      const { savings_opening_fee_ghs: _openingFee, ...withoutFee } = payload;
      void _openingFee;
      payload = withoutFee;
      const retry = await supabase.from("tenants").update(payload).eq("id", tenantId);
      error = retry.error;
    }
    if (error && /font_size_step/i.test(error.message)) {
      if (next.fontSizeStep !== 0) {
        throw new Error(
          "Font size storage is not ready. Apply migration 068_tenant_font_size.sql in Supabase, then save again."
        );
      }
      const { font_size_step: _fontSizeStep, ...withoutFont } = payload;
      void _fontSizeStep;
      payload = withoutFont;
      const retry = await supabase.from("tenants").update(payload).eq("id", tenantId);
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

/** Keeps the in-memory profile in step when form setup changes the opening amount. */
export function cacheSavingsOpeningFee(tenantId: string, amount: number): void {
  const existing = memoryProfiles.get(tenantId);
  const stored = getTenantFromStore(tenantId);
  const base =
    existing ??
    companyProfileSchema.parse({
      tenantId,
      name: stored?.name ?? tenantId
    });
  memoryProfiles.set(tenantId, {
    ...base,
    savingsOpeningFeeGhs: savingsOpeningFeeFrom(amount)
  });
}

export async function getSavingsOpeningFeeGhs(tenantId: string): Promise<number> {
  const profile = await getCompanyProfile(tenantId);
  return savingsOpeningFeeFrom(profile.savingsOpeningFeeGhs);
}
