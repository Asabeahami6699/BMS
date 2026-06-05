import request from "supertest";
import { beforeAll, describe, expect, it } from "vitest";
import { SAVINGS_INITIAL_DEPOSIT_GHS } from "@bms/shared";
import { createApp } from "./app.js";
import { resolveTestBranchId } from "./testHelpers.js";

const app = createApp();

const AGENT_ID = "test-field-agent-1";
const FAKE_ID_CARD_PHOTO = "data:image/png;base64,iVBORw0KGgo=";
let branchId = "branch-a";

function agentHeaders() {
  return {
    "x-user-id": AGENT_ID,
    "x-tenant-id": "tenant-demo",
    "x-role": "field_agent",
    "x-scope-type": "branch",
    "x-branch-id": branchId
  };
}

function coordinatorHeaders() {
  return {
    "x-user-id": "test-coordinator",
    "x-tenant-id": "tenant-demo",
    "x-role": "coordinator",
    "x-scope-type": "head_office"
  };
}

describe("field agent flows", () => {
  beforeAll(async () => {
    branchId = await resolveTestBranchId(app, coordinatorHeaders());
  });

  it("submits registration pending approval", async () => {
    const res = await request(app)
      .post("/api/v1/customers/registrations")
      .set(agentHeaders())
      .send({
        fullName: "Agent Reg Customer",
        phone: "0244111222",
        location: "Kumasi",
        houseNumber: "12",
        accountType: "susu",
        idCardNumber: "GHA-FA-001",
        idCardPhotoUrl: FAKE_ID_CARD_PHOTO,
        nextOfKin: {
          fullName: "Kin Person",
          phone: "0244333444",
          location: "Kumasi",
          houseNumber: "12"
        },
        dailyContributionAmount: 25
      });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe("pending_activation");
    expect(res.body.createdByFieldAgentId).toBe(AGENT_ID);
    expect(res.body.accountNumber).toBeUndefined();
  });

  it("lists only the agent's customers", async () => {
    const res = await request(app).get("/api/v1/customers").set(agentHeaders());
    expect(res.status).toBe(200);
    const rows = res.body as Array<{ createdByFieldAgentId: string; assignedFieldAgentId: string }>;
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(
        row.createdByFieldAgentId === AGENT_ID || row.assignedFieldAgentId === AGENT_ID
      ).toBe(true);
    }
  });

  it("approves registration then agent can collect daily susu", async () => {
    const reg = await request(app)
      .post("/api/v1/customers/registrations")
      .set(agentHeaders())
      .send({
        fullName: "Collect Test Customer",
        phone: "0244999888",
        location: "Accra",
        houseNumber: "9",
        accountType: "susu",
        idCardNumber: "GHA-FA-002",
        idCardPhotoUrl: FAKE_ID_CARD_PHOTO,
        nextOfKin: {
          fullName: "Kin Two",
          phone: "0244777666",
          location: "Accra"
        },
        dailyContributionAmount: 15
      });
    expect(reg.status).toBe(201);
    const customerId = reg.body.id as string;

    const approve = await request(app)
      .patch(`/api/v1/customers/${customerId}/approve`)
      .set(coordinatorHeaders());
    expect(approve.status).toBe(200);
    expect(approve.body.accountNumber).toBeTruthy();
    expect(approve.body.accountNumber).toMatch(/^\d{12}$/);
    expect(approve.body.accountNumber.startsWith("233000")).toBe(true);

    const search = await request(app)
      .get("/api/v1/customers/search?q=Collect%20Test")
      .set(agentHeaders());
    expect(search.status).toBe(200);
    expect((search.body as unknown[]).length).toBeGreaterThan(0);

    const tx = await request(app)
      .post("/api/v1/transactions")
      .set(agentHeaders())
      .set("Idempotency-Key", "fa-collect-1")
      .send({
        customerId,
        type: "daily_susu",
        amount: 15,
        transactionBranchId: branchId
      });
    expect(tx.status).toBe(201);
  });

  it("rejects collection for pending customer", async () => {
    const reg = await request(app)
      .post("/api/v1/customers/registrations")
      .set(agentHeaders())
      .send({
        fullName: "Pending Only",
        phone: "0244888777",
        location: "Tema",
        houseNumber: "1",
        accountType: "susu",
        idCardNumber: "GHA-FA-003",
        idCardPhotoUrl: FAKE_ID_CARD_PHOTO,
        nextOfKin: { fullName: "Kin", phone: "0244000000", location: "Tema" },
        dailyContributionAmount: 10
      });
    const customerId = reg.body.id as string;

    const tx = await request(app)
      .post("/api/v1/transactions")
      .set(agentHeaders())
      .set("Idempotency-Key", "fa-collect-pending")
      .send({
        customerId,
        type: "daily_susu",
        amount: 10,
        transactionBranchId: branchId
      });
    expect(tx.status).toBe(400);
    expect(tx.body.error).toContain("not active");
  });

  it("balance request: agent requests, coordinator approves, agent sees balance for 6h", async () => {
    const reg = await request(app)
      .post("/api/v1/customers/registrations")
      .set(agentHeaders())
      .send({
        fullName: "Balance Test Customer",
        phone: "0244555666",
        location: "Accra",
        houseNumber: "3",
        accountType: "susu",
        idCardNumber: "GHA-FA-BAL",
        idCardPhotoUrl: FAKE_ID_CARD_PHOTO,
        nextOfKin: { fullName: "Kin Bal", phone: "0244111000", location: "Accra" },
        dailyContributionAmount: 20
      });
    expect(reg.status).toBe(201);
    const customerId = reg.body.id as string;

    await request(app)
      .patch(`/api/v1/customers/${customerId}/approve`)
      .set(coordinatorHeaders());

    const req = await request(app)
      .post(`/api/v1/field-agents/me/customers/${customerId}/balance-request`)
      .set(agentHeaders())
      .send({ type: "balance", reason: "Customer asked for their savings balance" });
    expect(req.status).toBe(201);
    expect(req.body.status).toBe("pending");
    expect(req.body.requestReason).toContain("savings balance");

    const pendingCoord = await request(app)
      .get("/api/v1/customers/balance-disclosures/pending")
      .set(coordinatorHeaders());
    expect(pendingCoord.status).toBe(200);
    const row = (pendingCoord.body as Array<{ id: string; customerId: string }>).find(
      (r) => r.customerId === customerId
    );
    expect(row).toBeTruthy();

    const approved = await request(app)
      .patch(`/api/v1/customers/balance-disclosures/${row!.id}/approve`)
      .set(coordinatorHeaders());
    expect(approved.status).toBe(200);
    expect(approved.body.status).toBe("approved");
    expect(typeof approved.body.balanceAmount).toBe("number");
    expect(approved.body.expiresAt).toBeTruthy();

    const agentList = await request(app)
      .get("/api/v1/field-agents/me/balance-disclosures")
      .set(agentHeaders());
    expect(agentList.status).toBe(200);
    const visible = (agentList.body as Array<{ customerId: string; balanceAmount?: number }>).find(
      (r) => r.customerId === customerId
    );
    expect(visible?.balanceAmount).toBe(approved.body.balanceAmount);
  });

  it("agent can re-request balance with a new reason after coordinator declines", async () => {
    const reg = await request(app)
      .post("/api/v1/customers/registrations")
      .set(agentHeaders())
      .send({
        fullName: "Balance Retry Customer",
        phone: "0244333222",
        location: "Tema",
        houseNumber: "2",
        accountType: "susu",
        idCardNumber: "GHA-FA-BAL2",
        idCardPhotoUrl: FAKE_ID_CARD_PHOTO,
        nextOfKin: { fullName: "Kin", phone: "0244222111", location: "Tema" },
        dailyContributionAmount: 10
      });
    const customerId = reg.body.id as string;
    await request(app)
      .patch(`/api/v1/customers/${customerId}/approve`)
      .set(coordinatorHeaders());

    const first = await request(app)
      .post(`/api/v1/field-agents/me/customers/${customerId}/balance-request`)
      .set(agentHeaders())
      .send({ type: "balance", reason: "Customer wants balance check" });
    expect(first.status).toBe(201);

    const pending = await request(app)
      .get("/api/v1/customers/balance-disclosures/pending")
      .set(coordinatorHeaders());
    const row = (pending.body as Array<{ id: string }>)[0];
    expect(row).toBeTruthy();

    const declined = await request(app)
      .patch(`/api/v1/customers/balance-disclosures/${row.id}/reject`)
      .set(coordinatorHeaders())
      .send({ reason: "Try again next week" });
    expect(declined.status).toBe(200);
    expect(declined.body.status).toBe("rejected");

    const retry = await request(app)
      .post(`/api/v1/field-agents/me/customers/${customerId}/balance-request`)
      .set(agentHeaders())
      .send({ type: "balance", reason: "Customer visiting branch tomorrow" });
    expect(retry.status).toBe(201);
    expect(retry.body.status).toBe("pending");
    expect(retry.body.requestReason).toContain("tomorrow");
    expect(retry.body.id).not.toBe(row.id);
  });

  it("agent can request withdrawal pending coordinator approval", async () => {
    const reg = await request(app)
      .post("/api/v1/customers/registrations")
      .set(agentHeaders())
      .send({
        fullName: "Withdrawal Test Customer",
        phone: "0244111333",
        location: "Accra",
        houseNumber: "5",
        accountType: "susu",
        idCardNumber: "GHA-FA-WD",
        idCardPhotoUrl: FAKE_ID_CARD_PHOTO,
        nextOfKin: { fullName: "Kin", phone: "0244000111", location: "Accra" },
        dailyContributionAmount: 25
      });
    const customerId = reg.body.id as string;
    await request(app)
      .patch(`/api/v1/customers/${customerId}/approve`)
      .set(coordinatorHeaders());

    await request(app)
      .post("/api/v1/transactions")
      .set(agentHeaders())
      .set("Idempotency-Key", "fa-wd-fund")
      .send({
        customerId,
        type: "daily_susu",
        amount: 100,
        transactionBranchId: branchId
      });

    const wd = await request(app)
      .post(`/api/v1/field-agents/me/customers/${customerId}/customer-request`)
      .set(agentHeaders())
      .send({
        type: "withdrawal",
        reason: "Customer needs cash for transport",
        amount: 40,
        fulfillmentMode: "next_day_cash"
      });
    expect(wd.status).toBe(201);
    expect(wd.body.requestType).toBe("withdrawal");
    expect(wd.body.withdrawalAmount).toBe(40);

    const pendingCoord = await request(app)
      .get("/api/v1/customers/balance-disclosures/pending")
      .set(coordinatorHeaders());
    const row = (pendingCoord.body as Array<{ id: string; customerId: string }>).find(
      (r) => r.customerId === customerId
    );
    expect(row).toBeTruthy();

    const approved = await request(app)
      .patch(`/api/v1/customers/balance-disclosures/${row!.id}/approve`)
      .set(coordinatorHeaders());
    expect(approved.status).toBe(200);
    expect(approved.body.status).toBe("approved");
    expect(approved.body.balanceAmount).toBe(60);

    const ledger = await request(app)
      .get(`/api/v1/ledger/customers/${customerId}`)
      .set(coordinatorHeaders());
    expect(ledger.status).toBe(200);
    const entries = ledger.body as Array<{ entryType: string; amount: number; balanceAfter: number }>;
    const last = entries[entries.length - 1];
    expect(last.entryType).toBe("debit");
    expect(last.amount).toBe(40);
    expect(last.balanceAfter).toBe(60);
  });

  it("credits non-withdrawable initial deposit when savings account is approved", async () => {
    const reg = await request(app)
      .post("/api/v1/customers/registrations")
      .set(agentHeaders())
      .send({
        fullName: "Savings Opening Customer",
        phone: "0244222555",
        location: "Tamale",
        houseNumber: "3",
        accountType: "savings",
        idCardNumber: "GHA-FA-SAV",
        idCardPhotoUrl: FAKE_ID_CARD_PHOTO,
        savingsOpeningFeeCollected: false,
        nextOfKin: { fullName: "Kin Sav", phone: "0244333666", location: "Tamale" },
        dailyContributionAmount: 0
      });
    expect(reg.status).toBe(201);
    const customerId = reg.body.id as string;

    const approve = await request(app)
      .patch(`/api/v1/customers/${customerId}/approve`)
      .set(coordinatorHeaders());
    expect(approve.status).toBe(200);
    expect(approve.body.accountType).toBe("savings");
    expect(approve.body.lockedBalance).toBe(SAVINGS_INITIAL_DEPOSIT_GHS);

    const wdBlocked = await request(app)
      .post("/api/v1/transactions")
      .set(agentHeaders())
      .set("Idempotency-Key", "fa-sav-wd-blocked")
      .send({
        customerId,
        type: "withdrawal",
        amount: SAVINGS_INITIAL_DEPOSIT_GHS,
        transactionBranchId: branchId
      });
    expect(wdBlocked.status).toBe(400);
    expect(String(wdBlocked.body.error)).toMatch(/withdrawable/i);

    await request(app)
      .post("/api/v1/transactions")
      .set(agentHeaders())
      .set("Idempotency-Key", "fa-sav-topup")
      .send({
        customerId,
        type: "deposit",
        amount: 30,
        transactionBranchId: branchId
      });

    const wdOk = await request(app)
      .post("/api/v1/transactions")
      .set(agentHeaders())
      .set("Idempotency-Key", "fa-sav-wd-ok")
      .send({
        customerId,
        type: "withdrawal",
        amount: 30,
        transactionBranchId: branchId
      });
    expect(wdOk.status).toBe(201);

    const regDeduct = await request(app)
      .post("/api/v1/customers/registrations")
      .set(agentHeaders())
      .send({
        fullName: "Savings Fee Deduct Customer",
        phone: "0244222666",
        location: "Tamale",
        houseNumber: "8",
        accountType: "savings",
        idCardNumber: "GHA-FA-SAV2",
        idCardPhotoUrl: FAKE_ID_CARD_PHOTO,
        savingsOpeningFeeCollected: false,
        nextOfKin: { fullName: "Kin", phone: "0244000222", location: "Tamale" },
        dailyContributionAmount: 0
      });
    expect(regDeduct.status).toBe(201);
    const deductId = regDeduct.body.id as string;
    await request(app)
      .patch(`/api/v1/customers/${deductId}/approve`)
      .set(coordinatorHeaders());

    const firstCollect = await request(app)
      .post("/api/v1/transactions")
      .set(agentHeaders())
      .set("Idempotency-Key", "fa-sav-fee-deduct")
      .send({
        customerId: deductId,
        type: "deposit",
        amount: 35,
        transactionBranchId: branchId
      });
    expect(firstCollect.status).toBe(201);
    expect(String(firstCollect.body.notes ?? "")).toMatch(/Opening fee/i);
    expect(firstCollect.body.amount).toBe(15);
  });
});
