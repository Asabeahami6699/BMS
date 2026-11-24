import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildSusuCustomerPassbook,
  defaultSusuCommissionPolicy,
  type SusuCustomerCycle
} from "@bms/shared";

let mockBalance = 0;
const mockPostedIncome: Array<{ amount: number; note?: string; idempotencyKey?: string }> = [];

vi.mock("../config/supabaseClient.js", () => ({
  getSupabaseAdminClient: () => null
}));

vi.mock("./branchService.js", () => ({
  listBranches: async () => [{ id: "branch-1", name: "Main Branch" }]
}));

vi.mock("./customerService.js", () => ({
  getCustomerWithdrawableBalance: async () => mockBalance,
  getPendingDailyContribution: async () => null,
  promotePendingDailyContributionToActive: async () => {}
}));

vi.mock("./ledgerService.js", () => ({
  getCustomerLedger: async () =>
    mockBalance > 0
      ? [{ entryType: "credit", amount: mockBalance, balanceAfter: mockBalance }]
      : []
}));

vi.mock("./institutionalIncomeService.js", () => ({
  postInstitutionalIncome: async (
    _ctx: unknown,
    input: { amount: number; notes?: string; idempotencyKey?: string }
  ) => {
    mockPostedIncome.push({
      amount: input.amount,
      note: input.notes,
      idempotencyKey: input.idempotencyKey
    });
  },
  reverseInstitutionalIncome: async () => {}
}));

import {
  applySusuCollectionToCycle,
  getCustomerSusuCycleSummary,
  publishSusuCommissionPolicy,
  resolveSusuWithdrawalCommission
} from "./susuCycleCommissionService.js";

const ctx = {
  userId: "user-1",
  tenantId: "tenant-fifo-1",
  role: "admin",
  branchId: "branch-1"
};

describe("Susu FIFO withdrawal commission, red-line cancellation, and BBF", () => {
  beforeEach(() => {
    mockBalance = 0;
    mockPostedIncome.length = 0;
  });

  it("cancels touched completed Page #1 immediately, carries remaining BBF to Page #2, and leaves active Page #4 untouched", async () => {
    const tenantId = "tenant-fifo-case-1";
    const c = { ...ctx, tenantId };
    await publishSusuCommissionPolicy(c, {
      enabled: true,
      dailyContributionMode: "fixed",
      defaultDailyContributionGhs: 5,
      cycleDays: 31,
      commissionBasis: "first_day",
      commissionFixedAmount: 5,
      commissionPercent: 3.23,
      deductionTiming: "withdrawal",
      rolloverTreatment: "defer",
      partialAllocation: "commission_first",
      earlyWithdrawalPolicy: "deduct_full"
    });

    // Opioko Ba scenario: Pages #1, #2, #3 completed (3 * GHS 155 = 465) + Page #4 active (7 boxes = GHS 35) = GHS 500
    await applySusuCollectionToCycle(c, {
      customerId: "cust-1",
      branchId: "branch-1",
      paymentAmount: 500,
      dailyContributionAmount: 5
    });
    mockBalance = 500;

    // Withdraw GHS 100 -> touches Page #1 (GHS 155). Commission GHS 5 charged on top (total debit 105).
    // Page #1 is cancelled immediately with red line; leftover GHS 50 is written as BBF at top of Page #2!
    const res1 = await resolveSusuWithdrawalCommission(c, {
      customerId: "cust-1",
      branchId: "branch-1",
      requestedWithdrawalAmount: 100,
      transactionId: "tx-w1"
    });
    expect(res1.blocked).toBe(false);
    expect(res1.commissionToCollect).toBe(5);
    expect(res1.note).toContain("BBF GHS 50.00 carried to Page #2");
    mockBalance -= 105; // 395 remaining

    let { cycles } = await getCustomerSusuCycleSummary(tenantId, "cust-1");
    expect(cycles).toHaveLength(4);
    expect(cycles[0]!.cycleNumber).toBe(1);
    expect(cycles[0]!.status).toBe("closed");
    expect(cycles[0]!.cancelledAt).not.toBeNull();
    expect(cycles[0]!.commissionCollected).toBe(5);
    expect(cycles[0]!.withdrawnAmount).toBe(105);
    // Page #2 stays completed and receives BBF GHS 50.00
    expect(cycles[1]!.cycleNumber).toBe(2);
    expect(cycles[1]!.status).toBe("matured");
    expect(cycles[1]!.balanceBroughtForward).toBe(50);
    expect(cycles[1]!.bbfWithdrawn).toBe(0);
    expect(cycles[1]!.commissionOutstanding).toBe(5);
    // Page #3 & active Page #4 completely untouched
    expect(cycles[2]!.status).toBe("matured");
    expect(cycles[3]!.status).toBe("open");
    expect(cycles[3]!.contributionDays).toBe(7);
    expect(cycles[3]!.commissionCollected).toBe(0);
    expect(cycles[3]!.commissionOutstanding).toBe(5);

    // Next withdrawal of GHS 30 fits inside Page #2's BBF (GHS 50) -> GHS 0 extra fee, Page #2 NOT cancelled!
    const res2 = await resolveSusuWithdrawalCommission(c, {
      customerId: "cust-1",
      branchId: "branch-1",
      requestedWithdrawalAmount: 30,
      transactionId: "tx-w2"
    });
    expect(res2.commissionToCollect).toBe(0);
    mockBalance -= 30; // 365 remaining

    ({ cycles } = await getCustomerSusuCycleSummary(tenantId, "cust-1"));
    expect(cycles[1]!.status).toBe("matured");
    expect(cycles[1]!.balanceBroughtForward).toBe(50);
    expect(cycles[1]!.bbfWithdrawn).toBe(30);
    expect(cycles[3]!.status).toBe("open");

    // Next withdrawal of GHS 50 spends remaining GHS 20 BBF on Page #2 + GHS 30 from Page #2 (+ GHS 5 fee)
    // -> Page #2 is cancelled immediately, leftover GHS 120 (155 - 30 - 5) moves as BBF to Page #3!
    const res3 = await resolveSusuWithdrawalCommission(c, {
      customerId: "cust-1",
      branchId: "branch-1",
      requestedWithdrawalAmount: 50,
      transactionId: "tx-w3"
    });
    expect(res3.commissionToCollect).toBe(5);
    expect(res3.note).toContain("BBF GHS 120.00 carried to Page #3");
    mockBalance -= 55;

    ({ cycles } = await getCustomerSusuCycleSummary(tenantId, "cust-1"));
    expect(cycles[1]!.status).toBe("closed");
    expect(cycles[1]!.cancelledAt).not.toBeNull();
    expect(cycles[1]!.bbfWithdrawn).toBe(50);
    expect(cycles[2]!.status).toBe("matured");
    expect(cycles[2]!.balanceBroughtForward).toBe(120);
    expect(cycles[3]!.status).toBe("open");
    expect(cycles[3]!.commissionOutstanding).toBe(5);
  });

  it("cancels broken incomplete page, charges fee on top, opens fresh next card with BBF at 0/31, and spends BBF first next time", async () => {
    const tenantId = "tenant-fifo-case-2";
    const c = { ...ctx, tenantId };
    await publishSusuCommissionPolicy(c, {
      enabled: true,
      dailyContributionMode: "fixed",
      defaultDailyContributionGhs: 5,
      cycleDays: 31,
      commissionBasis: "first_day",
      commissionFixedAmount: 5,
      commissionPercent: 3.23,
      deductionTiming: "withdrawal",
      rolloverTreatment: "defer",
      partialAllocation: "commission_first",
      earlyWithdrawalPolicy: "deduct_full"
    });

    // Complete Page #1 (GHS 155) + partial Page #2 (22 boxes * GHS 5 = GHS 110) -> total GHS 265
    await applySusuCollectionToCycle(c, {
      customerId: "cust-2",
      branchId: "branch-1",
      paymentAmount: 155,
      dailyContributionAmount: 5
    });
    await applySusuCollectionToCycle(c, {
      customerId: "cust-2",
      branchId: "branch-1",
      paymentAmount: 110,
      dailyContributionAmount: 5
    });
    mockBalance = 265;

    // Customer withdraws GHS 180 -> exhausts Page #1 (150 principal + 5 fee) and dips GHS 30 into Page #2 (+ GHS 5 Page #2 fee)
    // Total commission = 5 + 5 = 10, total debit = 180 + 10 = 190, leftover balance = 265 - 190 = 75 -> BBF on Page #3
    const res = await resolveSusuWithdrawalCommission(c, {
      customerId: "cust-2",
      branchId: "branch-1",
      requestedWithdrawalAmount: 180,
      transactionId: "tx-break-1"
    });
    expect(res.blocked).toBe(false);
    expect(res.commissionToCollect).toBe(10);
    mockBalance -= 190; // 75 left

    const { cycles } = await getCustomerSusuCycleSummary(tenantId, "cust-2");
    expect(cycles).toHaveLength(3);
    expect(cycles[0]!.status).toBe("closed");
    expect(cycles[0]!.cancelledAt).not.toBeNull();
    expect(cycles[1]!.status).toBe("closed");
    expect(cycles[1]!.cancelledAt).not.toBeNull();
    // Brand-new Page #3 starts at 0/31 boxes carrying GHS 75 BBF
    expect(cycles[2]!.cycleNumber).toBe(3);
    expect(cycles[2]!.status).toBe("open");
    expect(cycles[2]!.contributionDays).toBe(0);
    expect(cycles[2]!.grossContributions).toBe(0);
    expect(cycles[2]!.balanceBroughtForward).toBe(75);
    expect(cycles[2]!.bbfWithdrawn).toBe(0);

    // Subsequent withdrawal of GHS 50 spends BBF first -> GHS 0 extra commission and Page #3 stays open!
    const resBbf = await resolveSusuWithdrawalCommission(c, {
      customerId: "cust-2",
      branchId: "branch-1",
      requestedWithdrawalAmount: 50,
      transactionId: "tx-bbf-1"
    });
    expect(resBbf.commissionToCollect).toBe(0);
    mockBalance -= 50;

    const { cycles: afterBbf } = await getCustomerSusuCycleSummary(tenantId, "cust-2");
    expect(afterBbf).toHaveLength(3);
    expect(afterBbf[2]!.status).toBe("open");
    expect(afterBbf[2]!.balanceBroughtForward).toBe(75);
    expect(afterBbf[2]!.bbfWithdrawn).toBe(50);
  });

  it("rejects withdrawal cleanly without mutating cycles when balance < requested + commission", async () => {
    const tenantId = "tenant-fifo-case-3";
    const c = { ...ctx, tenantId };
    await publishSusuCommissionPolicy(c, {
      enabled: true,
      dailyContributionMode: "fixed",
      defaultDailyContributionGhs: 5,
      cycleDays: 31,
      commissionBasis: "first_day",
      commissionFixedAmount: 5,
      commissionPercent: 3.23,
      deductionTiming: "withdrawal",
      rolloverTreatment: "defer",
      partialAllocation: "commission_first",
      earlyWithdrawalPolicy: "deduct_full"
    });

    await applySusuCollectionToCycle(c, {
      customerId: "cust-3",
      branchId: "branch-1",
      paymentAmount: 30,
      dailyContributionAmount: 5
    });
    mockBalance = 30;

    // Requesting GHS 30 + GHS 5 fee = GHS 35 > GHS 30 available -> must throw and leave cycle open
    await expect(
      resolveSusuWithdrawalCommission(c, {
        customerId: "cust-3",
        branchId: "branch-1",
        requestedWithdrawalAmount: 30,
        transactionId: "tx-insufficient"
      })
    ).rejects.toThrow(/Insufficient withdrawable balance/i);

    const { cycles } = await getCustomerSusuCycleSummary(tenantId, "cust-3");
    expect(cycles).toHaveLength(1);
    expect(cycles[0]!.status).toBe("open");
    expect(cycles[0]!.cancelledAt).toBeNull();
    expect(mockPostedIncome).toHaveLength(0);
  });

  it("renders passbook with red-line cancelled Page #1 and fresh Page #2 carrying BBF at 0/31 boxes", () => {
    const policy = {
      ...defaultSusuCommissionPolicy("t1"),
      deductionTiming: "withdrawal" as const,
      defaultDailyContributionGhs: 5,
      cycleDays: 31
    };
    const persisted: SusuCustomerCycle[] = [
      {
        id: "cyc-1",
        tenantId: "t1",
        customerId: "c1",
        branchId: "b1",
        policyId: "p1",
        policyVersion: 1,
        cycleNumber: 1,
        status: "closed",
        dailyContributionAmount: 5,
        cycleDays: 31,
        commissionBasis: "first_day",
        commissionAgreedAmount: 5,
        deductionTiming: "withdrawal",
        rolloverTreatment: "defer",
        partialAllocation: "commission_first",
        earlyWithdrawalPolicy: "deduct_full",
        grossContributions: 110,
        customerSavingsCredited: 110,
        commissionEarned: 5,
        commissionCollected: 5,
        commissionOutstanding: 0,
        withdrawnAmount: 35,
        balanceBroughtForward: 0,
        bbfWithdrawn: 0,
        collectionsCount: 1,
        contributionDays: 22,
        firstCollectionAt: "2026-11-01T09:00:00.000Z",
        openedAt: "2026-11-01T09:00:00.000Z",
        maturedAt: null,
        closedAt: "2026-11-10T12:00:00.000Z",
        cancelledAt: "2026-11-10T12:00:00.000Z",
        rolledFromCycleId: null,
        createdAt: "2026-11-01T09:00:00.000Z",
        updatedAt: "2026-11-10T12:00:00.000Z"
      },
      {
        id: "cyc-2",
        tenantId: "t1",
        customerId: "c1",
        branchId: "b1",
        policyId: "p1",
        policyVersion: 1,
        cycleNumber: 2,
        status: "open",
        dailyContributionAmount: 5,
        cycleDays: 31,
        commissionBasis: "first_day",
        commissionAgreedAmount: 5,
        deductionTiming: "withdrawal",
        rolloverTreatment: "defer",
        partialAllocation: "commission_first",
        earlyWithdrawalPolicy: "deduct_full",
        grossContributions: 0,
        customerSavingsCredited: 0,
        commissionEarned: 5,
        commissionCollected: 0,
        commissionOutstanding: 5,
        withdrawnAmount: 0,
        balanceBroughtForward: 75,
        bbfWithdrawn: 0,
        collectionsCount: 0,
        contributionDays: 0,
        firstCollectionAt: null,
        openedAt: "2026-11-10T12:00:01.000Z",
        maturedAt: null,
        closedAt: null,
        cancelledAt: null,
        rolledFromCycleId: "cyc-1",
        createdAt: "2026-11-10T12:00:01.000Z",
        updatedAt: "2026-11-10T12:00:01.000Z"
      }
    ];

    const passbook = buildSusuCustomerPassbook({
      customerId: "c1",
      dailyContributionAmount: 5,
      policy,
      cycles: persisted,
      collections: [
        { id: "col-1", grossAmount: 110, ledgerAmount: 110, createdAt: "2026-11-01T09:00:00.000Z" }
      ],
      reconciliation: {
        totalWithdrawalsAndCharges: 35,
        otherCredits: 0,
        accountBalance: 75
      }
    });

    expect(passbook.cards).toHaveLength(2);
    expect(passbook.activeCardNumber).toBe(2);
    expect(passbook.activeBalanceBroughtForward).toBe(75);
    // Page #1 is cancelled at 22/31
    expect(passbook.cards[0]!.cancelled).toBe(true);
    expect(passbook.cards[0]!.status).toBe("closed");
    expect(passbook.cards[0]!.checkedBoxes).toBe(22);
    // Page #2 starts fresh at 0/31 with BBF 75 — BBF must NEVER auto-check boxes
    expect(passbook.cards[1]!.cancelled).toBe(false);
    expect(passbook.cards[1]!.status).toBe("open");
    expect(passbook.cards[1]!.checkedBoxes).toBe(0);
    expect(passbook.cards[1]!.balanceBroughtForward).toBe(75);
    expect(passbook.cards[1]!.bbfRemaining).toBe(75);

    // Next collection after cancellation goes straight into Page #2 Box #1 (NOT Page #1 Box #23)
    const passbookAfterNewDeposit = buildSusuCustomerPassbook({
      customerId: "c1",
      dailyContributionAmount: 5,
      policy,
      cycles: persisted,
      collections: [
        { id: "col-1", grossAmount: 110, ledgerAmount: 110, createdAt: "2026-11-01T09:00:00.000Z" },
        { id: "col-2", grossAmount: 10, ledgerAmount: 10, createdAt: "2026-11-11T09:00:00.000Z" }
      ],
      reconciliation: {
        totalWithdrawalsAndCharges: 35,
        otherCredits: 0,
        accountBalance: 85
      }
    });

    expect(passbookAfterNewDeposit.cards[0]!.checkedBoxes).toBe(22);
    expect(passbookAfterNewDeposit.cards[0]!.cancelled).toBe(true);
    expect(passbookAfterNewDeposit.cards[1]!.checkedBoxes).toBe(2);
    expect(passbookAfterNewDeposit.cards[1]!.balanceBroughtForward).toBe(75);
  });

  it("auto-displays Page #2 with BBF for legacy closed Page #1 that still has remaining account balance", () => {
    const policy = {
      ...defaultSusuCommissionPolicy("t1"),
      deductionTiming: "withdrawal" as const,
      defaultDailyContributionGhs: 5,
      cycleDays: 31
    };
    const legacyClosedCycle: SusuCustomerCycle[] = [
      {
        id: "cyc-legacy-1",
        tenantId: "t1",
        customerId: "sandra",
        branchId: "b1",
        policyId: "p1",
        policyVersion: 4,
        cycleNumber: 1,
        status: "closed",
        dailyContributionAmount: 5,
        cycleDays: 31,
        commissionBasis: "first_day",
        commissionAgreedAmount: 5,
        deductionTiming: "withdrawal",
        rolloverTreatment: "waive",
        partialAllocation: "savings_first",
        earlyWithdrawalPolicy: "deduct_full",
        grossContributions: 50,
        customerSavingsCredited: 50,
        commissionEarned: 5,
        commissionCollected: 5,
        commissionOutstanding: 0,
        withdrawnAmount: 0,
        balanceBroughtForward: 0,
        bbfWithdrawn: 0,
        collectionsCount: 1,
        contributionDays: 10,
        openedAt: "2026-11-23T11:57:49.439Z",
        firstCollectionAt: "2026-11-23T11:57:50.046Z",
        maturedAt: null,
        closedAt: "2026-11-23T13:32:07.251Z",
        cancelledAt: null,
        rolledFromCycleId: null,
        createdAt: "2026-11-23T11:57:49.439Z",
        updatedAt: "2026-11-23T13:32:07.252Z"
      }
    ];

    const passbook = buildSusuCustomerPassbook({
      customerId: "sandra",
      dailyContributionAmount: 5,
      policy,
      cycles: legacyClosedCycle,
      collections: [
        { id: "col-50", grossAmount: 50, ledgerAmount: 50, createdAt: "2026-11-23T11:57:50.649Z" }
      ],
      reconciliation: {
        totalWithdrawalsAndCharges: 35,
        otherCredits: 0,
        accountBalance: 15
      }
    });

    expect(passbook.cards).toHaveLength(2);
    expect(passbook.activeCardNumber).toBe(2);
    expect(passbook.activeBalanceBroughtForward).toBe(15);
    expect(passbook.cards[0]!.cancelled).toBe(true);
    expect(passbook.cards[0]!.checkedBoxes).toBe(10);
    expect(passbook.cards[1]!.cycleNumber).toBe(2);
    expect(passbook.cards[1]!.status).toBe("open");
    expect(passbook.cards[1]!.checkedBoxes).toBe(0);
    expect(passbook.cards[1]!.balanceBroughtForward).toBe(15);
    expect(passbook.cards[1]!.bbfRemaining).toBe(15);
  });

  it("never double-deducts commission when switching from first_collection to withdrawal, and persists notifyCustomerOnCommission", async () => {
    const tenantId = `tenant-switch-${Date.now()}`;
    const ctx = { userId: "admin-1", tenantId, role: "admin", branchId: "br-1" };

    // 1. Start with First collection(s) timing
    await publishSusuCommissionPolicy(ctx, {
      enabled: true,
      dailyContributionMode: "flexible",
      defaultDailyContributionGhs: 10,
      cycleDays: 31,
      commissionBasis: "first_day",
      commissionFixedAmount: 10,
      commissionPercent: 0,
      deductionTiming: "first_collection",
      rolloverTreatment: "defer",
      partialAllocation: "commission_first",
      earlyWithdrawalPolicy: "deduct_full",
      notifyCustomerOnCommission: true
    });

    // Customer deposits GHS 100 (fee GHS 10 deducted immediately -> GHS 90 credited to savings)
    const col1 = await applySusuCollectionToCycle(ctx, {
      customerId: "cust-switch-1",
      branchId: "br-1",
      dailyContributionAmount: 10,
      paymentAmount: 100,
      transactionId: "tx-switch-1"
    });
    expect(col1.commissionCollectNow).toBe(10);
    expect(col1.savingsCredit).toBe(90);

    // 2. Admin switches policy to Customer withdrawal & turns OFF customer commission SMS
    const switched = await publishSusuCommissionPolicy(ctx, {
      enabled: true,
      dailyContributionMode: "flexible",
      defaultDailyContributionGhs: 10,
      cycleDays: 31,
      commissionBasis: "first_day",
      commissionFixedAmount: 10,
      commissionPercent: 0,
      deductionTiming: "withdrawal",
      rolloverTreatment: "defer",
      partialAllocation: "commission_first",
      earlyWithdrawalPolicy: "deduct_full",
      notifyCustomerOnCommission: false
    });
    expect(switched.deductionTiming).toBe("withdrawal");
    expect(switched.notifyCustomerOnCommission).toBe(false);

    // 3. Customer withdraws from the already-charged card -> ZERO double-deduction!
    const wd = await resolveSusuWithdrawalCommission(ctx, {
      customerId: "cust-switch-1",
      branchId: "br-1",
      requestedWithdrawalAmount: 50,
      transactionId: "tx-switch-wd-1"
    });
    expect(wd.blocked).toBe(false);
    expect(wd.commissionToCollect).toBe(0);

    // 4. New customer starting AFTER the switch gets deferred fee (0 taken on deposit)
    const colNew = await applySusuCollectionToCycle(ctx, {
      customerId: "cust-switch-2",
      branchId: "br-1",
      dailyContributionAmount: 10,
      paymentAmount: 100,
      transactionId: "tx-switch-2"
    });
    expect(colNew.commissionCollectNow).toBe(0);
    expect(colNew.savingsCredit).toBe(100);
  });
});
