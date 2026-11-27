import request from "supertest";
import { describe, expect, it, vi } from "vitest";

vi.mock("../config/supabaseClient.js", () => ({
  getSupabaseAdminClient: () => null
}));

import { createApp } from "../app.js";

const app = createApp();
const FAKE_ID_PHOTO = "data:image/png;base64,iVBORw0KGgo=";

function headers(
  tenantId: string,
  role: string,
  opts?: { userId?: string; scopeType?: "head_office" | "branch"; branchId?: string }
) {
  return {
    "x-user-id": opts?.userId ?? `${role}-user-1`,
    "x-tenant-id": tenantId,
    "x-role": role,
    "x-scope-type": opts?.scopeType ?? "head_office",
    ...(opts?.branchId ? { "x-branch-id": opts.branchId } : {})
  };
}

describe("PATCH /api/v1/customers/:customerId (update customer details)", () => {
  it("allows admin/coordinator/customer_service to update editable details while keeping account number and lock intact", async () => {
    const tenantId = `tenant-edit-cust-${Date.now()}`;
    const branchId = "branch-a";

    const reg = await request(app)
      .post("/api/v1/customers/registrations")
      .set(headers(tenantId, "field_agent", { userId: "agent-1", scopeType: "branch", branchId }))
      .send({
        fullName: "Original Name",
        phone: "0244111000",
        location: "Accra",
        houseNumber: "10",
        dateOfBirth: "1991-02-10",
        occupation: "Trader",
        accountType: "savings",
        idCardNumber: "GHA-111-111",
        idCardPhotoUrl: FAKE_ID_PHOTO,
        initialDepositAmount: 100,
        nextOfKin: {
          fullName: "Old Kin",
          phone: "0244000111",
          location: "Accra",
          houseNumber: "10"
        },
        dailyContributionAmount: 0
      });
    expect(reg.status, JSON.stringify(reg.body)).toBe(201);
    const customerId = String(reg.body.id);

    const approve = await request(app)
      .patch(`/api/v1/customers/${customerId}/approve`)
      .set(headers(tenantId, "coordinator"));
    expect(approve.status).toBe(200);
    const originalAccountNumber = approve.body.accountNumber;
    const originalLockedBalance = approve.body.lockedBalance;

    // Update customer details as coordinator
    const patch = await request(app)
      .patch(`/api/v1/customers/${customerId}`)
      .set(headers(tenantId, "coordinator"))
      .send({
        fullName: "Updated Full Name",
        phone: "0555999888",
        email: "updated@example.com",
        location: "Kumasi",
        houseNumber: "AK-456-7890",
        occupation: "Pharmacist",
        nationality: "Ghanaian",
        idCardType: "passport",
        idCardNumber: "G1234567",
        nextOfKin: {
          fullName: "New Kin",
          phone: "0200123456",
          location: "Kumasi",
          houseNumber: "AK-456-7890"
        },
        assignedFieldAgentId: "agent-2"
      });
    expect(patch.status, JSON.stringify(patch.body)).toBe(200);
    expect(patch.body.fullName).toBe("Updated Full Name");
    expect(patch.body.phone).toBe("0555999888");
    expect(patch.body.email).toBe("updated@example.com");
    expect(patch.body.location).toBe("Kumasi");
    expect(patch.body.houseNumber).toBe("AK-456-7890");
    expect(patch.body.occupation).toBe("Pharmacist");
    expect(patch.body.nationality).toBe("Ghanaian");
    expect(patch.body.idCardType).toBe("passport");
    expect(patch.body.idCardNumber).toBe("G1234567");
    expect(patch.body.nextOfKin?.fullName).toBe("New Kin");
    expect(patch.body.assignedFieldAgentId).toBe("agent-2");

    // Immutable accounting fields must remain untouched
    expect(patch.body.accountNumber).toBe(originalAccountNumber);
    expect(patch.body.accountType).toBe("savings");
    expect(patch.body.lockedBalance).toBe(originalLockedBalance);
    expect(patch.body.status).toBe("active");

    // Customer Service role is also permitted
    const csPatch = await request(app)
      .patch(`/api/v1/customers/${customerId}`)
      .set(headers(tenantId, "customer_service"))
      .send({ occupation: "Senior Pharmacist" });
    expect(csPatch.status, JSON.stringify(csPatch.body)).toBe(200);
    expect(csPatch.body.occupation).toBe("Senior Pharmacist");
  });

  it("enforces role guards, branch scope, and validation", async () => {
    const tenantId = `tenant-edit-guard-${Date.now()}`;
    const branchId = "branch-a";

    const reg = await request(app)
      .post("/api/v1/customers/registrations")
      .set(headers(tenantId, "field_agent", { userId: "agent-1", scopeType: "branch", branchId }))
      .send({
        fullName: "Guard Target",
        phone: "0244222000",
        location: "Accra",
        houseNumber: "5",
        dateOfBirth: "1995-07-01",
        occupation: "Tailor",
        accountType: "susu",
        idCardNumber: "GHA-222-222",
        idCardPhotoUrl: FAKE_ID_PHOTO,
        nextOfKin: { fullName: "Kin", phone: "0244000222", location: "Accra" },
        dailyContributionAmount: 20
      });
    expect(reg.status).toBe(201);
    const customerId = String(reg.body.id);

    // Field agent cannot edit
    const agentAttempt = await request(app)
      .patch(`/api/v1/customers/${customerId}`)
      .set(headers(tenantId, "field_agent", { userId: "agent-1", scopeType: "branch", branchId }))
      .send({ fullName: "Hacked Name" });
    expect(agentAttempt.status).toBe(403);

    // Teller cannot edit
    const tellerAttempt = await request(app)
      .patch(`/api/v1/customers/${customerId}`)
      .set(headers(tenantId, "teller", { scopeType: "branch", branchId }))
      .send({ fullName: "Teller Edit" });
    expect(tellerAttempt.status).toBe(403);

    // Branch-scoped coordinator from another branch cannot edit
    const otherBranchAttempt = await request(app)
      .patch(`/api/v1/customers/${customerId}`)
      .set(headers(tenantId, "coordinator", { scopeType: "branch", branchId: "branch-b" }))
      .send({ fullName: "Cross Branch Edit" });
    expect(otherBranchAttempt.status).toBe(403);

    // Validation rejects blank name or invalid email
    const badEmail = await request(app)
      .patch(`/api/v1/customers/${customerId}`)
      .set(headers(tenantId, "admin"))
      .send({ email: "not-an-email" });
    expect(badEmail.status).toBe(400);

    const emptyName = await request(app)
      .patch(`/api/v1/customers/${customerId}`)
      .set(headers(tenantId, "admin"))
      .send({ fullName: "   " });
    expect(emptyName.status).toBe(400);
  });
});
