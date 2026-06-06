import type { LoanApplicationStatus, LoanIncomeSource, LoanPurpose, LoanRepaymentFrequency, LoanScheduleStatus } from "@bms/shared";

export function formatLoanMoney(amount: number): string {
  return `GHS ${amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function parseMoneyInput(raw: string): number {
  const cleaned = raw.replace(/,/g, "").trim();
  if (!cleaned) {
    return NaN;
  }
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : NaN;
}

export function formatMoneyInput(value: number): string {
  if (!Number.isFinite(value)) {
    return "";
  }
  const parts = value.toFixed(2).split(".");
  const intPart = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const dec = parts[1];
  return dec === "00" ? intPart : `${intPart}.${dec}`;
}

export function sanitizeMoneyTyping(raw: string): string {
  let value = raw.replace(/[^\d.,]/g, "");
  const firstDot = value.indexOf(".");
  if (firstDot >= 0) {
    value =
      value.slice(0, firstDot + 1) + value.slice(firstDot + 1).replace(/\./g, "");
    const [whole, dec = ""] = value.split(".");
    value = `${whole}.${dec.slice(0, 2)}`;
  }
  return value;
}

export function customerDisplayName(name?: string, fallback = "Customer"): string {
  const trimmed = name?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : fallback;
}

export function formatLoanDate(iso?: string): string {
  if (!iso) {
    return "—";
  }
  try {
    return new Date(iso.includes("T") ? iso : `${iso}T12:00:00`).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric"
    });
  } catch {
    return iso;
  }
}

export function formatLoanDateTime(iso?: string): string {
  if (!iso) {
    return "—";
  }
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    });
  } catch {
    return iso;
  }
}

export const LOAN_STATUS_LABELS: Record<LoanApplicationStatus, string> = {
  pending_approval: "Pending approval",
  approved: "Approved",
  rejected: "Rejected",
  disbursed: "Active",
  closed: "Closed"
};

export const LOAN_STATUS_PILL: Record<LoanApplicationStatus, string> = {
  pending_approval: "pending",
  approved: "active",
  rejected: "inactive",
  disbursed: "success",
  closed: "inactive"
};

export const SCHEDULE_STATUS_LABELS: Record<LoanScheduleStatus, string> = {
  pending: "Due",
  paid: "Paid",
  partial: "Partial",
  overdue: "Overdue"
};

export const SCHEDULE_STATUS_PILL: Record<LoanScheduleStatus, string> = {
  pending: "pending",
  paid: "success",
  partial: "active",
  overdue: "inactive"
};

export function frequencyLabel(frequency: LoanRepaymentFrequency): string {
  return frequency === "weekly" ? "Weekly" : "Monthly";
}

export function loanTypeLabel(type?: "individual" | "group_solidarity"): string {
  return type === "group_solidarity" ? "Group solidarity" : "Individual";
}

export const LOAN_PURPOSE_OPTIONS: { value: LoanPurpose; label: string }[] = [
  { value: "working_capital", label: "Working capital" },
  { value: "business_expansion", label: "Business expansion" },
  { value: "education", label: "Education" },
  { value: "medical", label: "Medical / health" },
  { value: "home_improvement", label: "Home improvement" },
  { value: "debt_consolidation", label: "Debt consolidation" },
  { value: "equipment", label: "Equipment purchase" },
  { value: "personal", label: "Personal use" },
  { value: "other", label: "Other" }
];

export const LOAN_INCOME_SOURCE_OPTIONS: { value: LoanIncomeSource; label: string }[] = [
  { value: "salary", label: "Salary / wages" },
  { value: "business", label: "Business profits" },
  { value: "trading", label: "Trading / retail" },
  { value: "farming", label: "Farming / agriculture" },
  { value: "pension", label: "Pension" },
  { value: "remittance", label: "Remittance" },
  { value: "other", label: "Other" }
];

export function loanPurposeLabel(purpose?: LoanPurpose, other?: string): string {
  if (!purpose) {
    return "—";
  }
  if (purpose === "other") {
    return other?.trim() || "Other";
  }
  return LOAN_PURPOSE_OPTIONS.find((o) => o.value === purpose)?.label ?? purpose;
}

export function loanIncomeSourceLabel(source?: LoanIncomeSource, other?: string): string {
  if (!source) {
    return "—";
  }
  if (source === "other") {
    return other?.trim() || "Other";
  }
  return LOAN_INCOME_SOURCE_OPTIONS.find((o) => o.value === source)?.label ?? source;
}

export function estimateAffordabilityRatio(
  monthlyIncome: number | undefined,
  monthlyExpenses: number | undefined,
  installmentAmount: number | undefined
): number | null {
  if (!monthlyIncome || monthlyIncome <= 0 || !installmentAmount) {
    return null;
  }
  const expenses = monthlyExpenses ?? 0;
  const disposable = monthlyIncome - expenses;
  if (disposable <= 0) {
    return null;
  }
  return Math.round((installmentAmount / disposable) * 100);
}

export const LOAN_WORKFLOW_STEPS = [
  { key: "apply", label: "Application" },
  { key: "approve", label: "Approval" },
  { key: "disburse", label: "Disbursement" },
  { key: "repay", label: "Repayments" },
  { key: "closed", label: "Closed" }
] as const;
