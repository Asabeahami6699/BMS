import {
  defaultTenantSmsSettings,
  tenantSmsSettingsSchema,
  updateTenantSmsSettingsSchema,
  type TenantSmsSettings,
  type UpdateTenantSmsSettingsInput
} from "@bms/shared";
import { getSupabaseAdminClient } from "../config/supabaseClient.js";

const memorySettings = new Map<string, TenantSmsSettings>();

function mapRow(tenantId: string, row: Record<string, unknown>): TenantSmsSettings {
  return tenantSmsSettingsSchema.parse({
    tenantId,
    enabled: Boolean(row.enabled ?? true),
    notifyDeposit: Boolean(row.notify_deposit ?? true),
    notifyWithdrawal: Boolean(row.notify_withdrawal ?? true),
    notifyDailySusu: Boolean(row.notify_daily_susu ?? true),
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
    if (error && !/tenant_sms_settings|does not exist/i.test(error.message)) {
      throw new Error(`Failed to load SMS settings: ${error.message}`);
    }
    if (data) {
      return mapRow(tenantId, data as Record<string, unknown>);
    }
  }

  return memorySettings.get(tenantId) ?? defaultTenantSmsSettings(tenantId);
}

export async function upsertTenantSmsSettings(
  tenantId: string,
  userId: string,
  input: UpdateTenantSmsSettingsInput
): Promise<TenantSmsSettings> {
  const payload = updateTenantSmsSettingsSchema.parse(input);
  const current = await getTenantSmsSettings(tenantId);
  const next = tenantSmsSettingsSchema.parse({
    ...current,
    ...payload,
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
      sender_id: next.senderId ?? null,
      updated_at: next.updatedAt,
      updated_by: userId
    });
    if (error && !/tenant_sms_settings|does not exist/i.test(error.message)) {
      throw new Error(`Failed to save SMS settings: ${error.message}`);
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
