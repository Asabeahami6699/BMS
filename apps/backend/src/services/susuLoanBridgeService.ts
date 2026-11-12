import { randomUUID } from "crypto";
import { canUseSusuLoanBridge,
  susuCreditSnapshotSchema,
  type SusuCreditSnapshot,
  type TenantProductModule, formatAccountAmount } from "@bms/shared";
import { getSupabaseAdminClient } from "../config/supabaseClient.js";
import { getCustomerById, getCustomerWithdrawableBalance } from "./customerService.js";
import { notifyCustomerLoanRepaymentFromSusu } from "./customerNotificationService.js";
import { addLedgerEntry, computeCustomerBalance } from "./ledgerService.js";
import { getSusuLoanBridgeEnabled } from "./tenantProfileService.js";
import { loadTenantModules } from "./tenantModuleService.js";

export const LOAN_REPAYMENT_SUSU_NOTE_TAG = "loan_repay:";
export const LOAN_REPAYMENT_SUSU_REVERSE_TAG = "loan_repay_reverse:";
export const LOAN_DISBURSE_SUSU_NOTE_TAG = "loan_disburse:";

function rpcPostFailedMessage(action: string, rpcMessage: string): string {
  return `Failed to ${action}: ${rpcMessage}. Apply Supabase migrations (including 084) and retry — non-atomic fallback is disabled.`;
}

export async function isSusuLoanBridgeActive(tenantId: string): Promise<boolean> {
  const [modules, settingEnabled] = await Promise.all([
    loadTenantModules(tenantId),
    getSusuLoanBridgeEnabled(tenantId)
  ]);
  return canUseSusuLoanBridge(modules as TenantProductModule[], settingEnabled);
}

async function recentDailySusuStats(
  tenantId: string,
  customerId: string
): Promise<{ count: number; total: number }> {
  const supabase = getSupabaseAdminClient();
  if (!supabase) {
    return { count: 0, total: 0 };
  }
  const since = new Date();
  since.setDate(since.getDate() - 90);
  const { data, error } = await supabase
    .from("customer_transactions")
    .select("amount")
    .eq("tenant_id", tenantId)
    .eq("customer_id", customerId)
    .eq("type", "daily_susu")
    .is("reversed_at", null)
    .gte("created_at", since.toISOString());
  if (error) {
    if (/reversed_at|column/i.test(error.message)) {
      const retry = await supabase
        .from("customer_transactions")
        .select("amount")
        .eq("tenant_id", tenantId)
        .eq("customer_id", customerId)
        .eq("type", "daily_susu")
        .gte("created_at", since.toISOString());
      if (retry.error) {
        return { count: 0, total: 0 };
      }
      const rows = retry.data ?? [];
      return {
        count: rows.length,
        total: Math.round(rows.reduce((sum, row) => sum + Number(row.amount ?? 0), 0) * 100) / 100
      };
    }
    return { count: 0, total: 0 };
  }
  const rows = data ?? [];
  return {
    count: rows.length,
    total: Math.round(rows.reduce((sum, row) => sum + Number(row.amount ?? 0), 0) * 100) / 100
  };
}

/** Read-only Susu benchmark for loan qualification (bridge must already be active). */
export async function buildSusuCreditSnapshot(
  tenantId: string,
  customerId: string
): Promise<SusuCreditSnapshot> {
  const customer = await getCustomerById(tenantId, customerId);
  if (!customer) {
    throw new Error("Customer not found");
  }
  const [accountBalance, withdrawableBalance, susuStats] = await Promise.all([
    computeCustomerBalance(tenantId, customerId),
    getCustomerWithdrawableBalance(tenantId, customerId),
    recentDailySusuStats(tenantId, customerId)
  ]);
  const lockedBalance = Math.max(0, customer.lockedBalance ?? 0);
  return susuCreditSnapshotSchema.parse({
    capturedAt: new Date().toISOString(),
    accountBalance: Math.round(accountBalance * 100) / 100,
    withdrawableBalance: Math.round(withdrawableBalance * 100) / 100,
    lockedBalance: Math.round(lockedBalance * 100) / 100,
    dailySusuCount90d: susuStats.count,
    dailySusuTotal90d: susuStats.total,
    note: "Captured for Susu↔Loans bridge qualification"
  });
}

/**
 * Debit the customer's Susu/savings ledger for a loan repayment.
 * Idempotent per repayment id via notes tag.
 */
export async function postSusuDebitForLoanRepayment(params: {
  tenantId: string;
  customerId: string;
  branchId: string;
  amount: number;
  repaymentId: string;
  loanId: string;
  recordedByUserId: string;
}): Promise<string> {
  if (!(await isSusuLoanBridgeActive(params.tenantId))) {
    throw new Error("Susu↔Loans bridge is not enabled for this company");
  }
  if (params.amount <= 0) {
    throw new Error("Repayment amount must be greater than zero");
  }

  const customer = await getCustomerById(params.tenantId, params.customerId);
  if (!customer || customer.status !== "active") {
    throw new Error("Customer not found or not active");
  }

  const idempotencyTag = `${LOAN_REPAYMENT_SUSU_NOTE_TAG}${params.repaymentId}`;
  const loanRef = params.loanId.replace(/-/g, "").slice(0, 8).toUpperCase();
  const fullNotes = `Loan repayment · Paid from Susu/savings account · Loan ${loanRef} · ${idempotencyTag}`;

  // Loan repayment may consume the installment reserve; still respect savings locked minimum.
  const available = await getCustomerWithdrawableBalance(params.tenantId, params.customerId, {
    allowLoanReserve: true
  });
  if (available < params.amount) {
    throw new Error(
      `Insufficient Susu/savings balance. Available for loan repayment: GHS ${available.toFixed(2)}`
    );
  }

  const balanceBefore = await computeCustomerBalance(params.tenantId, params.customerId);
  const transactionId = randomUUID();
  const homeBranchId = customer.homeBranchId || params.branchId;
  const supabase = getSupabaseAdminClient();

  if (supabase) {
    const { data: existing, error: existingError } = await supabase
      .from("customer_transactions")
      .select("id")
      .eq("tenant_id", params.tenantId)
      .eq("customer_id", params.customerId)
      .eq("type", "withdrawal")
      .like("notes", `%${idempotencyTag}%`)
      .limit(1)
      .maybeSingle();

    if (existingError) {
      throw new Error(`Failed to check prior Susu loan repayment: ${existingError.message}`);
    }
    if (existing?.id) {
      return String(existing.id);
    }

    const { error: rpcError } = await supabase.rpc("post_customer_transaction_atomic", {
      p_transaction_id: transactionId,
      p_tenant_id: params.tenantId,
      p_customer_id: params.customerId,
      p_type: "withdrawal",
      p_amount: params.amount,
      p_transaction_branch_id: params.branchId,
      p_home_branch_id: homeBranchId,
      p_recorded_by_user_id: params.recordedByUserId,
      p_field_agent_id: customer.assignedFieldAgentId ?? params.recordedByUserId,
      p_notes: fullNotes
    });

    if (rpcError) {
      throw new Error(rpcPostFailedMessage("debit Susu for loan repayment", rpcError.message));
    }

    const balanceAfter = await computeCustomerBalance(params.tenantId, params.customerId);
    const expected = Math.round((balanceBefore - params.amount) * 100) / 100;
    if (Math.abs(balanceAfter - expected) > 0.01) {
      throw new Error(
        `Susu debit did not update the customer ledger (expected GHS ${formatAccountAmount(expected)}, actual GHS ${formatAccountAmount(balanceAfter)}).`
      );
    }

    void notifyCustomerLoanRepaymentFromSusu({
      tenantId: params.tenantId,
      customerId: params.customerId,
      transactionId,
      amount: params.amount,
      loanReference: loanRef
    }).catch((error) => {
      console.warn(
        "[notifications] loan repayment SMS skipped:",
        error instanceof Error ? error.message : error
      );
    });

    return transactionId;
  }

  await addLedgerEntry({
    tenantId: params.tenantId,
    customerId: params.customerId,
    transactionId,
    entryType: "debit",
    amount: params.amount,
    transactionBranchId: params.branchId
  });

  void notifyCustomerLoanRepaymentFromSusu({
    tenantId: params.tenantId,
    customerId: params.customerId,
    transactionId,
    amount: params.amount,
    loanReference: loanRef
  }).catch(() => {
    /* non-blocking */
  });

  return transactionId;
}

/** Compensating credit if loan repayment bookkeeping fails after Susu was already debited. */
export async function reverseSusuDebitForLoanRepayment(params: {
  tenantId: string;
  customerId: string;
  branchId: string;
  amount: number;
  repaymentId: string;
  loanId: string;
  recordedByUserId: string;
}): Promise<string | null> {
  const reverseTag = `${LOAN_REPAYMENT_SUSU_REVERSE_TAG}${params.repaymentId}`;
  const debitTag = `${LOAN_REPAYMENT_SUSU_NOTE_TAG}${params.repaymentId}`;
  const loanRef = params.loanId.replace(/-/g, "").slice(0, 8).toUpperCase();
  const fullNotes = `Loan repayment reverse · Restoring Susu after failed loan post · Loan ${loanRef} · ${reverseTag}`;
  const customer = await getCustomerById(params.tenantId, params.customerId);
  if (!customer) {
    return null;
  }
  const supabase = getSupabaseAdminClient();
  const transactionId = randomUUID();
  const homeBranchId = customer.homeBranchId || params.branchId;

  if (supabase) {
    const { data: debitRow } = await supabase
      .from("customer_transactions")
      .select("id")
      .eq("tenant_id", params.tenantId)
      .eq("customer_id", params.customerId)
      .eq("type", "withdrawal")
      .like("notes", `%${debitTag}%`)
      .limit(1)
      .maybeSingle();
    if (!debitRow?.id) {
      return null;
    }
    const { data: existingReverse } = await supabase
      .from("customer_transactions")
      .select("id")
      .eq("tenant_id", params.tenantId)
      .eq("customer_id", params.customerId)
      .eq("type", "deposit")
      .like("notes", `%${reverseTag}%`)
      .limit(1)
      .maybeSingle();
    if (existingReverse?.id) {
      return String(existingReverse.id);
    }

    const { error: rpcError } = await supabase.rpc("post_customer_transaction_atomic", {
      p_transaction_id: transactionId,
      p_tenant_id: params.tenantId,
      p_customer_id: params.customerId,
      p_type: "deposit",
      p_amount: params.amount,
      p_transaction_branch_id: params.branchId,
      p_home_branch_id: homeBranchId,
      p_recorded_by_user_id: params.recordedByUserId,
      p_field_agent_id: customer.assignedFieldAgentId ?? params.recordedByUserId,
      p_notes: fullNotes
    });
    if (rpcError) {
      console.warn("[loans] Susu repayment reverse failed:", rpcError.message);
      return null;
    }
    return transactionId;
  }

  await addLedgerEntry({
    tenantId: params.tenantId,
    customerId: params.customerId,
    transactionId,
    entryType: "credit",
    amount: params.amount,
    transactionBranchId: params.branchId
  });
  return transactionId;
}

/**
 * Credit loan principal into the customer's Susu/savings ledger so they can
 * withdraw at the branch counter.
 */
export async function postSusuCreditForLoanDisbursement(params: {
  tenantId: string;
  customerId: string;
  branchId: string;
  amount: number;
  loanId: string;
  recordedByUserId: string;
}): Promise<string> {
  if (!(await isSusuLoanBridgeActive(params.tenantId))) {
    throw new Error("Susu↔Loans bridge is not enabled for this company");
  }
  if (params.amount <= 0) {
    throw new Error("Disbursement amount must be greater than zero");
  }

  const customer = await getCustomerById(params.tenantId, params.customerId);
  if (!customer || customer.status !== "active") {
    throw new Error("Customer not found or not active");
  }

  const idempotencyTag = `${LOAN_DISBURSE_SUSU_NOTE_TAG}${params.loanId}`;
  const loanRef = params.loanId.replace(/-/g, "").slice(0, 8).toUpperCase();
  const fullNotes = `Loan disbursement · Credited to Susu/savings · Loan ${loanRef} · ${idempotencyTag}`;
  const transactionId = randomUUID();
  const homeBranchId = customer.homeBranchId || params.branchId;
  const supabase = getSupabaseAdminClient();
  const balanceBefore = await computeCustomerBalance(params.tenantId, params.customerId);

  if (supabase) {
    const { data: existing, error: existingError } = await supabase
      .from("customer_transactions")
      .select("id")
      .eq("tenant_id", params.tenantId)
      .eq("customer_id", params.customerId)
      .eq("type", "deposit")
      .like("notes", `%${idempotencyTag}%`)
      .limit(1)
      .maybeSingle();

    if (existingError) {
      throw new Error(`Failed to check prior Susu loan disbursement: ${existingError.message}`);
    }
    if (existing?.id) {
      return String(existing.id);
    }

    const { error: rpcError } = await supabase.rpc("post_customer_transaction_atomic", {
      p_transaction_id: transactionId,
      p_tenant_id: params.tenantId,
      p_customer_id: params.customerId,
      p_type: "deposit",
      p_amount: params.amount,
      p_transaction_branch_id: params.branchId,
      p_home_branch_id: homeBranchId,
      p_recorded_by_user_id: params.recordedByUserId,
      p_field_agent_id: customer.assignedFieldAgentId ?? params.recordedByUserId,
      p_notes: fullNotes
    });

    if (rpcError) {
      throw new Error(rpcPostFailedMessage("credit Susu for loan disbursement", rpcError.message));
    }

    const balanceAfter = await computeCustomerBalance(params.tenantId, params.customerId);
    const expected = Math.round((balanceBefore + params.amount) * 100) / 100;
    if (Math.abs(balanceAfter - expected) > 0.01) {
      throw new Error(
        `Susu credit did not update the customer ledger (expected GHS ${formatAccountAmount(expected)}, actual GHS ${formatAccountAmount(balanceAfter)}).`
      );
    }

    return transactionId;
  }

  await addLedgerEntry({
    tenantId: params.tenantId,
    customerId: params.customerId,
    transactionId,
    entryType: "credit",
    amount: params.amount,
    transactionBranchId: params.branchId
  });
  return transactionId;
}

/** Lock a share of Susu/savings as passbook collateral for an open loan. */
export async function setCustomerLoanCollateralLocked(
  tenantId: string,
  customerId: string,
  amount: number
): Promise<void> {
  const locked = Math.max(0, Math.round(amount * 100) / 100);
  const supabase = getSupabaseAdminClient();
  if (!supabase) {
    return;
  }
  const { error } = await supabase
    .from("customers")
    .update({ loan_collateral_locked: locked })
    .eq("tenant_id", tenantId)
    .eq("id", customerId);
  if (error && !/loan_collateral_locked/i.test(error.message)) {
    throw new Error(`Failed to set loan collateral lock: ${error.message}`);
  }
}

/**
 * Recompute passbook collateral from all still-open (disbursed) loans for the customer.
 * Closing one loan must not wipe liens belonging to other open loans.
 */
export async function recomputeCustomerLoanCollateralLocked(
  tenantId: string,
  customerId: string,
  excludeLoanId?: string
): Promise<number> {
  const supabase = getSupabaseAdminClient();
  let total = 0;
  if (supabase) {
    let query = supabase
      .from("loan_applications")
      .select("id, collateral_lien_amount")
      .eq("tenant_id", tenantId)
      .eq("customer_id", customerId)
      .eq("status", "disbursed");
    if (excludeLoanId) {
      query = query.neq("id", excludeLoanId);
    }
    const { data, error } = await query;
    if (error && !/collateral_lien_amount|loan_applications/i.test(error.message)) {
      throw new Error(`Failed to recompute loan collateral: ${error.message}`);
    }
    for (const row of data ?? []) {
      total += Number(row.collateral_lien_amount ?? 0);
    }
  }
  total = Math.max(0, Math.round(total * 100) / 100);
  await setCustomerLoanCollateralLocked(tenantId, customerId, total);
  return total;
}

export async function clearCustomerLoanCollateralLocked(
  tenantId: string,
  customerId: string
): Promise<void> {
  await setCustomerLoanCollateralLocked(tenantId, customerId, 0);
}
