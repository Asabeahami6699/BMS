import request from "supertest";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { createApp } from "./app.js";
import { resolveTestBranchId } from "./testHelpers.js";

const app = createApp();
let testBranchId = "branch-a";

vi.setConfig({ testTimeout: 20000 });

function authHeaders(role: string, scopeType: "head_office" | "branch", branchId = testBranchId) {
  return {
    "x-user-id": `test-${role}`,
    "x-tenant-id": "tenant-demo",
    "x-role": role,
    "x-scope-type": scopeType,
    "x-branch-id": branchId
  };
}

describe("money route safeguards", () => {
  beforeAll(async () => {
    testBranchId = await resolveTestBranchId(app, authHeaders("admin", "head_office"));
  });

  it("rejects transaction post without idempotency key", async () => {
    const createCustomerRes = await request(app)
      .post("/api/v1/customers")
      .set(authHeaders("admin", "head_office"))
      .send({
        fullName: "Test Customer One",
        phone: "0500000000",
        homeBranchId: testBranchId,
        assignedFieldAgentId: "test-field_agent",
        dailyContributionAmount: 20
      });

    expect(createCustomerRes.status).toBe(201);
    const customerId = createCustomerRes.body.id as string;

    const txRes = await request(app)
      .post("/api/v1/transactions")
      .set(authHeaders("field_agent", "branch", testBranchId))
      .send({
        customerId,
        type: "deposit",
        amount: 10,
        transactionBranchId: testBranchId
      });

    expect(txRes.status).toBe(400);
    expect(txRes.body.error).toContain("Idempotency-Key");
  });

  it("rejects branch user posting outside assigned branch", async () => {
    const createCustomerRes = await request(app)
      .post("/api/v1/customers")
      .set(authHeaders("admin", "head_office"))
      .send({
        fullName: "Test Customer Two",
        phone: "0500000001",
        homeBranchId: testBranchId,
        assignedFieldAgentId: "test-field_agent",
        dailyContributionAmount: 20
      });

    expect(createCustomerRes.status).toBe(201);
    const customerId = createCustomerRes.body.id as string;

    const otherBranch =
      testBranchId === "branch-a" ? "branch-b" : "00000000-0000-0000-0000-000000000099";

    const txRes = await request(app)
      .post("/api/v1/transactions")
      .set(authHeaders("admin", "branch", testBranchId))
      .set("Idempotency-Key", "tx-branch-mismatch")
      .send({
        customerId,
        type: "deposit",
        amount: 10,
        transactionBranchId: otherBranch
      });

    expect(txRes.status).toBe(400);
    expect(txRes.body.error).toContain("outside assigned branch");
  });

  it("rejects withdrawal when balance is insufficient", async () => {
    const createCustomerRes = await request(app)
      .post("/api/v1/customers")
      .set(authHeaders("admin", "head_office"))
      .send({
        fullName: "Test Customer Three",
        phone: "0500000002",
        homeBranchId: testBranchId,
        assignedFieldAgentId: "test-field_agent",
        dailyContributionAmount: 20
      });

    expect(createCustomerRes.status).toBe(201);
    const customerId = createCustomerRes.body.id as string;

    const txRes = await request(app)
      .post("/api/v1/transactions")
      .set(authHeaders("admin", "branch", testBranchId))
      .set("Idempotency-Key", "tx-insufficient-withdrawal")
      .send({
        customerId,
        type: "withdrawal",
        amount: 99,
        transactionBranchId: testBranchId
      });

    expect(txRes.status).toBe(400);
    expect(txRes.body.error).toContain("Insufficient withdrawable balance");
  });
});
