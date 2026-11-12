import {
  buildAccountOpenedMessage,
  buildLoanRepaymentFromSusuMessage,
  buildTransactionAlertMessage,
  formatAccountAmount,
  hasTenantAddon,
  normalizeGhanaPhone,
  type SmsEventType,
  type TenantAddon
} from "@bms/shared";
import { randomUUID } from "node:crypto";
import { hasArkeselSmsConfig } from "../config/env.js";
import { getSupabaseAdminClient } from "../config/supabaseClient.js";
import { getTenantFromStore } from "./authStore.js";
import { getCustomerById } from "./customerService.js";
import { computeCustomerBalance } from "./ledgerService.js";
import { sendArkeselSms } from "./arkeselSmsProvider.js";
import { getTenantSmsSettings, isSmsEventEnabled } from "./tenantSmsSettingsService.js";
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
    .from("sms_outbox")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();
  if (error && !/sms_outbox|does not exist/i.test(error.message)) {
    console.warn("[sms] outbox lookup failed:", error.message);
    return false;
  }
  return Boolean(data?.id);
}

async function recordOutbox(input: {
  tenantId: string;
  customerId?: string;
  eventType: SmsEventType;
  phone: string;
  message: string;
  idempotencyKey: string;
  transactionId?: string;
  status: "pending" | "sent" | "failed";
  providerMessageId?: string;
  errorMessage?: string;
}): Promise<void> {
  const supabase = getSupabaseAdminClient();
  if (!supabase) {
    return;
  }
  const { error } = await supabase.from("sms_outbox").insert({
    id: randomUUID(),
    tenant_id: input.tenantId,
    customer_id: input.customerId ?? null,
    event_type: input.eventType,
    phone: input.phone,
    message_body: input.message,
    status: input.status,
    provider_message_id: input.providerMessageId ?? null,
    idempotency_key: input.idempotencyKey,
    transaction_id: input.transactionId ?? null,
    error_message: input.errorMessage ?? null,
    sent_at: input.status === "sent" ? new Date().toISOString() : null
  });
  if (error && !/duplicate|sms_outbox|does not exist/i.test(error.message)) {
    console.warn("[sms] failed to record outbox:", error.message);
  }
}

async function deliverSms(input: {
  tenantId: string;
  customerId?: string;
  eventType: SmsEventType;
  phone: string;
  message: string;
  idempotencyKey: string;
  transactionId?: string;
  senderId?: string;
}): Promise<void> {
  if (await outboxExists(input.tenantId, input.idempotencyKey)) {
    return;
  }

  if (!hasArkeselSmsConfig()) {
    await recordOutbox({
      ...input,
      status: "failed",
      errorMessage: "Arkesel SMS not configured on platform"
    });
    return;
  }

  try {
    const result = await sendArkeselSms({
      to: input.phone,
      content: input.message,
      from: input.senderId
    });
    await recordOutbox({
      ...input,
      status: "sent",
      providerMessageId: result.messageId
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "SMS send failed";
    console.warn("[sms] send failed:", message);
    await recordOutbox({
      ...input,
      status: "failed",
      errorMessage: message
    });
  }
}

/** Non-blocking customer SMS for posted susu/savings transactions. */
export async function notifyCustomerTransactionSms(input: NotifyInput): Promise<void> {
  const addons = input.subscribedAddons ?? (await loadTenantAddons(input.tenantId)) ?? [];
  if (!hasTenantAddon(addons, "sms_notifications")) {
    return;
  }

  if (!isSmsEventEnabled(await getTenantSmsSettings(input.tenantId), input.type)) {
    return;
  }

  const customer = await getCustomerById(input.tenantId, input.customerId);
  if (!customer?.phone) {
    return;
  }

  const phone = normalizeGhanaPhone(customer.phone);
  if (!phone) {
    return;
  }

  const [brand, balance, settings] = await Promise.all([
    resolveTenantName(input.tenantId),
    computeCustomerBalance(input.tenantId, input.customerId),
    getTenantSmsSettings(input.tenantId)
  ]);

  const message = buildTransactionAlertMessage({
    brand: brand.slice(0, 40),
    type: input.type,
    amount: input.amount,
    balance,
    accountNumber: customer.accountNumber,
    customerName: customer.fullName
  }).text;

  await deliverSms({
    tenantId: input.tenantId,
    customerId: input.customerId,
    eventType: input.type,
    phone,
    message,
    idempotencyKey: `tx:${input.transactionId}`,
    transactionId: input.transactionId,
    senderId: settings.senderId
  });
}

/** SMS for missed Susu auto-debit recovery ladder. */
export async function deliverLoanRecoveryCustomerSms(input: {
  tenantId: string;
  customerId: string;
  amount: number;
  customerName?: string;
}): Promise<boolean> {
  const addons = (await loadTenantAddons(input.tenantId)) ?? [];
  if (!hasTenantAddon(addons, "sms_notifications")) {
    return false;
  }
  const settings = await getTenantSmsSettings(input.tenantId);
  if (
    !settings.enabled ||
    (!isSmsEventEnabled(settings, "withdrawal") && !isSmsEventEnabled(settings, "deposit"))
  ) {
    return false;
  }
  const customer = await getCustomerById(input.tenantId, input.customerId);
  if (!customer?.phone) {
    return false;
  }
  const phone = normalizeGhanaPhone(customer.phone);
  if (!phone) {
    return false;
  }
  const brand = await resolveTenantName(input.tenantId);
  const acct = customer.accountNumber ? ` Acct ${customer.accountNumber}.` : "";
  const message = `${brand.slice(0, 40)}: Loan installment of GHS ${formatAccountAmount(input.amount)} could not be taken from your Susu account. Please deposit or visit your branch.${acct}`;
  await deliverSms({
    tenantId: input.tenantId,
    customerId: input.customerId,
    eventType: "withdrawal",
    phone,
    message,
    idempotencyKey: `loan-recovery:${input.customerId}:${new Date().toISOString().slice(0, 10)}:${formatAccountAmount(input.amount)}`,
    senderId: settings.senderId
  });
  return true;
}

/** SMS when a customer newly qualifies for a Susu-secured loan. */
export async function notifyCustomerLoanQualifiedSms(input: {
  tenantId: string;
  customerId: string;
  badgeLabel: string;
  suggestedMaxLoanGhs: number;
  periodMonths: number;
  subscribedAddons?: TenantAddon[];
}): Promise<boolean> {
  const addons = input.subscribedAddons ?? (await loadTenantAddons(input.tenantId)) ?? [];
  if (!hasTenantAddon(addons, "sms_notifications")) {
    return false;
  }

  const settings = await getTenantSmsSettings(input.tenantId);
  if (
    !settings.enabled ||
    (!isSmsEventEnabled(settings, "deposit") && !isSmsEventEnabled(settings, "withdrawal"))
  ) {
    return false;
  }

  const customer = await getCustomerById(input.tenantId, input.customerId);
  if (!customer?.phone) {
    return false;
  }

  const phone = normalizeGhanaPhone(customer.phone);
  if (!phone) {
    return false;
  }

  const brand = await resolveTenantName(input.tenantId);
  const maxPart =
    input.suggestedMaxLoanGhs > 0
      ? ` Suggested up to GHS ${formatAccountAmount(input.suggestedMaxLoanGhs)}.`
      : "";
  const acct = customer.accountNumber ? ` Acct ${customer.accountNumber}.` : "";
  const message = `${brand.slice(0, 40)}: You qualify for a loan (${input.badgeLabel}) based on ${input.periodMonths} month(s) Susu consistency.${maxPart}${acct} Visit your branch to apply.`;

  await deliverSms({
    tenantId: input.tenantId,
    customerId: input.customerId,
    eventType: "deposit",
    phone,
    message,
    idempotencyKey: `loan-qualify:${input.customerId}:${input.periodMonths}:${new Date()
      .toISOString()
      .slice(0, 10)}`,
    senderId: settings.senderId
  });
  return true;
}

/** SMS when a loan repayment is taken from the customer's Susu/savings balance. */
export async function notifyCustomerLoanRepaymentFromSusuSms(input: {
  tenantId: string;
  customerId: string;
  transactionId: string;
  amount: number;
  loanReference?: string;
  subscribedAddons?: TenantAddon[];
}): Promise<void> {
  const addons = input.subscribedAddons ?? (await loadTenantAddons(input.tenantId)) ?? [];
  if (!hasTenantAddon(addons, "sms_notifications")) {
    return;
  }

  if (!isSmsEventEnabled(await getTenantSmsSettings(input.tenantId), "withdrawal")) {
    return;
  }

  const customer = await getCustomerById(input.tenantId, input.customerId);
  if (!customer?.phone) {
    return;
  }

  const phone = normalizeGhanaPhone(customer.phone);
  if (!phone) {
    return;
  }

  const [brand, balance, settings] = await Promise.all([
    resolveTenantName(input.tenantId),
    computeCustomerBalance(input.tenantId, input.customerId),
    getTenantSmsSettings(input.tenantId)
  ]);

  const message = buildLoanRepaymentFromSusuMessage({
    brand: brand.slice(0, 40),
    amount: input.amount,
    balance,
    accountNumber: customer.accountNumber,
    loanReference: input.loanReference
  }).text;

  await deliverSms({
    tenantId: input.tenantId,
    customerId: input.customerId,
    eventType: "withdrawal",
    phone,
    message,
    idempotencyKey: `loan-repay:${input.transactionId}`,
    transactionId: input.transactionId,
    senderId: settings.senderId
  });
}

/** SMS after a registration is approved, including the full account number. */
export async function notifyCustomerAccountOpenedSms(input: {
  tenantId: string;
  customerId: string;
}): Promise<void> {
  const addons = (await loadTenantAddons(input.tenantId)) ?? [];
  if (!hasTenantAddon(addons, "sms_notifications")) {
    return;
  }

  const settings = await getTenantSmsSettings(input.tenantId);
  if (!settings.enabled) {
    return;
  }

  const customer = await getCustomerById(input.tenantId, input.customerId);
  const accountNumber = customer?.accountNumber?.trim();
  if (!customer?.phone || !accountNumber) {
    return;
  }

  const phone = normalizeGhanaPhone(customer.phone);
  if (!phone) {
    return;
  }

  const brand = await resolveTenantName(input.tenantId);
  const message = buildAccountOpenedMessage({
    brand,
    accountNumber,
    customerName: customer.fullName
  }).text;

  await deliverSms({
    tenantId: input.tenantId,
    customerId: input.customerId,
    eventType: "account_opened",
    phone,
    message,
    idempotencyKey: `account-opened:${input.customerId}:${accountNumber}`,
    senderId: settings.senderId
  });
}

export async function sendTestCustomerSms(input: {
  tenantId: string;
  phone: string;
  message?: string;
  subscribedAddons?: TenantAddon[];
}): Promise<{ sent: boolean; phone: string; message: string }> {
  const addons = input.subscribedAddons ?? (await loadTenantAddons(input.tenantId)) ?? [];
  if (!hasTenantAddon(addons, "sms_notifications")) {
    throw new Error("SMS notifications add-on is not active on this subscription");
  }

  if (!hasArkeselSmsConfig()) {
    throw new Error(
      "Arkesel is not configured on the server. Add ARKESEL_API_KEY to apps/backend/.env"
    );
  }

  const normalized = normalizeGhanaPhone(input.phone);
  if (!normalized) {
    throw new Error("Enter a valid Ghana mobile number (e.g. 0244123456)");
  }

  const brand = await resolveTenantName(input.tenantId);
  const settings = await getTenantSmsSettings(input.tenantId);
  if (!settings.senderId?.trim()) {
    throw new Error("Enter a Sender ID and save SMS settings before sending a test.");
  }
  const message =
    input.message?.trim() ||
    `${brand}: This is a test SMS from your aabanker notification settings.`;

  const idempotencyKey = `test:${randomUUID()}`;
  await deliverSms({
    tenantId: input.tenantId,
    eventType: "test",
    phone: normalized,
    message,
    idempotencyKey,
    senderId: settings.senderId
  });

  return { sent: true, phone: normalized, message };
}

export async function getSmsPlatformStatus(): Promise<{ configured: boolean }> {
  return { configured: hasArkeselSmsConfig() };
}
