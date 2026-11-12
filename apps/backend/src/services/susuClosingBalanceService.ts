import type { Transaction } from "@bms/shared";
import { formatAccountAmount, transactionSchema } from "@bms/shared";
import type { Role } from "@bms/shared";
import { getSupabaseAdminClient } from "../config/supabaseClient.js";
import { listUsersByTenant } from "./authStore.js";
import { notifyTenantStaff } from "./notificationService.js";
import { DISCLOSURE_WITHDRAWAL_NOTE_TAG } from "./transactionService.js";
import { userDisplayName } from "./userNameResolver.js";
import { branchDisplayLabel } from "./branchService.js";

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
  fieldAgentWithdrawals: number;
  walkInWithdrawals: number;
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
  usingSavedInputs: boolean;
  notes?: string;
  recordedBy?: string;
  updatedAt?: string;
};

type TillCashRollup = {
  physicalCash: number;
  expenses: number;
  expectedCash: number;
  sessionCount: number;
  cashReturnedFromClosedTills: number;
  cashStillInOpenTills: number;
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
  if (tx.notes?.toLowerCase().includes("batch")) {
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
    cashReturnedFromClosedTills: 0,
    cashStillInOpenTills: 0
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
  let cashReturnedFromClosedTills = 0;
  let cashStillInOpenTills = 0;

  for (const row of data ?? []) {
    const status = String((row as Record<string, unknown>).status);
    sessionCount += 1;
    const r = row as Record<string, unknown>;
    const initialCash = Number(r.initial_cash ?? 0);
    const extraCash = Number(r.extra_cash ?? 0);
    const totalExpenses = Number(r.total_expenses ?? 0);
    physicalCash += initialCash + extraCash;
    expenses += totalExpenses;
    const expected = sessionExpectedCash(r);
    expectedCash += expected;
    if (status === "closed" || status === "settled") {
      cashReturnedFromClosedTills +=
        r.actual_closing != null ? Number(r.actual_closing) : expected;
    } else if (status === "open" || status === "approved") {
      cashStillInOpenTills += expected;
    }
  }

  return {
    physicalCash: roundMoney(physicalCash),
    expenses: roundMoney(expenses),
    expectedCash: roundMoney(expectedCash),
    sessionCount,
    cashReturnedFromClosedTills: roundMoney(cashReturnedFromClosedTills),
    cashStillInOpenTills: roundMoney(cashStillInOpenTills)
  };
}

async function loadSavedClosingRow(
  tenantId: string,
  branchId: string,
  businessDate: string
): Promise<SavedClosingRecord | null> {
  const supabase = getSupabaseAdminClient();
  if (!supabase) {
    return null;
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
    if (/opening_vault|cash_to_bank|closing_vault_counted|does not exist|schema cache/i.test(error.message)) {
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
      if (!legacy) {
        return null;
      }
      return {
        openingVault: null,
        cashToBank: 0,
        closingVaultCounted: null,
        initialCash: Number(legacy.initial_cash ?? 0),
        susuExpenses: Number(legacy.susu_expenses ?? 0),
        notes: legacy.notes != null ? String(legacy.notes) : undefined,
        recordedBy: legacy.recorded_by != null ? String(legacy.recorded_by) : undefined,
        updatedAt: legacy.updated_at != null ? String(legacy.updated_at) : undefined,
        usingSavedInputs: true
      };
    }
    throw new Error(`Failed to load closing record: ${error.message}`);
  }

  if (!data) {
    return null;
  }

  return {
    openingVault: data.opening_vault != null ? Number(data.opening_vault) : null,
    cashToBank: Number(data.cash_to_bank ?? 0),
    closingVaultCounted:
      data.closing_vault_counted != null ? Number(data.closing_vault_counted) : null,
    initialCash: data.initial_cash != null ? Number(data.initial_cash) : null,
    susuExpenses: data.susu_expenses != null ? Number(data.susu_expenses) : null,
    notes: data.notes != null ? String(data.notes) : undefined,
    recordedBy: data.recorded_by != null ? String(data.recorded_by) : undefined,
    updatedAt: data.updated_at != null ? String(data.updated_at) : undefined,
    usingSavedInputs: true
  };
}

/**
 * Prior day closing vault suggestion:
 * counted vault if set, else recompute expected closing from prior saved inputs + prior activity/tills.
 * For speed/reliability we store expected on save via closing_vault_counted preference;
 * if only opening_vault/cash_to_bank saved, recompute a lightweight prior expected using prior record fields + prior till rollup + prior field activity would be heavy.
 * Locked approach: use closing_vault_counted if present; else if prior record has opening_vault, recompute prior expected with prior day's till+field snapshots.
 */
async function computeSuggestedOpeningVault(
  tenantId: string,
  context: RoleContext,
  branchId: string,
  businessDate: string
): Promise<number> {
  const priorDate = priorBusinessDate(businessDate);
  const priorSaved = await loadSavedClosingRow(tenantId, branchId, priorDate);
  if (priorSaved?.closingVaultCounted != null) {
    return roundMoney(priorSaved.closingVaultCounted);
  }

  // Recompute prior expected closing vault from prior day data.
  try {
    const priorSnap = await buildSnapshot(tenantId, context, branchId, priorDate, {
      skipPriorSuggestion: true
    });
    return roundMoney(priorSnap.expectedClosingVault);
  } catch {
    if (priorSaved?.openingVault != null) {
      return roundMoney(priorSaved.openingVault);
    }
    return 0;
  }
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
    transactions = (data ?? []).map((row) => mapTransactionRow(row as Record<string, unknown>));
  } else {
    const { listTransactions } = await import("./transactionService.js");
    const all = await listTransactions(tenantId);
    transactions = all.filter(
      (tx) =>
        tx.transactionBranchId === branchId && tx.createdAt >= start && tx.createdAt <= end
    );
  }

  let fieldAgentDeposits = 0;
  let walkInDeposits = 0;
  let fieldAgentWithdrawals = 0;
  let walkInWithdrawals = 0;

  for (const tx of transactions) {
    const isHall = isBranchCounterPost(tx, userMeta);
    const isField = isFieldAgentChannelPost(tx, userMeta);

    if (tx.type === "withdrawal") {
      if (isField && !isHall) {
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

    if (isField && !isHall) {
      fieldAgentDeposits += tx.amount;
    } else if (isHall) {
      walkInDeposits += tx.amount;
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
  const activity = await loadDayActivity(tenantId, branchId, businessDate);
  const till = await loadTillCashRollup(tenantId, branchId, businessDate);
  const saved = await loadSavedClosingRow(tenantId, branchId, businessDate);

  const suggestedOpeningVault = options?.skipPriorSuggestion
    ? saved?.openingVault != null
      ? roundMoney(saved.openingVault)
      : 0
    : await computeSuggestedOpeningVault(tenantId, context, branchId, businessDate);

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

  // Walk-in stays inside tills — do not add walk-in to vault again.
  const expectedClosingVault = roundMoney(
    openingVault -
      till.physicalCash +
      activity.fieldAgentDeposits -
      activity.fieldAgentWithdrawals +
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

  // Legacy worksheet fields for older UI/clients.
  const initialCash =
    saved?.initialCash != null ? roundMoney(saved.initialCash) : till.physicalCash;
  const totalInflows = roundMoney(
    openingVault + activity.fieldAgentDeposits + activity.walkInDeposits
  );
  const totalOutflows = roundMoney(
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
    fieldAgentWithdrawals: activity.fieldAgentWithdrawals,
    walkInWithdrawals: activity.walkInWithdrawals,
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
    usingSavedInputs: Boolean(saved?.usingSavedInputs),
    notes: saved?.notes,
    recordedBy: saved?.recordedBy,
    updatedAt: saved?.updatedAt
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

  const supabase = getSupabaseAdminClient();
  if (!supabase) {
    throw new Error("Closing records require database storage");
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

  const now = new Date().toISOString();
  const row: Record<string, unknown> = {
    tenant_id: tenantId,
    branch_id: input.branchId,
    business_date: input.businessDate,
    initial_cash: initialCash,
    susu_expenses: susuExpenses,
    opening_vault: openingVault,
    cash_to_bank: cashToBank,
    closing_vault_counted: closingVaultCounted,
    notes: input.notes ?? null,
    recorded_by: context.userId,
    updated_at: now
  };

  const { error } = await supabase.from("susu_daily_closing_records").upsert(row, {
    onConflict: "tenant_id,branch_id,business_date"
  });

  if (error) {
    // Fallback if migration not applied yet.
    if (/opening_vault|cash_to_bank|closing_vault_counted|schema cache/i.test(error.message)) {
      const { error: legacyErr } = await supabase.from("susu_daily_closing_records").upsert(
        {
          tenant_id: tenantId,
          branch_id: input.branchId,
          business_date: input.businessDate,
          initial_cash: initialCash,
          susu_expenses: susuExpenses,
          notes: input.notes ?? null,
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
