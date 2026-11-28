import { createHash } from "node:crypto";
import { getSupabaseAdminClient } from "../config/supabaseClient.js";
import { listPlatformTenants } from "./authService.js";
import { listUsersByTenant } from "./authStore.js";
import { listBranches } from "./branchService.js";
import { createMigratedActiveCustomer, listCustomers } from "./customerService.js";
import { seedOpeningBalanceSusuCycle } from "./susuCycleCommissionService.js";
import { recordOpeningBalanceTransaction } from "./transactionService.js";

export type MigrationBranchSummary = {
  id: string;
  code: string;
  name: string;
};

export type MigrationAgentSummary = {
  id: string;
  fullName: string;
  email: string;
  role: string;
  branchId: string | null;
};

export type TenantMigrationContext = {
  tenant: {
    id: string;
    name: string;
    subdomain: string;
    subscriptionStatus: string;
  };
  existingCustomerCount: number;
  branches: MigrationBranchSummary[];
  staff: MigrationAgentSummary[];
  templateCsv: string;
  templateFilename: string;
};

export type MigrationPreviewRowStatus = "ready" | "duplicate_skipped" | "error";

export type MigrationPreviewRow = {
  rowNumber: number;
  status: MigrationPreviewRowStatus;
  fullName: string;
  phone: string;
  branchCode: string;
  branchId: string | null;
  branchName: string | null;
  assignedAgentLabel: string;
  assignedAgentId: string | null;
  accountType: "susu" | "savings";
  dailyContributionAmount: number;
  openingBalance: number;
  lockedBalance: number;
  kycTier: "full" | "simplified";
  legacyAccountNumber: string;
  idCardNumber: string;
  location: string;
  occupation: string;
  email: string;
  nextOfKinName: string;
  nextOfKinPhone: string;
  issues: string[];
};

export type MigrationBranchTotal = {
  branchId: string;
  branchCode: string;
  branchName: string;
  customerCount: number;
  susuCount: number;
  savingsCount: number;
  totalOpeningBalance: number;
  totalLockedBalance: number;
};

export type TenantMigrationPreview = {
  tenantId: string;
  tenantName: string;
  cutoverDate: string;
  csvSha256: string;
  totalRows: number;
  readyCount: number;
  duplicateSkippedCount: number;
  errorCount: number;
  susuCount: number;
  savingsCount: number;
  simplifiedKycCount: number;
  fullKycCount: number;
  totalOpeningBalance: number;
  susuOpeningBalance: number;
  savingsOpeningBalance: number;
  totalLockedBalance: number;
  branchTotals: MigrationBranchTotal[];
  rows: MigrationPreviewRow[];
  canCommit: boolean;
};

export type MigrationCommittedCustomer = {
  rowNumber: number;
  customerId: string;
  accountNumber: string;
  legacyAccountNumber: string;
  fullName: string;
  phone: string;
  branchCode: string;
  branchName: string;
  assignedAgentLabel: string;
  accountType: "susu" | "savings";
  dailyContributionAmount: number;
  openingBalance: number;
  lockedBalance: number;
  kycTier: "full" | "simplified";
  openingTransactionId: string | null;
};

export type TenantMigrationCommitResult = {
  tenantId: string;
  tenantName: string;
  cutoverDate: string;
  committedAt: string;
  csvSha256: string;
  importedCount: number;
  duplicateSkippedCount: number;
  susuCount: number;
  savingsCount: number;
  totalOpeningBalance: number;
  susuOpeningBalance: number;
  savingsOpeningBalance: number;
  totalLockedBalance: number;
  branchTotals: MigrationBranchTotal[];
  customers: MigrationCommittedCustomer[];
  certificateCsv: string;
  certificateFilename: string;
};

export type MigrationInputOptions = {
  csvText: string;
  cutoverDate: string;
  defaultBranchCode?: string;
  defaultKycTier?: "simplified" | "full";
  skipDuplicatePhones?: boolean;
};

const MAX_MIGRATION_ROWS = 2500;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function csvCell(value: unknown): string {
  const s = value == null ? "" : String(value);
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function normalizeHeader(raw: string): string {
  return raw
    .replace(/^\uFEFF/, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/**
 * RFC-4180 CSV parser supporting quoted fields, embedded commas/newlines, BOM, and CRLF/LF.
 */
export function parseCsvRecords(csvText: string): string[][] {
  const text = csvText.replace(/^\uFEFF/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\r") {
      if (text[i + 1] === "\n") {
        i += 1;
      }
      row.push(field);
      field = "";
      if (row.some((cell) => cell.trim() !== "")) {
        rows.push(row);
      }
      row = [];
    } else if (ch === "\n") {
      row.push(field);
      field = "";
      if (row.some((cell) => cell.trim() !== "")) {
        rows.push(row);
      }
      row = [];
    } else {
      field += ch;
    }
  }

  row.push(field);
  if (row.some((cell) => cell.trim() !== "")) {
    rows.push(row);
  }

  return rows;
}

function normalizePhoneKey(phone: string): string {
  const digits = phone.replace(/\D+/g, "");
  if (digits.startsWith("233") && digits.length === 12) {
    return `0${digits.slice(3)}`;
  }
  return digits;
}

function parseMoneyCell(raw: string): { value: number; valid: boolean } {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { value: 0, valid: true };
  }
  const cleaned = trimmed
    .replace(/ghs/gi, "")
    .replace(/gh₵/gi, "")
    .replace(/₵/g, "")
    .replace(/,/g, "")
    .replace(/\s+/g, "");
  const num = Number(cleaned);
  if (!Number.isFinite(num)) {
    return { value: 0, valid: false };
  }
  return { value: round2(num), valid: true };
}

type CanonicalColumn =
  | "full_name"
  | "phone"
  | "branch_code"
  | "assigned_agent"
  | "account_type"
  | "daily_contribution"
  | "opening_balance"
  | "locked_balance"
  | "kyc_tier"
  | "legacy_account_number"
  | "id_card_number"
  | "location"
  | "occupation"
  | "email"
  | "next_of_kin_name"
  | "next_of_kin_phone";

const HEADER_ALIASES: Record<string, CanonicalColumn> = {
  full_name: "full_name",
  fullname: "full_name",
  name: "full_name",
  customer_name: "full_name",
  client_name: "full_name",

  phone: "phone",
  phone_number: "phone",
  mobile: "phone",
  mobile_number: "phone",
  telephone: "phone",
  contact: "phone",

  branch_code: "branch_code",
  branch: "branch_code",
  branch_name: "branch_code",
  home_branch: "branch_code",

  assigned_agent: "assigned_agent",
  agent_email: "assigned_agent",
  field_agent: "assigned_agent",
  mobilizer: "assigned_agent",
  mobilizer_email: "assigned_agent",
  agent: "assigned_agent",

  account_type: "account_type",
  type: "account_type",
  product: "account_type",
  account: "account_type",

  daily_contribution: "daily_contribution",
  daily_contribution_amount: "daily_contribution",
  daily_rate: "daily_contribution",
  daily_amount: "daily_contribution",
  daily_susu: "daily_contribution",
  rate: "daily_contribution",

  opening_balance: "opening_balance",
  balance_brought_forward: "opening_balance",
  bbf: "opening_balance",
  brought_forward: "opening_balance",
  balance: "opening_balance",
  current_balance: "opening_balance",

  locked_balance: "locked_balance",
  locked_minimum: "locked_balance",
  minimum_balance: "locked_balance",
  savings_lock: "locked_balance",

  kyc_tier: "kyc_tier",
  kyc: "kyc_tier",

  legacy_account_number: "legacy_account_number",
  legacy_ref: "legacy_account_number",
  card_number: "legacy_account_number",
  card_no: "legacy_account_number",
  old_account_number: "legacy_account_number",
  passbook_no: "legacy_account_number",
  passbook_number: "legacy_account_number",

  id_card_number: "id_card_number",
  ghana_card: "id_card_number",
  ghana_card_number: "id_card_number",
  id_number: "id_card_number",

  location: "location",
  address: "location",
  town: "location",

  occupation: "occupation",
  work: "occupation",
  trade: "occupation",

  email: "email",

  next_of_kin_name: "next_of_kin_name",
  nok_name: "next_of_kin_name",
  kin_name: "next_of_kin_name",

  next_of_kin_phone: "next_of_kin_phone",
  nok_phone: "next_of_kin_phone",
  kin_phone: "next_of_kin_phone"
};

function buildTemplateCsv(
  branches: MigrationBranchSummary[],
  staff: MigrationAgentSummary[]
): string {
  const headers = [
    "full_name",
    "phone",
    "branch_code",
    "assigned_agent",
    "account_type",
    "daily_contribution",
    "opening_balance",
    "locked_balance",
    "kyc_tier",
    "legacy_account_number",
    "id_card_number",
    "location",
    "occupation",
    "next_of_kin_name",
    "next_of_kin_phone"
  ];
  const sampleBranch = branches[0]?.code ?? "MAIN";
  const fieldAgent =
    staff.find((s) => s.role === "field_agent") ?? staff[0];
  const sampleAgent = fieldAgent?.email ?? "";

  const sampleRows = [
    [
      "Ama Mensah",
      "0244000111",
      sampleBranch,
      sampleAgent,
      "susu",
      "20",
      "460.00",
      "0",
      "simplified",
      "CARD-001",
      "",
      "Central Market",
      "Trader",
      "Kwame Mensah",
      "0244000222"
    ],
    [
      "Kofi Boateng",
      "0554000333",
      sampleBranch,
      sampleAgent,
      "savings",
      "0",
      "1250.00",
      "20",
      "full",
      "SAV-042",
      "GHA-123456789-0",
      "High Street",
      "Mechanic",
      "Abena Boateng",
      "0554000444"
    ]
  ];

  return [
    headers.map(csvCell).join(","),
    ...sampleRows.map((r) => r.map(csvCell).join(","))
  ].join("\n");
}

function resolveTenantSlug(name: string, subdomain: string, id: string): string {
  return (
    (subdomain || name || id)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "tenant"
  );
}

async function resolveTenantRecord(tenantId: string): Promise<{
  id: string;
  name: string;
  subdomain: string;
  subscriptionStatus: string;
}> {
  const tenants = await listPlatformTenants();
  const match = tenants.find((t) => t.id === tenantId);
  if (!match) {
    throw new Error(`Tenant '${tenantId}' not found`);
  }
  return {
    id: match.id,
    name: match.name,
    subdomain: match.subdomain ?? match.id,
    subscriptionStatus: match.subscriptionStatus
  };
}

async function loadTenantActiveStaff(tenantId: string): Promise<MigrationAgentSummary[]> {
  const supabase = getSupabaseAdminClient();
  if (supabase) {
    const { data, error } = await supabase
      .from("users")
      .select("id, email, full_name, role, branch_id, status")
      .eq("tenant_id", tenantId)
      .order("full_name", { ascending: true });
    if (error) {
      throw new Error(`Failed to list tenant staff: ${error.message}`);
    }
    return (data ?? [])
      .filter((row) => (row.status ?? "active") === "active")
      .map((row) => ({
        id: String(row.id),
        fullName: String(row.full_name ?? "").trim() || String(row.email ?? ""),
        email: String(row.email ?? ""),
        role: String(row.role ?? ""),
        branchId: row.branch_id ? String(row.branch_id) : null
      }));
  }

  return listUsersByTenant(tenantId)
    .filter((u) => (u.status ?? "active") === "active")
    .map((u) => ({
      id: u.id,
      fullName: u.fullName?.trim() || u.email,
      email: u.email,
      role: u.role,
      branchId: u.branchId ?? null
    }));
}

export async function getTenantMigrationContext(
  tenantId: string
): Promise<TenantMigrationContext> {
  const tenant = await resolveTenantRecord(tenantId);
  const [branches, staffList, customers] = await Promise.all([
    listBranches(tenantId),
    loadTenantActiveStaff(tenantId),
    listCustomers(tenantId)
  ]);

  const branchSummaries: MigrationBranchSummary[] = branches.map((b) => ({
    id: b.id,
    code: b.code,
    name: b.name
  }));

  const staffSummaries: MigrationAgentSummary[] = [...staffList].sort((a, b) => {
    if (a.role === "field_agent" && b.role !== "field_agent") return -1;
    if (b.role === "field_agent" && a.role !== "field_agent") return 1;
    return a.fullName.localeCompare(b.fullName);
  });

  const slug = resolveTenantSlug(tenant.name, tenant.subdomain, tenant.id);

  return {
    tenant,
    existingCustomerCount: customers.length,
    branches: branchSummaries,
    staff: staffSummaries,
    templateCsv: buildTemplateCsv(branchSummaries, staffSummaries),
    templateFilename: `${slug}-opening-balances-template.csv`
  };
}

export async function previewTenantMigration(
  tenantId: string,
  options: MigrationInputOptions,
  actorUserId: string
): Promise<TenantMigrationPreview> {
  const cutoverDate = options.cutoverDate?.trim();
  if (!cutoverDate || !ISO_DATE_RE.test(cutoverDate)) {
    throw new Error("Cutover date must be in YYYY-MM-DD format.");
  }
  const csvText = options.csvText ?? "";
  if (!csvText.trim()) {
    throw new Error("CSV content is empty. Upload or paste at least one customer row.");
  }

  const records = parseCsvRecords(csvText);
  if (records.length < 2) {
    throw new Error("CSV must include a header row and at least one customer data row.");
  }

  const dataRowCount = records.length - 1;
  if (dataRowCount > MAX_MIGRATION_ROWS) {
    throw new Error(
      `Batch size (${dataRowCount}) exceeds the ${MAX_MIGRATION_ROWS}-row limit per upload. Split into smaller branch files.`
    );
  }

  const headerRow = records[0]!;
  const columnMap = new Map<CanonicalColumn, number>();
  headerRow.forEach((rawHeader, idx) => {
    const canonical = HEADER_ALIASES[normalizeHeader(rawHeader)];
    if (canonical && !columnMap.has(canonical)) {
      columnMap.set(canonical, idx);
    }
  });

  if (!columnMap.has("full_name") || !columnMap.has("phone")) {
    throw new Error(
      "CSV header must include at least 'full_name' and 'phone' columns. Download the template to see all supported columns."
    );
  }

  const [tenant, branches, activeUsers, existingCustomers] = await Promise.all([
    resolveTenantRecord(tenantId),
    listBranches(tenantId),
    loadTenantActiveStaff(tenantId),
    listCustomers(tenantId)
  ]);

  if (branches.length === 0) {
    throw new Error(
      `Tenant '${tenant.name}' has no branches configured yet. Create at least one branch before importing customers.`
    );
  }

  const branchByKey = new Map<string, MigrationBranchSummary>();
  for (const b of branches) {
    const summary: MigrationBranchSummary = { id: b.id, code: b.code, name: b.name };
    branchByKey.set(b.code.trim().toLowerCase(), summary);
    branchByKey.set(b.name.trim().toLowerCase(), summary);
    branchByKey.set(b.id.trim().toLowerCase(), summary);
  }

  const defaultBranch =
    (options.defaultBranchCode
      ? branchByKey.get(options.defaultBranchCode.trim().toLowerCase())
      : undefined) ?? (branches.length === 1 ? { id: branches[0]!.id, code: branches[0]!.code, name: branches[0]!.name } : undefined);

  const userByKey = new Map<string, MigrationAgentSummary>();
  for (const summary of activeUsers) {
    userByKey.set(summary.email.trim().toLowerCase(), summary);
    userByKey.set(summary.id.trim().toLowerCase(), summary);
    if (summary.fullName.trim()) {
      userByKey.set(summary.fullName.trim().toLowerCase(), summary);
    }
  }

  const existingPhoneKeys = new Set<string>(
    existingCustomers.map((c) => normalizePhoneKey(c.phone)).filter(Boolean)
  );
  const seenInCsvPhones = new Map<string, number>();

  const skipDuplicatePhones = options.skipDuplicatePhones !== false;
  const defaultKycTier = options.defaultKycTier ?? "simplified";

  const getCell = (row: string[], col: CanonicalColumn): string => {
    const idx = columnMap.get(col);
    if (idx === undefined) return "";
    return (row[idx] ?? "").trim();
  };

  const previewRows: MigrationPreviewRow[] = [];
  const branchTotalsMap = new Map<string, MigrationBranchTotal>();

  let readyCount = 0;
  let duplicateSkippedCount = 0;
  let errorCount = 0;
  let susuCount = 0;
  let savingsCount = 0;
  let simplifiedKycCount = 0;
  let fullKycCount = 0;
  let totalOpeningBalance = 0;
  let susuOpeningBalance = 0;
  let savingsOpeningBalance = 0;
  let totalLockedBalance = 0;

  for (let i = 1; i < records.length; i += 1) {
    const raw = records[i]!;
    const rowNumber = i + 1;
    const issues: string[] = [];

    const fullName = getCell(raw, "full_name");
    const phone = getCell(raw, "phone");
    const branchCell = getCell(raw, "branch_code");
    const agentCell = getCell(raw, "assigned_agent");
    const accountTypeRaw = getCell(raw, "account_type").toLowerCase();
    const dailyRaw = getCell(raw, "daily_contribution");
    const openingRaw = getCell(raw, "opening_balance");
    const lockedRaw = getCell(raw, "locked_balance");
    const kycRaw = getCell(raw, "kyc_tier").toLowerCase();
    const legacyAccountNumber = getCell(raw, "legacy_account_number");
    const idCardNumber = getCell(raw, "id_card_number");
    const location = getCell(raw, "location");
    const occupation = getCell(raw, "occupation");
    const email = getCell(raw, "email");
    const nextOfKinName = getCell(raw, "next_of_kin_name");
    const nextOfKinPhone = getCell(raw, "next_of_kin_phone");

    if (!fullName || fullName.length < 2) {
      issues.push("Missing or invalid full_name");
    }

    const phoneKey = normalizePhoneKey(phone);
    if (!phone || phoneKey.length < 7) {
      issues.push("Missing or invalid phone number");
    }

    // Branch resolution
    let resolvedBranch: MigrationBranchSummary | undefined;
    if (branchCell) {
      resolvedBranch = branchByKey.get(branchCell.toLowerCase());
      if (!resolvedBranch) {
        issues.push(`Unknown branch '${branchCell}'`);
      }
    } else if (defaultBranch) {
      resolvedBranch = defaultBranch;
    } else {
      issues.push("Missing branch_code (and no default branch selected)");
    }

    // Account type
    let accountType: "susu" | "savings" = "susu";
    if (!accountTypeRaw || accountTypeRaw === "susu" || accountTypeRaw === "daily_susu" || accountTypeRaw === "daily susu") {
      accountType = "susu";
    } else if (
      accountTypeRaw === "savings" ||
      accountTypeRaw === "normal_savings" ||
      accountTypeRaw === "normal savings"
    ) {
      accountType = "savings";
    } else {
      issues.push(`Unsupported account_type '${accountTypeRaw}' (use 'susu' or 'savings')`);
    }

    // Agent resolution
    let resolvedAgent: MigrationAgentSummary | undefined;
    if (agentCell) {
      resolvedAgent = userByKey.get(agentCell.toLowerCase());
      if (!resolvedAgent) {
        issues.push(`Unknown staff/agent '${agentCell}'`);
      }
    } else if (resolvedBranch) {
      resolvedAgent =
        activeUsers
          .filter((u) => u.role === "field_agent" && u.branchId === resolvedBranch!.id)
          .map((u) => ({
            id: u.id,
            fullName: u.fullName?.trim() || u.email,
            email: u.email,
            role: u.role,
            branchId: u.branchId ?? null
          }))[0] ??
        activeUsers
          .filter((u) => u.role === "admin" || u.role === "coordinator")
          .map((u) => ({
            id: u.id,
            fullName: u.fullName?.trim() || u.email,
            email: u.email,
            role: u.role,
            branchId: u.branchId ?? null
          }))[0];
    }

    const assignedAgentId = resolvedAgent?.id ?? actorUserId;
    const assignedAgentLabel = resolvedAgent
      ? `${resolvedAgent.fullName} (${resolvedAgent.email})`
      : "Migration Admin";

    // Money fields
    const openingParsed = parseMoneyCell(openingRaw);
    if (!openingParsed.valid || openingParsed.value < 0) {
      issues.push(`Invalid opening_balance '${openingRaw}' (must be >= 0)`);
    }
    const openingBalance = openingParsed.valid ? Math.max(0, openingParsed.value) : 0;

    const dailyParsed = parseMoneyCell(dailyRaw);
    if (!dailyParsed.valid || dailyParsed.value < 0) {
      issues.push(`Invalid daily_contribution '${dailyRaw}' (must be >= 0)`);
    }
    const dailyContributionAmount =
      accountType === "susu" && dailyParsed.valid ? Math.max(0, dailyParsed.value) : 0;

    const lockedParsed = parseMoneyCell(lockedRaw);
    if (!lockedParsed.valid || lockedParsed.value < 0) {
      issues.push(`Invalid locked_balance '${lockedRaw}' (must be >= 0)`);
    }
    const lockedBalance =
      accountType === "savings" && lockedParsed.valid ? Math.max(0, lockedParsed.value) : 0;
    if (accountType === "savings" && lockedBalance > openingBalance) {
      issues.push(
        `locked_balance (${lockedBalance.toFixed(2)}) cannot exceed opening_balance (${openingBalance.toFixed(2)})`
      );
    }

    // KYC tier
    let kycTier: "full" | "simplified" = defaultKycTier;
    if (kycRaw === "full" || kycRaw === "tier2" || kycRaw === "tier_2" || kycRaw === "full_kyc") {
      kycTier = "full";
    } else if (
      kycRaw === "simplified" ||
      kycRaw === "tier1" ||
      kycRaw === "tier_1" ||
      kycRaw === "tier 1"
    ) {
      kycTier = "simplified";
    } else if (kycRaw) {
      issues.push(`Unsupported kyc_tier '${kycRaw}' (use 'simplified' or 'full')`);
    } else if (!idCardNumber && defaultKycTier === "full") {
      kycTier = "simplified";
    }

    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      issues.push(`Invalid email '${email}'`);
    }

    // Duplicate phone detection
    let isDuplicate = false;
    if (phoneKey.length >= 7) {
      if (existingPhoneKeys.has(phoneKey)) {
        isDuplicate = true;
        issues.push("Phone number already exists in this company");
      } else if (seenInCsvPhones.has(phoneKey)) {
        isDuplicate = true;
        issues.push(`Duplicate phone number in CSV (first seen on row ${seenInCsvPhones.get(phoneKey)})`);
      } else {
        seenInCsvPhones.set(phoneKey, rowNumber);
      }
    }

    let status: MigrationPreviewRowStatus;
    if (isDuplicate && skipDuplicatePhones && issues.length === 1) {
      status = "duplicate_skipped";
      duplicateSkippedCount += 1;
    } else if (issues.length > 0) {
      status = "error";
      errorCount += 1;
    } else {
      status = "ready";
      readyCount += 1;
      if (accountType === "susu") {
        susuCount += 1;
        susuOpeningBalance = round2(susuOpeningBalance + openingBalance);
      } else {
        savingsCount += 1;
        savingsOpeningBalance = round2(savingsOpeningBalance + openingBalance);
      }
      if (kycTier === "simplified") {
        simplifiedKycCount += 1;
      } else {
        fullKycCount += 1;
      }
      totalOpeningBalance = round2(totalOpeningBalance + openingBalance);
      totalLockedBalance = round2(totalLockedBalance + lockedBalance);

      if (resolvedBranch) {
        const current = branchTotalsMap.get(resolvedBranch.id) ?? {
          branchId: resolvedBranch.id,
          branchCode: resolvedBranch.code,
          branchName: resolvedBranch.name,
          customerCount: 0,
          susuCount: 0,
          savingsCount: 0,
          totalOpeningBalance: 0,
          totalLockedBalance: 0
        };
        current.customerCount += 1;
        if (accountType === "susu") current.susuCount += 1;
        else current.savingsCount += 1;
        current.totalOpeningBalance = round2(current.totalOpeningBalance + openingBalance);
        current.totalLockedBalance = round2(current.totalLockedBalance + lockedBalance);
        branchTotalsMap.set(resolvedBranch.id, current);
      }
    }

    previewRows.push({
      rowNumber,
      status,
      fullName,
      phone,
      branchCode: resolvedBranch?.code ?? branchCell,
      branchId: resolvedBranch?.id ?? null,
      branchName: resolvedBranch?.name ?? null,
      assignedAgentLabel,
      assignedAgentId,
      accountType,
      dailyContributionAmount,
      openingBalance,
      lockedBalance,
      kycTier,
      legacyAccountNumber,
      idCardNumber,
      location,
      occupation,
      email,
      nextOfKinName,
      nextOfKinPhone,
      issues
    });
  }

  const csvSha256 = createHash("sha256").update(csvText, "utf8").digest("hex");

  return {
    tenantId: tenant.id,
    tenantName: tenant.name,
    cutoverDate,
    csvSha256,
    totalRows: previewRows.length,
    readyCount,
    duplicateSkippedCount,
    errorCount,
    susuCount,
    savingsCount,
    simplifiedKycCount,
    fullKycCount,
    totalOpeningBalance,
    susuOpeningBalance,
    savingsOpeningBalance,
    totalLockedBalance,
    branchTotals: [...branchTotalsMap.values()].sort((a, b) =>
      a.branchCode.localeCompare(b.branchCode)
    ),
    rows: previewRows,
    canCommit: readyCount > 0 && errorCount === 0
  };
}

function buildCertificateCsv(
  tenantName: string,
  cutoverDate: string,
  customers: MigrationCommittedCustomer[]
): string {
  const headers = [
    "company",
    "cutover_date",
    "row_number",
    "account_number",
    "legacy_account_number",
    "full_name",
    "phone",
    "branch_code",
    "branch_name",
    "assigned_agent",
    "account_type",
    "daily_contribution_ghs",
    "opening_balance_ghs",
    "locked_balance_ghs",
    "kyc_tier",
    "opening_transaction_id"
  ];
  const lines = [headers.map(csvCell).join(",")];
  for (const c of customers) {
    lines.push(
      [
        tenantName,
        cutoverDate,
        c.rowNumber,
        c.accountNumber,
        c.legacyAccountNumber,
        c.fullName,
        c.phone,
        c.branchCode,
        c.branchName,
        c.assignedAgentLabel,
        c.accountType,
        c.dailyContributionAmount.toFixed(2),
        c.openingBalance.toFixed(2),
        c.lockedBalance.toFixed(2),
        c.kycTier,
        c.openingTransactionId ?? ""
      ]
        .map(csvCell)
        .join(",")
    );
  }
  return lines.join("\n");
}

export async function commitTenantMigration(
  tenantId: string,
  options: MigrationInputOptions & { expectedTotalBalance?: number },
  actor: { userId: string; role: string }
): Promise<TenantMigrationCommitResult> {
  const preview = await previewTenantMigration(tenantId, options, actor.userId);

  if (preview.errorCount > 0) {
    throw new Error(
      `Cannot commit migration: ${preview.errorCount} row(s) have validation errors. Fix all red rows first.`
    );
  }
  if (preview.readyCount === 0) {
    throw new Error("No valid customer rows to import.");
  }

  if (
    typeof options.expectedTotalBalance === "number" &&
    Number.isFinite(options.expectedTotalBalance)
  ) {
    const diff = Math.abs(round2(options.expectedTotalBalance) - preview.totalOpeningBalance);
    if (diff > 0.01) {
      throw new Error(
        `Control total mismatch: expected GHS ${options.expectedTotalBalance.toFixed(2)} but CSV totals GHS ${preview.totalOpeningBalance.toFixed(2)}.`
      );
    }
  }

  const readyRows = preview.rows.filter((r) => r.status === "ready");
  const committed: MigrationCommittedCustomer[] = [];
  const cycleCtx = {
    tenantId,
    userId: actor.userId,
    role: actor.role
  };

  for (const row of readyRows) {
    if (!row.branchId) {
      throw new Error(`Row ${row.rowNumber}: missing resolved branch ID`);
    }

    const nextOfKin =
      row.nextOfKinName && row.nextOfKinPhone
        ? {
            fullName: row.nextOfKinName,
            phone: row.nextOfKinPhone,
            location: row.location || row.branchName || "Branch"
          }
        : undefined;

    const customer = await createMigratedActiveCustomer({
      tenantId,
      createdByUserId: actor.userId,
      fullName: row.fullName,
      phone: row.phone,
      homeBranchId: row.branchId,
      assignedFieldAgentId: row.assignedAgentId ?? actor.userId,
      accountType: row.accountType,
      dailyContributionAmount: row.dailyContributionAmount,
      kycTier: row.kycTier,
      lockedBalance: row.lockedBalance,
      location: row.location || undefined,
      occupation: row.occupation || undefined,
      idCardNumber: row.idCardNumber || undefined,
      email: row.email || undefined,
      nextOfKin
    });

    let openingTransactionId: string | null = null;
    if (row.openingBalance > 0) {
      const tx = await recordOpeningBalanceTransaction({
        tenantId,
        customerId: customer.id,
        branchId: row.branchId,
        amount: row.openingBalance,
        recordedByUserId: actor.userId,
        fieldAgentId: row.assignedAgentId ?? actor.userId,
        cutoverDate: preview.cutoverDate,
        legacyAccountNumber: row.legacyAccountNumber || undefined
      });
      openingTransactionId = tx.id;

      if (row.accountType === "susu") {
        await seedOpeningBalanceSusuCycle({
          context: cycleCtx,
          customerId: customer.id,
          branchId: row.branchId,
          dailyContributionAmount: row.dailyContributionAmount,
          balanceBroughtForward: row.openingBalance
        });
      }
    }

    committed.push({
      rowNumber: row.rowNumber,
      customerId: customer.id,
      accountNumber: customer.accountNumber ?? "",
      legacyAccountNumber: row.legacyAccountNumber,
      fullName: customer.fullName,
      phone: customer.phone,
      branchCode: row.branchCode,
      branchName: row.branchName ?? row.branchCode,
      assignedAgentLabel: row.assignedAgentLabel,
      accountType: row.accountType,
      dailyContributionAmount: row.dailyContributionAmount,
      openingBalance: row.openingBalance,
      lockedBalance: row.lockedBalance,
      kycTier: row.kycTier,
      openingTransactionId
    });
  }

  const tenant = await resolveTenantRecord(tenantId);
  const slug = resolveTenantSlug(tenant.name, tenant.subdomain, tenant.id);
  const certificateCsv = buildCertificateCsv(preview.tenantName, preview.cutoverDate, committed);
  const certificateFilename = `${slug}-opening-balances-certificate-${preview.cutoverDate}.csv`;

  return {
    tenantId: preview.tenantId,
    tenantName: preview.tenantName,
    cutoverDate: preview.cutoverDate,
    committedAt: new Date().toISOString(),
    csvSha256: preview.csvSha256,
    importedCount: committed.length,
    duplicateSkippedCount: preview.duplicateSkippedCount,
    susuCount: preview.susuCount,
    savingsCount: preview.savingsCount,
    totalOpeningBalance: preview.totalOpeningBalance,
    susuOpeningBalance: preview.susuOpeningBalance,
    savingsOpeningBalance: preview.savingsOpeningBalance,
    totalLockedBalance: preview.totalLockedBalance,
    branchTotals: preview.branchTotals,
    customers: committed,
    certificateCsv,
    certificateFilename
  };
}
