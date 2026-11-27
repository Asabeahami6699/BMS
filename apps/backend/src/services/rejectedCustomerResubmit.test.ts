import request from "supertest";
import { describe, expect, it, vi } from "vitest";

vi.mock("../config/supabaseClient.js", () => ({
  getSupabaseAdminClient: () => null
}));

import { createApp } from "../app.js";

const app = createApp();
const TENANT_ID = `tenant-rejected-resubmit-${Date.now()}`;
const BRANCH_ID = "branch-bondaye";
const AGENT_ID = "agent-albert-tusoe";
const OTHER_AGENT_ID = "agent-other-1";
const FAKE_ID_PHOTO = "data:image/png;base64,iVBORw0KGgo=";

function agentHeaders(userId = AGENT_ID) {
  return {
    "x-user-id": userId,
    "x-tenant-id": TENANT_ID,
    "x-role": "field_agent",
    "x-scope-type": "branch",
    "x-branch-id": BRANCH_ID
  };
}

function coordinatorHeaders() {
  return {
    "x-user-id": "coordinator-1",
    "x-tenant-id": TENANT_ID,
    "x-role": "coordinator",
    "x-scope-type": "head_office"
  };
}

describe("rejected registration: send back to mobilizer & resubmit", () => {
  it("allows coordinator to send a rejected registration back with instructions, mobilizer edits & resubmits in place, and coordinator approves", async () => {
    // 1. Mobilizer registers Gladys Somuah
    const regRes = await request(app)
      .post("/api/v1/customers/registrations")
      .set(agentHeaders())
      .send({
        fullName: "Gladys Somuah",
        phone: "0542297676",
        location: "Bondaye",
        houseNumber: "12",
        dateOfBirth: "1991-04-10",
        occupation: "Trader",
        accountType: "susu",
        idCardNumber: "GHA-123456789-0",
        idCardPhotoUrl: FAKE_ID_PHOTO,
        nextOfKin: {
          fullName: "Kwame Somuah",
          phone: "0244000010",
          location: "Bondaye",
          houseNumber: "12"
        },
        dailyContributionAmount: 50
      });
    expect(regRes.status, JSON.stringify(regRes.body)).toBe(201);
    const customerId = String(regRes.body.id);
    expect(regRes.body.status).toBe("pending_activation");

    // 2. Coordinator rejects the registration
    const rejectRes = await request(app)
      .patch(`/api/v1/customers/${customerId}/reject`)
      .set(coordinatorHeaders())
      .send({ reason: "Blurry Ghana Card photo" });
    expect(rejectRes.status, JSON.stringify(rejectRes.body)).toBe(200);
    expect(rejectRes.body.status).toBe("rejected");
    expect(rejectRes.body.rejectionReason).toBe("Blurry Ghana Card photo");

    // Guard: field agent cannot call return-to-agent
    const forbiddenReturn = await request(app)
      .patch(`/api/v1/customers/${customerId}/return-to-agent`)
      .set(agentHeaders())
      .send({ reason: "Self return" });
    expect(forbiddenReturn.status).toBe(403);

    // 3. Coordinator sends the rejected account back to the mobilizer with updated instructions
    const returnRes = await request(app)
      .patch(`/api/v1/customers/${customerId}/return-to-agent`)
      .set(coordinatorHeaders())
      .send({ reason: "Please retake clear Ghana Card photo and confirm house number" });
    expect(returnRes.status, JSON.stringify(returnRes.body)).toBe(200);
    expect(returnRes.body.status).toBe("rejected");
    expect(returnRes.body.rejectionReason).toBe(
      "Please retake clear Ghana Card photo and confirm house number"
    );

    // Mobilizer received the notification
    const alertsRes = await request(app)
      .get("/api/v1/customers/notifications/me")
      .set(agentHeaders());
    expect(alertsRes.status).toBe(200);
    expect(
      (alertsRes.body as Array<{ title: string; customerId?: string }>).some(
        (n) =>
          n.customerId === customerId &&
          /sent back for correction/i.test(n.title)
      )
    ).toBe(true);

    // Guard: another field agent cannot resubmit someone else's rejected registration
    const otherAgentResubmit = await request(app)
      .put(`/api/v1/customers/${customerId}/resubmit`)
      .set(agentHeaders(OTHER_AGENT_ID))
      .send({
        fullName: "Gladys Somuah",
        phone: "0542297676",
        location: "Bondaye",
        houseNumber: "14B",
        dateOfBirth: "1991-04-10",
        occupation: "Trader",
        accountType: "susu",
        idCardNumber: "GHA-123456789-0",
        idCardPhotoUrl: FAKE_ID_PHOTO,
        nextOfKin: {
          fullName: "Kwame Somuah",
          phone: "0244000010",
          location: "Bondaye",
          houseNumber: "14B"
        },
        dailyContributionAmount: 50
      });
    expect(otherAgentResubmit.status).toBe(403);

    // 4. Assigned mobilizer fixes the details and resubmits IN PLACE (same customerId)
    const resubmitRes = await request(app)
      .put(`/api/v1/customers/${customerId}/resubmit`)
      .set(agentHeaders())
      .send({
        fullName: "Gladys Somuah",
        phone: "0542297676",
        location: "Bondaye",
        houseNumber: "14B",
        dateOfBirth: "1991-04-10",
        occupation: "Trader",
        accountType: "susu",
        idCardNumber: "GHA-123456789-0",
        idCardPhotoUrl: FAKE_ID_PHOTO,
        nextOfKin: {
          fullName: "Kwame Somuah",
          phone: "0244000010",
          location: "Bondaye",
          houseNumber: "14B"
        },
        dailyContributionAmount: 50
      });
    expect(resubmitRes.status, JSON.stringify(resubmitRes.body)).toBe(200);
    expect(resubmitRes.body.id).toBe(customerId);
    expect(resubmitRes.body.status).toBe("pending_activation");
    expect(resubmitRes.body.houseNumber).toBe("14B");
    expect(resubmitRes.body.rejectionReason).toBeUndefined();

    // Guard: cannot return-to-agent or resubmit once back in pending_activation
    const returnPending = await request(app)
      .patch(`/api/v1/customers/${customerId}/return-to-agent`)
      .set(coordinatorHeaders())
      .send({ reason: "Not rejected anymore" });
    expect(returnPending.status).toBe(400);

    const resubmitPending = await request(app)
      .put(`/api/v1/customers/${customerId}/resubmit`)
      .set(agentHeaders())
      .send({
        fullName: "Gladys Somuah",
        phone: "0542297676",
        location: "Bondaye",
        houseNumber: "14B",
        dateOfBirth: "1991-04-10",
        occupation: "Trader",
        accountType: "susu",
        idCardNumber: "GHA-123456789-0",
        idCardPhotoUrl: FAKE_ID_PHOTO,
        nextOfKin: {
          fullName: "Kwame Somuah",
          phone: "0244000010",
          location: "Bondaye",
          houseNumber: "14B"
        },
        dailyContributionAmount: 50
      });
    expect(resubmitPending.status).toBe(400);

    // 5. Coordinator approves the corrected registration -> active with account number, zero duplicate records
    const approveRes = await request(app)
      .patch(`/api/v1/customers/${customerId}/approve`)
      .set(coordinatorHeaders());
    expect(approveRes.status, JSON.stringify(approveRes.body)).toBe(200);
    expect(approveRes.body.status).toBe("active");
    expect(approveRes.body.accountNumber).toBeTruthy();

    const listRes = await request(app).get("/api/v1/customers").set(coordinatorHeaders());
    const gladysRows = (listRes.body as Array<{ fullName: string }>).filter(
      (c) => c.fullName === "Gladys Somuah"
    );
    expect(gladysRows).toHaveLength(1);
  });
});
