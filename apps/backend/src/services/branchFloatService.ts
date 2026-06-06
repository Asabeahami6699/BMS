import { randomUUID } from "node:crypto";
import { getSupabaseAdminClient } from "../config/supabaseClient.js";
import { isMissingSupabaseResource } from "../lib/supabaseSchema.js";
import { resolveBranchId } from "./branchService.js";
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
  openingFloat: number;
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

function expectedCash(session: BranchFloatSession): number {
  return (
    session.openingFloat +
    session.totalDeposits +
    session.totalDailySusu -
    session.totalWithdrawals
  );
}

/** Remaining allocated float: reduced by deposits/Susu, increased by withdrawals. */
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
    varianceNote: row.variance_note != null ? String(row.variance_note) : undefined
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

  const { error } = await supabase.from("branch_float_sessions").upsert(sessionToRow(session));
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
  input: { branchId: string; requestedAmount: number; note?: string; businessDate?: string }
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
  try {
    await notifyTenantStaff({
      tenantId: context.tenantId,
      roles: ["admin", "coordinator"],
      kind: "float_requested",
      title: "Till float requested",
      body: `GHS ${session.openingFloat.toFixed(2)} requested for branch ${branchId} on ${businessDate}.`
    });
  } catch {
    // Non-blocking
  }
  return session;
}

export async function allocateBranchFloat(
  context: ActorContext,
  sessionId: string,
  input: { openingFloat: number }
): Promise<BranchFloatSession> {
  if (context.role !== "admin" && context.role !== "coordinator") {
    throw new Error("Only admin or coordinator can release float");
  }

  const sessions = await listSessions(context.tenantId);
  const session = sessions.find((s) => s.id === sessionId);
  if (!session) {
    throw new Error("Float session not found");
  }
  if (session.status !== "requested" && session.status !== "approved") {
    throw new Error("Float session cannot be opened in its current status");
  }

  const opening = Math.max(0, input.openingFloat);
  session.openingFloat = opening;
  session.status = "open";
  session.allocatedBy = context.userId;
  session.allocatedAt = new Date().toISOString();
  session.expectedClosing = expectedCash(session);

  await persistSession(session);
  await recordMovement(session, {
    movementType: "allocation",
    amount: opening,
    createdBy: context.userId,
    notes: "Opening float released"
  });

  try {
    await createAgentNotification({
      tenantId: session.tenantId,
      userId: session.cashierUserId,
      kind: "float_allocated",
      title: "Till float released",
      body: `GHS ${opening.toFixed(2)} is now open for ${session.businessDate}. You can transact at the branch counter.`
    });
  } catch {
    // Non-blocking
  }

  return session;
}

/** Admin pushes float directly (skip request queue). */
export async function pushBranchFloat(
  context: ActorContext,
  input: {
    branchId: string;
    cashierUserId: string;
    openingFloat: number;
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
      openingFloat: Math.max(0, input.openingFloat),
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
    session.openingFloat = Math.max(0, input.openingFloat);
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
    notes: "Float pushed by admin"
  });

  try {
    await createAgentNotification({
      tenantId: session.tenantId,
      userId: session.cashierUserId,
      kind: "float_allocated",
      title: "Till float pushed",
      body: `Admin opened GHS ${session.openingFloat.toFixed(2)} for ${session.businessDate}.`
    });
  } catch {
    // Non-blocking
  }

  return session;
}

export async function listPendingFloatRequests(tenantId: string): Promise<BranchFloatSession[]> {
  const sessions = await listSessions(tenantId);
  return sessions
    .filter((s) => s.status === "requested")
    .sort((a, b) => b.requestedAt.localeCompare(a.requestedAt));
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
  try {
    await notifyTenantStaff({
      tenantId: context.tenantId,
      roles: ["admin", "coordinator"],
      kind: "float_closed_pending_settlement",
      title: "Till closed — settlement needed",
      body: `Branch ${session.branchId} closed with GHS ${actual.toFixed(2)} (variance ${session.variance?.toFixed(2) ?? "0"}).`
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
    movementType: "allocation" | "deposit" | "withdrawal" | "adjustment" | "settlement";
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
        `Insufficient till float balance. Available float: GHS ${availableFloat.toFixed(2)}. Request more float from admin.`
      );
    }
  }

  if (transaction.type === "withdrawal") {
    const cashInTill = expectedCash(session);
    if (transaction.amount > cashInTill + 1e-9) {
      throw new Error(
        `Insufficient cash in till for this withdrawal. Available: GHS ${cashInTill.toFixed(2)}.`
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

export function floatSessionSummary(session: BranchFloatSession | null): {
  expectedCash: number;
  floatBalance: number;
  openingFloat: number;
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
  const lowFloatThreshold = Math.max(50, session.openingFloat * 0.2);
  const statusLabels: Record<FloatSessionStatus, string> = {
    requested: "Awaiting float release",
    approved: "Approved — not yet open",
    open: "Till open",
    closed: "Closed — pending settlement",
    settled: "Settled",
    rejected: "Rejected"
  };
  return {
    expectedCash: expected,
    floatBalance,
    openingFloat: session.openingFloat,
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
