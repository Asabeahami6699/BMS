import { beforeEach, describe, expect, it, vi } from "vitest";
import { SUSU_COMMISSION_DEBIT_TAG } from "@bms/shared";

const notifyTxCalls: Array<Record<string, unknown>> = [];
const scheduleCommCalls: Array<Record<string, unknown>> = [];
const postedIncomeCalls: Array<{ branchId: string; amount: number; source?: string }> = [];

vi.mock("../config/supabaseClient.js", () => ({
  getSupabaseAdminClient: () => null
}));

vi.mock("./branchService.js", () => ({
  listBranches: async () => [
    { id: "branch-1", name: "Main Branch", code: "MAIN" },
    { id: "branch-2", name: "Akropong", code: "AKP" }
  ]
}));

vi.mock("./institutionalIncomeService.js", () => ({
  postInstitutionalIncome: async (
    _ctx: unknown,
    input: { branchId: string; amount: number; source?: string }
  ) => {
    postedIncomeCalls.push({
      branchId: input.branchId,
      amount: input.amount,
      source: input.source
    });
  },
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

import { updateApprovalWorkflow } from "./approvalWorkflowService.js";
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
    postedIncomeCalls.length = 0;
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

  it("credits Susu withdrawal commission to home branch on cross-branch payout and enforces policy toggle", async () => {
    const tenantId = `tenant-xbranch-${Date.now()}`;
    const adminCtx = {
      userId: "admin-1",
      tenantId,
      role: "admin",
      scopeType: "head_office" as const,
      branchId: "branch-1"
    };
    const branchBTellerCtx = {
      userId: "teller-b",
      tenantId,
      role: "teller",
      scopeType: "branch" as const,
      branchId: "branch-2"
    };

    await publishSusuCommissionPolicy(adminCtx, {
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
      fullName: "Cross Branch Customer",
      phone: "0545276370",
      location: "Accra",
      houseNumber: "20",
      dateOfBirth: "1991-03-11",
      occupation: "Trader",
      homeBranchId: "branch-1",
      accountType: "susu",
      idCardNumber: "GHA-XB-001",
      idCardPhotoUrl: FAKE_ID_CARD_PHOTO,
      nextOfKin: { fullName: "Kin Three", phone: "0244000003", location: "Accra", houseNumber: "20" },
      dailyContributionAmount: 5
    });
    const customer = await approveCustomerRegistration(tenantId, submitted.id, "admin-1");

    // Deposit GHS 310 at home branch (branch-1) -> fills Page #1 & Page #2.
    await createTransaction(
      adminCtx,
      {
        customerId: customer.id,
        type: "deposit",
        amount: 310,
        transactionBranchId: "branch-1"
      },
      { skipBranchFloat: true }
    );

    postedIncomeCalls.length = 0;

    // 1. Default policy (allowCrossBranchWithdrawals: true): Branch B teller pays out GHS 100.
    const wdTx = await createTransaction(
      branchBTellerCtx,
      {
        customerId: customer.id,
        type: "withdrawal",
        amount: 100,
        transactionBranchId: "branch-2"
      },
      { skipBranchFloat: true }
    );
    expect(wdTx.transactionBranchId).toBe("branch-2");
    expect(wdTx.homeBranchId).toBe("branch-1");
    // Commission income is attributed to customer's home branch (branch-1), not paying branch (branch-2).
    expect(postedIncomeCalls).toHaveLength(1);
    expect(postedIncomeCalls[0]?.branchId).toBe("branch-1");
    expect(postedIncomeCalls[0]?.amount).toBe(5);

    // 2. Disable cross-branch withdrawals -> Branch B teller cannot withdraw for Branch A customer.
    await updateApprovalWorkflow(tenantId, {
      registrationApproverRoles: ["admin", "coordinator"],
      withdrawalApproverRoles: ["admin", "coordinator", "customer_service"],
      allowCrossBranchWithdrawals: false
    });

    await expect(
      createTransaction(
        branchBTellerCtx,
        {
          customerId: customer.id,
          type: "withdrawal",
          amount: 50,
          transactionBranchId: "branch-2"
        },
        { skipBranchFloat: true }
      )
    ).rejects.toThrow(/Cross-branch withdrawals are disabled/i);

    // Deposits at Branch B remain allowed even when cross-branch withdrawals are disabled.
    const depTx = await createTransaction(
      branchBTellerCtx,
      {
        customerId: customer.id,
        type: "deposit",
        amount: 20,
        transactionBranchId: "branch-2"
      },
      { skipBranchFloat: true }
    );
    expect(depTx.transactionBranchId).toBe("branch-2");
    expect(depTx.homeBranchId).toBe("branch-1");
  });

  it("enforces mandatory verification on Simplified KYC withdrawals and tenant verification modes (never on deposits)", async () => {
    const tenantId = `tenant-verify-${Date.now()}`;
    const adminCtx = {
      userId: "admin-1",
      tenantId,
      role: "admin" as const,
      scopeType: "head_office" as const,
      branchId: "branch-1",
      permissions: [
        "transactions.read",
        "transactions.create.deposit",
        "transactions.create.daily_susu",
        "transactions.create.withdrawal"
      ]
    };

    const fullSubmitted = await submitCustomerRegistration(tenantId, "agent-1", "branch-1", {
      fullName: "Full KYC Member",
      phone: "0244888001",
      location: "Accra",
      houseNumber: "1",
      dateOfBirth: "1990-01-01",
      occupation: "Trader",
      nationality: "Ghanaian",
      homeBranchId: "branch-1",
      accountType: "susu",
      idCardNumber: "GHA-FULL-001",
      idCardPhotoUrl: FAKE_ID_CARD_PHOTO,
      nextOfKin: { fullName: "Kin Full", phone: "0244000011", location: "Accra", houseNumber: "2" },
      dailyContributionAmount: 10
    });
    const fullCustomer = await approveCustomerRegistration(tenantId, fullSubmitted.id, "admin-1");

    const simpSubmitted = await submitCustomerRegistration(tenantId, "agent-1", "branch-1", {
      fullName: "Simplified KYC Member",
      phone: "0244888002",
      location: "Accra",
      houseNumber: "3",
      dateOfBirth: "1992-01-01",
      occupation: "Vendor",
      nationality: "Ghanaian",
      homeBranchId: "branch-1",
      accountType: "susu",
      idCardType: "no_id_simplified_kyc",
      photoUrl: FAKE_ID_CARD_PHOTO,
      kycIntroducer: {
        fullName: "Introducer One",
        phone: "0244111222",
        relationship: "Market leader",
        ghanaCardNumber: "GHA-123456789-0"
      },
      nextOfKin: { fullName: "Kin Simp", phone: "0244000012", location: "Accra", houseNumber: "4" },
      dailyContributionAmount: 10
    });
    const simplifiedCustomer = await approveCustomerRegistration(tenantId, simpSubmitted.id, "admin-1");

    // Set tenant mode to "always" — deposits MUST still succeed without verification for both Full & Simplified KYC.
    await updateApprovalWorkflow(tenantId, {
      registrationApproverRoles: ["admin", "coordinator"],
      withdrawalApproverRoles: ["admin", "coordinator", "customer_service"],
      allowCrossBranchWithdrawals: true,
      withdrawalVerificationMode: "always"
    });

    await createTransaction(
      adminCtx,
      {
        customerId: fullCustomer.id,
        type: "deposit",
        amount: 200,
        transactionBranchId: "branch-1"
      },
      { skipBranchFloat: true }
    );
    await createTransaction(
      adminCtx,
      {
        customerId: simplifiedCustomer.id,
        type: "deposit",
        amount: 200,
        transactionBranchId: "branch-1"
      },
      { skipBranchFloat: true }
    );

    // Full KYC withdrawal under "always" fails without customerIdentityVerified, succeeds with it.
    await expect(
      createTransaction(
        adminCtx,
        {
          customerId: fullCustomer.id,
          type: "withdrawal",
          amount: 20,
          transactionBranchId: "branch-1"
        },
        { skipBranchFloat: true }
      )
    ).rejects.toThrow(/requires customer verification/i);

    const verifiedFullWd = await createTransaction(
      adminCtx,
      {
        customerId: fullCustomer.id,
        type: "withdrawal",
        amount: 20,
        transactionBranchId: "branch-1",
        customerIdentityVerified: true
      },
      { skipBranchFloat: true }
    );
    expect(verifiedFullWd.workflowData?.customerIdentityVerified).toBe(true);

    // Switch tenant mode to "cross_branch_only": home-branch Full KYC succeeds without flag, cross-branch fails without flag.
    await updateApprovalWorkflow(tenantId, {
      registrationApproverRoles: ["admin", "coordinator"],
      withdrawalApproverRoles: ["admin", "coordinator", "customer_service"],
      allowCrossBranchWithdrawals: true,
      withdrawalVerificationMode: "cross_branch_only"
    });

    await createTransaction(
      adminCtx,
      {
        customerId: fullCustomer.id,
        type: "withdrawal",
        amount: 10,
        transactionBranchId: "branch-1"
      },
      { skipBranchFloat: true }
    );

    await expect(
      createTransaction(
        adminCtx,
        {
          customerId: fullCustomer.id,
          type: "withdrawal",
          amount: 10,
          transactionBranchId: "branch-2"
        },
        { skipBranchFloat: true }
      )
    ).rejects.toThrow(/Inter-branch withdrawals require customer verification/i);

    // Switch tenant mode to "optional": Simplified KYC STILL MUST be verified on home-branch withdrawals!
    await updateApprovalWorkflow(tenantId, {
      registrationApproverRoles: ["admin", "coordinator"],
      withdrawalApproverRoles: ["admin", "coordinator", "customer_service"],
      allowCrossBranchWithdrawals: true,
      withdrawalVerificationMode: "optional"
    });

    await expect(
      createTransaction(
        adminCtx,
        {
          customerId: simplifiedCustomer.id,
          type: "withdrawal",
          amount: 20,
          transactionBranchId: "branch-1"
        },
        { skipBranchFloat: true }
      )
    ).rejects.toThrow(/Tier 1 Simplified KYC accounts must be verified before withdrawal/i);

    const verifiedSimpWd = await createTransaction(
      adminCtx,
      {
        customerId: simplifiedCustomer.id,
        type: "withdrawal",
        amount: 20,
        transactionBranchId: "branch-1",
        customerIdentityVerified: true
      },
      { skipBranchFloat: true }
    );
    expect(verifiedSimpWd.workflowData?.customerIdentityVerified).toBe(true);
  });
});
