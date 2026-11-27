import { SAVINGS_INITIAL_DEPOSIT_GHS } from "@bms/shared";
import type { Customer, LedgerEntry } from "../app/api";

export function effectiveSavingsLockAmount(customer: Customer): number {
  if (customer.accountType !== "savings") {
    return 0;
  }
  const hasExplicitLock =
    customer.lockedBalance != null ||
    customer.savingsLockTiming != null ||
    customer.initialDepositCreditedAt != null;
  const currentLocked = hasExplicitLock
    ? Math.max(0, customer.lockedBalance ?? 0)
    : SAVINGS_INITIAL_DEPOSIT_GHS;
  if (customer.savingsLockTiming === "withdrawal") {
    const target = Math.max(0, customer.savingsLockTargetAmount ?? 0);
    return Math.max(currentLocked, target);
  }
  return currentLocked;
}

export function balancesFromLedger(customer: Customer, ledger: LedgerEntry[]) {
  const accountBalance = ledger.length > 0 ? ledger[ledger.length - 1]!.balanceAfter : 0;
  const isSavings = customer.accountType === "savings";
  const currentLockedAmount = isSavings
    ? customer.lockedBalance != null ||
      customer.savingsLockTiming != null ||
      customer.initialDepositCreditedAt != null
      ? Math.max(0, customer.lockedBalance ?? 0)
      : SAVINGS_INITIAL_DEPOSIT_GHS
    : 0;
  const lockedAmount = effectiveSavingsLockAmount(customer);
  const deferredLockOnWithdrawal =
    isSavings &&
    customer.savingsLockTiming === "withdrawal" &&
    currentLockedAmount < lockedAmount;
  const loanReserveAmount = Math.max(0, customer.loanReserveAmount ?? 0);
  const withdrawableBalance = Math.max(0, accountBalance - lockedAmount - loanReserveAmount);
  return {
    accountBalance,
    withdrawableBalance,
    lockedAmount,
    currentLockedAmount,
    deferredLockOnWithdrawal,
    loanReserveAmount,
    isSavings,
    hasLoanReserve: loanReserveAmount > 0
  };
}
