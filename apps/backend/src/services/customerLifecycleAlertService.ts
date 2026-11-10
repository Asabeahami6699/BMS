import {
  buildAccountLifecycleWarningMessage,
  CUSTOMER_DORMANT_AFTER_MONTHS,
  CUSTOMER_INACTIVE_AFTER_MONTHS,
  CUSTOMER_LIFECYCLE_WARN_MONTHS_BEFORE,
  hasTenantAddon,
  normalizeGhanaPhone
} from "@bms/shared";
import { hasArkeselSmsConfig } from "../config/env.js";
import { getSupabaseAdminClient } from "../config/supabaseClient.js";
import { sendArkeselSms } from "./arkeselSmsProvider.js";
import { loadTenantAddons } from "./tenantAddonService.js";
import { getTenantFromStore } from "./authStore.js";
import { getTenantSmsSettings, isSmsEventEnabled } from "./tenantSmsSettingsService.js";
import { randomUUID } from "node:crypto";

function monthsAgoIso(months: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() - months);
  return d.toISOString();
}

async function resolveTenantName(tenantId: string): Promise<string> {
  const stored = getTenantFromStore(tenantId);
  if (stored?.name) {
    return stored.name;
  }
  const supabase = getSupabaseAdminClient();
  if (supabase) {
    const { data } = await supabase.from("tenants").select("name").eq("id", tenantId).maybeSingle();
    if (data?.name) {
      return String(data.name);
    }
  }
  return "Your SACCO";
}

async function outboxExists(tenantId: string, idempotencyKey: string): Promise<boolean> {
  const supabase = getSupabaseAdminClient();
  if (!supabase) {
    return false;
  }
  const { data } = await supabase
    .from("sms_outbox")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();
  return Boolean(data?.id);
}

async function recordAndSend(input: {
  tenantId: string;
  customerId: string;
  phone: string;
  message: string;
  idempotencyKey: string;
  senderId?: string;
}): Promise<boolean> {
  if (await outboxExists(input.tenantId, input.idempotencyKey)) {
    return false;
  }
  const supabase = getSupabaseAdminClient();
  if (!hasArkeselSmsConfig()) {
    if (supabase) {
      await supabase.from("sms_outbox").insert({
        id: randomUUID(),
        tenant_id: input.tenantId,
        customer_id: input.customerId,
        event_type: "withdrawal",
        phone: input.phone,
        message: input.message,
        idempotency_key: input.idempotencyKey,
        status: "failed",
        error_message: "Arkesel SMS not configured"
      });
    }
    return false;
  }

  try {
    const result = await sendArkeselSms({
      to: input.phone,
      content: input.message,
      from: input.senderId
    });
    if (supabase) {
      await supabase.from("sms_outbox").insert({
        id: randomUUID(),
        tenant_id: input.tenantId,
        customer_id: input.customerId,
        event_type: "withdrawal",
        phone: input.phone,
        message: input.message,
        idempotency_key: input.idempotencyKey,
        status: "sent",
        provider_message_id: result.messageId ?? null
      });
    }
    return true;
  } catch (error) {
    if (supabase) {
      await supabase.from("sms_outbox").insert({
        id: randomUUID(),
        tenant_id: input.tenantId,
        customer_id: input.customerId,
        event_type: "withdrawal",
        phone: input.phone,
        message: input.message,
        idempotency_key: input.idempotencyKey,
        status: "failed",
        error_message: error instanceof Error ? error.message : "SMS failed"
      });
    }
    return false;
  }
}

/**
 * SMS customers ~1 month before inactive (12m) or dormant (24m) thresholds.
 */
export async function sendCustomerLifecycleWarningSms(): Promise<{
  inactiveWarnings: number;
  dormantWarnings: number;
}> {
  const supabase = getSupabaseAdminClient();
  if (!supabase) {
    return { inactiveWarnings: 0, dormantWarnings: 0 };
  }

  const warnBefore = CUSTOMER_LIFECYCLE_WARN_MONTHS_BEFORE;
  const inactiveStart = monthsAgoIso(CUSTOMER_INACTIVE_AFTER_MONTHS - warnBefore);
  const inactiveEnd = monthsAgoIso(CUSTOMER_INACTIVE_AFTER_MONTHS);
  const dormantStart = monthsAgoIso(CUSTOMER_DORMANT_AFTER_MONTHS - warnBefore);
  const dormantEnd = monthsAgoIso(CUSTOMER_DORMANT_AFTER_MONTHS);

  let inactiveWarnings = 0;
  let dormantWarnings = 0;

  const { data: inactiveCandidates, error: inactiveError } = await supabase
    .from("customers")
    .select("id, tenant_id, phone, account_number, last_qualifying_activity_at, status")
    .eq("status", "active")
    .gte("last_qualifying_activity_at", inactiveEnd)
    .lt("last_qualifying_activity_at", inactiveStart);

  if (inactiveError) {
    console.warn("[customers] lifecycle inactive scan failed:", inactiveError.message);
  } else {
    for (const row of inactiveCandidates ?? []) {
      const sent = await sendOneWarning({
        tenantId: String(row.tenant_id),
        customerId: String(row.id),
        phone: row.phone ? String(row.phone) : "",
        accountNumber: row.account_number ? String(row.account_number) : undefined,
        status: "inactive",
        periodKey: String(row.last_qualifying_activity_at ?? "").slice(0, 7)
      });
      if (sent) {
        inactiveWarnings += 1;
      }
    }
  }

  const { data: dormantCandidates, error: dormantError } = await supabase
    .from("customers")
    .select("id, tenant_id, phone, account_number, last_qualifying_activity_at, status")
    .in("status", ["active", "inactive"])
    .gte("last_qualifying_activity_at", dormantEnd)
    .lt("last_qualifying_activity_at", dormantStart);

  if (dormantError) {
    console.warn("[customers] lifecycle dormant scan failed:", dormantError.message);
  } else {
    for (const row of dormantCandidates ?? []) {
      const sent = await sendOneWarning({
        tenantId: String(row.tenant_id),
        customerId: String(row.id),
        phone: row.phone ? String(row.phone) : "",
        accountNumber: row.account_number ? String(row.account_number) : undefined,
        status: "dormant",
        periodKey: String(row.last_qualifying_activity_at ?? "").slice(0, 7)
      });
      if (sent) {
        dormantWarnings += 1;
      }
    }
  }

  return { inactiveWarnings, dormantWarnings };
}

async function sendOneWarning(input: {
  tenantId: string;
  customerId: string;
  phone: string;
  accountNumber?: string;
  status: "inactive" | "dormant";
  periodKey: string;
}): Promise<boolean> {
  const addons = (await loadTenantAddons(input.tenantId)) ?? [];
  if (!hasTenantAddon(addons, "sms_notifications")) {
    return false;
  }
  const settings = await getTenantSmsSettings(input.tenantId);
  // Reuse deposit channel as a general account alert if withdrawals are off — prefer withdrawal/deposit either enabled.
  if (
    !settings.enabled ||
    (!isSmsEventEnabled(settings, "deposit") && !isSmsEventEnabled(settings, "withdrawal"))
  ) {
    return false;
  }

  const phone = normalizeGhanaPhone(input.phone);
  if (!phone) {
    return false;
  }

  const brand = await resolveTenantName(input.tenantId);
  const message = buildAccountLifecycleWarningMessage({
    brand: brand.slice(0, 40),
    status: input.status,
    accountNumber: input.accountNumber,
    monthsRemainingApprox: CUSTOMER_LIFECYCLE_WARN_MONTHS_BEFORE
  }).text;

  return recordAndSend({
    tenantId: input.tenantId,
    customerId: input.customerId,
    phone,
    message,
    idempotencyKey: `lifecycle-warn:${input.status}:${input.customerId}:${input.periodKey}`,
    senderId: settings.senderId
  });
}
