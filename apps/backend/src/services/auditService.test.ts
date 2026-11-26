import { describe, expect, it, vi } from "vitest";

vi.mock("../config/supabaseClient.js", () => ({
  getSupabaseAdminClient: () => null
}));

vi.mock("./notificationService.js", () => ({
  notifyTenantStaff: vi.fn().mockResolvedValue(undefined)
}));

import {
  _unsafeTamperMemoryAuditLogForTest,
  computeChangedFields,
  listAuditLogs,
  sanitizeAuditSnapshot,
  verifyAuditLogChain,
  writeAuditLog
} from "./auditService.js";

describe("auditService immutable hash chain & before/after snapshots", () => {
  it("redacts sensitive credentials and oversized image data from snapshots", () => {
    const cleaned = sanitizeAuditSnapshot({
      amount: 250,
      password: "secret-password",
      transaction_pin: "1234",
      apiKey: "sk_live_123",
      photoUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==",
      nested: {
        accessToken: "jwt-token",
        status: "closed"
      }
    });

    expect(cleaned).toEqual({
      amount: 250,
      password: "[REDACTED]",
      transaction_pin: "[REDACTED]",
      apiKey: "[REDACTED]",
      photoUrl: "[image data omitted]",
      nested: {
        accessToken: "[REDACTED]",
        status: "closed"
      }
    });
  });

  it("computes exact sorted changedFields between before and after snapshots", () => {
    const changed = computeChangedFields(
      { status: "open", actualClosing: null, openingFloat: 1000 },
      { status: "closed", actualClosing: 1450, openingFloat: 1000, variance: -50 }
    );
    expect(changed).toEqual(["actualClosing", "status", "variance"]);
  });

  it("seals monotonic seqNo + SHA-256 hash chain and verifies intact logs", async () => {
    const tenantId = `audit-intact-${Date.now()}`;

    await writeAuditLog({
      tenantId,
      actorUserId: "teller-1",
      actorRole: "teller",
      method: "POST",
      path: "/api/v1/transactions",
      action: "Posted customer withdrawal",
      statusCode: 201,
      entityType: "transaction",
      entityId: "tx-100",
      beforeSnapshot: { balance: 500 },
      afterSnapshot: { balance: 300, amount: 200 }
    });

    await writeAuditLog({
      tenantId,
      actorUserId: "teller-1",
      actorRole: "teller",
      method: "POST",
      path: "/api/v1/transactions/branch-float/fs-1/close",
      action: "Closed teller till after call-over",
      statusCode: 200,
      entityType: "branch_float",
      entityId: "fs-1",
      beforeSnapshot: { status: "open", actualClosing: null },
      afterSnapshot: { status: "closed", actualClosing: 1200, variance: 0 }
    });

    const rows = await listAuditLogs(tenantId);
    expect(rows).toHaveLength(2);
    // Returned newest first
    const second = rows[0]!;
    const first = rows[1]!;

    expect(first.seqNo).toBe(1);
    expect(first.prevHash).toBe("GENESIS");
    expect(first.entryHash).toMatch(/^[a-f0-9]{64}$/);
    expect(first.changedFields).toEqual(["amount", "balance"]);

    expect(second.seqNo).toBe(2);
    expect(second.prevHash).toBe(first.entryHash);
    expect(second.entryHash).toMatch(/^[a-f0-9]{64}$/);
    expect(second.changedFields).toEqual(["actualClosing", "status", "variance"]);

    const verification = await verifyAuditLogChain(tenantId);
    expect(verification.valid).toBe(true);
    expect(verification.checkedCount).toBe(2);
    expect(verification.latestSeqNo).toBe(2);
    expect(verification.latestHash).toBe(second.entryHash);
  });

  it("detects post-hoc payload tampering in the hash chain", async () => {
    const tenantId = `audit-tamper-${Date.now()}`;

    await writeAuditLog({
      tenantId,
      actorUserId: "admin-1",
      actorRole: "admin",
      method: "POST",
      path: "/api/v1/transactions/tx-1/reverse",
      action: "Reversed Susu collection",
      statusCode: 201,
      entityType: "susu_reversal",
      entityId: "rev-1",
      beforeSnapshot: { status: "posted", amount: 500 },
      afterSnapshot: { status: "reversed", amount: 500 }
    });

    await writeAuditLog({
      tenantId,
      actorUserId: "admin-1",
      actorRole: "admin",
      method: "PUT",
      path: "/api/v1/tenant/approval-workflows",
      action: "Updated approval workflow",
      statusCode: 200,
      entityType: "approval_workflow",
      entityId: tenantId,
      beforeSnapshot: { allowCrossBranchWithdrawals: false },
      afterSnapshot: { allowCrossBranchWithdrawals: true }
    });

    // Simulate someone altering the financial amount on row #1 directly in storage
    _unsafeTamperMemoryAuditLogForTest(tenantId, 0, (rec) => {
      if (rec.afterSnapshot) {
        rec.afterSnapshot.amount = 50;
      }
    });

    const verification = await verifyAuditLogChain(tenantId);
    expect(verification.valid).toBe(false);
    expect(verification.brokenSeqNo).toBe(1);
    expect(verification.reason).toMatch(/tampering detected/i);
  });

  it("detects sequence gaps if an audit row is removed", async () => {
    const tenantId = `audit-gap-${Date.now()}`;

    await writeAuditLog({
      tenantId,
      actorUserId: "admin-1",
      actorRole: "admin",
      method: "POST",
      path: "/api/v1/transactions",
      action: "Posted deposit",
      statusCode: 201,
      entityType: "transaction",
      entityId: "tx-1"
    });

    _unsafeTamperMemoryAuditLogForTest(tenantId, 0, (rec) => {
      rec.seqNo = 2;
    });

    const verification = await verifyAuditLogChain(tenantId);
    expect(verification.valid).toBe(false);
    expect(verification.brokenSeqNo).toBe(2);
    expect(verification.reason).toMatch(/Sequence gap/i);
  });
});
