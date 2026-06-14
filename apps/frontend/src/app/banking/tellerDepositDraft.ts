const DRAFT_KEY = "bms.tellerDepositDraft";

export type TellerDepositDraft = {
  amount: string;
  notes: string;
  bankProductId: string;
  workflowData: Record<string, unknown>;
  captureMode: "banks" | "manual";
  customerSearchTab: "all" | "susu" | "savings";
  accountNumberInput: string;
};

export function loadTellerDepositDraft(): TellerDepositDraft | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    const raw = sessionStorage.getItem(DRAFT_KEY);
    if (!raw) {
      return null;
    }
    return JSON.parse(raw) as TellerDepositDraft;
  } catch {
    return null;
  }
}

export function saveTellerDepositDraft(draft: TellerDepositDraft): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  } catch {
    /* quota */
  }
}

export function clearTellerDepositDraft(): void {
  if (typeof window === "undefined") {
    return;
  }
  sessionStorage.removeItem(DRAFT_KEY);
}

export function formatAccountingGhs(amount: number): string {
  return `GHS ${new Intl.NumberFormat("en-GH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(amount)}`;
}
