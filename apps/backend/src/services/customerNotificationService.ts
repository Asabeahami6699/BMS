import type { TenantAddon } from "@bms/shared";
import {
  notifyCustomerAccountOpenedEmail,
  notifyCustomerTransactionEmail
} from "./customerEmailService.js";
import {
  notifyCustomerAccountOpenedSms,
  notifyCustomerLoanRepaymentFromSusuSms,
  notifyCustomerTransactionSms
} from "./customerSmsService.js";

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
