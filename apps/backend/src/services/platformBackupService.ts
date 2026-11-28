import { createHash } from "node:crypto";
import { getSupabaseAdminClient } from "../config/supabaseClient.js";
import { listPlatformTenants } from "./authService.js";
import { listUsersByTenant } from "./authStore.js";
import { listAuditLogs, verifyAuditLogChain, type AuditChainVerification } from "./auditService.js";
import { listBranches } from "./branchService.js";
import { listCustomers } from "./customerService.js";
import { getCompanyProfile } from "./tenantProfileService.js";
import { listTransactions } from "./transactionService.js";

export type PlatformTenantBackupSummary = {
  tenantId: string;
  companyName: string;
  subdomain?: string;
  subscriptionStatus: "active" | "inactive";
  totalCustomers: number;
  activeCustomers: number;
  totalTransactions: number;
  totalCustomerBalance: number;
  totalAuditLogs: number;
  lastTransactionAt: string | null;
  lastAuditAt: string | null;
};

export type PlatformBackupOverview = {
  generatedAt: string;
  storageMode: "supabase" | "memory";
  totals: {
    tenants: number;
    activeTenants: number;
    totalCustomers: number;
    activeCustomers: number;
    totalTransactions: number;
    totalCustomerBalance: number;
    totalAuditLogs: number;
  };
  tenants: PlatformTenantBackupSummary[];
};

export type TenantFinancialSnapshot = {
  formatVersion: "1.0";
  generatedAt: string;
  storageMode: "supabase" | "memory";
  includePhotos: boolean;
  tenant: {
    id: string;
    name: string;
    subdomain?: string;
    subscriptionStatus: "active" | "inactive";
    productModules: string[];
  };
  companyProfile: unknown;
  auditChainVerification: AuditChainVerification;
  summary: {
    branches: number;
    staff: number;
    customers: number;
    activeCustomers: number;
    transactions: number;
    ledgerEntries: number;
    totalCustomerBalance: number;
    susuCycles: number;
    collectionBatches: number;
    branchFloatSessions: number;
    cashVariances: number;
    loans: number;
    loanRepayments: number;
    auditLogs: number;
  };
  data: {
    branches: unknown[];
    staff: unknown[];
    customers: unknown[];
    transactions: unknown[];
    ledgerEntries: unknown[];
    susuCycles: unknown[];
    collectionBatches: unknown[];
    branchFloatSessions: unknown[];
    cashVariances: unknown[];
    loans: unknown[];
    loanRepayments: unknown[];
    auditLogs: unknown[];
  };
  integrity: {
    algorithm: "sha256";
    sha256: string;
  };
};

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function csvCell(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  const raw = String(value);
  if (/[",\r\n]/.test(raw)) {
    return `"${raw.replace(/"/g, '""')}"`;
  }
  return raw;
}

async function fetchOptionalTenantRows(
  table: string,
  tenantId: string,
  orderBy = "created_at"
): Promise<Record<string, unknown>[]> {
  const supabase = getSupabaseAdminClient();
  if (!supabase) {
    return [];
  }
  const query = supabase.from(table).select("*").eq("tenant_id", tenantId);
  const ordered = orderBy ? query.order(orderBy, { ascending: false }) : query;
  const { data, error } = await ordered.limit(20000);
  if (error || !data) {
    return [];
  }
  return data as Record<string, unknown>[];
}

function computeTxStatsFromTransactions(
  transactions: Array<{
    customerId: string;
    type: string;
    amount: number;
    createdAt?: string;
  }>
): Map<string, { deposits: number; withdrawals: number; net: number; lastAt: string | null }> {
  const map = new Map<
    string,
    { deposits: number; withdrawals: number; net: number; lastAt: string | null }
  >();
  for (const tx of transactions) {
    const entry = map.get(tx.customerId) ?? {
      deposits: 0,
      withdrawals: 0,
      net: 0,
      lastAt: null
    };
    const amt = Number(tx.amount) || 0;
    if (tx.type === "withdrawal" || tx.type === "susu_reversal") {
      entry.withdrawals = round2(entry.withdrawals + amt);
      entry.net = round2(entry.net - amt);
    } else if (tx.type === "deposit" || tx.type === "daily_susu" || tx.type === "opening_balance") {
      entry.deposits = round2(entry.deposits + amt);
      entry.net = round2(entry.net + amt);
    }
    if (tx.createdAt && (!entry.lastAt || tx.createdAt > entry.lastAt)) {
      entry.lastAt = tx.createdAt;
    }
    map.set(tx.customerId, entry);
  }
  return map;
}

export async function getPlatformBackupOverview(): Promise<PlatformBackupOverview> {
  const tenants = await listPlatformTenants();
  const supabase = getSupabaseAdminClient();
  const summaries: PlatformTenantBackupSummary[] = [];

  for (const tenant of tenants) {
    if (supabase) {
      const [custRes, ledgerRes, txCountRes, latestTxRes, auditCountRes, latestAuditRes] =
        await Promise.all([
          supabase.from("customers").select("id, status").eq("tenant_id", tenant.id),
          supabase
            .from("ledger_entries")
            .select("entry_type, amount")
            .eq("tenant_id", tenant.id),
          supabase
            .from("customer_transactions")
            .select("id", { count: "exact", head: true })
            .eq("tenant_id", tenant.id),
          supabase
            .from("customer_transactions")
            .select("created_at")
            .eq("tenant_id", tenant.id)
            .order("created_at", { ascending: false })
            .limit(1),
          supabase
            .from("audit_logs")
            .select("id", { count: "exact", head: true })
            .eq("tenant_id", tenant.id),
          supabase
            .from("audit_logs")
            .select("created_at")
            .eq("tenant_id", tenant.id)
            .order("created_at", { ascending: false })
            .limit(1)
        ]);

      const custRows = (!custRes.error && custRes.data ? custRes.data : []) as Array<{
        id: string;
        status: string;
      }>;
      const ledgerRows = (!ledgerRes.error && ledgerRes.data ? ledgerRes.data : []) as Array<{
        entry_type: string;
        amount: number;
      }>;

      let totalBalance = 0;
      for (const row of ledgerRows) {
        const amt = Number(row.amount) || 0;
        totalBalance += row.entry_type === "credit" ? amt : -amt;
      }

      const lastTransactionAt =
        !latestTxRes.error && latestTxRes.data?.[0]?.created_at
          ? String(latestTxRes.data[0].created_at)
          : null;

      const lastAuditAt =
        !latestAuditRes.error && latestAuditRes.data?.[0]?.created_at
          ? String(latestAuditRes.data[0].created_at)
          : null;

      summaries.push({
        tenantId: tenant.id,
        companyName: tenant.name,
        subdomain: tenant.subdomain,
        subscriptionStatus: tenant.subscriptionStatus,
        totalCustomers: custRows.length,
        activeCustomers: custRows.filter((c) => c.status === "active").length,
        totalTransactions: txCountRes.count ?? 0,
        totalCustomerBalance: round2(totalBalance),
        totalAuditLogs: auditCountRes.count ?? 0,
        lastTransactionAt,
        lastAuditAt
      });
    } else {
      const [customers, transactions, audits] = await Promise.all([
        listCustomers(tenant.id, { light: true }),
        listTransactions(tenant.id),
        listAuditLogs(tenant.id, { limit: 10000 })
      ]);

      let totalBalance = 0;
      for (const c of customers) {
        totalBalance += Number(c.accountBalance ?? 0);
      }

      let lastTransactionAt: string | null = null;
      for (const tx of transactions) {
        if (tx.createdAt && (!lastTransactionAt || tx.createdAt > lastTransactionAt)) {
          lastTransactionAt = tx.createdAt;
        }
      }

      summaries.push({
        tenantId: tenant.id,
        companyName: tenant.name,
        subdomain: tenant.subdomain,
        subscriptionStatus: tenant.subscriptionStatus,
        totalCustomers: customers.length,
        activeCustomers: customers.filter((c) => c.status === "active").length,
        totalTransactions: transactions.length,
        totalCustomerBalance: round2(totalBalance),
        totalAuditLogs: audits.length,
        lastTransactionAt,
        lastAuditAt: audits[0]?.createdAt ?? null
      });
    }
  }

  const totals = summaries.reduce(
    (acc, row) => {
      acc.tenants += 1;
      if (row.subscriptionStatus === "active") acc.activeTenants += 1;
      acc.totalCustomers += row.totalCustomers;
      acc.activeCustomers += row.activeCustomers;
      acc.totalTransactions += row.totalTransactions;
      acc.totalCustomerBalance = round2(acc.totalCustomerBalance + row.totalCustomerBalance);
      acc.totalAuditLogs += row.totalAuditLogs;
      return acc;
    },
    {
      tenants: 0,
      activeTenants: 0,
      totalCustomers: 0,
      activeCustomers: 0,
      totalTransactions: 0,
      totalCustomerBalance: 0,
      totalAuditLogs: 0
    }
  );

  return {
    generatedAt: new Date().toISOString(),
    storageMode: supabase ? "supabase" : "memory",
    totals,
    tenants: summaries
  };
}

export async function verifyTenantAuditIntegrity(tenantId: string): Promise<
  AuditChainVerification & {
    tenantId: string;
    checkedAt: string;
    ok: boolean;
    firstBrokenId?: string;
    firstBrokenReason?: string;
  }
> {
  const tenants = await listPlatformTenants();
  if (!tenants.some((t) => t.id === tenantId)) {
    throw new Error("Tenant not found");
  }
  const result = await verifyAuditLogChain(tenantId);
  return {
    tenantId,
    checkedAt: result.verifiedAt || new Date().toISOString(),
    ok: result.valid,
    firstBrokenId: result.brokenId ?? undefined,
    firstBrokenReason: result.reason,
    ...result
  };
}

export async function buildTenantFinancialSnapshot(
  tenantId: string,
  options?: { includePhotos?: boolean }
): Promise<TenantFinancialSnapshot> {
  const includePhotos = options?.includePhotos === true;
  const tenants = await listPlatformTenants();
  const tenant = tenants.find((t) => t.id === tenantId);
  if (!tenant) {
    throw new Error("Tenant not found");
  }

  const supabase = getSupabaseAdminClient();

  const [
    companyProfile,
    branches,
    rawUsers,
    customers,
    transactions,
    ledgerEntries,
    auditLogs,
    auditChainVerification,
    susuCycles,
    collectionBatches,
    branchFloatSessions,
    cashVariances,
    loans,
    loanRepayments
  ] = await Promise.all([
    getCompanyProfile(tenantId).catch(() => null),
    listBranches(tenantId),
    listUsersByTenant(tenantId),
    listCustomers(tenantId, { light: !includePhotos }),
    listTransactions(tenantId),
    fetchOptionalTenantRows("ledger_entries", tenantId),
    listAuditLogs(tenantId, { limit: 10000 }),
    verifyAuditLogChain(tenantId),
    fetchOptionalTenantRows("susu_customer_cycles", tenantId),
    fetchOptionalTenantRows("field_agent_collection_batches", tenantId),
    fetchOptionalTenantRows("branch_float_sessions", tenantId),
    fetchOptionalTenantRows("cash_variance_cases", tenantId),
    fetchOptionalTenantRows("loan_applications", tenantId),
    fetchOptionalTenantRows("loan_repayments", tenantId)
  ]);

  // Never include password hashes or credential material in backup snapshots
  const sanitizedStaff = rawUsers.map((u) => ({
    id: u.id,
    email: u.email,
    fullName: u.fullName,
    role: u.role,
    branchId: u.branchId,
    scopeType: u.scopeType,
    status: u.status
  }));

  const sanitizedCustomers = includePhotos
    ? customers
    : customers.map((c) => {
        const { photoUrl: _p, idCardPhotoUrl: _id, ...rest } = c;
        return rest;
      });

  let totalCustomerBalance = 0;
  for (const c of customers) {
    totalCustomerBalance = round2(totalCustomerBalance + Number(c.accountBalance ?? 0));
  }

  const data = {
    branches,
    staff: sanitizedStaff,
    customers: sanitizedCustomers,
    transactions,
    ledgerEntries,
    susuCycles,
    collectionBatches,
    branchFloatSessions,
    cashVariances,
    loans,
    loanRepayments,
    auditLogs
  };

  const sha256 = createHash("sha256").update(JSON.stringify(data)).digest("hex");

  return {
    formatVersion: "1.0",
    generatedAt: new Date().toISOString(),
    storageMode: supabase ? "supabase" : "memory",
    includePhotos,
    tenant: {
      id: tenant.id,
      name: tenant.name,
      subdomain: tenant.subdomain,
      subscriptionStatus: tenant.subscriptionStatus,
      productModules: [...tenant.subscribedModules]
    },
    companyProfile,
    auditChainVerification,
    summary: {
      branches: branches.length,
      staff: sanitizedStaff.length,
      customers: sanitizedCustomers.length,
      activeCustomers: customers.filter((c) => c.status === "active").length,
      transactions: transactions.length,
      ledgerEntries: ledgerEntries.length,
      totalCustomerBalance,
      susuCycles: susuCycles.length,
      collectionBatches: collectionBatches.length,
      branchFloatSessions: branchFloatSessions.length,
      cashVariances: cashVariances.length,
      loans: loans.length,
      loanRepayments: loanRepayments.length,
      auditLogs: auditLogs.length
    },
    data,
    integrity: {
      algorithm: "sha256",
      sha256
    }
  };
}

export async function buildTenantBalancesCsv(tenantId: string): Promise<{
  filename: string;
  csv: string;
  rowCount: number;
}> {
  const tenants = await listPlatformTenants();
  const tenant = tenants.find((t) => t.id === tenantId);
  if (!tenant) {
    throw new Error("Tenant not found");
  }

  const [branches, customers, transactions] = await Promise.all([
    listBranches(tenantId),
    listCustomers(tenantId, { light: true }),
    listTransactions(tenantId)
  ]);

  const branchNameById = new Map(branches.map((b) => [b.id, `${b.name} (${b.code})`]));
  const txStatsMap = computeTxStatsFromTransactions(transactions);

  const headers = [
    "Customer ID",
    "Account Number",
    "Full Name",
    "Phone",
    "Account Type",
    "Status",
    "Branch",
    "Field Agent",
    "Daily Contribution (GHS)",
    "Locked Balance (GHS)",
    "Total Credits (GHS)",
    "Total Withdrawals (GHS)",
    "Net Ledger Balance (GHS)",
    "Withdrawable Balance (GHS)",
    "Last Transaction At"
  ];

  const rows: string[] = [headers.map(csvCell).join(",")];
  for (const c of customers) {
    const stats = txStatsMap.get(c.id) ?? {
      deposits: 0,
      withdrawals: 0,
      net: 0,
      lastAt: null
    };
    const netBalance = round2(Number(c.accountBalance ?? stats.net));
    const locked = round2(Number(c.lockedBalance ?? 0));
    const withdrawable = round2(
      c.withdrawableBalance !== undefined
        ? Number(c.withdrawableBalance)
        : Math.max(0, netBalance - locked)
    );
    rows.push(
      [
        c.id,
        c.accountNumber ?? "",
        c.fullName,
        c.phone,
        c.accountType ?? "",
        c.status,
        branchNameById.get(c.homeBranchId) ?? c.homeBranchId,
        c.assignedFieldAgentName ?? c.createdByFieldAgentName ?? "",
        round2(Number(c.dailyContributionAmount ?? 0)).toFixed(2),
        locked.toFixed(2),
        stats.deposits.toFixed(2),
        stats.withdrawals.toFixed(2),
        netBalance.toFixed(2),
        withdrawable.toFixed(2),
        stats.lastAt ?? ""
      ]
        .map(csvCell)
        .join(",")
    );
  }

  const slug = (tenant.subdomain || tenant.name || tenant.id)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  const datePart = new Date().toISOString().slice(0, 10);

  return {
    filename: `${slug || "tenant"}-balances-${datePart}.csv`,
    csv: rows.join("\r\n"),
    rowCount: customers.length
  };
}

export async function buildAllTenantsSnapshot(options?: {
  includePhotos?: boolean;
}): Promise<{
  formatVersion: "1.0";
  generatedAt: string;
  includePhotos: boolean;
  tenantCount: number;
  snapshots: TenantFinancialSnapshot[];
  integrity: {
    algorithm: "sha256";
    sha256: string;
  };
}> {
  const tenants = await listPlatformTenants();
  const snapshots: TenantFinancialSnapshot[] = [];
  for (const t of tenants) {
    snapshots.push(await buildTenantFinancialSnapshot(t.id, options));
  }
  const sha256 = createHash("sha256")
    .update(snapshots.map((s) => `${s.tenant.id}:${s.integrity.sha256}`).join("|"))
    .digest("hex");

  return {
    formatVersion: "1.0",
    generatedAt: new Date().toISOString(),
    includePhotos: options?.includePhotos === true,
    tenantCount: snapshots.length,
    snapshots,
    integrity: {
      algorithm: "sha256",
      sha256
    }
  };
}
