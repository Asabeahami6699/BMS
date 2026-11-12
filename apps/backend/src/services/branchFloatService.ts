import { formatAccountAmount } from "@bms/shared";
import { randomUUID } from "node:crypto";
import { getSupabaseAdminClient } from "../config/supabaseClient.js";
import { isMissingSupabaseResource } from "../lib/supabaseSchema.js";
import { branchDisplayLabel, resolveBranchId } from "./branchService.js";
import type { Transaction } from "@bms/shared";
import { notifyTenantStaff, createAgentNotification } from "./notificationService.js";

/** Susu Management branch counter till — not the Banking product vault module. */
export type FloatSessionStatus =
  | "requested"
  | "approved"
  | "open"
  | "closed"
  | "settled"
  | "rejected";

export type BranchFloatSession = {
  id: string;
  tenantId: string;
  branchId: string;
  cashierUserId: string;
  businessDate: string;
  status: FloatSessionStatus;
  /** Deposit/Susu capacity allocated (grows with float top-ups). Not physical cash. */
  openingFloat: number;
  /** Physical cash handed at open (may be 0). */
  initialCash: number;
  /** Extra physical cash collected during the day for payouts. */
  extraCash: number;
  /** Till expenses / petty cash paid from the drawer. */
  totalExpenses: number;
  expectedClosing: number | null;
  actualClosing: number | null;
  variance: number | null;
  totalDeposits: number;
  totalWithdrawals: number;
  totalDailySusu: number;
  transactionCount: number;
  requestedAt: string;
  requestedNote?: string;
  allocatedBy?: string;
  allocatedAt?: string;
  closedAt?: string;
  settledBy?: string;
  settledAt?: string;
  varianceNote?: string;
  /** Extra float capacity asked for while this till is already open. */
  topUpRequested?: number;
  topUpNote?: string;
  /** Pending extra physical cash awaiting admin/coordinator approval. */
  extraCashRequested?: number;
  extraCashRequestNote?: string;
  /** Pending expense awaiting admin/coordinator approval. */
  expenseRequested?: number;
  expenseRequestNote?: string;
};

type ActorContext = {
  tenantId: string;
  userId: string;
  role: string;
  scopeType: "head_office" | "branch";
  branchId?: string;
};

const memorySessions = new Map<string, BranchFloatSession[]>();

function tenantKey(tenantId: string): string {
  return tenantId;
}

function todayDate(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Physical cash that should be in the drawer.
 * Float capacity is NOT assumed to be cash.
 */
function expectedCash(session: BranchFloatSession): number {
  return (
    session.initialCash +
    session.extraCash +
    session.totalDeposits +
    session.totalDailySusu -
    session.totalWithdrawals -
    session.totalExpenses
  );
}

/** Issued till capital for the day: float capacity + all physical cash issued. */
function dayCapital(session: BranchFloatSession): number {
  return session.openingFloat + session.initialCash + session.extraCash;
}

/** Remaining allocated float: reduced by deposits/Susu, restored by withdrawals. */
function remainingFloatBalance(session: BranchFloatSession): number {
  return (
    session.openingFloat -
    session.totalDeposits -
    session.totalDailySusu +
    session.totalWithdrawals
  );
}

function rowToSession(row: Record<string, unknown>): BranchFloatSession {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    branchId: String(row.branch_id),
    cashierUserId: String(row.cashier_user_id),
    businessDate: String(row.business_date).slice(0, 10),
    status: row.status as FloatSessionStatus,
    openingFloat: Number(row.opening_float ?? 0),
    initialCash: Number(row.initial_cash ?? 0),
    extraCash: Number(row.extra_cash ?? 0),
    totalExpenses: Number(row.total_expenses ?? 0),
    expectedClosing: row.expected_closing != null ? Number(row.expected_closing) : null,
    actualClosing: row.actual_closing != null ? Number(row.actual_closing) : null,
    variance: row.variance != null ? Number(row.variance) : null,
    totalDeposits: Number(row.total_deposits ?? 0),
    totalWithdrawals: Number(row.total_withdrawals ?? 0),
    totalDailySusu: Number(row.total_daily_susu ?? 0),
    transactionCount: Number(row.transaction_count ?? 0),
    requestedAt: String(row.requested_at),
    requestedNote: row.requested_note != null ? String(row.requested_note) : undefined,
    allocatedBy: row.allocated_by != null ? String(row.allocated_by) : undefined,
    allocatedAt: row.allocated_at != null ? String(row.allocated_at) : undefined,
    closedAt: row.closed_at != null ? String(row.closed_at) : undefined,
    settledBy: row.settled_by != null ? String(row.settled_by) : undefined,
    settledAt: row.settled_at != null ? String(row.settled_at) : undefined,
    varianceNote: row.variance_note != null ? String(row.variance_note) : undefined,
    topUpRequested: row.top_up_requested != null ? Number(row.top_up_requested) : undefined,
    topUpNote: row.top_up_note != null ? String(row.top_up_note) : undefined,
    extraCashRequested:
      row.extra_cash_requested != null ? Number(row.extra_cash_requested) : undefined,
    extraCashRequestNote:
      row.extra_cash_request_note != null ? String(row.extra_cash_request_note) : undefined,
    expenseRequested: row.expense_requested != null ? Number(row.expense_requested) : undefined,
    expenseRequestNote:
      row.expense_request_note != null ? String(row.expense_request_note) : undefined
  };
}

function sessionToRow(session: BranchFloatSession): Record<string, unknown> {
  return {
    id: session.id,
    tenant_id: session.tenantId,
    branch_id: session.branchId,
    cashier_user_id: session.cashierUserId,
    business_date: session.businessDate,
    status: session.status,
    opening_float: session.openingFloat,
    initial_cash: session.initialCash,
    extra_cash: session.extraCash,
    total_expenses: session.totalExpenses,
    expected_closing: session.expectedClosing,
    actual_closing: session.actualClosing,
    variance: session.variance,
    total_deposits: session.totalDeposits,
    total_withdrawals: session.totalWithdrawals,
    total_daily_susu: session.totalDailySusu,
    transaction_count: session.transactionCount,
    requested_at: session.requestedAt,
    requested_note: session.requestedNote ?? null,
    allocated_by: session.allocatedBy ?? null,
    allocated_at: session.allocatedAt ?? null,
    closed_at: session.closedAt ?? null,
    settled_by: session.settledBy ?? null,
    settled_at: session.settledAt ?? null,
    variance_note: session.varianceNote ?? null,
    top_up_requested: session.topUpRequested ?? null,
    top_up_note: session.topUpNote ?? null,
    extra_cash_requested: session.extraCashRequested ?? null,
    extra_cash_request_note: session.extraCashRequestNote ?? null,
    expense_requested: session.expenseRequested ?? null,
    expense_request_note: session.expenseRequestNote ?? null,
    updated_at: new Date().toISOString()
  };
}

async function persistSession(session: BranchFloatSession): Promise<void> {
  const supabase = getSupabaseAdminClient();
  if (!supabase) {
    const list = memorySessions.get(tenantKey(session.tenantId)) ?? [];
    const idx = list.findIndex((s) => s.id === session.id);
    if (idx >= 0) {
      list[idx] = session;
    } else {
      list.push(session);
    }
    memorySessions.set(tenantKey(session.tenantId), list);
    return;
  }

  const row = sessionToRow(session);
  let { error } = await supabase.from("branch_float_sessions").upsert(row);
  if (error && /top_up_requested|top_up_note/i.test(error.message)) {
    if ((session.topUpRequested ?? 0) > 0 || session.topUpNote) {
      throw new Error(
        "Float top-up storage is not ready. Apply migration 070_branch_float_top_up.sql in Supabase, then try again."
      );
    }
    const { top_up_requested: _topUpAmount, top_up_note: _topUpNote, ...withoutTopUp } = row;
    void _topUpAmount;
    void _topUpNote;
    const retry = await supabase.from("branch_float_sessions").upsert(withoutTopUp);
    error = retry.error;
  }
  if (
    error &&
    /initial_cash|extra_cash|total_expenses/i.test(error.message)
  ) {
    if (session.initialCash > 0 || session.extraCash > 0 || session.totalExpenses > 0) {
      throw new Error(
        "Till cash capital columns are not ready. Apply migration 085_branch_float_cash_capital.sql in Supabase, then try again."
      );
    }
    const {
      initial_cash: _initialCash,
      extra_cash: _extraCash,
      total_expenses: _totalExpenses,
      ...withoutCashCapital
    } = row;
    void _initialCash;
    void _extraCash;
    void _totalExpenses;
    const retry = await supabase.from("branch_float_sessions").upsert(withoutCashCapital);
    error = retry.error;
  }
  if (error && !isMissingSupabaseResource(error.message)) {
    throw new Error(`Failed to save float session: ${error.message}`);
  }
  if (error && isMissingSupabaseResource(error.message)) {
    const list = memorySessions.get(tenantKey(session.tenantId)) ?? [];
    const idx = list.findIndex((s) => s.id === session.id);
    if (idx >= 0) {
      list[idx] = session;
    } else {
      list.push(session);
    }
    memorySessions.set(tenantKey(session.tenantId), list);
  }
}

async function listSessions(tenantId: string): Promise<BranchFloatSession[]> {
  const supabase = getSupabaseAdminClient();
  if (!supabase) {
    return [...(memorySessions.get(tenantKey(tenantId)) ?? [])];
  }

  const { data, error } = await supabase
    .from("branch_float_sessions")
    .select("*")
    .eq("tenant_id", tenantId)
    .order("business_date", { ascending: false });

  if (error) {
    if (isMissingSupabaseResource(error.message)) {
      return [...(memorySessions.get(tenantKey(tenantId)) ?? [])];
    }
    throw new Error(`Failed to list float sessions: ${error.message}`);
  }

  return (data ?? []).map((row) => rowToSession(row as Record<string, unknown>));
}

export function branchCounterRequiresFloat(role: string): boolean {
  return role === "teller" || role === "coordinator";
}

export async function getFloatSessionForCashier(
  tenantId: string,
  cashierUserId: string,
  businessDate: string,
  branchId?: string
): Promise<BranchFloatSession | null> {
  const sessions = await listSessions(tenantId);
  return (
    sessions.find(
      (s) =>
        s.cashierUserId === cashierUserId &&
        s.businessDate === businessDate &&
        (!branchId || s.branchId === branchId)
    ) ?? null
  );
}

export async function getMyBranchFloatSession(
  context: ActorContext,
  options?: { businessDate?: string; branchId?: string }
): Promise<BranchFloatSession | null> {
  const date = options?.businessDate?.trim() || todayDate();
  const branchRef = options?.branchId?.trim() || context.branchId || "";
  const branchId = branchRef ? await resolveBranchId(context.tenantId, branchRef) : undefined;
  return getFloatSessionForCashier(context.tenantId, context.userId, date, branchId ?? undefined);
}

export async function requestBranchFloat(
  context: ActorContext,
  input: {
    branchId: string;
    requestedAmount: number;
    requestedInitialCash?: number;
    note?: string;
    businessDate?: string;
  }
): Promise<BranchFloatSession> {
  if (!branchCounterRequiresFloat(context.role) && context.role !== "admin") {
    throw new Error("Only branch counter staff can request a till float");
  }

  const branchId = await resolveBranchId(context.tenantId, input.branchId);
  if (!branchId) {
    throw new Error("Branch not found");
  }

  const businessDate = input.businessDate?.trim() || todayDate();
  const existing = await getFloatSessionForCashier(
    context.tenantId,
    context.userId,
    businessDate,
    branchId
  );
  if (existing && existing.status !== "rejected") {
    if (existing.status === "open") {
      return requestFloatTopUp(context, existing, input.requestedAmount, input.note);
    }
    throw new Error("You already have a float session for this branch and date");
  }

  const session: BranchFloatSession = {
    id: randomUUID(),
    tenantId: context.tenantId,
    branchId,
    cashierUserId: context.userId,
    businessDate,
    status: "requested",
    openingFloat: Math.max(0, input.requestedAmount),
    initialCash: Math.max(0, input.requestedInitialCash ?? 0),
    extraCash: 0,
    totalExpenses: 0,
    expectedClosing: null,
    actualClosing: null,
    variance: null,
    totalDeposits: 0,
    totalWithdrawals: 0,
    totalDailySusu: 0,
    transactionCount: 0,
    requestedAt: new Date().toISOString(),
    requestedNote: input.note?.trim() || undefined
  };

  await persistSession(session);
  const branchLabel = await branchDisplayLabel(context.tenantId, branchId);
  try {
    await notifyTenantStaff({
      tenantId: context.tenantId,
      roles: ["admin", "coordinator"],
      kind: "float_requested",
      title: "Till float requested",
      body: `Float GHS ${formatAccountAmount(session.openingFloat)} · initial cash GHS ${formatAccountAmount(session.initialCash)} requested for ${branchLabel} on ${businessDate}.`
    });
  } catch {
    // Non-blocking
  }
  try {
    await createAgentNotification({
      tenantId: context.tenantId,
      userId: context.userId,
      kind: "float_requested",
      title: "Till float request sent",
      body: `You requested GHS ${formatAccountAmount(session.openingFloat)} for ${branchLabel} on ${businessDate}. Waiting for release.`
    });
  } catch {
    // Non-blocking
  }
  return session;
}

async function requestFloatTopUp(
  context: ActorContext,
  session: BranchFloatSession,
  requestedAmount: number,
  note?: string
): Promise<BranchFloatSession> {
  const amount = Math.max(0, requestedAmount);
  if (amount <= 0) {
    throw new Error("Enter the top-up amount you need");
  }
  if ((session.topUpRequested ?? 0) > 0) {
    throw new Error("A top-up is already waiting to be released");
  }

  session.topUpRequested = amount;
  session.topUpNote = note?.trim() || undefined;
  await persistSession(session);

  const branchLabel = await branchDisplayLabel(context.tenantId, session.branchId);
  try {
    await notifyTenantStaff({
      tenantId: context.tenantId,
      roles: ["admin", "coordinator"],
      kind: "float_requested",
      title: "Till float top-up requested",
      body: `GHS ${formatAccountAmount(amount)} top-up requested for ${branchLabel} on ${session.businessDate}.`
    });
  } catch {
    // Non-blocking
  }
  try {
    await createAgentNotification({
      tenantId: context.tenantId,
      userId: context.userId,
      kind: "float_requested",
      title: "Till float top-up request sent",
      body: `You requested a GHS ${formatAccountAmount(amount)} top-up for ${branchLabel} on ${session.businessDate}. Waiting for release.`
    });
  } catch {
    // Non-blocking
  }
  return session;
}

export async function allocateBranchFloat(
  context: ActorContext,
  sessionId: string,
  input: { openingFloat: number; initialCash?: number }
): Promise<BranchFloatSession> {
  if (context.role !== "admin" && context.role !== "coordinator") {
    throw new Error("Only admin or coordinator can release float");
  }

  const sessions = await listSessions(context.tenantId);
  const session = sessions.find((s) => s.id === sessionId);
  if (!session) {
    throw new Error("Float session not found");
  }
  if (session.status === "open" && (session.topUpRequested ?? 0) > 0) {
    const added = Math.max(0, input.openingFloat);
    if (added <= 0) {
      throw new Error("Enter the top-up amount to release");
    }
    session.openingFloat = Math.round((session.openingFloat + added) * 100) / 100;
    session.topUpRequested = undefined;
    session.topUpNote = undefined;
    session.expectedClosing = expectedCash(session);
    await persistSession(session);
    await recordMovement(session, {
      movementType: "adjustment",
      amount: added,
      createdBy: context.userId,
      notes: "Extra float released — adds to day capital"
    });
    try {
      await createAgentNotification({
        tenantId: session.tenantId,
        userId: session.cashierUserId,
        kind: "float_allocated",
        title: "Extra float released",
        body: `GHS ${added.toFixed(2)} float capacity was added for ${session.businessDate}. Day capital is now GHS ${formatAccountAmount(dayCapital(session))}.`
      });
    } catch {
      // Non-blocking
    }
    return session;
  }

  if (session.status !== "requested" && session.status !== "approved") {
    throw new Error("Float session cannot be opened in its current status");
  }

  const opening = Math.max(0, input.openingFloat);
  const initialCash = Math.max(
    0,
    input.initialCash != null ? input.initialCash : session.initialCash
  );
  session.openingFloat = opening;
  session.initialCash = initialCash;
  session.extraCash = 0;
  session.totalExpenses = 0;
  session.status = "open";
  session.allocatedBy = context.userId;
  session.allocatedAt = new Date().toISOString();
  session.expectedClosing = expectedCash(session);

  await persistSession(session);
  await recordMovement(session, {
    movementType: "allocation",
    amount: opening,
    createdBy: context.userId,
    notes: `Opening float released · initial cash GHS ${formatAccountAmount(initialCash)}`
  });

  try {
    await createAgentNotification({
      tenantId: session.tenantId,
      userId: session.cashierUserId,
      kind: "float_allocated",
      title: "Till opened",
      body: `Float GHS ${formatAccountAmount(opening)} · physical cash GHS ${formatAccountAmount(initialCash)} for ${session.businessDate}. Day capital GHS ${formatAccountAmount(dayCapital(session))}.`
    });
  } catch {
    // Non-blocking
  }

  return session;
}

/** Admin pushes float + initial cash directly (skip request queue). */
export async function pushBranchFloat(
  context: ActorContext,
  input: {
    branchId: string;
    cashierUserId: string;
    openingFloat: number;
    initialCash?: number;
    businessDate?: string;
  }
): Promise<BranchFloatSession> {
  if (context.role !== "admin") {
    throw new Error("Only admin can push float to a branch counter");
  }

  const branchId = await resolveBranchId(context.tenantId, input.branchId);
  if (!branchId) {
    throw new Error("Branch not found");
  }

  const businessDate = input.businessDate?.trim() || todayDate();
  const openingFloat = Math.max(0, input.openingFloat);
  const initialCash = Math.max(0, input.initialCash ?? 0);
  let session = await getFloatSessionForCashier(
    context.tenantId,
    input.cashierUserId,
    businessDate,
    branchId
  );

  if (!session) {
    session = {
      id: randomUUID(),
      tenantId: context.tenantId,
      branchId,
      cashierUserId: input.cashierUserId,
      businessDate,
      status: "open",
      openingFloat,
      initialCash,
      extraCash: 0,
      totalExpenses: 0,
      expectedClosing: null,
      actualClosing: null,
      variance: null,
      totalDeposits: 0,
      totalWithdrawals: 0,
      totalDailySusu: 0,
      transactionCount: 0,
      requestedAt: new Date().toISOString(),
      allocatedBy: context.userId,
      allocatedAt: new Date().toISOString()
    };
  } else {
    session.openingFloat = openingFloat;
    session.initialCash = initialCash;
    session.extraCash = 0;
    session.totalExpenses = 0;
    session.status = "open";
    session.allocatedBy = context.userId;
    session.allocatedAt = new Date().toISOString();
  }

  session.expectedClosing = expectedCash(session);
  await persistSession(session);
  await recordMovement(session, {
    movementType: "allocation",
    amount: session.openingFloat,
    createdBy: context.userId,
    notes: `Float pushed by admin · initial cash GHS ${formatAccountAmount(initialCash)}`
  });

  try {
    await createAgentNotification({
      tenantId: session.tenantId,
      userId: session.cashierUserId,
      kind: "float_allocated",
      title: "Till opened by admin",
      body: `Float GHS ${formatAccountAmount(session.openingFloat)} · physical cash GHS ${formatAccountAmount(session.initialCash)} for ${session.businessDate}.`
    });
  } catch {
    // Non-blocking
  }

  return session;
}

export async function listPendingFloatRequests(tenantId: string): Promise<BranchFloatSession[]> {
  const sessions = await listSessions(tenantId);
  return sessions
    .filter(
      (s) =>
        s.status === "requested" ||
        (s.status === "open" &&
          ((s.topUpRequested ?? 0) > 0 ||
            (s.extraCashRequested ?? 0) > 0 ||
            (s.expenseRequested ?? 0) > 0))
    )
    .sort((a, b) => b.requestedAt.localeCompare(a.requestedAt));
}

export function canApproveTillMovements(role: string): boolean {
  return role === "admin" || role === "coordinator";
}

export async function listBranchFloatSessions(
  tenantId: string,
  options?: { businessDate?: string; status?: FloatSessionStatus }
): Promise<BranchFloatSession[]> {
  const date = options?.businessDate?.trim() || todayDate();
  const sessions = await listSessions(tenantId);
  return sessions
    .filter((s) => {
      if (s.businessDate !== date) {
        return false;
      }
      if (options?.status && s.status !== options.status) {
        return false;
      }
      return true;
    })
    .sort((a, b) => b.requestedAt.localeCompare(a.requestedAt));
}

export async function closeBranchFloat(
  context: ActorContext,
  sessionId: string,
  input: { actualClosing: number; varianceNote?: string }
): Promise<BranchFloatSession> {
  const sessions = await listSessions(context.tenantId);
  const session = sessions.find((s) => s.id === sessionId);
  if (!session) {
    throw new Error("Float session not found");
  }
  if (session.cashierUserId !== context.userId && context.role !== "admin") {
    throw new Error("You can only close your own float session");
  }
  if (session.status !== "open") {
    throw new Error("Float session must be open before end-of-day close");
  }

  const expected = expectedCash(session);
  const actual = Math.max(0, input.actualClosing);
  session.expectedClosing = expected;
  session.actualClosing = actual;
  session.variance = Math.round((actual - expected) * 100) / 100;
  session.varianceNote = input.varianceNote?.trim() || undefined;
  session.status = "closed";
  session.closedAt = new Date().toISOString();

  await persistSession(session);

  if (Math.abs(session.variance ?? 0) >= 0.005) {
    try {
      const { openTillCashVarianceFromClose } = await import("./tellerTillCashVarianceService.js");
      await openTillCashVarianceFromClose(session, context.userId);
    } catch {
      // Non-blocking — close still succeeds; OS case can be opened after migration
    }
  }

  try {
    const variance = session.variance ?? 0;
    const absVariance = Math.abs(variance);
    const flagLabel =
      absVariance < 0.005
        ? "balanced"
        : variance > 0
          ? `overage GHS ${absVariance.toFixed(2)} — Branch till OS opened`
          : `shortage GHS ${absVariance.toFixed(2)} — Branch till OS opened`;
    await notifyTenantStaff({
      tenantId: context.tenantId,
      roles: ["admin", "coordinator"],
      kind: "float_closed_pending_settlement",
      title:
        absVariance < 0.005
          ? "Till closed — settlement needed"
          : variance > 0
            ? "Till closed — overage flagged"
            : "Till closed — shortage flagged",
      body: `${await branchDisplayLabel(context.tenantId, session.branchId)} closed with GHS ${actual.toFixed(2)} (${flagLabel}).`
    });
  } catch {
    // Non-blocking
  }
  return session;
}

export async function settleBranchFloat(
  context: ActorContext,
  sessionId: string
): Promise<BranchFloatSession> {
  if (context.role !== "admin" && context.role !== "coordinator") {
    throw new Error("Only admin or coordinator can settle a float session");
  }

  const sessions = await listSessions(context.tenantId);
  const session = sessions.find((s) => s.id === sessionId);
  if (!session) {
    throw new Error("Float session not found");
  }
  if (session.status !== "closed") {
    throw new Error("Float session must be closed before settlement");
  }

  session.status = "settled";
  session.settledBy = context.userId;
  session.settledAt = new Date().toISOString();

  await persistSession(session);
  await recordMovement(session, {
    movementType: "settlement",
    amount: session.actualClosing ?? 0,
    createdBy: context.userId,
    notes: "End-of-day settlement"
  });

  return session;
}

async function recordMovement(
  session: BranchFloatSession,
  input: {
    movementType:
      | "allocation"
      | "deposit"
      | "withdrawal"
      | "adjustment"
      | "settlement"
      | "extra_cash"
      | "expense";
    amount: number;
    customerTransactionId?: string;
    createdBy: string;
    notes?: string;
  }
): Promise<void> {
  const supabase = getSupabaseAdminClient();
  const row = {
    id: randomUUID(),
    tenant_id: session.tenantId,
    session_id: session.id,
    movement_type: input.movementType,
    amount: input.amount,
    customer_transaction_id: input.customerTransactionId ?? null,
    notes: input.notes ?? null,
    created_by: input.createdBy,
    created_at: new Date().toISOString()
  };

  if (!supabase) {
    return;
  }

  const { error } = await supabase.from("branch_float_movements").insert(row);
  if (error && !isMissingSupabaseResource(error.message)) {
    throw new Error(`Failed to record float movement: ${error.message}`);
  }
}

export async function assertOpenFloatForTransaction(
  context: ActorContext,
  transactionBranchId: string
): Promise<BranchFloatSession | null> {
  if (!branchCounterRequiresFloat(context.role)) {
    return null;
  }

  const branchId = await resolveBranchId(context.tenantId, transactionBranchId);
  const session = await getFloatSessionForCashier(
    context.tenantId,
    context.userId,
    todayDate(),
    branchId ?? undefined
  );

  if (!session || session.status !== "open") {
    throw new Error(
      "Open your daily branch counter float before posting cash. Request float from admin or wait for allocation."
    );
  }

  return session;
}

export async function applyTransactionToFloat(
  context: ActorContext,
  transaction: Transaction
): Promise<void> {
  const session = await assertOpenFloatForTransaction(context, transaction.transactionBranchId);
  if (!session) {
    return;
  }

  if (transaction.type === "deposit" || transaction.type === "daily_susu") {
    const availableFloat = remainingFloatBalance(session);
    if (transaction.amount > availableFloat + 1e-9) {
      throw new Error(
        `Insufficient till float balance. Available float: GHS ${formatAccountAmount(availableFloat)}. Request more float from admin.`
      );
    }
  }

  if (transaction.type === "withdrawal") {
    const cashInTill = expectedCash(session);
    if (transaction.amount > cashInTill + 1e-9) {
      throw new Error(
        `Insufficient physical cash in till for this withdrawal. Available: GHS ${formatAccountAmount(cashInTill)}. Collect extra cash first — float alone is not cash.`
      );
    }
  }

  if (transaction.type === "withdrawal") {
    session.totalWithdrawals += transaction.amount;
  } else if (transaction.type === "daily_susu") {
    session.totalDailySusu += transaction.amount;
  } else if (transaction.type === "deposit") {
    session.totalDeposits += transaction.amount;
  }

  session.transactionCount += 1;
  session.expectedClosing = expectedCash(session);

  await persistSession(session);
  await recordMovement(session, {
    movementType: transaction.type === "withdrawal" ? "withdrawal" : "deposit",
    amount: transaction.amount,
    customerTransactionId: transaction.id,
    createdBy: context.userId,
    notes: transaction.type
  });
}

export async function reverseTransactionFromFloat(
  context: ActorContext,
  transaction: Transaction
): Promise<void> {
  const session = await getFloatSessionForCashier(
    context.tenantId,
    context.userId,
    transaction.createdAt.slice(0, 10),
    transaction.transactionBranchId
  );
  if (!session || session.status !== "open") {
    return;
  }

  if (transaction.type === "withdrawal") {
    session.totalWithdrawals = Math.max(0, session.totalWithdrawals - transaction.amount);
  } else if (transaction.type === "daily_susu") {
    session.totalDailySusu = Math.max(0, session.totalDailySusu - transaction.amount);
  } else if (transaction.type === "deposit") {
    session.totalDeposits = Math.max(0, session.totalDeposits - transaction.amount);
  }
  session.transactionCount = Math.max(0, session.transactionCount - 1);
  session.expectedClosing = expectedCash(session);
  await persistSession(session);
}

export async function adjustDepositAmountOnFloat(
  context: ActorContext,
  transaction: Transaction,
  previousAmount: number,
  nextAmount: number
): Promise<void> {
  const session = await getFloatSessionForCashier(
    context.tenantId,
    context.userId,
    transaction.createdAt.slice(0, 10),
    transaction.transactionBranchId
  );
  if (!session || session.status !== "open") {
    return;
  }
  const delta = nextAmount - previousAmount;
  if (delta > 0) {
    const availableFloat = remainingFloatBalance(session);
    if (delta > availableFloat + 1e-9) {
      throw new Error(
        `Insufficient till float balance for the updated amount. Available float: GHS ${formatAccountAmount(availableFloat)}.`
      );
    }
  }
  session.totalDeposits = Math.max(0, session.totalDeposits + delta);
  session.expectedClosing = expectedCash(session);
  await persistSession(session);
}

export function floatSessionSummary(session: BranchFloatSession | null): {
  expectedCash: number;
  floatBalance: number;
  openingFloat: number;
  initialCash: number;
  extraCash: number;
  totalExpenses: number;
  dayCapital: number;
  totalDeposits: number;
  totalWithdrawals: number;
  totalDailySusu: number;
  remainingOpeningFloat: number;
  lowFloatThreshold: number;
  isLowFloat: boolean;
  canTransact: boolean;
  statusLabel: string;
} | null {
  if (!session) {
    return null;
  }
  const expected = expectedCash(session);
  const floatBalance = remainingFloatBalance(session);
  const capital = dayCapital(session);
  const lowFloatThreshold = Math.max(50, session.openingFloat * 0.2);
  const statusLabels: Record<FloatSessionStatus, string> = {
    requested: "Awaiting float release",
    approved: "Approved — not yet open",
    open:
      (session.topUpRequested ?? 0) > 0 ||
      (session.extraCashRequested ?? 0) > 0 ||
      (session.expenseRequested ?? 0) > 0
        ? "Till open · movement awaiting approval"
        : "Till open",
    closed: "Closed — pending settlement",
    settled: "Settled",
    rejected: "Rejected"
  };
  return {
    expectedCash: expected,
    floatBalance,
    openingFloat: session.openingFloat,
    initialCash: session.initialCash,
    extraCash: session.extraCash,
    totalExpenses: session.totalExpenses,
    dayCapital: capital,
    totalDeposits: session.totalDeposits,
    totalWithdrawals: session.totalWithdrawals,
    totalDailySusu: session.totalDailySusu,
    remainingOpeningFloat: floatBalance,
    lowFloatThreshold,
    isLowFloat: session.status === "open" && floatBalance < lowFloatThreshold,
    canTransact: session.status === "open",
    statusLabel: statusLabels[session.status]
  };
}

/** Request or (if authorized) immediately apply extra physical cash. */
export async function collectExtraCash(
  context: ActorContext,
  sessionId: string,
  input: { amount: number; note?: string }
): Promise<BranchFloatSession> {
  const amount = Math.round(Math.max(0, input.amount) * 100) / 100;
  if (amount <= 0) {
    throw new Error("Enter the extra cash amount collected");
  }

  const sessions = await listSessions(context.tenantId);
  const session = sessions.find((s) => s.id === sessionId);
  if (!session) {
    throw new Error("Float session not found");
  }
  if (session.cashierUserId !== context.userId && !canApproveTillMovements(context.role)) {
    throw new Error("You can only collect extra cash on your own till");
  }
  if (session.status !== "open") {
    throw new Error("Till must be open to collect extra cash");
  }

  if (canApproveTillMovements(context.role)) {
    return applyExtraCash(context, session, amount, input.note);
  }

  if ((session.extraCashRequested ?? 0) > 0) {
    throw new Error("An extra cash request is already waiting for approval");
  }
  session.extraCashRequested = amount;
  session.extraCashRequestNote = input.note?.trim() || undefined;
  await persistSession(session);
  try {
    await notifyTenantStaff({
      tenantId: context.tenantId,
      roles: ["admin", "coordinator"],
      kind: "float_requested",
      title: "Extra cash requested",
      body: `GHS ${formatAccountAmount(amount)} extra cash requested for till on ${session.businessDate}.`
    });
  } catch {
    // Non-blocking
  }
  return session;
}

async function applyExtraCash(
  context: ActorContext,
  session: BranchFloatSession,
  amount: number,
  note?: string
): Promise<BranchFloatSession> {
  session.extraCash = Math.round((session.extraCash + amount) * 100) / 100;
  session.extraCashRequested = undefined;
  session.extraCashRequestNote = undefined;
  session.expectedClosing = expectedCash(session);
  await persistSession(session);
  await recordMovement(session, {
    movementType: "extra_cash",
    amount,
    createdBy: context.userId,
    notes: note?.trim() || "Extra cash collected for till payouts"
  });
  return session;
}

export async function approveExtraCash(
  context: ActorContext,
  sessionId: string,
  input?: { amount?: number }
): Promise<BranchFloatSession> {
  if (!canApproveTillMovements(context.role)) {
    throw new Error("Only admin or coordinator can approve extra cash");
  }
  const sessions = await listSessions(context.tenantId);
  const session = sessions.find((s) => s.id === sessionId);
  if (!session) {
    throw new Error("Float session not found");
  }
  if (session.status !== "open") {
    throw new Error("Till must be open");
  }
  const amount = Math.round(Math.max(0, input?.amount ?? session.extraCashRequested ?? 0) * 100) / 100;
  if (amount <= 0) {
    throw new Error("No pending extra cash to approve");
  }
  const note = session.extraCashRequestNote;
  return applyExtraCash(context, session, amount, note);
}

/** Request or (if authorized) immediately apply a till expense. */
export async function recordTillExpense(
  context: ActorContext,
  sessionId: string,
  input: { amount: number; note?: string }
): Promise<BranchFloatSession> {
  const amount = Math.round(Math.max(0, input.amount) * 100) / 100;
  if (amount <= 0) {
    throw new Error("Enter the expense amount");
  }
  if (!input.note?.trim()) {
    throw new Error("Enter a reason for the expense");
  }

  const sessions = await listSessions(context.tenantId);
  const session = sessions.find((s) => s.id === sessionId);
  if (!session) {
    throw new Error("Float session not found");
  }
  if (session.cashierUserId !== context.userId && !canApproveTillMovements(context.role)) {
    throw new Error("You can only record expenses on your own till");
  }
  if (session.status !== "open") {
    throw new Error("Till must be open to record an expense");
  }

  if (canApproveTillMovements(context.role)) {
    return applyTillExpense(context, session, amount, input.note);
  }

  if ((session.expenseRequested ?? 0) > 0) {
    throw new Error("An expense request is already waiting for approval");
  }
  session.expenseRequested = amount;
  session.expenseRequestNote = input.note.trim();
  await persistSession(session);
  try {
    await notifyTenantStaff({
      tenantId: context.tenantId,
      roles: ["admin", "coordinator"],
      kind: "float_requested",
      title: "Till expense requested",
      body: `GHS ${formatAccountAmount(amount)} expense requested for till on ${session.businessDate}.`
    });
  } catch {
    // Non-blocking
  }
  return session;
}

async function applyTillExpense(
  context: ActorContext,
  session: BranchFloatSession,
  amount: number,
  note: string
): Promise<BranchFloatSession> {
  const cashInTill = expectedCash(session);
  if (amount > cashInTill + 1e-9) {
    throw new Error(
      `Expense exceeds physical cash in till (GHS ${formatAccountAmount(cashInTill)} available).`
    );
  }
  session.totalExpenses = Math.round((session.totalExpenses + amount) * 100) / 100;
  session.expenseRequested = undefined;
  session.expenseRequestNote = undefined;
  session.expectedClosing = expectedCash(session);
  await persistSession(session);
  await recordMovement(session, {
    movementType: "expense",
    amount,
    createdBy: context.userId,
    notes: note.trim() || "Till expense"
  });
  return session;
}

export async function approveTillExpense(
  context: ActorContext,
  sessionId: string,
  input?: { amount?: number }
): Promise<BranchFloatSession> {
  if (!canApproveTillMovements(context.role)) {
    throw new Error("Only admin or coordinator can approve till expenses");
  }
  const sessions = await listSessions(context.tenantId);
  const session = sessions.find((s) => s.id === sessionId);
  if (!session) {
    throw new Error("Float session not found");
  }
  if (session.status !== "open") {
    throw new Error("Till must be open");
  }
  const amount = Math.round(Math.max(0, input?.amount ?? session.expenseRequested ?? 0) * 100) / 100;
  if (amount <= 0) {
    throw new Error("No pending expense to approve");
  }
  const note = session.expenseRequestNote || "Till expense";
  return applyTillExpense(context, session, amount, note);
}
