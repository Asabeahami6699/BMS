import type { BranchFloatSummary } from "../app/api";
import { listTellerTillJournalEntries } from "../app/api";
import { checkTillFloatForTransaction, roleRequiresBranchFloat } from "./branchFloatBalance";

export async function ensureTillReadyForAgencyDeposit(input: {
  hasSusuModule: boolean;
  role: string;
  branchId: string;
  amount: number;
  floatSummary?: BranchFloatSummary | null;
}): Promise<{ ok: true } | { ok: false; message: string }> {
  if (!roleRequiresBranchFloat(input.role)) {
    return { ok: true };
  }

  if (!input.branchId) {
    return { ok: false, message: "Select the branch where cash is received." };
  }

  if (input.hasSusuModule) {
    if (!input.floatSummary) {
      return {
        ok: false,
        message:
          "Open your daily branch counter float before posting cash. Request float from admin."
      };
    }
    return checkTillFloatForTransaction({
      role: input.role,
      type: "deposit",
      amount: input.amount,
      floatSummary: input.floatSummary
    });
  }

  const businessDate = new Date().toISOString().slice(0, 10);
  const entries = await listTellerTillJournalEntries({
    branchId: input.branchId,
    date: businessDate
  });
  const hasOpeningDrawer = entries.some((entry) => entry.entryType === "opening_drawer");
  if (!hasOpeningDrawer) {
    return {
      ok: false,
      message:
        "Open your till in the daybook first — log an Opening drawer movement before recording deposits."
    };
  }

  return { ok: true };
}
