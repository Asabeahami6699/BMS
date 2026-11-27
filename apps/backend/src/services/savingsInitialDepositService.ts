import { formatAccountAmount } from "@bms/shared";
import type { Customer, SusuCommissionDeductionTiming } from "@bms/shared";
import { randomUUID } from "node:crypto";
import { getSupabaseAdminClient } from "../config/supabaseClient.js";
import { addLedgerEntry } from "./ledgerService.js";
import { getActiveSusuCommissionPolicy } from "./susuCycleCommissionService.js";
import { getSavingsOpeningFeeGhs } from "./tenantProfileService.js";

const creditedInitialDepositForAlert = new Map<
  string,
  { transactionId: string; amount: number }
>();

function alertKey(tenantId: string, customerId: string): string {
  return `${tenantId}:${customerId}`;
}

/**
 * Consumes the one-time credited initial deposit details recorded during approval
 * so the HTTP route can dispatch the follow-up deposit SMS/email right after the
 * account-opened notification.
 */
export function consumeCreditedInitialDepositForNotification(
  tenantId: string,
  customerId: string
): { transactionId: string; amount: number } | null {
  const key = alertKey(tenantId, customerId);
  const entry = creditedInitialDepositForAlert.get(key) ?? null;
  if (entry) {
    creditedInitialDepositForAlert.delete(key);
  }
  return entry;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function isMissingSavingsInitialDepositColumnsError(message: string): boolean {
  return /initial_deposit_amount|initial_deposit_credited_at|savings_lock_timing|savings_lock_target_amount/i.test(
    message
  );
}

/**
 * Resolves the effective non-withdrawable savings lock amount for balance/withdrawal checks.
 * - For `first_collection` / `cycle_maturity` (locked on approval), `lockedBalance` is already set.
 * - For `withdrawal` (deferred lock), before the first withdrawal `lockedBalance` is 0 on the customer
 *   record while `savingsLockTargetAmount` holds the minimum balance that will be locked on withdrawal.
 */
export function resolveSavingsEffectiveLockAmount(customer: Customer): number {
  const locked = Math.max(0, customer.lockedBalance ?? 0);
  if (customer.accountType !== "savings") {
    return locked;
  }
  if (customer.savingsLockTiming === "withdrawal") {
    const target = Math.max(0, customer.savingsLockTargetAmount ?? 0);
    return Math.max(locked, target);
  }
  return locked;
}

/**
 * Credits a Savings customer's initial deposit once the account is approved and assigned an account number,
 * and applies `locked_balance` according to the tenant's Commission Settings "When to deduct" policy:
 * - `first_collection` or `cycle_maturity`: locks `locked_balance` immediately on approval.
 * - `withdrawal`: credits full initial deposit with `locked_balance = 0` and defers locking until withdrawal.
 */
export async function applySavingsInitialDepositOnApproval(
  tenantId: string,
  customer: Customer,
  recordedByUserId: string
): Promise<void> {
  if (customer.accountType !== "savings") {
    return;
  }

  // Idempotency guard: never double-credit an already-credited initial deposit.
  if (customer.initialDepositCreditedAt) {
    return;
  }

  const configuredLock = round2(await getSavingsOpeningFeeGhs(tenantId));
  const lockedTarget =
    customer.savingsLockTargetAmount != null && customer.savingsLockTargetAmount > 0
      ? round2(customer.savingsLockTargetAmount)
      : configuredLock;

  const depositAmount =
    customer.initialDepositAmount != null && customer.initialDepositAmount > 0
      ? round2(customer.initialDepositAmount)
      : customer.savingsOpeningFeeCollected
        ? lockedTarget
        : 0;

  if (depositAmount <= 0) {
    return;
  }

  // Legacy idempotency guard for rows approved before migration 109 existed.
  if (
    customer.initialDepositAmount == null &&
    (customer.lockedBalance ?? 0) >= lockedTarget &&
    lockedTarget > 0
  ) {
    return;
  }

  let lockTiming: SusuCommissionDeductionTiming = customer.savingsLockTiming ?? "first_collection";
  if (!customer.savingsLockTiming) {
    try {
      const policy = await getActiveSusuCommissionPolicy(tenantId);
      lockTiming = policy.deductionTiming;
    } catch {
      lockTiming = "first_collection";
    }
  }

  // Per policy: first_collection and cycle_maturity lock immediately on approval;
  // withdrawal defers locked_balance until the customer withdraws.
  const lockImmediately = lockTiming !== "withdrawal";
  const lockedNow = lockImmediately ? round2(Math.min(depositAmount, lockedTarget)) : 0;
  const nowIso = new Date().toISOString();

  const notes =
    lockedNow > 0
      ? `Savings initial deposit (GHS ${formatAccountAmount(lockedNow)} locked non-withdrawable)`
      : lockedTarget > 0
        ? `Savings initial deposit (GHS ${formatAccountAmount(lockedTarget)} locked balance applies on withdrawal)`
        : "Savings initial deposit";

  const supabase = getSupabaseAdminClient();
  if (supabase) {
    // 1. Persist lock state & metadata before/around posting so SQL guard matches.
    const fullUpdate = {
      locked_balance: lockedNow,
      initial_deposit_amount: depositAmount,
      initial_deposit_credited_at: nowIso,
      savings_lock_timing: lockTiming,
      savings_lock_target_amount: lockedTarget,
      savings_opening_fee_collected: lockedNow >= lockedTarget,
      savings_opening_fee_recovered: lockedNow
    };
    let { error: lockError } = await supabase
      .from("customers")
      .update(fullUpdate)
      .eq("tenant_id", tenantId)
      .eq("id", customer.id);

    if (lockError && isMissingSavingsInitialDepositColumnsError(lockError.message)) {
      const fallback = await supabase
        .from("customers")
        .update({
          locked_balance: lockedNow,
          savings_opening_fee_collected: lockedNow >= lockedTarget,
          savings_opening_fee_recovered: lockedNow
        })
        .eq("tenant_id", tenantId)
        .eq("id", customer.id);
      lockError = fallback.error;
    }

    if (lockError) {
      throw new Error(`Failed to set savings locked deposit: ${lockError.message}`);
    }

    // 2. Credit the full initial deposit to the customer's account now that account_number is ready.
    const transactionId = randomUUID();
    const { error: rpcError } = await supabase.rpc("post_customer_transaction_atomic", {
      p_transaction_id: transactionId,
      p_tenant_id: tenantId,
      p_customer_id: customer.id,
      p_type: "deposit",
      p_amount: depositAmount,
      p_transaction_branch_id: customer.homeBranchId,
      p_home_branch_id: customer.homeBranchId,
      p_recorded_by_user_id: recordedByUserId,
      p_field_agent_id: customer.assignedFieldAgentId,
      p_notes: notes
    });

    if (rpcError) {
      throw new Error(`Failed to post savings initial deposit: ${rpcError.message}`);
    }

    creditedInitialDepositForAlert.set(alertKey(tenantId, customer.id), {
      transactionId,
      amount: depositAmount
    });

    if (lockedNow > 0) {
      await postSavingsOpeningFeeIncome({
        tenantId,
        customerId: customer.id,
        branchId: customer.homeBranchId,
        amount: lockedNow,
        transactionId,
        recordedByUserId,
        businessDate: nowIso.slice(0, 10)
      });
    }
    return;
  }

  // In-memory store path (used by unit/integration tests without Supabase)
  const memoryTxId = randomUUID();
  const patch = {
    initialDepositAmount: depositAmount,
    initialDepositCreditedAt: nowIso,
    savingsLockTiming: lockTiming,
    savingsLockTargetAmount: lockedTarget,
    lockedBalance: lockedNow,
    savingsOpeningFeeCollected: lockedNow >= lockedTarget,
    savingsOpeningFeeRecovered: lockedNow
  };
  Object.assign(customer, patch);
  const { updateCustomerSavingsLockInMemory } = await import("./customerService.js");
  updateCustomerSavingsLockInMemory(tenantId, customer.id, patch);

  await addLedgerEntry({
    tenantId,
    customerId: customer.id,
    transactionId: memoryTxId,
    entryType: "credit",
    amount: depositAmount,
    transactionBranchId: customer.homeBranchId
  });

  creditedInitialDepositForAlert.set(alertKey(tenantId, customer.id), {
    transactionId: memoryTxId,
    amount: depositAmount
  });

  if (lockedNow > 0) {
    await postSavingsOpeningFeeIncome({
      tenantId,
      customerId: customer.id,
      branchId: customer.homeBranchId,
      amount: lockedNow,
      transactionId: memoryTxId,
      recordedByUserId,
      businessDate: nowIso.slice(0, 10)
    });
  }
}

/**
 * Enforces and persists `locked_balance` on a Savings account's first withdrawal when its
 * Commission Settings timing is `withdrawal`.
 * Must be called BEFORE `post_customer_transaction_atomic` so Postgres also enforces the lock.
 */
export async function enforceSavingsLockOnWithdrawal(options: {
  tenantId: string;
  customer: Customer;
  recordedByUserId: string;
  branchId?: string;
}): Promise<{ applied: boolean; lockedAmount: number }> {
  const { tenantId, customer, recordedByUserId, branchId } = options;
  if (customer.accountType !== "savings" || customer.savingsLockTiming !== "withdrawal") {
    return { applied: false, lockedAmount: Math.max(0, customer.lockedBalance ?? 0) };
  }

  const target =
    customer.savingsLockTargetAmount != null && customer.savingsLockTargetAmount > 0
      ? round2(customer.savingsLockTargetAmount)
      : round2(await getSavingsOpeningFeeGhs(tenantId));

  const currentLocked = Math.max(0, customer.lockedBalance ?? 0);
  if (target <= 0 || currentLocked >= target) {
    return { applied: false, lockedAmount: currentLocked };
  }

  const supabase = getSupabaseAdminClient();
  if (supabase) {
    const { error } = await supabase
      .from("customers")
      .update({
        locked_balance: target,
        savings_opening_fee_collected: true,
        savings_opening_fee_recovered: target
      })
      .eq("tenant_id", tenantId)
      .eq("id", customer.id);
    if (error) {
      throw new Error(`Failed to apply savings locked balance on withdrawal: ${error.message}`);
    }
  } else {
    const patch = {
      lockedBalance: target,
      savingsOpeningFeeCollected: true,
      savingsOpeningFeeRecovered: target
    };
    Object.assign(customer, patch);
    const { updateCustomerSavingsLockInMemory } = await import("./customerService.js");
    updateCustomerSavingsLockInMemory(tenantId, customer.id, patch);
  }

  await postSavingsOpeningFeeIncome({
    tenantId,
    customerId: customer.id,
    branchId: branchId || customer.homeBranchId,
    amount: target,
    recordedByUserId,
    businessDate: new Date().toISOString().slice(0, 10),
    notes: "Savings locked balance applied on withdrawal"
  });

  return { applied: true, lockedAmount: target };
}

/** Institutional income for savings opening fee (idempotent per customer). */
export async function postSavingsOpeningFeeIncome(options: {
  tenantId: string;
  customerId: string;
  branchId: string;
  amount: number;
  transactionId?: string;
  recordedByUserId: string;
  businessDate?: string;
  notes?: string;
  /** When true, surface posting errors (report backfill). Default swallows for approval path. */
  throwOnError?: boolean;
}): Promise<void> {
  if (!(options.amount > 0) || !options.branchId) {
    return;
  }
  const { postInstitutionalIncome } = await import("./institutionalIncomeService.js");
  const { listBranches } = await import("./branchService.js");
  const branches = await listBranches(options.tenantId).catch(() => []);
  const branchName =
    branches.find((b) => String(b.id) === String(options.branchId))?.name ?? "Branch";
  const run = postInstitutionalIncome(
    {
      userId: options.recordedByUserId,
      tenantId: options.tenantId,
      role: "system"
    },
    {
      branchId: String(options.branchId),
      source: "savings_fee",
      amount: options.amount,
      customerId: options.customerId,
      transactionId: options.transactionId,
      businessDate: options.businessDate,
      notes: options.notes ?? "Savings opening fee (locked initial deposit)",
      // Stable per customer so locked + recovered paths never double-post.
      idempotencyKey: `savings_fee:opening:${options.customerId}`
    },
    { branchName }
  );
  if (options.throwOnError) {
    await run;
    return;
  }
  await run.catch(() => {
    /* income tracking must not block account approval */
  });
}
