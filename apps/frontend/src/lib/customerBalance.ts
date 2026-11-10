import { SAVINGS_INITIAL_DEPOSIT_GHS } from "@bms/shared";
import type { Customer, LedgerEntry } from "../app/api";

export function balancesFromLedger(customer: Customer, ledger: LedgerEntry[]) {
  const accountBalance = ledger.length > 0 ? ledger[ledger.length - 1]!.balanceAfter : 0;
  const isSavings = customer.accountType === "savings";
  const lockedAmount = isSavings ? (customer.lockedBalance ?? SAVINGS_INITIAL_DEPOSIT_GHS) : 0;
  const loanReserveAmount = Math.max(0, customer.loanReserveAmount ?? 0);
  const withdrawableBalance = Math.max(0, accountBalance - lockedAmount - loanReserveAmount);
  return {
    accountBalance,
    withdrawableBalance,
    lockedAmount,
    loanReserveAmount,
    isSavings,
    hasLoanReserve: loanReserveAmount > 0
  };
}
