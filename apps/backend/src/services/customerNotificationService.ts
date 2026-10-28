import type { TenantAddon } from "@bms/shared";
import { notifyCustomerTransactionEmail } from "./customerEmailService.js";
import { notifyCustomerTransactionSms } from "./customerSmsService.js";

type NotifyInput = {
  tenantId: string;
  customerId: string;
  transactionId: string;
  type: "deposit" | "withdrawal" | "daily_susu";
  amount: number;
  subscribedAddons?: TenantAddon[];
};

/** Send SMS and/or email based on tenant add-ons and settings. Non-blocking. */
export async function notifyCustomerTransaction(input: NotifyInput): Promise<void> {
  await Promise.allSettled([
    notifyCustomerTransactionSms(input),
    notifyCustomerTransactionEmail(input)
  ]);
}

export async function getNotificationPlatformStatus(): Promise<{
  smsConfigured: boolean;
  smtpConfigured: boolean;
}> {
  const [{ configured: smsConfigured }, { configured: smtpConfigured }] = await Promise.all([
    import("./customerSmsService.js").then((m) => m.getSmsPlatformStatus()),
    import("./emailProvider.js").then((m) => Promise.resolve(m.getEmailPlatformStatus()))
  ]);
  return { smsConfigured, smtpConfigured };
}
