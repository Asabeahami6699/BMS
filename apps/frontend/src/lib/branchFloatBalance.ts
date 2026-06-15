import type { BranchFloatSummary } from "../app/api";

const ROLES_REQUIRING_FLOAT = new Set(["teller", "coordinator"]);

export function roleRequiresBranchFloat(role: string): boolean {
  return ROLES_REQUIRING_FLOAT.has(role);
}

export function checkTillFloatForTransaction(input: {
  role: string;
  type: "daily_susu" | "deposit" | "withdrawal";
  amount: number;
  floatSummary: BranchFloatSummary;
}): { ok: true } | { ok: false; message: string } {
  if (!roleRequiresBranchFloat(input.role)) {
    return { ok: true };
  }

  if (!input.floatSummary) {
    return {
      ok: false,
      message: "Open your daily branch counter float before posting cash. Request float from admin."
    };
  }

  if (!input.floatSummary.canTransact) {
    return {
      ok: false,
      message:
        "Your daily till float is not open yet. Open your till float before recording cash transactions."
    };
  }

  if (
    (input.type === "deposit" || input.type === "daily_susu") &&
    input.amount > input.floatSummary.floatBalance + 1e-9
  ) {
    return {
      ok: false,
      message: `Insufficient float balance (GHS ${input.floatSummary.floatBalance.toFixed(2)} available). Deposits reduce float — request more from admin.`
    };
  }

  if (input.type === "withdrawal" && input.amount > input.floatSummary.expectedCash + 1e-9) {
    return {
      ok: false,
      message: `Insufficient cash in till for this withdrawal (GHS ${input.floatSummary.expectedCash.toFixed(2)} available).`
    };
  }

  return { ok: true };
}

export function projectedFloatBalance(
  floatSummary: BranchFloatSummary,
  type: "daily_susu" | "deposit" | "withdrawal",
  amount: number
): number | null {
  if (!floatSummary?.canTransact || !Number.isFinite(amount) || amount <= 0) {
    return null;
  }

  if (type === "withdrawal") {
    return floatSummary.floatBalance + amount;
  }

  return floatSummary.floatBalance - amount;
}
