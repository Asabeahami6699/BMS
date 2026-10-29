import { formatSmsAmount, maskAccountNumber } from "./sms.js";

export type CustomerTransactionAlertType = "deposit" | "withdrawal" | "daily_susu";

export function buildTransactionAlertMessage(input: {
  brand: string;
  type: CustomerTransactionAlertType;
  amount: number;
  balance: number;
  accountNumber?: string;
  customerName?: string;
}): { text: string; subject: string } {
  const amt = formatSmsAmount(input.amount);
  const bal = formatSmsAmount(input.balance);
  const acct = maskAccountNumber(input.accountNumber);
  const accountMask = `**********${acct}`;
  const customerName = input.customerName?.trim() || "customer";
  const brand = input.brand.slice(0, 60);

  if (input.type === "deposit") {
    return {
      subject: `${brand} — deposit received`,
      text: `A sum of GHS ${amt} has been credited to your Account # ${accountMask} being deposited by ${customerName} - GHS ${amt}. current balance is: Ghs ${bal}`
    };
  }
  if (input.type === "withdrawal") {
    return {
      subject: `${brand} — withdrawal processed`,
      text: `A sum of GHS ${amt} has been debited to your Account # ${accountMask} being withdrawal by ${customerName} - GHS ${amt}. current balance is: Ghs ${bal}`
    };
  }
  return {
    subject: `${brand} — daily collection received`,
    text: `${brand}: Daily collection GHS ${amt} received on account ****${acct}. Balance GHS ${bal}.`
  };
}

/** Sent after a registration is approved. Uses the full account number. */
export function buildAccountOpenedMessage(input: {
  brand: string;
  accountNumber: string;
  customerName?: string;
}): { text: string; subject: string } {
  const brand = input.brand.slice(0, 40);
  const accountNumber = input.accountNumber.trim();
  const name = input.customerName?.trim();
  const greeting = name ? `${name}, your` : "Your";
  return {
    subject: `${brand} — account created`,
    text: `${brand}: ${greeting} account has been created successfully. Your account number is ${accountNumber}.`
  };
}
