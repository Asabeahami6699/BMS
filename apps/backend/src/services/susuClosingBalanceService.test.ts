import { describe, expect, it } from "vitest";
import {
  checkCashConservationInvariant,
  computeOffTillVaultFlows,
  parseRetainedOpeningFeeFromNotes
} from "./susuClosingBalanceService.js";

describe("susuClosingBalanceService physical vault cash helpers", () => {
  it("parses retained Savings opening fee from collection notes for gross vault cash", () => {
    expect(
      parseRetainedOpeningFeeFromNotes(
        "Batch 86a98f21 · Opening fee GHS 50.00 retained from collection"
      )
    ).toBe(50);
    expect(
      parseRetainedOpeningFeeFromNotes(
        "Opening fee GHS 1,250.50 retained from collection (GHS 250.00 still to recover from deposits)"
      )
    ).toBe(1250.5);
    expect(
      parseRetainedOpeningFeeFromNotes(
        "Batch 33c01210 · Susu cycle #1 · gross GHS 1300.00 · savings GHS 1300.00"
      )
    ).toBe(0);
    expect(parseRetainedOpeningFeeFromNotes(undefined)).toBe(0);
  });

  it("routes off-till approval / direct deposits to vault without double-counting teller till deposits", () => {
    // Example: GHS 2,400 Savings initial deposit credited on approval (off-till) +
    // GHS 600 walk-in deposit inside an open teller till => GHS 3,000 total walkInDeposits,
    // GHS 600 recorded in branch_float_sessions => GHS 2,400 goes directly to vault.
    expect(
      computeOffTillVaultFlows(
        { walkInDeposits: 3000, walkInWithdrawals: 0 },
        { recordedInflows: 600, recordedWithdrawals: 0 }
      )
    ).toEqual({
      directToVaultDeposits: 2400,
      directFromVaultWithdrawals: 0
    });
  });

  it("returns zero direct-to-vault flows when all walk-in cash is inside teller tills", () => {
    expect(
      computeOffTillVaultFlows(
        { walkInDeposits: 600, walkInWithdrawals: 150 },
        { recordedInflows: 600, recordedWithdrawals: 150 }
      )
    ).toEqual({
      directToVaultDeposits: 0,
      directFromVaultWithdrawals: 0
    });
  });

  it("clamps negative deltas to zero when till totals exceed active transactions (e.g. post-close reversal)", () => {
    expect(
      computeOffTillVaultFlows(
        { walkInDeposits: 400, walkInWithdrawals: 50 },
        { recordedInflows: 600, recordedWithdrawals: 100 }
      )
    ).toEqual({
      directToVaultDeposits: 0,
      directFromVaultWithdrawals: 0
    });
  });

  it("verifies cash-conservation invariant on a balanced branch day with open till + direct approval deposits", () => {
    // Opening 1,200 + Field 2,620 + Walk-in 3,000 (2,400 off-till + 600 open till) = 6,820 position
    const res = checkCashConservationInvariant({
      openingVault: 1200,
      capitalInjectedToday: 0,
      capitalDrawingsToday: 0,
      fieldAgentDeposits: 2620,
      walkInDeposits: 3000,
      fieldAgentWithdrawals: 0,
      walkInWithdrawals: 0,
      effectiveTotalExpenses: 0,
      closedTillVariance: 0,
      branchCashPosition: 6820
    });
    expect(res).toEqual({
      balanced: true,
      expectedPosition: 6820,
      actualPosition: 6820,
      discrepancy: 0
    });
  });

  it("flags an unreconciled discrepancy when physical cash position drifts from ledger cash flows", () => {
    const res = checkCashConservationInvariant({
      openingVault: 1200,
      capitalInjectedToday: 0,
      capitalDrawingsToday: 0,
      fieldAgentDeposits: 2620,
      walkInDeposits: 3000,
      fieldAgentWithdrawals: 0,
      walkInWithdrawals: 0,
      effectiveTotalExpenses: 0,
      closedTillVariance: 0,
      branchCashPosition: 4370
    });
    expect(res.balanced).toBe(false);
    expect(res.expectedPosition).toBe(6820);
    expect(res.actualPosition).toBe(4370);
    expect(res.discrepancy).toBe(-2450);
  });
});
