import type { PartnerBankAccount } from "@bms/shared";

function workflowString(data: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = data[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "";
}

function workflowNumber(data: Record<string, unknown>, ...keys: string[]): number | null {
  for (const key of keys) {
    const value = data[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === "string" && value.trim()) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
  }
  return null;
}

export function accountOpeningPhone(account: PartnerBankAccount): string {
  const workflow = account.workflowData ?? {};
  return (
    workflowString(workflow, "contact_phone", "phone") ||
    account.customerPhone?.trim() ||
    "—"
  );
}

export function accountOpeningEmail(account: PartnerBankAccount): string {
  const workflow = account.workflowData ?? {};
  return (
    workflowString(workflow, "contact_email", "email") ||
    account.customerEmail?.trim() ||
    "—"
  );
}

export function accountOpeningInitialDeposit(account: PartnerBankAccount): string {
  const amount = workflowNumber(account.workflowData ?? {}, "initial_deposit", "initialDeposit");
  if (amount == null) {
    return "—";
  }
  return `GHS ${amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function accountOpeningTypeLabel(account: PartnerBankAccount): string {
  return account.bankProductName?.trim() || account.bankLabel?.trim() || "—";
}

export function accountOpeningDate(account: PartnerBankAccount): string {
  const workflow = account.workflowData ?? {};
  const raw = workflowString(workflow, "opening_date", "openingDate") || account.createdAt;
  try {
    return new Date(raw).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric"
    });
  } catch {
    return raw;
  }
}

export function accountOpenedBy(account: PartnerBankAccount): string {
  return account.createdByName?.trim() || "—";
}
