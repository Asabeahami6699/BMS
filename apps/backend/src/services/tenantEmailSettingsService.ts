import {
  defaultTenantEmailSettings,
  tenantEmailSettingsSchema,
  updateTenantEmailSettingsSchema,
  type TenantEmailSettings,
  type UpdateTenantEmailSettingsInput
} from "@bms/shared";
import { getSupabaseAdminClient } from "../config/supabaseClient.js";

const memorySettings = new Map<string, TenantEmailSettings>();

function mapRow(tenantId: string, row: Record<string, unknown>): TenantEmailSettings {
  return tenantEmailSettingsSchema.parse({
    tenantId,
    enabled: Boolean(row.enabled ?? true),
    notifyDeposit: Boolean(row.notify_deposit ?? true),
    notifyWithdrawal: Boolean(row.notify_withdrawal ?? true),
    notifyDailySusu: Boolean(row.notify_daily_susu ?? true),
    fromName: row.from_name ? String(row.from_name) : undefined,
    replyToEmail: row.reply_to_email ? String(row.reply_to_email) : undefined,
    updatedAt: row.updated_at ? String(row.updated_at) : undefined,
    updatedBy: row.updated_by ? String(row.updated_by) : undefined
  });
}

export async function getTenantEmailSettings(tenantId: string): Promise<TenantEmailSettings> {
  const supabase = getSupabaseAdminClient();
  if (supabase) {
    const { data, error } = await supabase
      .from("tenant_email_settings")
      .select("*")
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (error && !/tenant_email_settings|does not exist/i.test(error.message)) {
      throw new Error(`Failed to load email settings: ${error.message}`);
    }
    if (data) {
      return mapRow(tenantId, data as Record<string, unknown>);
    }
  }

  return memorySettings.get(tenantId) ?? defaultTenantEmailSettings(tenantId);
}

export async function upsertTenantEmailSettings(
  tenantId: string,
  userId: string,
  input: UpdateTenantEmailSettingsInput
): Promise<TenantEmailSettings> {
  const payload = updateTenantEmailSettingsSchema.parse(input);
  const current = await getTenantEmailSettings(tenantId);
  const next = tenantEmailSettingsSchema.parse({
    ...current,
    ...payload,
    fromName: payload.fromName === null ? undefined : (payload.fromName ?? current.fromName),
    replyToEmail:
      payload.replyToEmail === null || payload.replyToEmail === ""
        ? undefined
        : (payload.replyToEmail ?? current.replyToEmail),
    tenantId,
    updatedBy: userId,
    updatedAt: new Date().toISOString()
  });

  const supabase = getSupabaseAdminClient();
  if (supabase) {
    const { error } = await supabase.from("tenant_email_settings").upsert({
      tenant_id: tenantId,
      enabled: next.enabled,
      notify_deposit: next.notifyDeposit,
      notify_withdrawal: next.notifyWithdrawal,
      notify_daily_susu: next.notifyDailySusu,
      from_name: next.fromName ?? null,
      reply_to_email: next.replyToEmail ?? null,
      updated_at: next.updatedAt,
      updated_by: userId
    });
    if (error && !/tenant_email_settings|does not exist/i.test(error.message)) {
      throw new Error(`Failed to save email settings: ${error.message}`);
    }
  }

  memorySettings.set(tenantId, next);
  return next;
}

export function isEmailEventEnabled(
  settings: TenantEmailSettings,
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
