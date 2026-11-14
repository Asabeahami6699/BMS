import {
  defaultTenantSmsSettings,
  MAX_SMS_MONTHLY_CHARGE_GHS,
  tenantSmsSettingsSchema,
  updateTenantSmsSettingsSchema,
  type TenantSmsSettings,
  type UpdateTenantSmsSettingsInput
} from "@bms/shared";
import { getSupabaseAdminClient } from "../config/supabaseClient.js";

const memorySettings = new Map<string, TenantSmsSettings>();

function mapRow(tenantId: string, row: Record<string, unknown>): TenantSmsSettings {
  const amountRaw = Number(row.sms_charge_amount_ghs ?? 0);
  const amount = Number.isFinite(amountRaw)
    ? Math.min(MAX_SMS_MONTHLY_CHARGE_GHS, Math.max(0, amountRaw))
    : 0;
  return tenantSmsSettingsSchema.parse({
    tenantId,
    enabled: Boolean(row.enabled ?? true),
    notifyDeposit: Boolean(row.notify_deposit ?? true),
    notifyWithdrawal: Boolean(row.notify_withdrawal ?? true),
    notifyDailySusu: Boolean(row.notify_daily_susu ?? true),
    smsChargesEnabled: Boolean(row.sms_charges_enabled ?? false),
    smsChargeAmountGhs: amount,
    senderId: row.sender_id ? String(row.sender_id) : undefined,
    updatedAt: row.updated_at ? String(row.updated_at) : undefined,
    updatedBy: row.updated_by ? String(row.updated_by) : undefined
  });
}

export async function getTenantSmsSettings(tenantId: string): Promise<TenantSmsSettings> {
  const supabase = getSupabaseAdminClient();
  if (supabase) {
    const { data, error } = await supabase
      .from("tenant_sms_settings")
      .select("*")
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (error && !/tenant_sms_settings|does not exist|sms_charge/i.test(error.message)) {
      throw new Error(`Failed to load SMS settings: ${error.message}`);
    }
    if (data) {
      return mapRow(tenantId, data as Record<string, unknown>);
    }
  }

  return memorySettings.get(tenantId) ?? defaultTenantSmsSettings(tenantId);
}

/** Tenants that have monthly SMS customer charges turned on. */
export async function listTenantsWithSmsChargesEnabled(): Promise<TenantSmsSettings[]> {
  const supabase = getSupabaseAdminClient();
  if (supabase) {
    const { data, error } = await supabase
      .from("tenant_sms_settings")
      .select("*")
      .eq("sms_charges_enabled", true)
      .gt("sms_charge_amount_ghs", 0);
    if (error) {
      if (/sms_charges_enabled|sms_charge_amount|does not exist|schema cache/i.test(error.message)) {
        console.warn(
          "[sms] monthly charge columns missing — apply migration 093_tenant_sms_monthly_charges.sql"
        );
        return [];
      }
      throw new Error(`Failed to list SMS charge settings: ${error.message}`);
    }
    return (data ?? []).map((row) => mapRow(String((row as { tenant_id: string }).tenant_id), row as Record<string, unknown>));
  }

  return [...memorySettings.values()].filter(
    (s) => s.smsChargesEnabled && s.smsChargeAmountGhs > 0
  );
}

export async function upsertTenantSmsSettings(
  tenantId: string,
  userId: string,
  input: UpdateTenantSmsSettingsInput
): Promise<TenantSmsSettings> {
  const payload = updateTenantSmsSettingsSchema.parse(input);
  const current = await getTenantSmsSettings(tenantId);

  const smsChargesEnabled = payload.smsChargesEnabled ?? current.smsChargesEnabled;
  let smsChargeAmountGhs = payload.smsChargeAmountGhs ?? current.smsChargeAmountGhs;
  if (!smsChargesEnabled) {
    smsChargeAmountGhs = payload.smsChargeAmountGhs ?? current.smsChargeAmountGhs ?? 0;
  } else if (!(smsChargeAmountGhs > 0)) {
    throw new Error("Enter an SMS charge greater than zero when charges are enabled");
  }
  if (smsChargeAmountGhs > MAX_SMS_MONTHLY_CHARGE_GHS) {
    throw new Error(`SMS charge cannot exceed GHS ${MAX_SMS_MONTHLY_CHARGE_GHS}`);
  }

  const next = tenantSmsSettingsSchema.parse({
    ...current,
    ...payload,
    smsChargesEnabled,
    smsChargeAmountGhs,
    senderId: payload.senderId === null ? undefined : (payload.senderId ?? current.senderId),
    tenantId,
    updatedBy: userId,
    updatedAt: new Date().toISOString()
  });

  const supabase = getSupabaseAdminClient();
  if (supabase) {
    const { error } = await supabase.from("tenant_sms_settings").upsert({
      tenant_id: tenantId,
      enabled: next.enabled,
      notify_deposit: next.notifyDeposit,
      notify_withdrawal: next.notifyWithdrawal,
      notify_daily_susu: next.notifyDailySusu,
      sms_charges_enabled: next.smsChargesEnabled,
      sms_charge_amount_ghs: next.smsChargeAmountGhs,
      sender_id: next.senderId ?? null,
      updated_at: next.updatedAt,
      updated_by: userId
    });
    if (error) {
      if (/sms_charges_enabled|sms_charge_amount|does not exist|schema cache/i.test(error.message)) {
        throw new Error(
          "Failed to save SMS settings: run Supabase migration 093_tenant_sms_monthly_charges.sql"
        );
      }
      if (!/tenant_sms_settings|does not exist/i.test(error.message)) {
        throw new Error(`Failed to save SMS settings: ${error.message}`);
      }
    }
  }

  memorySettings.set(tenantId, next);
  return next;
}

export function isSmsEventEnabled(
  settings: TenantSmsSettings,
  event: "deposit" | "withdrawal" | "daily_susu"
): boolean {
  if (!settings.enabled) {
    return false;
  }
  if (event === "deposit") {
    return settings.notifyDeposit;
  }
  if (event === "withdrawal") {
    return settings.notifyWithdrawal;
  }
  return settings.notifyDailySusu;
}
