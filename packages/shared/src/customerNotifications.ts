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
  const accountMask = maskAccountNumber(input.accountNumber);
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
    text: `A sum of GHS ${amt} has been credited to your Account # ${accountMask} being daily susu by ${customerName} - GHS ${amt}. current balance is: Ghs ${bal}`
  };
}

/** SMS when a loan repayment is debited from the customer's Susu/savings account. */
export function buildLoanRepaymentFromSusuMessage(input: {
  brand: string;
  amount: number;
  balance: number;
  accountNumber?: string;
  loanReference?: string;
}): { text: string; subject: string } {
  const amt = formatSmsAmount(input.amount);
  const bal = formatSmsAmount(input.balance);
  const accountMask = maskAccountNumber(input.accountNumber);
  const brand = input.brand.slice(0, 40);
  const loanBit = input.loanReference ? ` (loan ${input.loanReference})` : "";
  return {
    subject: `${brand} — loan repayment`,
    text: `${brand}: GHS ${amt} was debited from Account # ${accountMask} for loan repayment${loanBit}. Current balance: GHS ${bal}.`
  };
}

/** SMS warning that an account is nearing inactive or dormant status. */
export function buildAccountLifecycleWarningMessage(input: {
  brand: string;
  status: "inactive" | "dormant";
  accountNumber?: string;
  monthsRemainingApprox?: number;
}): { text: string; subject: string } {
  const brand = input.brand.slice(0, 40);
  const accountMask = maskAccountNumber(input.accountNumber);
  const statusWord = input.status === "dormant" ? "dormant" : "inactive";
  return {
    subject: `${brand} — account ${statusWord} warning`,
    text: `${brand}: Your Account # ${accountMask} will become ${statusWord} in about ${input.monthsRemainingApprox ?? 1} month if there is no deposit, Susu collection, or withdrawal. Please transact to keep it active.`
  };
}

/** Strip internal tags from transaction notes for statement display. */
export function ledgerDisplayReason(notes?: string | null): string | undefined {
  if (!notes?.trim()) {
    return undefined;
  }
  const cleaned = notes
    .replace(/\s*·\s*loan_repay:[0-9a-f-]+/gi, "")
    .replace(/\s*loan_repay:[0-9a-f-]+/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned || undefined;
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
