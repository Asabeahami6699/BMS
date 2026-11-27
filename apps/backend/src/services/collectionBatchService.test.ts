import request from "supertest";
import { describe, expect, it, vi } from "vitest";

vi.mock("../config/supabaseClient.js", () => ({
  getSupabaseAdminClient: () => null
}));

import { createApp } from "../app.js";

const app = createApp();

const TENANT_ID = `tenant-extra-batch-${Date.now()}`;
const BRANCH_ID = "branch-a";
const AGENT_ID = "agent-extra-batch-1";
const FAKE_ID_PHOTO = "data:image/png;base64,iVBORw0KGgo=";

function agentHeaders() {
  return {
    "x-user-id": AGENT_ID,
    "x-tenant-id": TENANT_ID,
    "x-role": "field_agent",
    "x-scope-type": "branch",
    "x-branch-id": BRANCH_ID
  };
}

function coordinatorHeaders() {
  return {
    "x-user-id": "coordinator-extra-batch-1",
    "x-tenant-id": TENANT_ID,
    "x-role": "coordinator",
    "x-scope-type": "head_office"
  };
}

function adminHeaders() {
  return {
    "x-user-id": "admin-extra-batch-1",
    "x-tenant-id": TENANT_ID,
    "x-role": "admin",
    "x-scope-type": "head_office"
  };
}

async function createActiveSusuCustomer(
  name: string,
  phone: string,
  idCard: string,
  headers: Record<string, string> = agentHeaders()
): Promise<string> {
  const reg = await request(app)
    .post("/api/v1/customers/registrations")
    .set(headers)
    .send({
      fullName: name,
      phone,
      location: "Accra",
      houseNumber: "10",
      dateOfBirth: "1990-01-15",
      occupation: "Trader",
      accountType: "susu",
      idCardNumber: idCard,
      idCardPhotoUrl: FAKE_ID_PHOTO,
      nextOfKin: {
        fullName: `${name} Kin`,
        phone: "0244000001",
        location: "Accra",
        houseNumber: "10"
      },
      dailyContributionAmount: 50
    });
  expect(reg.status, JSON.stringify(reg.body)).toBe(201);
  const customerId = String(reg.body.id);

  const approve = await request(app)
    .patch(`/api/v1/customers/${customerId}/approve`)
    .set(coordinatorHeaders());
  expect(approve.status, JSON.stringify(approve.body)).toBe(200);
  return customerId;
}

describe("coordinator-unlocked extra collection batches (Batch #2)", () => {
  it("locks Batch #1 after posting, allows coordinator to unlock Batch #2, and posts Batch #2 without double-crediting Batch #1", async () => {
    const customer1Id = await createActiveSusuCustomer("Ama Mensah", "0244100101", "GHA-EB-001");
    const customer2Id = await createActiveSusuCustomer("Kofi Boateng", "0244100102", "GHA-EB-002");

    // 1. Batch #1: agent collects GHS 50 from Customer 1
    const line1 = await request(app)
      .post("/api/v1/field-agents/me/collection-batches/lines")
      .set(agentHeaders())
      .send({
        customerId: customer1Id,
        amount: 50,
        transactionBranchId: BRANCH_ID
      });
    expect(line1.status, JSON.stringify(line1.body)).toBe(201);
    expect(line1.body.batchSequence).toBe(1);

    // Submit Batch #1 for coordinator approval
    const submit1 = await request(app)
      .post("/api/v1/field-agents/me/collection-batches/submit-for-approval")
      .set(agentHeaders())
      .send({
        lines: [
          {
            customerId: customer1Id,
            customerName: "Ama Mensah",
            documentAmount: 50,
            appAmount: 50,
            varianceType: "match"
          }
        ],
        summary: { totalDocument: 50, totalApp: 50, totalVariance: 0, unresolvedCount: 0 }
      });
    expect(submit1.status, JSON.stringify(submit1.body)).toBe(201);
    const batch1Id = String(submit1.body.batchId);

    // Post Batch #1
    const post1 = await request(app)
      .post(`/api/v1/collection-batches/${batch1Id}/post`)
      .set(adminHeaders())
      .send({ cashReceivedAmount: 50 });
    expect(post1.status, JSON.stringify(post1.body)).toBe(200);

    // 2. Agent is now locked from collecting again until coordinator unlocks Batch #2
    const blockedLine = await request(app)
      .post("/api/v1/field-agents/me/collection-batches/lines")
      .set(agentHeaders())
      .send({
        customerId: customer2Id,
        amount: 80,
        transactionBranchId: BRANCH_ID
      });
    expect(blockedLine.status).toBe(400);
    expect(String(blockedLine.body.error ?? blockedLine.body.message)).toMatch(
      /already posted.*unlock an extra batch/i
    );

    // 3. Coordinator sees Batch #1 on the posted batches list and can unlock Batch #2
    const postedBefore = await request(app)
      .get("/api/v1/collection-batches/posted")
      .set(coordinatorHeaders());
    expect(postedBefore.status, JSON.stringify(postedBefore.body)).toBe(200);
    const postedBatch1 = (postedBefore.body as Array<Record<string, unknown>>).find(
      (b) => b.id === batch1Id
    );
    expect(postedBatch1).toBeTruthy();
    expect(postedBatch1?.batchSequence).toBe(1);
    expect(postedBatch1?.canUnlockExtraBatch).toBe(true);
    expect(postedBatch1?.hasOpenNextBatch).toBe(false);

    // Guard: field agent cannot unlock their own extra batch
    const forbiddenUnlock = await request(app)
      .post(`/api/v1/collection-batches/${batch1Id}/unlock-extra`)
      .set(agentHeaders())
      .send({ reason: "Self unlock attempt" });
    expect(forbiddenUnlock.status).toBe(403);

    // Guard: reason is required
    const shortReasonUnlock = await request(app)
      .post(`/api/v1/collection-batches/${batch1Id}/unlock-extra`)
      .set(coordinatorHeaders())
      .send({ reason: "ok" });
    expect(shortReasonUnlock.status).toBe(400);

    // 4. Coordinator unlocks Batch #2 with a valid reason
    const unlockReason = "Agent submitted morning call-over early by mistake";
    const unlockRes = await request(app)
      .post(`/api/v1/collection-batches/${batch1Id}/unlock-extra`)
      .set(coordinatorHeaders())
      .send({ reason: unlockReason });
    expect(unlockRes.status, JSON.stringify(unlockRes.body)).toBe(201);
    expect(unlockRes.body.batch?.batchSequence).toBe(2);
    expect(unlockRes.body.batch?.status).toBe("draft");
    expect(unlockRes.body.batch?.unlockReason).toBe(unlockReason);
    expect(unlockRes.body.priorPostedCount).toBe(1);
    expect(unlockRes.body.priorPostedTotal).toBe(50);
    const batch2Id = String(unlockRes.body.batch?.id);
    expect(batch2Id).not.toBe(batch1Id);

    // Guard: cannot unlock another extra batch while Batch #2 is still open
    const duplicateUnlock = await request(app)
      .post(`/api/v1/collection-batches/${batch1Id}/unlock-extra`)
      .set(coordinatorHeaders())
      .send({ reason: "Duplicate unlock attempt" });
    expect(duplicateUnlock.status).toBe(400);

    // Posted list now reflects that Batch #2 is open
    const postedWhileOpen = await request(app)
      .get("/api/v1/collection-batches/posted")
      .set(coordinatorHeaders());
    expect(postedWhileOpen.status).toBe(200);
    const postedRowWhileOpen = (postedWhileOpen.body as Array<Record<string, unknown>>).find(
      (b) => b.id === batch1Id
    );
    expect(postedRowWhileOpen?.hasOpenNextBatch).toBe(true);
    expect(postedRowWhileOpen?.openNextBatchSequence).toBe(2);
    expect(postedRowWhileOpen?.canUnlockExtraBatch).toBe(false);

    // 5. Agent checks today's collections before collecting in Batch #2
    const todayBeforeB2 = await request(app)
      .get("/api/v1/field-agents/me/collections/today")
      .set(agentHeaders());
    expect(todayBeforeB2.status).toBe(200);
    expect(todayBeforeB2.body.batchId).toBe(batch2Id);
    expect(todayBeforeB2.body.batchSequence).toBe(2);
    expect(todayBeforeB2.body.batchStatus).toBe("draft");
    expect(todayBeforeB2.body.totalAmount).toBe(0);
    expect(todayBeforeB2.body.postedBatchesTodayCount).toBe(1);
    expect(todayBeforeB2.body.postedTotalToday).toBe(50);
    expect(todayBeforeB2.body.combinedTotalToday).toBe(50);
    expect(todayBeforeB2.body.unlockReason).toBe(unlockReason);

    // 6. Agent collects GHS 80 from Customer 2 in Batch #2
    const line2 = await request(app)
      .post("/api/v1/field-agents/me/collection-batches/lines")
      .set(agentHeaders())
      .send({
        customerId: customer2Id,
        amount: 80,
        transactionBranchId: BRANCH_ID
      });
    expect(line2.status, JSON.stringify(line2.body)).toBe(201);
    expect(line2.body.batchId).toBe(batch2Id);
    expect(line2.body.batchSequence).toBe(2);
    expect(line2.body.totalAmount).toBe(80);

    // Today's summary separates Batch #2 cash (80) from earlier posted Batch #1 (50) and shows combined (130)
    const todayDuringB2 = await request(app)
      .get("/api/v1/field-agents/me/collections/today")
      .set(agentHeaders());
    expect(todayDuringB2.status).toBe(200);
    expect(todayDuringB2.body.totalAmount).toBe(80);
    expect(todayDuringB2.body.postedTotalToday).toBe(50);
    expect(todayDuringB2.body.combinedTotalToday).toBe(130);

    // 7. Agent submits Batch #2 for approval
    const submit2 = await request(app)
      .post("/api/v1/field-agents/me/collection-batches/submit-for-approval")
      .set(agentHeaders())
      .send({
        lines: [
          {
            customerId: customer2Id,
            customerName: "Kofi Boateng",
            documentAmount: 80,
            appAmount: 80,
            varianceType: "match"
          }
        ],
        summary: { totalDocument: 80, totalApp: 80, totalVariance: 0, unresolvedCount: 0 }
      });
    expect(submit2.status, JSON.stringify(submit2.body)).toBe(201);
    expect(submit2.body.batchId).toBe(batch2Id);

    // Coordinator sees Batch #2 in pending list with sequence=2 and unlock reason
    const pendingRes = await request(app)
      .get("/api/v1/collection-batches/pending")
      .set(coordinatorHeaders());
    expect(pendingRes.status).toBe(200);
    const pendingB2 = (pendingRes.body as Array<Record<string, unknown>>).find(
      (b) => b.id === batch2Id
    );
    expect(pendingB2).toBeTruthy();
    expect(pendingB2?.batchSequence).toBe(2);
    expect(pendingB2?.totalAmount).toBe(80);
    expect(pendingB2?.unlockReason).toBe(unlockReason);

    // 8. Coordinator posts Batch #2 (cash received = 80 only)
    const post2 = await request(app)
      .post(`/api/v1/collection-batches/${batch2Id}/post`)
      .set(adminHeaders())
      .send({ cashReceivedAmount: 80 });
    expect(post2.status, JSON.stringify(post2.body)).toBe(200);

    // 9. Verify posted daily_susu transactions: Customer 1 was NOT double-credited (still 1 deposit = 50), Customer 2 has 1 deposit = 80
    const txRes = await request(app).get("/api/v1/transactions").set(coordinatorHeaders());
    expect(txRes.status).toBe(200);
    const txs = txRes.body as Array<{ customerId: string; type: string; amount: number }>;
    const c1Deposits = txs.filter(
      (t) => t.customerId === customer1Id && t.type === "daily_susu"
    );
    const c2Deposits = txs.filter(
      (t) => t.customerId === customer2Id && t.type === "daily_susu"
    );
    expect(c1Deposits).toHaveLength(1);
    expect(c1Deposits[0]?.amount).toBe(50);
    expect(c2Deposits).toHaveLength(1);
    expect(c2Deposits[0]?.amount).toBe(80);

    // 10. Both Batch #1 and Batch #2 appear in posted list; only latest (Batch #2) can unlock Batch #3
    const postedAfter = await request(app)
      .get("/api/v1/collection-batches/posted")
      .set(coordinatorHeaders());
    expect(postedAfter.status).toBe(200);
    const postedRows = postedAfter.body as Array<Record<string, unknown>>;
    const rowB1 = postedRows.find((b) => b.id === batch1Id);
    const rowB2 = postedRows.find((b) => b.id === batch2Id);
    expect(rowB1?.batchSequence).toBe(1);
    expect(rowB1?.isLatestBatchForAgent).toBe(false);
    expect(rowB1?.canUnlockExtraBatch).toBe(false);
    expect(rowB2?.batchSequence).toBe(2);
    expect(rowB2?.isLatestBatchForAgent).toBe(true);
    expect(rowB2?.canUnlockExtraBatch).toBe(true);

    // 11. Today's summary now reflects both posted batches (combined = 130)
    const todayFinal = await request(app)
      .get("/api/v1/field-agents/me/collections/today")
      .set(agentHeaders());
    expect(todayFinal.status).toBe(200);
    expect(todayFinal.body.batchSequence).toBe(2);
    expect(todayFinal.body.batchStatus).toBe("posted");
    expect(todayFinal.body.postedBatchesTodayCount).toBe(2);
    expect(todayFinal.body.postedTotalToday).toBe(130);
    expect(todayFinal.body.combinedTotalToday).toBe(130);
  });
});

describe("coordinator cancel unposted batch & remove single line", () => {
  const CANCEL_AGENT_ID = "agent-cancel-batch-2";

  function cancelAgentHeaders() {
    return {
      "x-user-id": CANCEL_AGENT_ID,
      "x-tenant-id": TENANT_ID,
      "x-role": "field_agent",
      "x-scope-type": "branch",
      "x-branch-id": BRANCH_ID
    };
  }

  it("removes a single duplicate line from a pending batch, recalculates total, and only posts the remaining line", async () => {
    const customerKeepId = await createActiveSusuCustomer(
      "Abena Osei",
      "0244200201",
      "GHA-RM-001",
      cancelAgentHeaders()
    );
    const customerDropId = await createActiveSusuCustomer(
      "Kwame Asare",
      "0244200202",
      "GHA-RM-002",
      cancelAgentHeaders()
    );

    // Agent records 2 collections (one valid, one duplicate)
    const add1 = await request(app)
      .post("/api/v1/field-agents/me/collection-batches/lines")
      .set(cancelAgentHeaders())
      .send({ customerId: customerKeepId, amount: 120, transactionBranchId: BRANCH_ID });
    expect(add1.status, JSON.stringify(add1.body)).toBe(201);

    const add2 = await request(app)
      .post("/api/v1/field-agents/me/collection-batches/lines")
      .set(cancelAgentHeaders())
      .send({ customerId: customerDropId, amount: 2400, transactionBranchId: BRANCH_ID });
    expect(add2.status, JSON.stringify(add2.body)).toBe(201);

    const submit = await request(app)
      .post("/api/v1/field-agents/me/collection-batches/submit-for-approval")
      .set(cancelAgentHeaders())
      .send({
        lines: [
          {
            customerId: customerKeepId,
            customerName: "Abena Osei",
            documentAmount: 120,
            appAmount: 120,
            varianceType: "match"
          },
          {
            customerId: customerDropId,
            customerName: "Kwame Asare",
            documentAmount: 2400,
            appAmount: 2400,
            varianceType: "match"
          }
        ],
        summary: { totalDocument: 2520, totalApp: 2520, totalVariance: 0, unresolvedCount: 0 }
      });
    expect(submit.status, JSON.stringify(submit.body)).toBe(201);
    const batchId = String(submit.body.batchId);

    const pendingBefore = await request(app)
      .get("/api/v1/collection-batches/pending")
      .set(coordinatorHeaders());
    expect(pendingBefore.status).toBe(200);
    const pendingBatch = (
      pendingBefore.body as Array<{
        id: string;
        totalAmount: number;
        lines: Array<{ id: string; customerId: string; amount: number }>;
      }>
    ).find((b) => b.id === batchId);
    expect(pendingBatch?.totalAmount).toBe(2520);
    const dropLine = pendingBatch?.lines.find((l) => l.customerId === customerDropId);
    expect(dropLine).toBeTruthy();

    // Guard: field agent cannot remove a line
    const agentAttempt = await request(app)
      .delete(`/api/v1/collection-batches/${batchId}/lines/${dropLine!.id}`)
      .set(cancelAgentHeaders())
      .send({ reason: "Self removal" });
    expect(agentAttempt.status).toBe(403);

    // Guard: reason is required
    const shortReason = await request(app)
      .delete(`/api/v1/collection-batches/${batchId}/lines/${dropLine!.id}`)
      .set(coordinatorHeaders())
      .send({ reason: "no" });
    expect(shortReason.status).toBe(400);

    // Coordinator removes the duplicate GHS 2,400 line
    const removeRes = await request(app)
      .delete(`/api/v1/collection-batches/${batchId}/lines/${dropLine!.id}`)
      .set(coordinatorHeaders())
      .send({ reason: "Duplicate initial deposit already settled separately" });
    expect(removeRes.status, JSON.stringify(removeRes.body)).toBe(200);
    expect(removeRes.body.batchDeleted).toBe(false);
    expect(removeRes.body.previousTotalAmount).toBe(2520);
    expect(removeRes.body.newTotalAmount).toBe(120);
    expect(removeRes.body.batch?.lines).toHaveLength(1);

    // Post the cleaned batch (GHS 120 only)
    const postRes = await request(app)
      .post(`/api/v1/collection-batches/${batchId}/post`)
      .set(adminHeaders())
      .send({ cashReceivedAmount: 120 });
    expect(postRes.status, JSON.stringify(postRes.body)).toBe(200);

    // Guard: posted batch cannot be canceled or have lines removed
    const cancelPosted = await request(app)
      .delete(`/api/v1/collection-batches/${batchId}`)
      .set(coordinatorHeaders())
      .send({ reason: "Trying to cancel posted batch" });
    expect(cancelPosted.status).toBe(400);

    const remainingLineId = String(removeRes.body.batch?.lines?.[0]?.id);
    const removeFromPosted = await request(app)
      .delete(`/api/v1/collection-batches/${batchId}/lines/${remainingLineId}`)
      .set(coordinatorHeaders())
      .send({ reason: "Trying to remove posted line" });
    expect(removeFromPosted.status).toBe(400);

    // Verify ledger: customerKeep credited GHS 120; customerDrop has ZERO transactions
    const txRes = await request(app).get("/api/v1/transactions").set(coordinatorHeaders());
    expect(txRes.status).toBe(200);
    const txs = txRes.body as Array<{ customerId: string; type: string; amount: number }>;
    const keepTxs = txs.filter((t) => t.customerId === customerKeepId && t.type === "daily_susu");
    const dropTxs = txs.filter((t) => t.customerId === customerDropId && t.type === "daily_susu");
    expect(keepTxs).toHaveLength(1);
    expect(keepTxs[0]?.amount).toBe(120);
    expect(dropTxs).toHaveLength(0);
  });

  it("cancels an entire pending batch cleanly (and auto-cancels when removing the only line), letting the agent collect fresh", async () => {
    const FRESH_AGENT_ID = "agent-cancel-batch-3";
    const freshAgentHeaders = () => ({
      "x-user-id": FRESH_AGENT_ID,
      "x-tenant-id": TENANT_ID,
      "x-role": "field_agent",
      "x-scope-type": "branch",
      "x-branch-id": BRANCH_ID
    });

    const customerId = await createActiveSusuCustomer(
      "Evans Botwe",
      "0244300301",
      "GHA-CN-001",
      freshAgentHeaders()
    );

    // 1. Agent submits a single-line mistaken batch of GHS 2,400
    const add = await request(app)
      .post("/api/v1/field-agents/me/collection-batches/lines")
      .set(freshAgentHeaders())
      .send({ customerId, amount: 2400, transactionBranchId: BRANCH_ID });
    expect(add.status, JSON.stringify(add.body)).toBe(201);

    const submit = await request(app)
      .post("/api/v1/field-agents/me/collection-batches/submit-for-approval")
      .set(freshAgentHeaders())
      .send({
        lines: [
          {
            customerId,
            customerName: "Evans Botwe",
            documentAmount: 2400,
            appAmount: 2400,
            varianceType: "match"
          }
        ],
        summary: { totalDocument: 2400, totalApp: 2400, totalVariance: 0, unresolvedCount: 0 }
      });
    expect(submit.status, JSON.stringify(submit.body)).toBe(201);
    const firstBatchId = String(submit.body.batchId);

    // Guard: field agent cannot cancel batch
    const forbiddenCancel = await request(app)
      .delete(`/api/v1/collection-batches/${firstBatchId}`)
      .set(freshAgentHeaders())
      .send({ reason: "Agent self cancel" });
    expect(forbiddenCancel.status).toBe(403);

    // Coordinator cancels the entire unposted batch
    const cancelRes = await request(app)
      .delete(`/api/v1/collection-batches/${firstBatchId}`)
      .set(coordinatorHeaders())
      .send({ reason: "Duplicate initial deposit entry" });
    expect(cancelRes.status, JSON.stringify(cancelRes.body)).toBe(200);
    expect(cancelRes.body.deletedBatchId).toBe(firstBatchId);
    expect(cancelRes.body.removedLineCount).toBe(1);
    expect(cancelRes.body.removedTotalAmount).toBe(2400);

    // Pending list no longer has the batch
    const pendingAfterCancel = await request(app)
      .get("/api/v1/collection-batches/pending")
      .set(coordinatorHeaders());
    expect(
      (pendingAfterCancel.body as Array<{ id: string }>).some((b) => b.id === firstBatchId)
    ).toBe(false);

    // Agent sees an empty fresh day (no active batch yet) and can record a new collection
    const todayAfterCancel = await request(app)
      .get("/api/v1/field-agents/me/collections/today")
      .set(freshAgentHeaders());
    expect(todayAfterCancel.status).toBe(200);
    expect(todayAfterCancel.body.totalAmount).toBe(0);
    expect(todayAfterCancel.body.batchId).toBeUndefined();
    expect(todayAfterCancel.body.batchStatus).toBeUndefined();

    // 2. Agent records another single-line batch, submits it, and coordinator removes its ONLY line -> auto-cancels batch
    const addAgain = await request(app)
      .post("/api/v1/field-agents/me/collection-batches/lines")
      .set(freshAgentHeaders())
      .send({ customerId, amount: 300, transactionBranchId: BRANCH_ID });
    expect(addAgain.status, JSON.stringify(addAgain.body)).toBe(201);

    const submitAgain = await request(app)
      .post("/api/v1/field-agents/me/collection-batches/submit-for-approval")
      .set(freshAgentHeaders())
      .send({
        lines: [
          {
            customerId,
            customerName: "Evans Botwe",
            documentAmount: 300,
            appAmount: 300,
            varianceType: "match"
          }
        ],
        summary: { totalDocument: 300, totalApp: 300, totalVariance: 0, unresolvedCount: 0 }
      });
    expect(submitAgain.status, JSON.stringify(submitAgain.body)).toBe(201);
    const secondBatchId = String(submitAgain.body.batchId);

    const pendingSecond = await request(app)
      .get("/api/v1/collection-batches/pending")
      .set(coordinatorHeaders());
    const batch2 = (
      pendingSecond.body as Array<{ id: string; lines: Array<{ id: string }> }>
    ).find((b) => b.id === secondBatchId);
    const onlyLineId = batch2?.lines[0]?.id;
    expect(onlyLineId).toBeTruthy();

    const removeOnlyLine = await request(app)
      .delete(`/api/v1/collection-batches/${secondBatchId}/lines/${onlyLineId}`)
      .set(coordinatorHeaders())
      .send({ reason: "Only line entered by mistake" });
    expect(removeOnlyLine.status, JSON.stringify(removeOnlyLine.body)).toBe(200);
    expect(removeOnlyLine.body.batchDeleted).toBe(true);
    expect(removeOnlyLine.body.batch).toBeNull();
    expect(removeOnlyLine.body.newTotalAmount).toBe(0);

    // Zero transactions posted for Evans Botwe
    const txRes = await request(app).get("/api/v1/transactions").set(coordinatorHeaders());
    const evansTxs = (txRes.body as Array<{ customerId: string }>).filter(
      (t) => t.customerId === customerId
    );
    expect(evansTxs).toHaveLength(0);
  });
});
