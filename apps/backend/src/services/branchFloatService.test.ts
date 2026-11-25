import { describe, expect, it, vi } from "vitest";

vi.mock("../config/supabaseClient.js", () => ({
  getSupabaseAdminClient: () => null
}));

vi.mock("./notificationService.js", () => ({
  notifyTenantStaff: vi.fn().mockResolvedValue(undefined),
  createAgentNotification: vi.fn().mockResolvedValue(undefined)
}));

vi.mock("./branchService.js", () => ({
  branchDisplayLabel: vi.fn().mockResolvedValue("Main Branch"),
  resolveBranchId: vi.fn(async (_tenantId: string, branchId?: string) => branchId ?? "branch-1")
}));

import {
  closeBranchFloat,
  getFloatSessionForCashier,
  pushBranchFloat
} from "./branchFloatService.js";

describe("branchFloatService call-over enforcement & persistence", () => {
  it("blocks a teller from closing their own till without confirming call-over", async () => {
    const tenantId = `tenant-callover-block-${Date.now()}`;
    const adminCtx = {
      tenantId,
      userId: "admin-1",
      role: "admin",
      scopeType: "head_office" as const
    };
    const tellerCtx = {
      tenantId,
      userId: "teller-1",
      role: "teller",
      scopeType: "branch" as const,
      branchId: "branch-1"
    };

    const opened = await pushBranchFloat(adminCtx, {
      branchId: "branch-1",
      cashierUserId: "teller-1",
      openingFloat: 1000,
      initialCash: 500
    });

    await expect(
      closeBranchFloat(tellerCtx, opened.id, { actualClosing: 500 })
    ).rejects.toThrow(/Teller call-over/i);
  });

  it("persists checked call-over transaction IDs and confirmation timestamp after closing", async () => {
    const tenantId = `tenant-callover-persist-${Date.now()}`;
    const adminCtx = {
      tenantId,
      userId: "admin-1",
      role: "admin",
      scopeType: "head_office" as const
    };
    const tellerCtx = {
      tenantId,
      userId: "teller-2",
      role: "teller",
      scopeType: "branch" as const,
      branchId: "branch-1"
    };

    const opened = await pushBranchFloat(adminCtx, {
      branchId: "branch-1",
      cashierUserId: "teller-2",
      openingFloat: 1000,
      initialCash: 500
    });

    const closed = await closeBranchFloat(tellerCtx, opened.id, {
      actualClosing: 500,
      calloverCheckedTxIds: ["tx-1", "tx-2", "tx-1"],
      calloverConfirmed: true
    });

    expect(closed.status).toBe("closed");
    expect(closed.calloverCheckedTxIds).toEqual(["tx-1", "tx-2"]);
    expect(closed.calloverConfirmedAt).toBeTruthy();

    const reloaded = await getFloatSessionForCashier(
      tenantId,
      "teller-2",
      opened.businessDate,
      "branch-1"
    );
    expect(reloaded?.status).toBe("closed");
    expect(reloaded?.calloverCheckedTxIds).toEqual(["tx-1", "tx-2"]);
    expect(reloaded?.calloverConfirmedAt).toBe(closed.calloverConfirmedAt);
  });

  it("still allows admin to close an absent teller's till on their behalf", async () => {
    const tenantId = `tenant-callover-admin-${Date.now()}`;
    const adminCtx = {
      tenantId,
      userId: "admin-1",
      role: "admin",
      scopeType: "head_office" as const
    };

    const opened = await pushBranchFloat(adminCtx, {
      branchId: "branch-1",
      cashierUserId: "teller-absent",
      openingFloat: 800,
      initialCash: 200
    });

    const closed = await closeBranchFloat(adminCtx, opened.id, {
      actualClosing: 200,
      varianceNote: "Closed on behalf of absent teller"
    });

    expect(closed.status).toBe("closed");
    expect(closed.actualClosing).toBe(200);
  });
});
