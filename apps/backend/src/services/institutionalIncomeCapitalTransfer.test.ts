import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../config/supabaseClient.js", () => ({
  getSupabaseAdminClient: () => null
}));

vi.mock("./branchService.js", () => ({
  listBranches: async () => [
    { id: "br-1", name: "Bondaye Branch", code: "BND", status: "active" },
    { id: "br-2", name: "Tarkwa Branch", code: "TRK", status: "active" }
  ],
  branchDisplayLabel: async (_tenantId: string, branchId: string) =>
    branchId === "br-1" ? "Bondaye Branch" : "Tarkwa Branch"
}));

vi.mock("./userNameResolver.js", () => ({
  fetchTenantUserNameMap: async () =>
    new Map([
      ["user-admin", "Evans Admin"],
      ["user-acct", "Ama Accountant"]
    ])
}));

vi.mock("./notificationService.js", () => ({
  notifyTenantStaff: async () => undefined
}));

import {
  clearMemoryCapitalEntries,
  createBranchCapitalEntry,
  getBranchCapitalSummary,
  loadDayBranchCapitalTotals,
  voidBranchCapitalEntry
} from "./branchCapitalService.js";
import {
  clearMemoryInstitutionalIncome,
  getInstitutionalIncomeReport,
  postInstitutionalIncome,
  reverseInstitutionalIncome,
  reverseInstitutionalIncomeCapitalTransfer,
  transferInstitutionalIncomeToCapital
} from "./institutionalIncomeService.js";
import { checkCashConservationInvariant } from "./susuClosingBalanceService.js";

const TENANT_ID = "tenant-test";
const BUSINESS_DATE = new Date().toISOString().slice(0, 10);

const ADMIN_CTX = {
  userId: "user-admin",
  tenantId: TENANT_ID,
  role: "admin",
  permissions: ["income.read"],
  scopeType: "head_office" as const
};

describe("Commission income transfer to Business Capital", () => {
  beforeEach(() => {
    clearMemoryInstitutionalIncome(TENANT_ID);
    clearMemoryCapitalEntries(TENANT_ID);
  });

  it("allocates partial and full commission income to Business Capital without adding physical vault cash or duplicate income entries", async () => {
    await postInstitutionalIncome(ADMIN_CTX, {
      branchId: "br-1",
      source: "susu_commission",
      amount: 350,
      businessDate: BUSINESS_DATE,
      idempotencyKey: "susu-comm-1"
    });
    await postInstitutionalIncome(ADMIN_CTX, {
      branchId: "br-1",
      source: "savings_fee",
      amount: 150,
      businessDate: BUSINESS_DATE,
      idempotencyKey: "sav-fee-1"
    });

    // Partial transfer: GHS 300 of GHS 500 available
    const first = await transferInstitutionalIncomeToCapital(ADMIN_CTX, {
      branchId: "br-1",
      amount: 300,
      businessDate: BUSINESS_DATE,
      reference: "ALLOC-001",
      notes: "Q4 commission allocation",
      idempotencyKey: "idem-transfer-1"
    });

    expect(first.idempotent).toBe(false);
    expect(first.previousBalance).toBe(500);
    expect(first.newBalance).toBe(200);
    expect(first.transfer.reference).toBe("ALLOC-001");
    expect(first.transfer.authorizedByName).toBe("Evans Admin");

    // Verify report metrics reconcile: earned (500) = available (200) + transferred (300)
    const report = await getInstitutionalIncomeReport(ADMIN_CTX, {
      period: "daily",
      branchId: "br-1"
    });
    expect(report.entryCount).toBe(2); // No duplicate institutional_income_entries created!
    expect(report.totalAmount).toBe(500);
    expect(report.capitalAllocation?.totalEarnedAllTime).toBe(500);
    expect(report.capitalAllocation?.availableBalance).toBe(200);
    expect(report.capitalAllocation?.totalTransferredToCapital).toBe(300);
    expect(report.capitalAllocation?.transfers).toHaveLength(1);

    // Verify Business Capital equity increased while physical vault dayInjections stayed 0!
    const capitalTotals = await loadDayBranchCapitalTotals(TENANT_ID, "br-1", BUSINESS_DATE);
    expect(capitalTotals.dayInjections).toBe(0);
    expect(capitalTotals.dayDrawings).toBe(0);
    expect(capitalTotals.dayIncomeAllocations).toBe(300);
    expect(capitalTotals.branchTotalCashInjected).toBe(0);
    expect(capitalTotals.branchTotalIncomeAllocated).toBe(300);
    expect(capitalTotals.branchTotalInjected).toBe(300);
    expect(capitalTotals.branchNetCapital).toBe(300);
    expect(capitalTotals.companyNetCapital).toBe(300);

    // Cash-conservation invariant stays perfectly balanced with 0 vault cash added by transfer.
    const invariant = checkCashConservationInvariant({
      openingVault: 1000,
      capitalInjectedToday: capitalTotals.dayInjections,
      capitalDrawingsToday: capitalTotals.dayDrawings,
      fieldAgentDeposits: 500,
      walkInDeposits: 0,
      fieldAgentWithdrawals: 0,
      walkInWithdrawals: 0,
      effectiveTotalExpenses: 0,
      closedTillVariance: 0,
      branchCashPosition: 1500
    });
    expect(invariant.balanced).toBe(true);
    expect(invariant.discrepancy).toBe(0);

    // Transfer remaining GHS 200 (full available)
    const second = await transferInstitutionalIncomeToCapital(ADMIN_CTX, {
      branchId: "br-1",
      amount: 200,
      businessDate: BUSINESS_DATE,
      idempotencyKey: "idem-transfer-2"
    });
    expect(second.previousBalance).toBe(200);
    expect(second.newBalance).toBe(0);

    const capitalAfterFull = await getBranchCapitalSummary(
      TENANT_ID,
      { role: "admin", scopeType: "head_office" },
      { branchId: "br-1", businessDate: BUSINESS_DATE }
    );
    expect(capitalAfterFull.branchNetCapital).toBe(500);
    expect(capitalAfterFull.dayInjections).toBe(0);
    expect(capitalAfterFull.dayIncomeAllocations).toBe(500);
  });

  it("is idempotent on duplicate idempotencyKey and prevents transfers exceeding available balance", async () => {
    await postInstitutionalIncome(ADMIN_CTX, {
      branchId: "br-1",
      source: "susu_commission",
      amount: 250,
      businessDate: BUSINESS_DATE,
      idempotencyKey: "comm-idem-base"
    });

    const first = await transferInstitutionalIncomeToCapital(ADMIN_CTX, {
      branchId: "br-1",
      amount: 150,
      businessDate: BUSINESS_DATE,
      idempotencyKey: "same-key-123"
    });
    const retry = await transferInstitutionalIncomeToCapital(ADMIN_CTX, {
      branchId: "br-1",
      amount: 150,
      businessDate: BUSINESS_DATE,
      idempotencyKey: "same-key-123"
    });

    expect(first.idempotent).toBe(false);
    expect(retry.idempotent).toBe(true);
    expect(retry.transfer.id).toBe(first.transfer.id);

    // Available must still be 100 (not -50)
    const report = await getInstitutionalIncomeReport(ADMIN_CTX, {
      period: "daily",
      branchId: "br-1"
    });
    expect(report.capitalAllocation?.availableBalance).toBe(100);
    expect(report.capitalAllocation?.totalTransferredToCapital).toBe(150);

    // Attempting to transfer 100.01 must fail
    await expect(
      transferInstitutionalIncomeToCapital(ADMIN_CTX, {
        branchId: "br-1",
        amount: 100.01,
        businessDate: BUSINESS_DATE,
        idempotencyKey: "overdraft-attempt"
      })
    ).rejects.toThrow(/exceeds available institutional income balance/i);
  });

  it("reverses a commission transfer atomically and restores available income + voids capital entry", async () => {
    await postInstitutionalIncome(ADMIN_CTX, {
      branchId: "br-1",
      source: "susu_commission",
      amount: 400,
      businessDate: BUSINESS_DATE,
      idempotencyKey: "comm-rev-1"
    });

    const created = await transferInstitutionalIncomeToCapital(ADMIN_CTX, {
      branchId: "br-1",
      amount: 250,
      businessDate: BUSINESS_DATE,
      reference: "ALLOC-REV",
      idempotencyKey: "idem-rev-1"
    });

    const reversed = await reverseInstitutionalIncomeCapitalTransfer(ADMIN_CTX, created.transfer.id, {
      reason: "Entered against wrong branch period"
    });

    expect(reversed.previousBalance).toBe(150);
    expect(reversed.newBalance).toBe(400);
    expect(reversed.transfer.reversedAt).toBeTruthy();
    expect(reversed.transfer.reversalReason).toBe("Entered against wrong branch period");

    // Duplicate reversal must fail
    await expect(
      reverseInstitutionalIncomeCapitalTransfer(ADMIN_CTX, created.transfer.id, {
        reason: "Second attempt"
      })
    ).rejects.toThrow(/already been reversed/i);

    const report = await getInstitutionalIncomeReport(ADMIN_CTX, {
      period: "daily",
      branchId: "br-1"
    });
    expect(report.capitalAllocation?.availableBalance).toBe(400);
    expect(report.capitalAllocation?.totalTransferredToCapital).toBe(0);

    const capital = await loadDayBranchCapitalTotals(TENANT_ID, "br-1", BUSINESS_DATE);
    expect(capital.branchNetCapital).toBe(0);
    expect(capital.dayInjections).toBe(0);
  });

  it("synchronizes both ledgers when an income_allocation capital entry is voided from Closing Balances", async () => {
    await postInstitutionalIncome(ADMIN_CTX, {
      branchId: "br-1",
      source: "susu_commission",
      amount: 600,
      businessDate: BUSINESS_DATE,
      idempotencyKey: "comm-void-sync"
    });

    // Also add a physical owner cash injection to verify separation
    await createBranchCapitalEntry(
      TENANT_ID,
      { userId: "user-admin", role: "admin", scopeType: "head_office" },
      {
        branchId: "br-1",
        businessDate: BUSINESS_DATE,
        entryType: "injection",
        amount: 1000,
        source: "Owner cash"
      }
    );

    const allocated = await transferInstitutionalIncomeToCapital(ADMIN_CTX, {
      branchId: "br-1",
      amount: 400,
      businessDate: BUSINESS_DATE,
      idempotencyKey: "idem-void-sync"
    });

    const beforeVoid = await loadDayBranchCapitalTotals(TENANT_ID, "br-1", BUSINESS_DATE);
    expect(beforeVoid.dayInjections).toBe(1000); // Only physical owner cash!
    expect(beforeVoid.branchNetCapital).toBe(1400); // 1000 cash + 400 commission allocation

    // Void the income_allocation entry via branchCapitalService
    await voidBranchCapitalEntry(
      TENANT_ID,
      { userId: "user-admin", role: "admin", scopeType: "head_office" },
      allocated.transfer.capitalEntryId,
      { reason: "Board deferred allocation" }
    );

    const afterVoid = await loadDayBranchCapitalTotals(TENANT_ID, "br-1", BUSINESS_DATE);
    expect(afterVoid.dayInjections).toBe(1000);
    expect(afterVoid.branchNetCapital).toBe(1000);

    const report = await getInstitutionalIncomeReport(ADMIN_CTX, {
      period: "daily",
      branchId: "br-1"
    });
    expect(report.capitalAllocation?.availableBalance).toBe(600);
    expect(report.capitalAllocation?.totalTransferredToCapital).toBe(0);
    expect(report.capitalAllocation?.transfers[0]?.reversedAt).toBeTruthy();
  });

  it("prevents reversing an underlying income entry if funds were already allocated to Business Capital", async () => {
    const entry = await postInstitutionalIncome(ADMIN_CTX, {
      branchId: "br-1",
      source: "susu_commission",
      amount: 100,
      businessDate: BUSINESS_DATE,
      idempotencyKey: "comm-guard-1"
    });

    await transferInstitutionalIncomeToCapital(ADMIN_CTX, {
      branchId: "br-1",
      amount: 80,
      businessDate: BUSINESS_DATE,
      idempotencyKey: "idem-guard-1"
    });

    await expect(
      reverseInstitutionalIncome(ADMIN_CTX, {
        entryId: entry.id,
        reason: "Correction after transfer"
      })
    ).rejects.toThrow(/reverse a commission capital transfer first/i);
  });

  it("enforces role and branch-scope authorization", async () => {
    await postInstitutionalIncome(ADMIN_CTX, {
      branchId: "br-1",
      source: "susu_commission",
      amount: 200,
      businessDate: BUSINESS_DATE,
      idempotencyKey: "comm-auth-1"
    });

    await expect(
      transferInstitutionalIncomeToCapital(
        {
          userId: "user-coord",
          tenantId: TENANT_ID,
          role: "coordinator",
          permissions: ["income.read"],
          scopeType: "head_office"
        },
        {
          branchId: "br-1",
          amount: 50,
          idempotencyKey: "idem-unauth-role"
        }
      )
    ).rejects.toThrow(/only authorized administrators or accountants/i);

    await expect(
      transferInstitutionalIncomeToCapital(
        {
          userId: "user-acct",
          tenantId: TENANT_ID,
          role: "accountant",
          permissions: ["income.read"],
          scopeType: "branch",
          branchId: "br-2"
        },
        {
          branchId: "br-1",
          amount: 50,
          idempotencyKey: "idem-cross-branch"
        }
      )
    ).rejects.toThrow(/another branch/i);
  });
});
