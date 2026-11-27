import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import {
  defaultSusuCommissionPolicy,
  SAVINGS_INITIAL_DEPOSIT_GHS,
  type SusuCommissionDeductionTiming
} from "@bms/shared";

vi.mock("../config/supabaseClient.js", () => ({
  getSupabaseAdminClient: () => null
}));

import { createApp } from "../app.js";
import { publishSusuCommissionPolicy } from "./susuCycleCommissionService.js";
import { computeCustomerBalance } from "./ledgerService.js";
import { getCustomerById, getCustomerWithdrawableBalance } from "./customerService.js";
import * as customerNotificationService from "./customerNotificationService.js";
import * as customerSmsService from "./customerSmsService.js";
import * as customerEmailService from "./customerEmailService.js";

const app = createApp();

const BRANCH_ID = "branch-a";
const FAKE_ID_PHOTO = "data:image/png;base64,iVBORw0KGgo=";

function agentHeaders(tenantId: string) {
  return {
    "x-user-id": "agent-savings-1",
    "x-tenant-id": tenantId,
    "x-role": "field_agent",
    "x-scope-type": "branch",
    "x-branch-id": BRANCH_ID
  };
}

function coordinatorHeaders(tenantId: string) {
  return {
    "x-user-id": "coordinator-savings-1",
    "x-tenant-id": tenantId,
    "x-role": "coordinator",
    "x-scope-type": "head_office"
  };
}

function adminHeaders(tenantId: string) {
  return {
    "x-user-id": "admin-savings-1",
    "x-tenant-id": tenantId,
    "x-role": "admin",
    "x-scope-type": "head_office"
  };
}

function savingsRegistrationBody(name: string, phone: string, idCard: string, initialDepositAmount?: number) {
  return {
    fullName: name,
    phone,
    location: "Accra",
    houseNumber: "14",
    dateOfBirth: "1993-04-12",
    occupation: "Trader",
    accountType: "savings",
    idCardNumber: idCard,
    idCardPhotoUrl: FAKE_ID_PHOTO,
    ...(initialDepositAmount !== undefined ? { initialDepositAmount } : {}),
    nextOfKin: {
      fullName: `${name} Kin`,
      phone: "0244000099",
      location: "Accra",
      houseNumber: "14"
    },
    dailyContributionAmount: 0
  };
}

async function setDeductionTiming(tenantId: string, deductionTiming: SusuCommissionDeductionTiming) {
  const base = defaultSusuCommissionPolicy(tenantId);
  await publishSusuCommissionPolicy(
    { userId: "admin-1", tenantId, role: "admin" },
    { ...base, deductionTiming }
  );
}

describe("savings initial deposit & locked_balance based on Commission Settings timing", () => {
  it("rejects savings registration when initial deposit is below the locked minimum", async () => {
    const tenantId = `tenant-sav-min-${Date.now()}`;

    const missingDeposit = await request(app)
      .post("/api/v1/customers/registrations")
      .set(agentHeaders(tenantId))
      .send(savingsRegistrationBody("No Deposit", "0244700001", "GHA-SAV-001"));
    expect(missingDeposit.status).toBe(400);

    const tooSmall = await request(app)
      .post("/api/v1/customers/registrations")
      .set(agentHeaders(tenantId))
      .send(savingsRegistrationBody("Small Deposit", "0244700002", "GHA-SAV-002", 10));
    expect(tooSmall.status).toBe(400);
    expect(String(tooSmall.body.error ?? tooSmall.body.message)).toMatch(/at least GHS 20/i);
  });

  it("credits full initial deposit after approval and locks minimum immediately for first_collection", async () => {
    const tenantId = `tenant-sav-fc-${Date.now()}`;
    await setDeductionTiming(tenantId, "first_collection");

    const reg = await request(app)
      .post("/api/v1/customers/registrations")
      .set(agentHeaders(tenantId))
      .send(savingsRegistrationBody("Akua Savings", "0244700010", "GHA-SAV-010", 100));
    expect(reg.status, JSON.stringify(reg.body)).toBe(201);
    const customerId = String(reg.body.id);

    // Must NOT be credited while pending_activation
    expect(await computeCustomerBalance(tenantId, customerId)).toBe(0);

    const approve = await request(app)
      .patch(`/api/v1/customers/${customerId}/approve`)
      .set(coordinatorHeaders(tenantId));
    expect(approve.status, JSON.stringify(approve.body)).toBe(200);
    expect(approve.body.accountNumber).toBeTruthy();
    expect(approve.body.initialDepositAmount).toBe(100);
    expect(approve.body.lockedBalance).toBe(SAVINGS_INITIAL_DEPOSIT_GHS);
    expect(approve.body.savingsLockTiming).toBe("first_collection");

    // Full GHS 100 credited, GHS 20 locked, GHS 80 withdrawable
    expect(await computeCustomerBalance(tenantId, customerId)).toBe(100);
    expect(await getCustomerWithdrawableBalance(tenantId, customerId)).toBe(80);

    // Attempting to withdraw 85 fails
    const overWd = await request(app)
      .post("/api/v1/transactions")
      .set(adminHeaders(tenantId))
      .set("Idempotency-Key", `sav-fc-over-${Date.now()}`)
      .send({
        customerId,
        type: "withdrawal",
        amount: 85,
        transactionBranchId: BRANCH_ID
      });
    expect(overWd.status).toBe(400);
    expect(String(overWd.body.error)).toMatch(/Insufficient withdrawable balance/i);

    // Withdrawing 80 succeeds, leaving 20 locked
    const okWd = await request(app)
      .post("/api/v1/transactions")
      .set(adminHeaders(tenantId))
      .set("Idempotency-Key", `sav-fc-ok-${Date.now()}`)
      .send({
        customerId,
        type: "withdrawal",
        amount: 80,
        transactionBranchId: BRANCH_ID
      });
    expect(okWd.status, JSON.stringify(okWd.body)).toBe(201);
    expect(await computeCustomerBalance(tenantId, customerId)).toBe(20);
    expect(await getCustomerWithdrawableBalance(tenantId, customerId)).toBe(0);
  });

  it("treats cycle_maturity like first_collection (locks immediately on approval)", async () => {
    const tenantId = `tenant-sav-cm-${Date.now()}`;
    await setDeductionTiming(tenantId, "cycle_maturity");

    const reg = await request(app)
      .post("/api/v1/customers/registrations")
      .set(agentHeaders(tenantId))
      .send(savingsRegistrationBody("Yaw Maturity", "0244700020", "GHA-SAV-020", 120));
    expect(reg.status).toBe(201);
    const customerId = String(reg.body.id);

    const approve = await request(app)
      .patch(`/api/v1/customers/${customerId}/approve`)
      .set(coordinatorHeaders(tenantId));
    expect(approve.status).toBe(200);
    expect(approve.body.accountNumber).toBeTruthy();
    expect(approve.body.lockedBalance).toBe(SAVINGS_INITIAL_DEPOSIT_GHS);
    expect(approve.body.savingsLockTiming).toBe("cycle_maturity");
    expect(await computeCustomerBalance(tenantId, customerId)).toBe(120);
    expect(await getCustomerWithdrawableBalance(tenantId, customerId)).toBe(100);
  });

  it("defers locked_balance until first withdrawal when Commission Settings timing is withdrawal", async () => {
    const tenantId = `tenant-sav-wd-${Date.now()}`;
    await setDeductionTiming(tenantId, "withdrawal");

    const reg = await request(app)
      .post("/api/v1/customers/registrations")
      .set(agentHeaders(tenantId))
      .send(savingsRegistrationBody("Efua Deferred", "0244700030", "GHA-SAV-030", 100));
    expect(reg.status).toBe(201);
    const customerId = String(reg.body.id);

    const approve = await request(app)
      .patch(`/api/v1/customers/${customerId}/approve`)
      .set(coordinatorHeaders(tenantId));
    expect(approve.status).toBe(200);
    expect(approve.body.accountNumber).toBeTruthy();
    // Initial deposit of 100 credited; locked_balance starts at 0 until customer withdraws
    expect(approve.body.lockedBalance).toBe(0);
    expect(approve.body.savingsLockTiming).toBe("withdrawal");
    expect(approve.body.savingsLockTargetAmount).toBe(SAVINGS_INITIAL_DEPOSIT_GHS);
    expect(await computeCustomerBalance(tenantId, customerId)).toBe(100);
    expect(await getCustomerWithdrawableBalance(tenantId, customerId)).toBe(80);

    // Later deposit of 50 is credited in FULL (never double-deducted as an opening fee)
    const dep = await request(app)
      .post("/api/v1/transactions")
      .set(adminHeaders(tenantId))
      .set("Idempotency-Key", `sav-wd-dep-${Date.now()}`)
      .send({
        customerId,
        type: "deposit",
        amount: 50,
        transactionBranchId: BRANCH_ID
      });
    expect(dep.status, JSON.stringify(dep.body)).toBe(201);
    expect(dep.body.amount).toBe(50);
    expect(await computeCustomerBalance(tenantId, customerId)).toBe(150);
    expect(await getCustomerWithdrawableBalance(tenantId, customerId)).toBe(130);

    // Still lockedBalance = 0 before first withdrawal
    const beforeWd = await getCustomerById(tenantId, customerId);
    expect(beforeWd?.lockedBalance).toBe(0);

    // Trying to withdraw 140 (> 130) is blocked
    const overWd = await request(app)
      .post("/api/v1/transactions")
      .set(adminHeaders(tenantId))
      .set("Idempotency-Key", `sav-wd-over-${Date.now()}`)
      .send({
        customerId,
        type: "withdrawal",
        amount: 140,
        transactionBranchId: BRANCH_ID
      });
    expect(overWd.status).toBe(400);
    expect(String(overWd.body.error)).toMatch(/minimum savings locked balance/i);

    // Withdrawing 130 succeeds and permanently locks GHS 20 on the account
    const okWd = await request(app)
      .post("/api/v1/transactions")
      .set(adminHeaders(tenantId))
      .set("Idempotency-Key", `sav-wd-ok-${Date.now()}`)
      .send({
        customerId,
        type: "withdrawal",
        amount: 130,
        transactionBranchId: BRANCH_ID
      });
    expect(okWd.status, JSON.stringify(okWd.body)).toBe(201);

    const afterWd = await getCustomerById(tenantId, customerId);
    expect(afterWd?.lockedBalance).toBe(SAVINGS_INITIAL_DEPOSIT_GHS);
    expect(await computeCustomerBalance(tenantId, customerId)).toBe(20);
    expect(await getCustomerWithdrawableBalance(tenantId, customerId)).toBe(0);

    // Cannot withdraw remaining GHS 20
    const blockedAfter = await request(app)
      .post("/api/v1/transactions")
      .set(adminHeaders(tenantId))
      .set("Idempotency-Key", `sav-wd-after-${Date.now()}`)
      .send({
        customerId,
        type: "withdrawal",
        amount: 1,
        transactionBranchId: BRANCH_ID
      });
    expect(blockedAfter.status).toBe(400);
  });

  it("sends account-opened notification first, followed by the initial deposit credit alert", async () => {
    const tenantId = `tenant-sav-notify-${Date.now()}`;
    const openedSpy = vi
      .spyOn(customerNotificationService, "notifyCustomerAccountOpened")
      .mockResolvedValue(undefined);

    try {
      const reg = await request(app)
        .post("/api/v1/customers/registrations")
        .set(agentHeaders(tenantId))
        .send(savingsRegistrationBody("Kofi Alerts", "0244700040", "GHA-SAV-040", 150));
      expect(reg.status).toBe(201);
      const customerId = String(reg.body.id);

      const approve = await request(app)
        .patch(`/api/v1/customers/${customerId}/approve`)
        .set(coordinatorHeaders(tenantId));
      expect(approve.status).toBe(200);
      expect(approve.body.accountNumber).toBeTruthy();

      expect(openedSpy).toHaveBeenCalledTimes(1);
      const callArg = openedSpy.mock.calls[0]?.[0];
      expect(callArg?.tenantId).toBe(tenantId);
      expect(callArg?.customerId).toBe(customerId);
      expect(callArg?.initialDeposit?.amount).toBe(150);
      expect(callArg?.initialDeposit?.transactionId).toBeTruthy();
    } finally {
      openedSpy.mockRestore();
    }

    // Verify exact dispatch order inside notifyCustomerAccountOpened:
    // Account Opened SMS/Email runs BEFORE the deposit credit SMS/Email.
    const order: string[] = [];
    const openedSmsSpy = vi
      .spyOn(customerSmsService, "notifyCustomerAccountOpenedSms")
      .mockImplementation(async () => {
        order.push("account_opened_sms");
      });
    const openedEmailSpy = vi
      .spyOn(customerEmailService, "notifyCustomerAccountOpenedEmail")
      .mockImplementation(async () => {
        order.push("account_opened_email");
      });
    const txSmsSpy = vi
      .spyOn(customerSmsService, "notifyCustomerTransactionSms")
      .mockImplementation(async (input) => {
        order.push(`deposit_sms:${input.type}:${input.amount}:${input.balanceOverride}`);
      });
    const txEmailSpy = vi
      .spyOn(customerEmailService, "notifyCustomerTransactionEmail")
      .mockImplementation(async (input) => {
        order.push(`deposit_email:${input.type}:${input.amount}:${input.balanceOverride}`);
      });

    try {
      await customerNotificationService.notifyCustomerAccountOpened({
        tenantId,
        customerId: "cust-order-test",
        initialDeposit: { transactionId: "tx-init-1", amount: 150 },
        depositDelayMs: 0
      });
      // Let microtasks flush for the follow-up Promise.allSettled
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(order.slice(0, 2)).toEqual(["account_opened_sms", "account_opened_email"]);
      expect(order.slice(2)).toEqual([
        "deposit_sms:deposit:150:150",
        "deposit_email:deposit:150:150"
      ]);
    } finally {
      openedSmsSpy.mockRestore();
      openedEmailSpy.mockRestore();
      txSmsSpy.mockRestore();
      txEmailSpy.mockRestore();
    }
  });
});
