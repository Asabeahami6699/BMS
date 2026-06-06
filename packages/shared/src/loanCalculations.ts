import type { LoanRepaymentFrequency } from "./loans.js";

export type LoanFigures = {
  totalInterest: number;
  totalRepayable: number;
  installmentsTotal: number;
  installmentAmount: number;
};

/** Flat-rate interest: P × R × (termMonths / 12). */
export function computeLoanFigures(
  principal: number,
  interestRatePercent: number,
  termMonths: number,
  frequency: LoanRepaymentFrequency
): LoanFigures {
  const totalInterest =
    Math.round(principal * (interestRatePercent / 100) * (termMonths / 12) * 100) / 100;
  const totalRepayable = Math.round((principal + totalInterest) * 100) / 100;
  const installmentsTotal = frequency === "weekly" ? termMonths * 4 : termMonths;
  const installmentAmount =
    installmentsTotal > 0
      ? Math.round((totalRepayable / installmentsTotal) * 100) / 100
      : totalRepayable;
  return { totalInterest, totalRepayable, installmentsTotal, installmentAmount };
}

export function addRepaymentInterval(date: Date, frequency: LoanRepaymentFrequency): Date {
  const next = new Date(date);
  if (frequency === "weekly") {
    next.setDate(next.getDate() + 7);
  } else {
    next.setMonth(next.getMonth() + 1);
  }
  return next;
}

export function generateScheduleDueDates(
  startDate: Date,
  count: number,
  frequency: LoanRepaymentFrequency
): string[] {
  const dates: string[] = [];
  let cursor = new Date(startDate);
  for (let i = 0; i < count; i++) {
    cursor = addRepaymentInterval(cursor, frequency);
    dates.push(cursor.toISOString().slice(0, 10));
  }
  return dates;
}

export function scheduleStatusFromAmounts(
  amountDue: number,
  amountPaid: number,
  dueDate: string,
  today = new Date()
): "pending" | "paid" | "partial" | "overdue" {
  if (amountPaid >= amountDue - 0.009) {
    return "paid";
  }
  if (amountPaid > 0) {
    return "partial";
  }
  const due = new Date(`${dueDate}T23:59:59`);
  if (due < today) {
    return "overdue";
  }
  return "pending";
}
