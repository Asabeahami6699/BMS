import {
  buildTransactionAlertMessage,
  hasTenantAddon,
  normalizeCustomerEmail,
  type EmailEventType,
  type TenantAddon
} from "@bms/shared";
import { randomUUID } from "node:crypto";
import { getSupabaseAdminClient } from "../config/supabaseClient.js";
import { getTenantFromStore } from "./authStore.js";
import { getCustomerById } from "./customerService.js";
import { computeCustomerBalance } from "./ledgerService.js";
import { getEmailPlatformStatus, sendPlatformEmail } from "./emailProvider.js";
import { getTenantEmailSettings, isEmailEventEnabled } from "./tenantEmailSettingsService.js";
import { loadTenantAddons } from "./tenantAddonService.js";

type NotifyInput = {
  tenantId: string;
  customerId: string;
  transactionId: string;
  type: "deposit" | "withdrawal" | "daily_susu";
  amount: number;
  subscribedAddons?: TenantAddon[];
};

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
  const { data, error } = await supabase
    .from("email_outbox")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();
  if (error && !/email_outbox|does not exist/i.test(error.message)) {
    console.warn("[email] outbox lookup failed:", error.message);
    return false;
  }
  return Boolean(data?.id);
}

async function recordOutbox(input: {
  tenantId: string;
  customerId?: string;
  eventType: EmailEventType;
  toEmail: string;
  subject: string;
  message: string;
  idempotencyKey: string;
  transactionId?: string;
  status: "pending" | "sent" | "failed" | "logged";
  errorMessage?: string;
}): Promise<void> {
  const supabase = getSupabaseAdminClient();
  if (!supabase) {
    return;
  }
  const { error } = await supabase.from("email_outbox").insert({
    id: randomUUID(),
    tenant_id: input.tenantId,
    customer_id: input.customerId ?? null,
    event_type: input.eventType,
    to_email: input.toEmail,
    subject: input.subject,
    message_body: input.message,
    status: input.status,
    idempotency_key: input.idempotencyKey,
    transaction_id: input.transactionId ?? null,
    error_message: input.errorMessage ?? null,
    sent_at: input.status === "sent" || input.status === "logged" ? new Date().toISOString() : null
  });
  if (error && !/duplicate|email_outbox|does not exist/i.test(error.message)) {
    console.warn("[email] failed to record outbox:", error.message);
  }
}

async function deliverEmail(input: {
  tenantId: string;
  customerId?: string;
  eventType: EmailEventType;
  toEmail: string;
  subject: string;
  message: string;
  idempotencyKey: string;
  transactionId?: string;
  fromName?: string;
  replyTo?: string;
}): Promise<void> {
  if (await outboxExists(input.tenantId, input.idempotencyKey)) {
    return;
  }

  try {
    const result = await sendPlatformEmail({
      to: input.toEmail,
      subject: input.subject,
      text: input.message,
      fromName: input.fromName,
      replyTo: input.replyTo
    });
    await recordOutbox({
      ...input,
      status: result.mode === "console" ? "logged" : "sent"
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Email send failed";
    console.warn("[email] send failed:", message);
    await recordOutbox({
      ...input,
      status: "failed",
      errorMessage: message
    });
  }
}

/** Non-blocking customer email for posted susu/savings transactions. */
export async function notifyCustomerTransactionEmail(input: NotifyInput): Promise<void> {
  const addons = input.subscribedAddons ?? (await loadTenantAddons(input.tenantId)) ?? [];
  if (!hasTenantAddon(addons, "email_notifications")) {
    return;
  }

  const settings = await getTenantEmailSettings(input.tenantId);
  if (!isEmailEventEnabled(settings, input.type)) {
    return;
  }

  const customer = await getCustomerById(input.tenantId, input.customerId);
  const toEmail = normalizeCustomerEmail(customer?.email);
  if (!toEmail) {
    return;
  }

  const [brand, balance] = await Promise.all([
    resolveTenantName(input.tenantId),
    computeCustomerBalance(input.tenantId, input.customerId)
  ]);

  const displayName = settings.fromName?.trim() || brand;
  const alert = buildTransactionAlertMessage({
    brand: displayName,
    type: input.type,
    amount: input.amount,
    balance,
    accountNumber: customer?.accountNumber,
    customerName: customer?.fullName
  });

  await deliverEmail({
    tenantId: input.tenantId,
    customerId: input.customerId,
    eventType: input.type,
    toEmail,
    subject: alert.subject,
    message: alert.text,
    idempotencyKey: `email:tx:${input.transactionId}`,
    transactionId: input.transactionId,
    fromName: displayName,
    replyTo: settings.replyToEmail || undefined
  });
}

export async function sendTestCustomerEmail(input: {
  tenantId: string;
  email: string;
  message?: string;
  subscribedAddons?: TenantAddon[];
}): Promise<{ sent: boolean; email: string; message: string; mode: "smtp" | "console" }> {
  const addons = input.subscribedAddons ?? (await loadTenantAddons(input.tenantId)) ?? [];
  if (!hasTenantAddon(addons, "email_notifications")) {
    throw new Error("Email notifications add-on is not active on this subscription");
  }

  const toEmail = normalizeCustomerEmail(input.email);
  if (!toEmail) {
    throw new Error("Enter a valid email address");
  }

  const brand = await resolveTenantName(input.tenantId);
  const settings = await getTenantEmailSettings(input.tenantId);
  const displayName = settings.fromName?.trim() || brand;
  const message =
    input.message?.trim() ||
    `${displayName}: This is a test email from your BMS notification settings.`;

  const idempotencyKey = `email:test:${randomUUID()}`;
  const result = await sendPlatformEmail({
    to: toEmail,
    subject: `${displayName} — test notification`,
    text: message,
    fromName: displayName,
    replyTo: settings.replyToEmail || undefined
  });

  await recordOutbox({
    tenantId: input.tenantId,
    eventType: "test",
    toEmail,
    subject: `${displayName} — test notification`,
    message,
    idempotencyKey,
    status: result.mode === "console" ? "logged" : "sent"
  });

  return { sent: true, email: toEmail, message, mode: result.mode };
}

export { getEmailPlatformStatus };
