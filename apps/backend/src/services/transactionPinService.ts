import {
  roleRequiresTransactionPin,
  TRANSACTION_PIN_LOCKOUT_MS,
  TRANSACTION_PIN_MAX_ATTEMPTS,
  TRANSACTION_STEP_UP_TTL_MS,
  validateTransactionPinFormat,
  type TransactionPinStatus,
  type TransactionPinVerifyResult
} from "@bms/shared";
import { randomUUID } from "node:crypto";
import { getSupabaseAdminClient } from "../config/supabaseClient.js";
import { findUserById } from "./authStore.js";
import { hashPassword, verifyPassword } from "./password.js";
import { writeAuditLog } from "./auditService.js";

type PinRecord = {
  userId: string;
  tenantId: string;
  transactionPinHash: string | null;
  transactionPinSetAt: string | null;
  transactionPinFailedAttempts: number;
  transactionPinLockedUntil: string | null;
  transactionPinResetRequired: boolean;
};

type StepUpSession = {
  userId: string;
  tenantId: string;
  expiresAt: number;
};

const memoryPinByUserId = new Map<string, PinRecord>();
const stepUpTokens = new Map<string, StepUpSession>();

function memoryKey(userId: string, tenantId: string): string {
  return `${tenantId}:${userId}`;
}

async function loadPinRecord(userId: string, tenantId: string): Promise<PinRecord | null> {
  const supabase = getSupabaseAdminClient();
  if (supabase) {
    const { data, error } = await supabase
      .from("users")
      .select(
        "id, tenant_id, transaction_pin_hash, transaction_pin_set_at, transaction_pin_failed_attempts, transaction_pin_locked_until, transaction_pin_reset_required"
      )
      .eq("id", userId)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (error) {
      throw new Error(`Failed to load transaction PIN status: ${error.message}`);
    }
    if (!data) {
      return null;
    }
    return {
      userId: String(data.id),
      tenantId: String(data.tenant_id),
      transactionPinHash: data.transaction_pin_hash ? String(data.transaction_pin_hash) : null,
      transactionPinSetAt: data.transaction_pin_set_at ? String(data.transaction_pin_set_at) : null,
      transactionPinFailedAttempts: Number(data.transaction_pin_failed_attempts ?? 0),
      transactionPinLockedUntil: data.transaction_pin_locked_until
        ? String(data.transaction_pin_locked_until)
        : null,
      transactionPinResetRequired: Boolean(data.transaction_pin_reset_required)
    };
  }

  const key = memoryKey(userId, tenantId);
  if (memoryPinByUserId.has(key)) {
    return memoryPinByUserId.get(key)!;
  }
  const user = findUserById(userId);
  if (!user || user.tenantId !== tenantId) {
    return null;
  }
  const record: PinRecord = {
    userId,
    tenantId,
    transactionPinHash: null,
    transactionPinSetAt: null,
    transactionPinFailedAttempts: 0,
    transactionPinLockedUntil: null,
    transactionPinResetRequired: false
  };
  memoryPinByUserId.set(key, record);
  return record;
}

async function savePinRecord(record: PinRecord): Promise<void> {
  const supabase = getSupabaseAdminClient();
  if (supabase) {
    const { error } = await supabase
      .from("users")
      .update({
        transaction_pin_hash: record.transactionPinHash,
        transaction_pin_set_at: record.transactionPinSetAt,
        transaction_pin_failed_attempts: record.transactionPinFailedAttempts,
        transaction_pin_locked_until: record.transactionPinLockedUntil,
        transaction_pin_reset_required: record.transactionPinResetRequired
      })
      .eq("id", record.userId)
      .eq("tenant_id", record.tenantId);
    if (error) {
      throw new Error(`Failed to save transaction PIN: ${error.message}`);
    }
    return;
  }
  memoryPinByUserId.set(memoryKey(record.userId, record.tenantId), record);
}

function isLocked(record: PinRecord): boolean {
  if (!record.transactionPinLockedUntil) {
    return false;
  }
  return new Date(record.transactionPinLockedUntil).getTime() > Date.now();
}

function cleanupStepUpTokens(): void {
  const now = Date.now();
  for (const [token, session] of stepUpTokens.entries()) {
    if (session.expiresAt <= now) {
      stepUpTokens.delete(token);
    }
  }
}

export async function getTransactionPinStatus(
  userId: string,
  tenantId: string,
  role: string
): Promise<TransactionPinStatus> {
  const required = roleRequiresTransactionPin(role);
  if (!required) {
    return { required: false, configured: false, resetRequired: false, lockedUntil: null };
  }
  const record = await loadPinRecord(userId, tenantId);
  if (!record) {
    return { required: true, configured: false, resetRequired: false, lockedUntil: null };
  }
  return {
    required: true,
    configured: Boolean(record.transactionPinHash),
    resetRequired: record.transactionPinResetRequired,
    lockedUntil: isLocked(record) ? record.transactionPinLockedUntil : null
  };
}

export async function setTransactionPin(
  userId: string,
  tenantId: string,
  role: string,
  pin: string
): Promise<void> {
  if (!roleRequiresTransactionPin(role)) {
    throw new Error("Transaction PIN is only required for teller and back officer roles");
  }
  const formatError = validateTransactionPinFormat(pin);
  if (formatError) {
    throw new Error(formatError);
  }
  const record = await loadPinRecord(userId, tenantId);
  if (!record) {
    throw new Error("User not found");
  }
  if (!record.transactionPinResetRequired) {
    throw new Error(
      "An administrator must reset your transaction PIN before you can set a new one"
    );
  }
  const now = new Date().toISOString();
  await savePinRecord({
    ...record,
    transactionPinHash: hashPassword(pin),
    transactionPinSetAt: now,
    transactionPinFailedAttempts: 0,
    transactionPinLockedUntil: null,
    transactionPinResetRequired: false
  });
  await writeAuditLog({
    tenantId,
    actorUserId: userId,
    actorRole: role,
    method: "POST",
    path: "/api/v1/auth/transaction-pin/setup",
    statusCode: 200
  });
}

export async function verifyTransactionPin(
  userId: string,
  tenantId: string,
  role: string,
  pin: string
): Promise<TransactionPinVerifyResult> {
  if (!roleRequiresTransactionPin(role)) {
    return { token: "", expiresAt: new Date().toISOString() };
  }

  const record = await loadPinRecord(userId, tenantId);
  if (!record?.transactionPinHash) {
    if (record?.transactionPinResetRequired) {
      throw new Error("Your administrator requires you to set a new transaction PIN before posting transactions");
    }
    throw new Error("Contact an administrator to reset your transaction PIN before posting transactions");
  }
  if (isLocked(record)) {
    throw new Error(
      `Transaction PIN is locked. Try again after ${new Date(record.transactionPinLockedUntil!).toLocaleTimeString()}`
    );
  }

  const ok = verifyPassword(pin, record.transactionPinHash);
  if (!ok) {
    const attempts = record.transactionPinFailedAttempts + 1;
    const lockedUntil =
      attempts >= TRANSACTION_PIN_MAX_ATTEMPTS
        ? new Date(Date.now() + TRANSACTION_PIN_LOCKOUT_MS).toISOString()
        : null;
    await savePinRecord({
      ...record,
      transactionPinFailedAttempts: attempts,
      transactionPinLockedUntil: lockedUntil
    });
    await writeAuditLog({
      tenantId,
      actorUserId: userId,
      actorRole: role,
      method: "POST",
      path: "/api/v1/auth/transaction-pin/verify",
      statusCode: 401
    });
    if (lockedUntil) {
      throw new Error("Too many incorrect PIN attempts. PIN locked for 15 minutes.");
    }
    throw new Error(
      `Incorrect transaction PIN. ${TRANSACTION_PIN_MAX_ATTEMPTS - attempts} attempt(s) left.`
    );
  }

  await savePinRecord({
    ...record,
    transactionPinFailedAttempts: 0,
    transactionPinLockedUntil: null
  });

  cleanupStepUpTokens();
  const token = `txstep_${randomUUID()}`;
  const expiresAt = Date.now() + TRANSACTION_STEP_UP_TTL_MS;
  stepUpTokens.set(token, { userId, tenantId, expiresAt });

  await writeAuditLog({
    tenantId,
    actorUserId: userId,
    actorRole: role,
    method: "POST",
    path: "/api/v1/auth/transaction-pin/verify",
    statusCode: 200
  });

  return {
    token,
    expiresAt: new Date(expiresAt).toISOString()
  };
}

export function verifyStepUpToken(token: string | undefined, userId: string, tenantId: string): boolean {
  if (!token?.trim()) {
    return false;
  }
  cleanupStepUpTokens();
  const session = stepUpTokens.get(token.trim());
  if (!session) {
    return false;
  }
  if (session.expiresAt <= Date.now()) {
    stepUpTokens.delete(token.trim());
    return false;
  }
  return session.userId === userId && session.tenantId === tenantId;
}

export async function seedTransactionPinResetForNewUser(
  userId: string,
  tenantId: string,
  role: string
): Promise<void> {
  if (!roleRequiresTransactionPin(role)) {
    return;
  }
  const record = await loadPinRecord(userId, tenantId);
  if (!record) {
    return;
  }
  await savePinRecord({
    ...record,
    transactionPinResetRequired: true
  });
}

export async function requireTransactionPinResetForUser(
  tenantId: string,
  targetUserId: string,
  actorUserId: string,
  actorRole: string
): Promise<void> {
  const record = await loadPinRecord(targetUserId, tenantId);
  if (!record) {
    throw new Error("User not found");
  }
  await savePinRecord({
    ...record,
    transactionPinHash: null,
    transactionPinSetAt: null,
    transactionPinFailedAttempts: 0,
    transactionPinLockedUntil: null,
    transactionPinResetRequired: true
  });
  await writeAuditLog({
    tenantId,
    actorUserId,
    actorRole,
    method: "POST",
    path: `/api/v1/users/${targetUserId}/transaction-pin/reset`,
    statusCode: 200
  });
}

export async function assertTransactionStepUpReady(
  userId: string,
  tenantId: string,
  role: string
): Promise<void> {
  if (!roleRequiresTransactionPin(role)) {
    return;
  }
  const status = await getTransactionPinStatus(userId, tenantId, role);
  if (!status.configured) {
    if (status.resetRequired) {
      throw new Error("Your administrator requires you to set a new transaction PIN before posting transactions");
    }
    throw new Error("Contact an administrator to reset your transaction PIN before posting transactions");
  }
  if (status.lockedUntil && new Date(status.lockedUntil).getTime() > Date.now()) {
    throw new Error("Transaction PIN is locked. Try again later.");
  }
}
