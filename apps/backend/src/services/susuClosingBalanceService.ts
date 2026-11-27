import type { Transaction } from "@bms/shared";
import {
  formatAccountAmount,
  SUSU_COMMISSION_DEBIT_TAG,
  SUSU_COMMISSION_REFUND_TAG,
  transactionSchema
} from "@bms/shared";
import type { Role } from "@bms/shared";
import { getSupabaseAdminClient } from "../config/supabaseClient.js";
import { listUsersByTenant } from "./authStore.js";
import { notifyTenantStaff } from "./notificationService.js";
import { DISCLOSURE_WITHDRAWAL_NOTE_TAG } from "./transactionService.js";
import { userDisplayName } from "./userNameResolver.js";
import { branchDisplayLabel } from "./branchService.js";
import { loadDayBranchCapitalTotals } from "./branchCapitalService.js";

type RoleContext = {
  role: string;
  scopeType: "head_office" | "branch";
  branchId?: string;
};

export type SusuClosingBalanceSnapshot = {
  branchId: string;
  businessDate: string;
  /** @deprecated Prefer openingVault / tillPhysicalCash — kept for older clients. */
  initialCash: number;
  fieldAgentDeposits: number;
  walkInDeposits: number;
  /** Counter / approval deposits not recorded inside any teller till session (go straight to vault). */
  directToVaultDeposits: number;
  fieldAgentWithdrawals: number;
  walkInWithdrawals: number;
  /** Counter withdrawals not recorded inside any teller till session (paid directly from vault). */
  directFromVaultWithdrawals: number;
  susuExpenses: number;
  totalInflows: number;
  totalOutflows: number;
  /** Legacy activity remaining (opening circulation style). Prefer expectedClosingVault. */
  cashRemaining: number;
  tillPhysicalCash: number;
  tillExpenses: number;
  tillExpectedCash: number;
  tillSessionCount: number;
  cashReturnedFromClosedTills: number;
  cashStillInOpenTills: number;
  suggestedOpeningVault: number;
  openingVault: number;
  openingVaultDelta: number;
  cashToBank: number;
  expectedClosingVault: number;
  closingVaultCounted: number | null;
  vaultCountVariance: number | null;
  branchCashPosition: number;
  capitalInjectedToday: number;
  capitalDrawingsToday: number;
  branchTotalCapitalAdded: number;
  branchTotalDrawings: number;
  branchNetCapital: number;
  companyTotalCapitalAdded: number;
  companyTotalDrawings: number;
  companyNetCapital: number;
  usingSavedInputs: boolean;
  notes?: string;
  recordedBy?: string;
  updatedAt?: string;
  /** Targeted EOD Guard checklist for the immediately preceding business day. */
  priorDayStatus?: {
    businessDate: string;
    closingSaved: boolean;
    unclosedTillCount: number;
    unpostedBatchCount: number;
    unsubmittedDraftBatchCount: number;
  };
  /** Guided EOD readiness checklist for the selected business date. */
  todayEodStatus?: {
    openTillCount: number;
    closedUnsettledTillCount: number;
    pendingBatchCount: number;
    draftBatchCount: number;
    priorClosingSaved: boolean;
    priorBusinessDate: string;
  };
  /** Automated cash-conservation invariant verifying vault + open tills against ledger flows. */
  reconciliationCheck?: {
    balanced: boolean;
    expectedPosition: number;
    actualPosition: number;
    discrepancy: number;
  };
};

type TillCashRollup = {
  physicalCash: number;
  expenses: number;
  expectedCash: number;
  sessionCount: number;
  openSessionCount: number;
  closedUnsettledCount: number;
  cashReturnedFromClosedTills: number;
  cashStillInOpenTills: number;
  /** Sum of (actual_closing - expected_closing) across closed/settled tills (teller overages/shortages). */
  closedTillVariance: number;
  /** Total customer deposit + daily_susu inflows already accounted for inside teller till sessions. */
  recordedInflows: number;
  /** Total customer withdrawals already accounted for inside teller till sessions. */
  recordedWithdrawals: number;
};

type SavedClosingRecord = {
  openingVault: number | null;
  cashToBank: number;
  closingVaultCounted: number | null;
  /** Legacy / optional circulation override. */
  initialCash: number | null;
  susuExpenses: number | null;
  notes?: string;
  recordedBy?: string;
  updatedAt?: string;
  usingSavedInputs: boolean;
};

type UserMeta = { role: string; name: string };

const HALL_POSTING_ROLES = new Set<Role>([
  "admin",
  "coordinator",
  "teller",
  "accountant",
  "customer_service"
]);

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

function parseDate(dateStr: string): { start: string; end: string } {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    throw new Error("Invalid date — use YYYY-MM-DD");
  }
  return {
    start: `${dateStr}T00:00:00.000Z`,
    end: `${dateStr}T23:59:59.999Z`
  };
}

function priorBusinessDate(dateStr: string): string {
  const d = new Date(`${dateStr}T12:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

function sessionExpectedCash(row: Record<string, unknown>): number {
  if (row.expected_closing != null) {
    return Number(row.expected_closing);
  }
  if (row.actual_closing != null && (row.status === "closed" || row.status === "settled")) {
    return Number(row.actual_closing);
  }
  const initialCash = Number(row.initial_cash ?? 0);
  const extraCash = Number(row.extra_cash ?? 0);
  const totalExpenses = Number(row.total_expenses ?? 0);
  const deposits = Number(row.total_deposits ?? 0);
  const withdrawals = Number(row.total_withdrawals ?? 0);
  const dailySusu = Number(row.total_daily_susu ?? 0);
  return initialCash + extraCash + deposits + dailySusu - withdrawals - totalExpenses;
}

async function fetchUserMetaMap(tenantId: string): Promise<Map<string, UserMeta>> {
  const map = new Map<string, UserMeta>();
  const supabase = getSupabaseAdminClient();
  if (supabase) {
    const { data, error } = await supabase
      .from("users")
      .select("id, role, full_name, email")
      .eq("tenant_id", tenantId);
    if (error) {
      throw new Error(`Failed to load users: ${error.message}`);
    }
    for (const row of data ?? []) {
      const id = String(row.id);
      map.set(id, {
        role: String(row.role),
        name: userDisplayName(row.full_name, row.email, id)
      });
    }
    return map;
  }
  for (const user of listUsersByTenant(tenantId)) {
    map.set(user.id, {
      role: user.role,
      name: userDisplayName(user.fullName, user.email, user.id)
    });
  }
  return map;
}

function isBranchCounterPost(tx: Transaction, userMeta: Map<string, UserMeta>): boolean {
  const meta = userMeta.get(tx.recordedByUserId);
  if (!meta) {
    return false;
  }
  if (HALL_POSTING_ROLES.has(meta.role as Role)) {
    return true;
  }
  return tx.recordedByUserId !== tx.fieldAgentId;
}

function isFieldAgentChannelPost(tx: Transaction, userMeta: Map<string, UserMeta>): boolean {
  const notes = (tx.notes ?? "").toLowerCase();
  // Teller Pay now / agency cash payouts leave via till — never vault field withdrawals.
  if (
    notes.includes("teller cash payout") ||
    notes.includes("agency withdrawal") ||
    notes.includes("teller payout")
  ) {
    return false;
  }
  if (notes.includes("batch")) {
    return true;
  }
  if (tx.notes?.includes(DISCLOSURE_WITHDRAWAL_NOTE_TAG)) {
    return true;
  }
  const meta = userMeta.get(tx.recordedByUserId);
  if (meta?.role === "field_agent") {
    return true;
  }
  return false;
}

function mapTransactionRow(row: Record<string, unknown>): Transaction {
  return transactionSchema.parse({
    id: String(row.id),
    tenantId: String(row.tenant_id),
    customerId: String(row.customer_id),
    type: row.type,
    amount: Number(row.amount),
    transactionBranchId: String(row.transaction_branch_id),
    homeBranchId: String(row.home_branch_id),
    recordedByUserId: String(row.recorded_by_user_id),
    fieldAgentId: String(row.field_agent_id),
    createdAt: String(row.created_at),
    notes: row.notes ? String(row.notes) : undefined
  });
}

/**
 * Roll up dual-bucket till sessions for the branch/day.
 * Physical cash = initial_cash + extra_cash (float capacity is excluded).
 * Closed/settled expected cash is treated as returned to vault; open stays in tills.
 */
async function loadTillCashRollup(
  tenantId: string,
  branchId: string,
  businessDate: string
): Promise<TillCashRollup> {
  const empty: TillCashRollup = {
    physicalCash: 0,
    expenses: 0,
    expectedCash: 0,
    sessionCount: 0,
    openSessionCount: 0,
    closedUnsettledCount: 0,
    cashReturnedFromClosedTills: 0,
    cashStillInOpenTills: 0,
    closedTillVariance: 0,
    recordedInflows: 0,
    recordedWithdrawals: 0
  };
  const supabase = getSupabaseAdminClient();
  if (!supabase) {
    return empty;
  }

  const { data, error } = await supabase
    .from("branch_float_sessions")
    .select(
      "status, initial_cash, extra_cash, total_expenses, total_deposits, total_withdrawals, total_daily_susu, expected_closing, actual_closing"
    )
    .eq("tenant_id", tenantId)
    .eq("branch_id", branchId)
    .eq("business_date", businessDate)
    .in("status", ["open", "closed", "settled", "approved"]);

  if (error) {
    if (/initial_cash|extra_cash|total_expenses|does not exist|schema cache/i.test(error.message)) {
      return empty;
    }
    throw new Error(`Failed to load till sessions for closing: ${error.message}`);
  }

  let physicalCash = 0;
  let expenses = 0;
  let expectedCash = 0;
  let sessionCount = 0;
  let openSessionCount = 0;
  let closedUnsettledCount = 0;
  let cashReturnedFromClosedTills = 0;
  let cashStillInOpenTills = 0;
  let closedTillVariance = 0;
  let recordedInflows = 0;
  let recordedWithdrawals = 0;

  for (const row of data ?? []) {
    const status = String((row as Record<string, unknown>).status);
    sessionCount += 1;
    const r = row as Record<string, unknown>;
    const initialCash = Number(r.initial_cash ?? 0);
    const extraCash = Number(r.extra_cash ?? 0);
    const totalExpenses = Number(r.total_expenses ?? 0);
    const deposits = Number(r.total_deposits ?? 0);
    const dailySusu = Number(r.total_daily_susu ?? 0);
    const withdrawals = Number(r.total_withdrawals ?? 0);
    physicalCash += initialCash + extraCash;
    expenses += totalExpenses;
    recordedInflows += deposits + dailySusu;
    recordedWithdrawals += withdrawals;
    const expected = sessionExpectedCash(r);
    expectedCash += expected;
    if (status === "closed" || status === "settled") {
      const returned = r.actual_closing != null ? Number(r.actual_closing) : expected;
      cashReturnedFromClosedTills += returned;
      closedTillVariance += returned - expected;
      if (status === "closed") {
        closedUnsettledCount += 1;
      }
    } else if (status === "open" || status === "approved") {
      openSessionCount += 1;
      cashStillInOpenTills += expected;
    }
  }

  return {
    physicalCash: roundMoney(physicalCash),
    expenses: roundMoney(expenses),
    expectedCash: roundMoney(expectedCash),
    sessionCount,
    openSessionCount,
    closedUnsettledCount,
    cashReturnedFromClosedTills: roundMoney(cashReturnedFromClosedTills),
    cashStillInOpenTills: roundMoney(cashStillInOpenTills),
    closedTillVariance: roundMoney(closedTillVariance),
    recordedInflows: roundMoney(recordedInflows),
    recordedWithdrawals: roundMoney(recordedWithdrawals)
  };
}

const LEGACY_VAULT_MARKER = "\n__BMS_VAULT__:";
const memoryClosingRecords = new Map<string, SavedClosingRecord & { businessDate: string }>();

function memoryKey(tenantId: string, branchId: string, businessDate: string): string {
  return `${tenantId}::${branchId}::${businessDate}`;
}

type LegacyVaultPayload = {
  openingVault: number;
  cashToBank: number;
  closingVaultCounted: number | null;
};

function encodeLegacyVaultNotes(
  userNotes: string | undefined,
  vault: LegacyVaultPayload
): string {
  const cleanNotes = stripLegacyVaultMarker(userNotes) ?? "";
  return `${cleanNotes}${LEGACY_VAULT_MARKER}${JSON.stringify(vault)}`;
}

function stripLegacyVaultMarker(raw: string | null | undefined): string | undefined {
  if (raw == null) {
    return undefined;
  }
  const idx = raw.indexOf(LEGACY_VAULT_MARKER);
  const cleaned = (idx >= 0 ? raw.slice(0, idx) : raw).trim();
  return cleaned.length > 0 ? cleaned : undefined;
}

function decodeLegacyVaultNotes(raw: string | null | undefined): {
  notes?: string;
  vault?: LegacyVaultPayload;
} {
  if (raw == null) {
    return {};
  }
  const idx = raw.indexOf(LEGACY_VAULT_MARKER);
  if (idx < 0) {
    const trimmed = raw.trim();
    return { notes: trimmed.length > 0 ? trimmed : undefined };
  }
  const notesPart = raw.slice(0, idx).trim();
  const jsonPart = raw.slice(idx + LEGACY_VAULT_MARKER.length).trim();
  try {
    const parsed = JSON.parse(jsonPart) as Partial<LegacyVaultPayload>;
    const openingVault =
      typeof parsed.openingVault === "number" && Number.isFinite(parsed.openingVault)
        ? roundMoney(Math.max(0, parsed.openingVault))
        : null;
    const cashToBank =
      typeof parsed.cashToBank === "number" && Number.isFinite(parsed.cashToBank)
        ? roundMoney(Math.max(0, parsed.cashToBank))
        : 0;
    const closingVaultCounted =
      typeof parsed.closingVaultCounted === "number" && Number.isFinite(parsed.closingVaultCounted)
        ? roundMoney(Math.max(0, parsed.closingVaultCounted))
        : null;
    return {
      notes: notesPart.length > 0 ? notesPart : undefined,
      vault: openingVault != null ? { openingVault, cashToBank, closingVaultCounted } : undefined
    };
  } catch {
    return { notes: notesPart.length > 0 ? notesPart : undefined };
  }
}

function isMissingVaultColumnsError(message: string): boolean {
  return /opening_vault|cash_to_bank|closing_vault_counted|does not exist|schema cache/i.test(
    message
  );
}

function mapLegacyClosingRow(legacy: Record<string, unknown>): SavedClosingRecord {
  const decoded = decodeLegacyVaultNotes(
    legacy.notes != null ? String(legacy.notes) : undefined
  );
  return {
    openingVault:
      decoded.vault != null
        ? decoded.vault.openingVault
        : legacy.initial_cash != null
          ? Number(legacy.initial_cash)
          : null,
    cashToBank: decoded.vault?.cashToBank ?? 0,
    closingVaultCounted: decoded.vault?.closingVaultCounted ?? null,
    initialCash: legacy.initial_cash != null ? Number(legacy.initial_cash) : null,
    susuExpenses: legacy.susu_expenses != null ? Number(legacy.susu_expenses) : null,
    notes: decoded.notes,
    recordedBy: legacy.recorded_by != null ? String(legacy.recorded_by) : undefined,
    updatedAt: legacy.updated_at != null ? String(legacy.updated_at) : undefined,
    usingSavedInputs: true
  };
}

function mapFullClosingRow(data: Record<string, unknown>): SavedClosingRecord {
  const decoded = decodeLegacyVaultNotes(data.notes != null ? String(data.notes) : undefined);
  return {
    openingVault:
      data.opening_vault != null
        ? Number(data.opening_vault)
        : (decoded.vault?.openingVault ?? null),
    cashToBank:
      data.cash_to_bank != null && Number(data.cash_to_bank) !== 0
        ? Number(data.cash_to_bank)
        : (decoded.vault?.cashToBank ?? Number(data.cash_to_bank ?? 0)),
    closingVaultCounted:
      data.closing_vault_counted != null
        ? Number(data.closing_vault_counted)
        : (decoded.vault?.closingVaultCounted ?? null),
    initialCash: data.initial_cash != null ? Number(data.initial_cash) : null,
    susuExpenses: data.susu_expenses != null ? Number(data.susu_expenses) : null,
    notes: decoded.notes,
    recordedBy: data.recorded_by != null ? String(data.recorded_by) : undefined,
    updatedAt: data.updated_at != null ? String(data.updated_at) : undefined,
    usingSavedInputs: true
  };
}

async function loadSavedClosingRow(
  tenantId: string,
  branchId: string,
  businessDate: string
): Promise<SavedClosingRecord | null> {
  const supabase = getSupabaseAdminClient();
  if (!supabase) {
    return memoryClosingRecords.get(memoryKey(tenantId, branchId, businessDate)) ?? null;
  }

  const { data, error } = await supabase
    .from("susu_daily_closing_records")
    .select(
      "initial_cash, susu_expenses, opening_vault, cash_to_bank, closing_vault_counted, notes, recorded_by, updated_at"
    )
    .eq("tenant_id", tenantId)
    .eq("branch_id", branchId)
    .eq("business_date", businessDate)
    .maybeSingle();

  if (error) {
    if (isMissingVaultColumnsError(error.message)) {
      const { data: legacy, error: legacyErr } = await supabase
        .from("susu_daily_closing_records")
        .select("initial_cash, susu_expenses, notes, recorded_by, updated_at")
        .eq("tenant_id", tenantId)
        .eq("branch_id", branchId)
        .eq("business_date", businessDate)
        .maybeSingle();
      if (legacyErr) {
        throw new Error(`Failed to load closing record: ${legacyErr.message}`);
      }
      return legacy ? mapLegacyClosingRow(legacy as Record<string, unknown>) : null;
    }
    throw new Error(`Failed to load closing record: ${error.message}`);
  }

  return data ? mapFullClosingRow(data as Record<string, unknown>) : null;
}

async function loadLatestPriorClosingRow(
  tenantId: string,
  branchId: string,
  businessDate: string
): Promise<{ businessDate: string; record: SavedClosingRecord } | null> {
  const supabase = getSupabaseAdminClient();
  if (!supabase) {
    const matches = Array.from(memoryClosingRecords.entries())
      .filter(([key, val]) => key.startsWith(`${tenantId}::${branchId}::`) && val.businessDate < businessDate)
      .sort((a, b) => b[1].businessDate.localeCompare(a[1].businessDate));
    const latest = matches[0]?.[1];
    return latest ? { businessDate: latest.businessDate, record: latest } : null;
  }

  const { data, error } = await supabase
    .from("susu_daily_closing_records")
    .select(
      "business_date, initial_cash, susu_expenses, opening_vault, cash_to_bank, closing_vault_counted, notes, recorded_by, updated_at"
    )
    .eq("tenant_id", tenantId)
    .eq("branch_id", branchId)
    .lt("business_date", businessDate)
    .order("business_date", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    if (isMissingVaultColumnsError(error.message)) {
      const { data: legacy, error: legacyErr } = await supabase
        .from("susu_daily_closing_records")
        .select("business_date, initial_cash, susu_expenses, notes, recorded_by, updated_at")
        .eq("tenant_id", tenantId)
        .eq("branch_id", branchId)
        .lt("business_date", businessDate)
        .order("business_date", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (legacyErr || !legacy) {
        return null;
      }
      return {
        businessDate: String(legacy.business_date),
        record: mapLegacyClosingRow(legacy as Record<string, unknown>)
      };
    }
    return null;
  }

  if (!data) {
    return null;
  }
  return {
    businessDate: String(data.business_date),
    record: mapFullClosingRow(data as Record<string, unknown>)
  };
}

/**
 * Prior closing vault carry-forward:
 * Looks up the most recent saved closing record strictly before `businessDate` (handles weekends,
 * holidays, and date switches cleanly). Uses `closingVaultCounted` if recorded; otherwise recomputes
 * that prior day's `expectedClosingVault`.
 */
function nextBusinessDate(dateStr: string): string {
  const d = new Date(`${dateStr}T12:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/**
 * Targeted EOD Guard vault carry-forward:
 * Starts from the latest saved prior closing row (counted vault if present, otherwise expected),
 * then chains day-by-day through every intermediate unsaved day up to yesterday (max 31 days)
 * so missed closing sheets never drop a day's physical cash movement.
 */
async function computeSuggestedOpeningVault(
  tenantId: string,
  context: RoleContext,
  branchId: string,
  businessDate: string
): Promise<number> {
  const yesterday = priorBusinessDate(businessDate);
  const latestPrior = await loadLatestPriorClosingRow(tenantId, branchId, businessDate);
  const priorSaved = latestPrior?.record ?? null;

  let runningVault = 0;
  let chainStartDate = yesterday;

  if (latestPrior && priorSaved) {
    if (priorSaved.closingVaultCounted != null) {
      runningVault = roundMoney(priorSaved.closingVaultCounted);
    } else {
      try {
        const savedSnap = await buildSnapshot(tenantId, context, branchId, latestPrior.businessDate, {
          skipPriorSuggestion: true
        });
        runningVault = roundMoney(savedSnap.expectedClosingVault);
      } catch {
        runningVault = priorSaved.openingVault != null ? roundMoney(priorSaved.openingVault) : 0;
      }
    }
    if (latestPrior.businessDate >= yesterday) {
      return runningVault;
    }
    chainStartDate = nextBusinessDate(latestPrior.businessDate);
  }

  // Walk intermediate unsaved dates forward up to yesterday (cap at 31 days for speed).
  let cursor = chainStartDate;
  let steps = 0;
  while (cursor <= yesterday && steps < 31) {
    steps += 1;
    try {
      const [activity, till, capital] = await Promise.all([
        loadDayActivity(tenantId, branchId, cursor),
        loadTillCashRollup(tenantId, branchId, cursor),
        loadDayBranchCapitalTotals(tenantId, branchId, cursor)
      ]);
      const { directToVaultDeposits, directFromVaultWithdrawals } = computeOffTillVaultFlows(
        activity,
        till
      );
      const dayDelta = roundMoney(
        capital.dayInjections -
          capital.dayDrawings -
          till.physicalCash +
          activity.fieldAgentDeposits +
          directToVaultDeposits -
          activity.fieldAgentWithdrawals -
          directFromVaultWithdrawals +
          till.cashReturnedFromClosedTills
      );
      runningVault = roundMoney(runningVault + dayDelta);
    } catch {
      // Keep running total if a single historical day query fails.
    }
    cursor = nextBusinessDate(cursor);
  }

  return roundMoney(runningVault);
}

async function loadPriorDayEodStatus(
  tenantId: string,
  branchId: string,
  businessDate: string
): Promise<NonNullable<SusuClosingBalanceSnapshot["priorDayStatus"]>> {
  const priorDate = priorBusinessDate(businessDate);
  const supabase = getSupabaseAdminClient();
  const [savedPrior, unclosedTillCount] = await Promise.all([
    loadSavedClosingRow(tenantId, branchId, priorDate).catch(() => null),
    (async () => {
      try {
        const { listPriorUnclosedFloatSessions } = await import("./branchFloatService.js");
        const openTills = await listPriorUnclosedFloatSessions(tenantId, businessDate, branchId);
        return openTills.length;
      } catch {
        return 0;
      }
    })()
  ]);

  let unpostedBatchCount = 0;
  let unsubmittedDraftBatchCount = 0;
  if (supabase) {
    try {
      const [{ data: branchAgents }, { data: priorBatches }] = await Promise.all([
        supabase
          .from("users")
          .select("id, branch_id")
          .eq("tenant_id", tenantId)
          .eq("role", "field_agent"),
        supabase
          .from("field_agent_collection_batches")
          .select("field_agent_id, status, line_count")
          .eq("tenant_id", tenantId)
          .eq("business_date", priorDate)
          .in("status", ["pending_approval", "draft", "rejected"])
          .gt("line_count", 0)
      ]);
      const branchAgentIds = new Set(
        (branchAgents ?? [])
          .filter((u) => !u.branch_id || String(u.branch_id) === branchId)
          .map((u) => String(u.id))
      );
      for (const row of priorBatches ?? []) {
        if (!branchAgentIds.has(String(row.field_agent_id))) {
          continue;
        }
        if (row.status === "pending_approval") {
          unpostedBatchCount += 1;
        } else {
          unsubmittedDraftBatchCount += 1;
        }
      }
    } catch {
      // Non-blocking
    }
  }

  return {
    businessDate: priorDate,
    closingSaved: Boolean(savedPrior?.usingSavedInputs),
    unclosedTillCount,
    unpostedBatchCount,
    unsubmittedDraftBatchCount
  };
}

/**
 * Parses any Savings opening fee retained directly from a collection so physical cash
 * totals reflect the full gross amount handed over by the customer (net credit + retained fee).
 */
export function parseRetainedOpeningFeeFromNotes(notes: string | undefined): number {
  if (!notes) {
    return 0;
  }
  const match = notes.match(/Opening fee GHS\s+([\d,]+(?:\.\d+)?)\s+retained from collection/i);
  if (!match) {
    return 0;
  }
  const parsed = Number(match[1].replace(/,/g, ""));
  return Number.isFinite(parsed) && parsed > 0 ? roundMoney(parsed) : 0;
}

/**
 * Computes counter / approval deposits and withdrawals that did NOT pass through any teller
 * till session (`branch_float_sessions`). Typical examples: Savings initial deposits credited
 * on account approval or coordinator/admin direct postings without an open till.
 * Cash already captured inside teller tills stays inside till cash (no double-counting).
 */
export function computeOffTillVaultFlows(
  activity: { walkInDeposits: number; walkInWithdrawals: number },
  till: { recordedInflows: number; recordedWithdrawals: number }
): { directToVaultDeposits: number; directFromVaultWithdrawals: number } {
  return {
    directToVaultDeposits: roundMoney(
      Math.max(0, activity.walkInDeposits - till.recordedInflows)
    ),
    directFromVaultWithdrawals: roundMoney(
      Math.max(0, activity.walkInWithdrawals - till.recordedWithdrawals)
    )
  };
}

/**
 * Automated cash-conservation invariant:
 * Compares physical branch cash position (expectedClosingVault + cashStillInOpenTills + cashToBank)
 * against ledger-level inflows/outflows (openingVault + net capital + all customer deposits
 * - all customer withdrawals - total effective expenses + closed till count variances).
 * Any non-zero discrepancy indicates an accounting drift (e.g. a post-close reversal on a closed till).
 */
export function checkCashConservationInvariant(input: {
  openingVault: number;
  capitalInjectedToday: number;
  capitalDrawingsToday: number;
  fieldAgentDeposits: number;
  walkInDeposits: number;
  fieldAgentWithdrawals: number;
  walkInWithdrawals: number;
  effectiveTotalExpenses: number;
  closedTillVariance: number;
  branchCashPosition: number;
}): {
  balanced: boolean;
  expectedPosition: number;
  actualPosition: number;
  discrepancy: number;
} {
  const expectedPosition = roundMoney(
    input.openingVault +
      input.capitalInjectedToday -
      input.capitalDrawingsToday +
      input.fieldAgentDeposits +
      input.walkInDeposits -
      input.fieldAgentWithdrawals -
      input.walkInWithdrawals -
      input.effectiveTotalExpenses +
      input.closedTillVariance
  );
  const actualPosition = roundMoney(input.branchCashPosition);
  const discrepancy = roundMoney(actualPosition - expectedPosition);
  return {
    balanced: Math.abs(discrepancy) < 0.01,
    expectedPosition,
    actualPosition,
    discrepancy
  };
}

async function loadDateBatchPendingCounts(
  tenantId: string,
  branchId: string,
  businessDate: string
): Promise<{ pendingBatchCount: number; draftBatchCount: number }> {
  const supabase = getSupabaseAdminClient();
  if (!supabase) {
    return { pendingBatchCount: 0, draftBatchCount: 0 };
  }
  try {
    const [{ data: branchAgents }, { data: batches }] = await Promise.all([
      supabase
        .from("users")
        .select("id, branch_id")
        .eq("tenant_id", tenantId)
        .eq("role", "field_agent"),
      supabase
        .from("field_agent_collection_batches")
        .select("field_agent_id, status, line_count")
        .eq("tenant_id", tenantId)
        .eq("business_date", businessDate)
        .in("status", ["pending_approval", "draft", "rejected"])
        .gt("line_count", 0)
    ]);
    const branchAgentIds = new Set(
      (branchAgents ?? [])
        .filter((u) => !u.branch_id || String(u.branch_id) === branchId)
        .map((u) => String(u.id))
    );
    let pendingBatchCount = 0;
    let draftBatchCount = 0;
    for (const row of batches ?? []) {
      if (!branchAgentIds.has(String(row.field_agent_id))) {
        continue;
      }
      if (row.status === "pending_approval") {
        pendingBatchCount += 1;
      } else {
        draftBatchCount += 1;
      }
    }
    return { pendingBatchCount, draftBatchCount };
  } catch {
    return { pendingBatchCount: 0, draftBatchCount: 0 };
  }
}

function isNonCashSystemEntry(notes: string | undefined): boolean {
  if (!notes) {
    return false;
  }
  const lower = notes.toLowerCase();
  return (
    notes.includes(SUSU_COMMISSION_DEBIT_TAG) ||
    notes.includes(SUSU_COMMISSION_REFUND_TAG) ||
    lower.includes("sms_charge:") ||
    lower.includes("loan_disburse:") ||
    lower.includes("loan_repay:") ||
    lower.includes("loan_repay_reverse:")
  );
}

async function loadDayActivity(
  tenantId: string,
  branchId: string,
  businessDate: string
): Promise<{
  fieldAgentDeposits: number;
  walkInDeposits: number;
  fieldAgentWithdrawals: number;
  walkInWithdrawals: number;
}> {
  const { start, end } = parseDate(businessDate);
  const userMeta = await fetchUserMetaMap(tenantId);
  const supabase = getSupabaseAdminClient();

  let transactions: Transaction[] = [];
  if (supabase) {
    const { data, error } = await supabase
      .from("customer_transactions")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("transaction_branch_id", branchId)
      .gte("created_at", start)
      .lte("created_at", end);
    if (error) {
      throw new Error(`Failed to load transactions: ${error.message}`);
    }
    transactions = (data ?? [])
      .filter((row) => {
        const r = row as Record<string, unknown>;
        if (r.reversed_at != null) {
          return false;
        }
        const execStatus = typeof r.execution_status === "string" ? r.execution_status : null;
        if (
          execStatus &&
          execStatus !== "completed" &&
          execStatus !== "settled"
        ) {
          return false;
        }
        return true;
      })
      .map((row) => mapTransactionRow(row as Record<string, unknown>));
  } else {
    const { listTransactions } = await import("./transactionService.js");
    const all = await listTransactions(tenantId);
    transactions = all.filter(
      (tx) =>
        tx.transactionBranchId === branchId &&
        tx.createdAt >= start &&
        tx.createdAt <= end &&
        !tx.reversedAt &&
        (!tx.executionStatus || tx.executionStatus === "completed")
    );
  }

  let fieldAgentDeposits = 0;
  let walkInDeposits = 0;
  let fieldAgentWithdrawals = 0;
  let walkInWithdrawals = 0;

  for (const tx of transactions) {
    if (isNonCashSystemEntry(tx.notes)) {
      continue;
    }
    const isField = isFieldAgentChannelPost(tx, userMeta);
    const isHall = isBranchCounterPost(tx, userMeta);

    if (tx.type === "withdrawal") {
      if (isField) {
        fieldAgentWithdrawals += tx.amount;
      } else if (isHall) {
        walkInWithdrawals += tx.amount;
      }
      continue;
    }

    const inflow = tx.type === "deposit" || tx.type === "daily_susu";
    if (!inflow) {
      continue;
    }

    const grossCashCollected = roundMoney(
      tx.amount + parseRetainedOpeningFeeFromNotes(tx.notes)
    );
    if (isField) {
      fieldAgentDeposits += grossCashCollected;
    } else if (isHall) {
      walkInDeposits += grossCashCollected;
    }
  }

  return {
    fieldAgentDeposits: roundMoney(fieldAgentDeposits),
    walkInDeposits: roundMoney(walkInDeposits),
    fieldAgentWithdrawals: roundMoney(fieldAgentWithdrawals),
    walkInWithdrawals: roundMoney(walkInWithdrawals)
  };
}

async function buildSnapshot(
  tenantId: string,
  context: RoleContext,
  branchId: string,
  businessDate: string,
  options?: { skipPriorSuggestion?: boolean }
): Promise<SusuClosingBalanceSnapshot> {
  const [activity, till, saved, capital] = await Promise.all([
    loadDayActivity(tenantId, branchId, businessDate),
    loadTillCashRollup(tenantId, branchId, businessDate),
    loadSavedClosingRow(tenantId, branchId, businessDate),
    loadDayBranchCapitalTotals(tenantId, branchId, businessDate)
  ]);

  const suggestedOpeningVault = options?.skipPriorSuggestion
    ? saved?.openingVault != null
      ? roundMoney(saved.openingVault)
      : 0
    : await computeSuggestedOpeningVault(tenantId, context, branchId, businessDate);

  const [priorDayStatus, todayBatches] = options?.skipPriorSuggestion
    ? [undefined, { pendingBatchCount: 0, draftBatchCount: 0 }]
    : await Promise.all([
        loadPriorDayEodStatus(tenantId, branchId, businessDate).catch(() => undefined),
        loadDateBatchPendingCounts(tenantId, branchId, businessDate)
      ]);

  const todayEodStatus = options?.skipPriorSuggestion
    ? undefined
    : {
        openTillCount: till.openSessionCount,
        closedUnsettledTillCount: till.closedUnsettledCount,
        pendingBatchCount: todayBatches.pendingBatchCount,
        draftBatchCount: todayBatches.draftBatchCount,
        priorClosingSaved: priorDayStatus ? priorDayStatus.closingSaved : true,
        priorBusinessDate: priorDayStatus ? priorDayStatus.businessDate : priorBusinessDate(businessDate)
      };

  const openingVault =
    saved?.openingVault != null ? roundMoney(saved.openingVault) : suggestedOpeningVault;
  const cashToBank = saved?.cashToBank != null ? roundMoney(saved.cashToBank) : 0;
  // Default total expenses = till expenses. Vault formula only deducts amounts above till
  // expenses, because closed-till returns are already net of till expenses.
  const susuExpenses =
    saved?.susuExpenses != null ? roundMoney(saved.susuExpenses) : till.expenses;
  const extraBranchExpenses = roundMoney(Math.max(0, susuExpenses - till.expenses));
  const closingVaultCounted =
    saved?.closingVaultCounted != null ? roundMoney(saved.closingVaultCounted) : null;

  // Teller-till walk-in stays inside till cash (returned when till closes);
  // off-till direct / approval deposits (e.g. Savings initial deposits credited on approval)
  // did not enter any teller till and move the vault directly.
  const { directToVaultDeposits, directFromVaultWithdrawals } = computeOffTillVaultFlows(
    activity,
    till
  );

  // Capital injections add physical cash into the vault; owner drawings remove it.
  const expectedClosingVault = roundMoney(
    openingVault +
      capital.dayInjections -
      capital.dayDrawings -
      till.physicalCash +
      activity.fieldAgentDeposits +
      directToVaultDeposits -
      activity.fieldAgentWithdrawals -
      directFromVaultWithdrawals +
      till.cashReturnedFromClosedTills -
      cashToBank -
      extraBranchExpenses
  );

  const openingVaultDelta = roundMoney(openingVault - suggestedOpeningVault);
  const vaultCountVariance =
    closingVaultCounted != null
      ? roundMoney(closingVaultCounted - expectedClosingVault)
      : null;

  const branchCashPosition = roundMoney(
    expectedClosingVault + till.cashStillInOpenTills + cashToBank
  );

  const reconciliationCheck = checkCashConservationInvariant({
    openingVault,
    capitalInjectedToday: capital.dayInjections,
    capitalDrawingsToday: capital.dayDrawings,
    fieldAgentDeposits: activity.fieldAgentDeposits,
    walkInDeposits: activity.walkInDeposits,
    fieldAgentWithdrawals: activity.fieldAgentWithdrawals,
    walkInWithdrawals: activity.walkInWithdrawals,
    effectiveTotalExpenses: roundMoney(till.expenses + extraBranchExpenses),
    closedTillVariance: till.closedTillVariance,
    branchCashPosition
  });

  // Legacy worksheet fields for older UI/clients.
  const initialCash =
    saved?.initialCash != null ? roundMoney(saved.initialCash) : till.physicalCash;
  const totalInflows = roundMoney(
    openingVault + capital.dayInjections + activity.fieldAgentDeposits + activity.walkInDeposits
  );
  const totalOutflows = roundMoney(
    capital.dayDrawings +
      activity.fieldAgentWithdrawals +
      activity.walkInWithdrawals +
      susuExpenses +
      cashToBank
  );
  const cashRemaining = roundMoney(totalInflows - totalOutflows);

  return {
    branchId,
    businessDate,
    initialCash,
    fieldAgentDeposits: activity.fieldAgentDeposits,
    walkInDeposits: activity.walkInDeposits,
    directToVaultDeposits,
    fieldAgentWithdrawals: activity.fieldAgentWithdrawals,
    walkInWithdrawals: activity.walkInWithdrawals,
    directFromVaultWithdrawals,
    susuExpenses,
    totalInflows,
    totalOutflows,
    cashRemaining,
    tillPhysicalCash: till.physicalCash,
    tillExpenses: till.expenses,
    tillExpectedCash: till.expectedCash,
    tillSessionCount: till.sessionCount,
    cashReturnedFromClosedTills: till.cashReturnedFromClosedTills,
    cashStillInOpenTills: till.cashStillInOpenTills,
    suggestedOpeningVault,
    openingVault,
    openingVaultDelta,
    cashToBank,
    expectedClosingVault,
    closingVaultCounted,
    vaultCountVariance,
    branchCashPosition,
    capitalInjectedToday: capital.dayInjections,
    capitalDrawingsToday: capital.dayDrawings,
    branchTotalCapitalAdded: capital.branchTotalInjected,
    branchTotalDrawings: capital.branchTotalDrawings,
    branchNetCapital: capital.branchNetCapital,
    companyTotalCapitalAdded: capital.companyTotalInjected,
    companyTotalDrawings: capital.companyTotalDrawings,
    companyNetCapital: capital.companyNetCapital,
    usingSavedInputs: Boolean(saved?.usingSavedInputs),
    notes: saved?.notes,
    recordedBy: saved?.recordedBy,
    updatedAt: saved?.updatedAt,
    priorDayStatus,
    todayEodStatus,
    reconciliationCheck
  };
}

export async function getSusuClosingBalance(
  tenantId: string,
  context: RoleContext,
  branchId: string,
  businessDate: string
): Promise<SusuClosingBalanceSnapshot> {
  if (!branchId) {
    throw new Error("Branch is required");
  }
  if (context.scopeType === "branch" && context.branchId && context.branchId !== branchId) {
    throw new Error("Cannot view closing balance for another branch");
  }
  parseDate(businessDate);
  return buildSnapshot(tenantId, context, branchId, businessDate);
}

export async function saveSusuClosingRecord(
  tenantId: string,
  context: RoleContext & { userId: string },
  input: {
    branchId: string;
    businessDate: string;
    openingVault: number;
    cashToBank: number;
    susuExpenses: number;
    closingVaultCounted?: number | null;
    notes?: string;
    /** Optional legacy field — stored as till circulation reference. */
    initialCash?: number;
  }
): Promise<SusuClosingBalanceSnapshot> {
  if (context.role !== "admin" && context.role !== "coordinator" && context.role !== "accountant") {
    throw new Error("Only admin, coordinator, or accountant can save closing records");
  }
  if (context.scopeType === "branch" && context.branchId && context.branchId !== input.branchId) {
    throw new Error("Cannot save closing record for another branch");
  }

  const before = await buildSnapshot(tenantId, context, input.branchId, input.businessDate);
  const openingVault = roundMoney(Math.max(0, input.openingVault));
  const cashToBank = roundMoney(Math.max(0, input.cashToBank));
  const susuExpenses = roundMoney(Math.max(0, input.susuExpenses));
  const closingVaultCounted =
    input.closingVaultCounted == null || input.closingVaultCounted === undefined
      ? null
      : roundMoney(Math.max(0, input.closingVaultCounted));
  const initialCash = roundMoney(
    input.initialCash != null ? Math.max(0, input.initialCash) : before.tillPhysicalCash
  );
  const cleanNotes = stripLegacyVaultMarker(input.notes);
  const now = new Date().toISOString();

  const supabase = getSupabaseAdminClient();
  if (!supabase) {
    memoryClosingRecords.set(memoryKey(tenantId, input.branchId, input.businessDate), {
      businessDate: input.businessDate,
      openingVault,
      cashToBank,
      closingVaultCounted,
      initialCash,
      susuExpenses,
      notes: cleanNotes,
      recordedBy: context.userId,
      updatedAt: now,
      usingSavedInputs: true
    });
  } else {
    const row: Record<string, unknown> = {
      tenant_id: tenantId,
      branch_id: input.branchId,
      business_date: input.businessDate,
      initial_cash: initialCash,
      susu_expenses: susuExpenses,
      opening_vault: openingVault,
      cash_to_bank: cashToBank,
      closing_vault_counted: closingVaultCounted,
      notes: cleanNotes ?? null,
      recorded_by: context.userId,
      updated_at: now
    };

    const { error } = await supabase.from("susu_daily_closing_records").upsert(row, {
      onConflict: "tenant_id,branch_id,business_date"
    });

    if (error) {
      // Fallback if migration 087_branch_vault_closing.sql has not been applied yet:
      // persist opening_vault in initial_cash AND store full vault payload inside notes metadata
      // so values survive page refreshes and date changes without silent data loss.
      if (isMissingVaultColumnsError(error.message)) {
        const legacyNotes = encodeLegacyVaultNotes(cleanNotes, {
          openingVault,
          cashToBank,
          closingVaultCounted
        });
        const { error: legacyErr } = await supabase.from("susu_daily_closing_records").upsert(
          {
            tenant_id: tenantId,
            branch_id: input.branchId,
            business_date: input.businessDate,
            initial_cash: openingVault,
            susu_expenses: susuExpenses,
            notes: legacyNotes,
            recorded_by: context.userId,
            updated_at: now
          },
          { onConflict: "tenant_id,branch_id,business_date" }
        );
        if (legacyErr) {
          throw new Error(`Failed to save closing record: ${legacyErr.message}`);
        }
      } else {
        throw new Error(`Failed to save closing record: ${error.message}`);
      }
    }
  }

  const saved = await getSusuClosingBalance(tenantId, context, input.branchId, input.businessDate);
  const branchLabel = await branchDisplayLabel(tenantId, input.branchId);

  const openingDelta = roundMoney(openingVault - before.suggestedOpeningVault);
  if (Math.abs(openingDelta) >= 0.005) {
    try {
      await notifyTenantStaff({
        tenantId,
        roles: ["admin", "coordinator"],
        kind: "vault_opening_adjusted",
        title: "Vault opening adjusted",
        body: `${branchLabel} · ${input.businessDate}: opening vault set to GHS ${formatAccountAmount(openingVault)} (suggested GHS ${formatAccountAmount(before.suggestedOpeningVault)}, difference GHS ${formatAccountAmount(openingDelta)}).`
      });
    } catch {
      // Non-blocking
    }
  }

  if (
    saved.closingVaultCounted != null &&
    saved.vaultCountVariance != null &&
    Math.abs(saved.vaultCountVariance) >= 0.005
  ) {
    try {
      await notifyTenantStaff({
        tenantId,
        roles: ["admin", "coordinator"],
        kind: "vault_close_variance",
        title: "Vault close count differs",
        body: `${branchLabel} · ${input.businessDate}: counted GHS ${formatAccountAmount(saved.closingVaultCounted)} vs expected GHS ${formatAccountAmount(saved.expectedClosingVault)} (variance GHS ${formatAccountAmount(saved.vaultCountVariance)}).`
      });
    } catch {
      // Non-blocking
    }
  }

  return saved;
}
