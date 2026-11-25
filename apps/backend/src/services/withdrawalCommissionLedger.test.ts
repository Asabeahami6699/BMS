import { beforeEach, describe, expect, it, vi } from "vitest";
import { SUSU_COMMISSION_DEBIT_TAG } from "@bms/shared";

const notifyTxCalls: Array<Record<string, unknown>> = [];
const scheduleCommCalls: Array<Record<string, unknown>> = [];

vi.mock("../config/supabaseClient.js", () => ({
  getSupabaseAdminClient: () => null
}));

vi.mock("./branchService.js", () => ({
  listBranches: async () => [{ id: "branch-1", name: "Main Branch" }]
}));

vi.mock("./institutionalIncomeService.js", () => ({
  postInstitutionalIncome: async () => {},
  reverseInstitutionalIncome: async () => {}
}));

vi.mock("./customerNotificationService.js", () => ({
  notifyCustomerTransaction: async (input: Record<string, unknown>) => {
    notifyTxCalls.push(input);
  },
  scheduleCustomerSusuCommissionNotification: (input: Record<string, unknown>) => {
    scheduleCommCalls.push(input);
  }
}));

import {
  approveCustomerRegistration,
  submitCustomerRegistration
} from "./customerService.js";
import { getCustomerLedger } from "./ledgerService.js";
import { publishSusuCommissionPolicy } from "./susuCycleCommissionService.js";
import {
  createTransaction,
  listTransactions,
  postWithdrawalForApprovedDisclosure
} from "./transactionService.js";

const FAKE_ID_CARD_PHOTO =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

describe("withdrawal Susu commission ledger entries and notifications", () => {
  beforeEach(() => {
    notifyTxCalls.length = 0;
    scheduleCommCalls.length = 0;
  });

  it("posts separate withdrawal and Susu commission ledger_entries rows on direct withdrawal", async () => {
    const tenantId = `tenant-wd-ledger-${Date.now()}`;
    const ctx = {
      userId: "teller-1",
      tenantId,
      role: "admin",
      scopeType: "head_office" as const,
      branchId: "branch-1"
    };

    await publishSusuCommissionPolicy(ctx, {
      enabled: true,
      dailyContributionMode: "flexible",
      defaultDailyContributionGhs: 5,
      cycleDays: 31,
      commissionBasis: "first_day",
      commissionFixedAmount: 5,
      commissionPercent: 0,
      deductionTiming: "withdrawal",
      rolloverTreatment: "waive",
      partialAllocation: "savings_first",
      earlyWithdrawalPolicy: "deduct_full",
      notifyCustomerOnCommission: true
    });

    const submitted = await submitCustomerRegistration(tenantId, "agent-1", "branch-1", {
      fullName: "Opioko Test",
      phone: "0545276368",
      location: "Accra",
      houseNumber: "12",
      dateOfBirth: "1992-05-14",
      occupation: "Trader",
      homeBranchId: "branch-1",
      accountType: "susu",
      idCardNumber: "GHA-WD-001",
      idCardPhotoUrl: FAKE_ID_CARD_PHOTO,
      nextOfKin: { fullName: "Kin One", phone: "0244000001", location: "Accra", houseNumber: "12" },
      dailyContributionAmount: 5
    });
    const customer = await approveCustomerRegistration(tenantId, submitted.id, "teller-1");

    // Deposit GHS 310 -> fills Page #1 (155, fee 5) + Page #2 (155, fee 5).
    await createTransaction(
      ctx,
      {
        customerId: customer.id,
        type: "deposit",
        amount: 310,
        transactionBranchId: "branch-1"
      },
      { skipBranchFloat: true }
    );

    notifyTxCalls.length = 0;
    scheduleCommCalls.length = 0;

    // Withdraw GHS 195 -> touches Page #1 (150 net + 5 fee) and Page #2 (45 net + 5 fee) => GHS 10 commission.
    const wdTx = await createTransaction(
      ctx,
      {
        customerId: customer.id,
        type: "withdrawal",
        amount: 195,
        transactionBranchId: "branch-1"
      },
      { skipBranchFloat: true }
    );

    const ledger = await getCustomerLedger(tenantId, customer.id);
    expect(ledger).toHaveLength(3);
    // 1) Deposit credit 310 -> bal 310
    expect(ledger[0]?.entryType).toBe("credit");
    expect(ledger[0]?.amount).toBe(310);
    expect(ledger[0]?.balanceAfter).toBe(310);
    // 2) Cash withdrawal debit 195 -> bal 115
    expect(ledger[1]?.entryType).toBe("debit");
    expect(ledger[1]?.transactionId).toBe(wdTx.id);
    expect(ledger[1]?.amount).toBe(195);
    expect(ledger[1]?.balanceAfter).toBe(115);
    // 3) Separate Susu commission debit 10 -> bal 105
    expect(ledger[2]?.entryType).toBe("debit");
    expect(ledger[2]?.amount).toBe(10);
    expect(ledger[2]?.balanceAfter).toBe(105);

    const allTxs = await listTransactions(tenantId);
    const commTx = allTxs.find((t) => t.id === ledger[2]?.transactionId);
    expect(commTx?.recordedByUserId).toBe("system:susu-commission");
    expect(commTx?.notes).toContain(`${SUSU_COMMISSION_DEBIT_TAG}${wdTx.id}`);

    // SMS #1: exact withdrawn amount (195) + balance after withdrawal (115)
    expect(notifyTxCalls).toHaveLength(1);
    expect(notifyTxCalls[0]?.amount).toBe(195);
    expect(notifyTxCalls[0]?.balanceOverride).toBe(115);

    // SMS #2: exact commission (10) + remaining balance (105), linked to commission tx
    expect(scheduleCommCalls).toHaveLength(1);
    expect(scheduleCommCalls[0]?.amount).toBe(10);
    expect(scheduleCommCalls[0]?.balanceOverride).toBe(105);
    expect(scheduleCommCalls[0]?.transactionId).toBe(commTx?.id);
  });

  it("posts separate withdrawal and Susu commission ledger_entries rows on approved withdrawal disclosure", async () => {
    const tenantId = `tenant-disc-ledger-${Date.now()}`;
    const ctx = {
      userId: "teller-1",
      tenantId,
      role: "admin",
      scopeType: "head_office" as const,
      branchId: "branch-1"
    };

    await publishSusuCommissionPolicy(ctx, {
      enabled: true,
      dailyContributionMode: "flexible",
      defaultDailyContributionGhs: 5,
      cycleDays: 31,
      commissionBasis: "first_day",
      commissionFixedAmount: 5,
      commissionPercent: 0,
      deductionTiming: "withdrawal",
      rolloverTreatment: "waive",
      partialAllocation: "savings_first",
      earlyWithdrawalPolicy: "deduct_full",
      notifyCustomerOnCommission: true
    });

    const submitted = await submitCustomerRegistration(tenantId, "agent-1", "branch-1", {
      fullName: "Disclosure Test",
      phone: "0545276369",
      location: "Accra",
      houseNumber: "14",
      dateOfBirth: "1993-06-20",
      occupation: "Trader",
      homeBranchId: "branch-1",
      accountType: "susu",
      idCardNumber: "GHA-WD-002",
      idCardPhotoUrl: FAKE_ID_CARD_PHOTO,
      nextOfKin: { fullName: "Kin Two", phone: "0244000002", location: "Accra", houseNumber: "14" },
      dailyContributionAmount: 5
    });
    const customer = await approveCustomerRegistration(tenantId, submitted.id, "teller-1");

    await createTransaction(
      ctx,
      {
        customerId: customer.id,
        type: "deposit",
        amount: 155,
        transactionBranchId: "branch-1"
      },
      { skipBranchFloat: true }
    );

    notifyTxCalls.length = 0;
    scheduleCommCalls.length = 0;

    const wdTxId = await postWithdrawalForApprovedDisclosure({
      tenantId,
      customerId: customer.id,
      homeBranchId: "branch-1",
      amount: 100,
      disclosureId: "disc-12345678",
      recordedByUserId: "teller-1",
      fieldAgentId: "agent-1",
      notes: "Teller cash payout"
    });

    const ledger = await getCustomerLedger(tenantId, customer.id);
    expect(ledger).toHaveLength(3);
    expect(ledger[1]?.transactionId).toBe(wdTxId);
    expect(ledger[1]?.amount).toBe(100);
    expect(ledger[1]?.balanceAfter).toBe(55);
    expect(ledger[2]?.amount).toBe(5);
    expect(ledger[2]?.balanceAfter).toBe(50);

    expect(notifyTxCalls).toHaveLength(1);
    expect(notifyTxCalls[0]?.amount).toBe(100);
    expect(notifyTxCalls[0]?.balanceOverride).toBe(55);

    expect(scheduleCommCalls).toHaveLength(1);
    expect(scheduleCommCalls[0]?.amount).toBe(5);
    expect(scheduleCommCalls[0]?.balanceOverride).toBe(50);
    expect(scheduleCommCalls[0]?.transactionId).toBe(ledger[2]?.transactionId);
  });
});
