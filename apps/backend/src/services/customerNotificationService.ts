import type { TenantAddon } from "@bms/shared";
import {
  notifyCustomerAccountOpenedEmail,
  notifyCustomerSusuCommissionEmail,
  notifyCustomerTransactionEmail
} from "./customerEmailService.js";
import {
  notifyCustomerAccountOpenedSms,
  notifyCustomerLoanRepaymentFromSusuSms,
  notifyCustomerSusuCommissionSms,
  notifyCustomerTransactionSms
} from "./customerSmsService.js";

type NotifyInput = {
  tenantId: string;
  customerId: string;
  transactionId: string;
  type: "deposit" | "withdrawal" | "daily_susu";
  amount: number;
  balanceOverride?: number;
  subscribedAddons?: TenantAddon[];
};

/** Send SMS and/or email based on tenant add-ons and settings. Non-blocking. */
export async function notifyCustomerTransaction(input: NotifyInput): Promise<void> {
  await Promise.allSettled([
    notifyCustomerTransactionSms(input),
    notifyCustomerTransactionEmail(input)
  ]);
}

const SUSU_COMMISSION_ALERT_DELAY_MS = 60_000;

/**
 * Notify customer that Susu card commission (service charge) was debited.
 * Delayed by ~1 minute by default so the customer sees their full deposit alert first,
 * followed by a clear service charge debit alert.
 */
export function scheduleCustomerSusuCommissionNotification(input: {
  tenantId: string;
  customerId: string;
  transactionId: string;
  amount: number;
  cycleNumber?: number;
  subscribedAddons?: TenantAddon[];
  delayMs?: number;
}): void {
  const delay = input.delayMs ?? SUSU_COMMISSION_ALERT_DELAY_MS;
  const run = () => {
    void Promise.allSettled([
      notifyCustomerSusuCommissionSms(input),
      notifyCustomerSusuCommissionEmail(input)
    ]).catch((error) => {
      console.warn(
        "[notifications] susu commission alert skipped:",
        error instanceof Error ? error.message : error
      );
    });
  };
  if (delay <= 0) {
    run();
    return;
  }
  const timer = setTimeout(run, delay);
  if (typeof timer.unref === "function") {
    timer.unref();
  }
}

/** Notify customer that a loan repayment was debited from their Susu account. */
export async function notifyCustomerLoanRepaymentFromSusu(input: {
  tenantId: string;
  customerId: string;
  transactionId: string;
  amount: number;
  loanReference?: string;
  subscribedAddons?: TenantAddon[];
}): Promise<void> {
  await Promise.allSettled([
    notifyCustomerLoanRepaymentFromSusuSms(input),
    notifyCustomerTransactionEmail({
      tenantId: input.tenantId,
      customerId: input.customerId,
      transactionId: input.transactionId,
      type: "withdrawal",
      amount: input.amount,
      subscribedAddons: input.subscribedAddons
    })
  ]);
}

/** Tell the customer their account number after registration approval. */
export async function notifyCustomerAccountOpened(input: {
  tenantId: string;
  customerId: string;
}): Promise<void> {
  await Promise.allSettled([
    notifyCustomerAccountOpenedSms(input),
    notifyCustomerAccountOpenedEmail(input)
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
