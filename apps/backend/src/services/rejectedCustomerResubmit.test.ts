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

  it("allows the owning field agent to delete a rejected registration and start fresh, while blocking other agents and non-rejected accounts", async () => {
    // 1. Mobilizer registers a customer
    const regRes = await request(app)
      .post("/api/v1/customers/registrations")
      .set(agentHeaders())
      .send({
        fullName: "Kofi Abandoned",
        phone: "0542297699",
        location: "Bondaye",
        houseNumber: "8",
        dateOfBirth: "1990-07-02",
        occupation: "Driver",
        accountType: "susu",
        idCardNumber: "GHA-999888777-1",
        idCardPhotoUrl: FAKE_ID_PHOTO,
        nextOfKin: {
          fullName: "Ama Abandoned",
          phone: "0244000099",
          location: "Bondaye",
          houseNumber: "8"
        },
        dailyContributionAmount: 30
      });
    expect(regRes.status, JSON.stringify(regRes.body)).toBe(201);
    const customerId = String(regRes.body.id);

    // Guard: cannot discard while still pending_activation
    const deletePending = await request(app)
      .delete(`/api/v1/customers/${customerId}/rejected`)
      .set(agentHeaders());
    expect(deletePending.status).toBe(400);

    // 2. Coordinator rejects the registration
    const rejectRes = await request(app)
      .patch(`/api/v1/customers/${customerId}/reject`)
      .set(coordinatorHeaders())
      .send({ reason: "Wrong person details — please discard or redo" });
    expect(rejectRes.status, JSON.stringify(rejectRes.body)).toBe(200);

    // Guard: another field agent cannot delete someone else's rejected registration
    const otherAgentDelete = await request(app)
      .delete(`/api/v1/customers/${customerId}/rejected`)
      .set(agentHeaders(OTHER_AGENT_ID));
    expect(otherAgentDelete.status).toBe(403);

    // 3. Owning field agent deletes the rejected registration
    const deleteRes = await request(app)
      .delete(`/api/v1/customers/${customerId}/rejected`)
      .set(agentHeaders());
    expect(deleteRes.status, JSON.stringify(deleteRes.body)).toBe(200);
    expect(deleteRes.body).toEqual({ ok: true, deletedId: customerId });

    // 4. Verify the discarded form is completely gone from the list
    const listAfter = await request(app).get("/api/v1/customers").set(agentHeaders());
    expect(listAfter.status).toBe(200);
    expect(
      (listAfter.body as Array<{ id: string }>).some((c) => c.id === customerId)
    ).toBe(false);

    // 5. Field agent can start a fresh registration right away
    const freshRes = await request(app)
      .post("/api/v1/customers/registrations")
      .set(agentHeaders())
      .send({
        fullName: "Kofi Fresh Start",
        phone: "0542297699",
        location: "Bondaye",
        houseNumber: "8A",
        dateOfBirth: "1990-07-02",
        occupation: "Driver",
        accountType: "susu",
        idCardNumber: "GHA-999888777-1",
        idCardPhotoUrl: FAKE_ID_PHOTO,
        nextOfKin: {
          fullName: "Ama Fresh",
          phone: "0244000099",
          location: "Bondaye",
          houseNumber: "8A"
        },
        dailyContributionAmount: 30
      });
    expect(freshRes.status, JSON.stringify(freshRes.body)).toBe(201);
    expect(freshRes.body.status).toBe("pending_activation");
  });
});
