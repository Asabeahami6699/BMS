import { describe, expect, it, beforeAll } from "vitest";
import { upsertTenantInStore } from "./authStore.js";
import { createBranch } from "./branchService.js";
import { getCustomerWithdrawableBalance, listCustomers } from "./customerService.js";
import { computeCustomerBalance } from "./ledgerService.js";
import { getSusuClosingBalance } from "./susuClosingBalanceService.js";
import {
  getCustomerSusuCycleSummary,
  resolveSusuWithdrawalCommission
} from "./susuCycleCommissionService.js";
import {
  commitTenantMigration,
  getTenantMigrationContext,
  parseCsvRecords,
  previewTenantMigration
} from "./tenantMigrationService.js";
import { createTransaction } from "./transactionService.js";

const TENANT_ID = "tenant-mig-test";
const ACTOR = { userId: "user-super-admin", role: "super_admin" };
let branchMainId = "";
let branchSubId = "";

describe("tenantMigrationService", () => {
  beforeAll(async () => {
    upsertTenantInStore({
      id: TENANT_ID,
      name: "Legacy Susu Ltd",
      subscriptionStatus: "active",
      accountNumberPrefix: "233999",
      subscribedModules: ["susu_management", "banking"],
      subdomain: "legacy-susu",
      createdAt: new Date().toISOString()
    });
    const b1 = await createBranch(TENANT_ID, { code: "MAIN", name: "Main Branch" });
    const b2 = await createBranch(TENANT_ID, { code: "MKT", name: "Market Branch" });
    branchMainId = b1.id;
    branchSubId = b2.id;
  });

  it("parses RFC-4180 CSV with BOM, quoted commas, and CRLF", () => {
    const raw =
      '\uFEFFfull_name,phone,location,opening_balance\r\n"Mensah, Ama",0244111001,"Adum, Kumasi","GHS 1,250.50"\r\n';
    const rows = parseCsvRecords(raw);
    expect(rows).toHaveLength(2);
    expect(rows[1]).toEqual(["Mensah, Ama", "0244111001", "Adum, Kumasi", "GHS 1,250.50"]);
  });

  it("provides tenant context and pre-filled CSV template", async () => {
    const ctx = await getTenantMigrationContext(TENANT_ID);
    expect(ctx.tenant.name).toBe("Legacy Susu Ltd");
    expect(ctx.branches.some((b) => b.code === "MAIN")).toBe(true);
    expect(ctx.branches.some((b) => b.code === "MKT")).toBe(true);
    expect(ctx.templateCsv).toContain("full_name,phone,branch_code");
    expect(ctx.templateFilename).toBe("legacy-susu-opening-balances-template.csv");
  });

  it("dry-run preview validates rows, skips in-CSV duplicate phones, and writes nothing", async () => {
    const csv = [
      "Full Name,Phone Number,Branch,Account Type,Daily Rate,Opening Balance,Locked Balance,KYC Tier,Card No",
      'Ama Mensah,0244 100 001,MAIN,susu,20,"GHS 400.00",0,simplified,CARD-001',
      'Kofi Boateng,+233244100002,MKT,savings,0,"1,250.00",20,full,SAV-002',
      "Duplicate Ama,0244100001,MAIN,susu,20,100,0,simplified,CARD-DUP"
    ].join("\n");

    const preview = await previewTenantMigration(
      TENANT_ID,
      {
        csvText: csv,
        cutoverDate: "2026-11-28",
        skipDuplicatePhones: true
      },
      ACTOR.userId
    );

    expect(preview.canCommit).toBe(true);
    expect(preview.readyCount).toBe(2);
    expect(preview.duplicateSkippedCount).toBe(1);
    expect(preview.errorCount).toBe(0);
    expect(preview.susuCount).toBe(1);
    expect(preview.savingsCount).toBe(1);
    expect(preview.totalOpeningBalance).toBe(1650);
    expect(preview.susuOpeningBalance).toBe(400);
    expect(preview.savingsOpeningBalance).toBe(1250);
    expect(preview.totalLockedBalance).toBe(20);
    expect(preview.branchTotals).toHaveLength(2);

    // Dry-run wrote zero customers
    const customersAfterPreview = await listCustomers(TENANT_ID);
    expect(customersAfterPreview).toHaveLength(0);
  });

  it("rejects commit when expectedTotalBalance does not match CSV control total", async () => {
    const csv = [
      "full_name,phone,branch_code,account_type,daily_contribution,opening_balance",
      "Test Client,0244999001,MAIN,susu,20,300"
    ].join("\n");

    await expect(
      commitTenantMigration(
        TENANT_ID,
        {
          csvText: csv,
          cutoverDate: "2026-11-28",
          expectedTotalBalance: 500
        },
        ACTOR
      )
    ).rejects.toThrow(/Control total mismatch/i);
  });

  it("commits Susu BBF (0 withdrawal fee), Savings locked balance, and keeps EOD cash untouched", async () => {
    const todayIso = new Date().toISOString().slice(0, 10);
    const csv = [
      "full_name,phone,branch_code,account_type,daily_contribution,opening_balance,locked_balance,kyc_tier,legacy_account_number",
      'Ama Mensah,0244100001,MAIN,susu,20,"400.00",0,simplified,CARD-001',
      'Kofi Boateng,0244100002,MKT,savings,0,"1,250.00",20,full,SAV-002'
    ].join("\n");

    const result = await commitTenantMigration(
      TENANT_ID,
      {
        csvText: csv,
        cutoverDate: todayIso,
        expectedTotalBalance: 1650
      },
      ACTOR
    );

    expect(result.importedCount).toBe(2);
    expect(result.totalOpeningBalance).toBe(1650);
    expect(result.certificateCsv).toContain("CARD-001");
    expect(result.certificateCsv).toContain("SAV-002");

    const ama = result.customers.find((c) => c.fullName === "Ama Mensah")!;
    const kofi = result.customers.find((c) => c.fullName === "Kofi Boateng")!;
    expect(ama.accountNumber).toMatch(/^233999\d{6}$/);
    expect(kofi.accountNumber).toMatch(/^233999\d{6}$/);

    // 1. Exact customer balances
    expect(await computeCustomerBalance(TENANT_ID, ama.customerId)).toBe(400);
    expect(await computeCustomerBalance(TENANT_ID, kofi.customerId)).toBe(1250);

    // 2. Savings locked balance respected (1250 - 20 = 1230 withdrawable)
    expect(await getCustomerWithdrawableBalance(TENANT_ID, kofi.customerId)).toBe(1230);

    // 3. Susu Cycle #1 seeded with BBF = 400, 0 boxes checked, and GHS 0 fee when withdrawing from BBF
    const cycleSummary = await getCustomerSusuCycleSummary(TENANT_ID, ama.customerId);
    expect(cycleSummary.openCycle?.balanceBroughtForward).toBe(400);
    expect(cycleSummary.openCycle?.collectionsCount).toBe(0);
    expect(cycleSummary.passbook.cards[0]?.balanceBroughtForward).toBe(400);
    expect(cycleSummary.passbook.cards[0]?.checkedBoxes).toBe(0);

    const withdrawalFee = await resolveSusuWithdrawalCommission(
      { tenantId: TENANT_ID, userId: ACTOR.userId, role: "admin" },
      {
        customerId: ama.customerId,
        branchId: branchMainId,
        requestedWithdrawalAmount: 250
      }
    );
    expect(withdrawalFee.blocked).toBe(false);
    expect(withdrawalFee.commissionToCollect).toBe(0);

    // 4. EOD Closing Balance on cutover day has ZERO false cash inflows
    const eodMain = await getSusuClosingBalance(
      TENANT_ID,
      { role: "admin", scopeType: "head_office" },
      branchMainId,
      todayIso
    );
    const eodSub = await getSusuClosingBalance(
      TENANT_ID,
      { role: "admin", scopeType: "head_office" },
      branchSubId,
      todayIso
    );
    expect(eodMain.fieldAgentDeposits).toBe(0);
    expect(eodMain.walkInDeposits).toBe(0);
    expect(eodSub.fieldAgentDeposits).toBe(0);
    expect(eodSub.walkInDeposits).toBe(0);

    // 5. Direct manual posting of opening_balance via createTransaction is blocked
    await expect(
      createTransaction(
        {
          userId: ACTOR.userId,
          tenantId: TENANT_ID,
          role: "admin",
          scopeType: "head_office"
        },
        {
          customerId: ama.customerId,
          type: "opening_balance",
          amount: 100,
          transactionBranchId: branchMainId
        }
      )
    ).rejects.toThrow(/Tenant Data Migration/i);
  });
});
