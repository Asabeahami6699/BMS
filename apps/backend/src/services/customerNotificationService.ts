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
  balanceOverride?: number;
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

const INITIAL_DEPOSIT_ALERT_DELAY_MS = 10_000;

/**
 * Tell the customer their account number after registration approval.
 * When a Savings initial deposit was credited on approval, sends the deposit credit
 * notification right after the account-opened message so the account number arrives first.
 */
export async function notifyCustomerAccountOpened(input: {
  tenantId: string;
  customerId: string;
  initialDeposit?: { transactionId: string; amount: number } | null;
  depositDelayMs?: number;
}): Promise<void> {
  await Promise.allSettled([
    notifyCustomerAccountOpenedSms(input),
    notifyCustomerAccountOpenedEmail(input)
  ]);

  if (input.initialDeposit && input.initialDeposit.amount > 0) {
    const { transactionId, amount } = input.initialDeposit;
    const delay = input.depositDelayMs ?? INITIAL_DEPOSIT_ALERT_DELAY_MS;
    const sendDepositAlert = () => {
      void notifyCustomerTransaction({
        tenantId: input.tenantId,
        customerId: input.customerId,
        transactionId,
        type: "deposit",
        amount,
        balanceOverride: amount
      }).catch((error) => {
        console.warn(
          "[notifications] savings initial deposit alert skipped:",
          error instanceof Error ? error.message : error
        );
      });
    };
    if (delay <= 0) {
      sendDepositAlert();
      return;
    }
    const timer = setTimeout(sendDepositAlert, delay);
    if (typeof timer.unref === "function") {
      timer.unref();
    }
  }
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
