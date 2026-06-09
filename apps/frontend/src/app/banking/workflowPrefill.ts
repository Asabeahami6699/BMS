import type { BalanceDisclosure } from "../api";

export function prefillWithdrawalVerificationData(
  row: BalanceDisclosure,
  current: Record<string, unknown> = {}
): Record<string, unknown> {
  const next = { ...current };
  if (!next.account_holder_name && row.customerName) {
    next.account_holder_name = row.customerName;
  }
  if (
    (next.amount == null || next.amount === "") &&
    row.withdrawalAmount != null &&
    Number.isFinite(row.withdrawalAmount)
  ) {
    next.amount = row.withdrawalAmount;
  }
  return next;
}
