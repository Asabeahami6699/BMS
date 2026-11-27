import {
  createTransactionInputSchema,
  evaluateWalkInWithdrawalVerification,
  SUSU_COMMISSION_DEBIT_TAG,
  transactionSchema,
  type Transaction,
  formatAccountAmount,
  withdrawalVerificationRequirementMessage
} from "@bms/shared";
import { randomUUID } from "node:crypto";
import { getSupabaseAdminClient } from "../config/supabaseClient.js";
import {
  getCustomerById,
  getCustomerWithdrawableBalance,
  QUALIFYING_TX_TYPES,
  touchCustomerQualifyingActivity
} from "./customerService.js";
import { addLedgerEntry, computeCustomerBalance } from "./ledgerService.js";
import {
  computeOpeningFeeDeduction,
  openingFeeNote,
  recordOpeningFeeRecovery
} from "./savingsOpeningFeeService.js";
import {
  enforceSavingsLockOnWithdrawal,
  resolveSavingsEffectiveLockAmount
} from "./savingsInitialDepositService.js";
import { getSavingsOpeningFeeGhs } from "./tenantProfileService.js";
import { getRegistrationFormSetup } from "./registrationFormService.js";
import {
  applyTransactionToFloat,
  assertFloatCapacityForTransaction
} from "./branchFloatService.js";
import { createAgencyPendingDeposit, usesAgencyDepositFlow } from "./agencyBankingService.js";
import {
  notifyCustomerTransaction,
  scheduleCustomerSusuCommissionNotification
} from "./customerNotificationService.js";
import {
  getBankProductById,
  resolveBankProductForTransaction
} from "./bankProductService.js";

const transactionStore = new Map<string, Transaction[]>();

export type TransactionRequestContext = {
  userId: string;
  tenantId: string;
  role: string;
  scopeType: "head_office" | "branch";
  branchId?: string;
  permissions?: string[];
  subscribedAddons?: import("@bms/shared").TenantAddon[];
};

function getTenantTransactions(tenantId: string): Transaction[] {
  return transactionStore.get(tenantId) ?? [];
}

function setTenantTransactions(tenantId: string, transactions: Transaction[]): void {
  transactionStore.set(tenantId, transactions);
}

export function mapTransactionRow(row: Record<string, unknown>): Transaction {
  return transactionSchema.parse({
    id: row.id,
    tenantId: row.tenant_id,
    customerId: row.customer_id,
    type: row.type,
    amount: Number(row.amount),
    transactionBranchId: row.transaction_branch_id,
    homeBranchId: row.home_branch_id,
    recordedByUserId: row.recorded_by_user_id,
    fieldAgentId: row.field_agent_id,
    createdAt: row.created_at,
    notes: row.notes ?? undefined,
    reversesTransactionId: row.reverses_transaction_id ?? undefined,
    reversedByTransactionId: row.reversed_by_transaction_id ?? undefined,
    reversalReason: row.reversal_reason ?? undefined,
    reversedByUserId: row.reversed_by_user_id ?? undefined,
    reversedAt: row.reversed_at ?? undefined,
    executionStatus: row.execution_status ?? "completed",
    bankExecutedByUserId: row.bank_executed_by_user_id ?? undefined,
    bankExecutedAt: row.bank_executed_at ?? undefined,
    bankProductId: row.bank_product_id ?? undefined
  });
}

export async function findTransaction(
  tenantId: string,
  transactionId: string
): Promise<Transaction | null> {
  const supabase = getSupabaseAdminClient();
  if (!supabase) {
    return getTenantTransactions(tenantId).find((tx) => tx.id === transactionId) ?? null;
  }

  const { data, error } = await supabase
    .from("customer_transactions")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("id", transactionId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load transaction: ${error.message}`);
  }
  if (!data) {
    return null;
  }
  return mapTransactionRow(data as Record<string, unknown>);
}

export function upsertMemoryTransaction(tenantId: string, transaction: Transaction): void {
  const rows = [...getTenantTransactions(tenantId)];
  const index = rows.findIndex((tx) => tx.id === transaction.id);
  if (index >= 0) {
    rows[index] = transaction;
  } else {
    rows.unshift(transaction);
  }
  setTenantTransactions(tenantId, rows);
}

async function persistBankProductId(
  transactionId: string,
  bankProductId: string | undefined
): Promise<void> {
  if (!bankProductId) {
    return;
  }
  const supabase = getSupabaseAdminClient();
  if (!supabase) {
    return;
  }
  const { error } = await supabase
    .from("customer_transactions")
    .update({ bank_product_id: bankProductId })
    .eq("id", transactionId);
  if (error && !/bank_product_id|column/.test(error.message)) {
    console.warn(`[transaction] bank_product_id update skipped: ${error.message}`);
  }
}

async function enrichTransactionProduct(
  tenantId: string,
  transaction: Transaction
): Promise<Transaction> {
  if (!transaction.bankProductId) {
    return transaction;
  }
  const product = await getBankProductById(tenantId, transaction.bankProductId);
  if (!product) {
    return transaction;
  }
  return {
    ...transaction,
    bankProductName: product.name,
    bankLabel: product.bankLabel
  };
}

function canRecordAtBranch(
  context: TransactionRequestContext,
  transactionBranchId: string,
  customerHomeBranchId: string
): boolean {
  if (context.scopeType === "head_office") {
    return true;
  }

  if (context.branchId && context.branchId === transactionBranchId) {
    return true;
  }

  // Field agents may record at the customer's home branch when assigned to that customer.
  if (
    context.role === "field_agent" &&
    transactionBranchId === customerHomeBranchId
  ) {
    return true;
  }

  return false;
}

/** Embedded in withdrawal notes when a coordinator approves a field-agent withdrawal request. */
export const DISCLOSURE_WITHDRAWAL_NOTE_TAG = "disclosure:";

const SYSTEM_SUSU_COMMISSION_USER_ID = "system:susu-commission";

/**
 * Post a separate system debit transaction + `ledger_entries` row for a Susu cycle commission
 * (service charge) linked to its parent deposit or withdrawal via `susu_comm_tx:<parentId>`.
 * Intentionally NOT applied to teller till float because no physical cash leaves the drawer.
 */
async function postSeparateSusuCommissionDebit(params: {
  tenantId: string;
  customerId: string;
  transactionBranchId: string;
  homeBranchId: string;
  fieldAgentId: string;
  parentTransactionId: string;
  commissionAmount: number;
  cardLabel?: string;
  balanceBeforeCommission?: number;
}): Promise<string | undefined> {
  const commissionAmount = Math.round(Math.max(0, params.commissionAmount) * 100) / 100;
  if (commissionAmount <= 0) {
    return undefined;
  }
  const commissionNotes = `Susu service charge · ${SUSU_COMMISSION_DEBIT_TAG}${params.parentTransactionId}`;
  const commTxId = randomUUID();
  const supabase = getSupabaseAdminClient();

  if (supabase) {
    const { error: commRpcError } = await supabase.rpc("post_customer_transaction_atomic", {
      p_transaction_id: commTxId,
      p_tenant_id: params.tenantId,
      p_customer_id: params.customerId,
      p_type: "withdrawal",
      p_amount: commissionAmount,
      p_transaction_branch_id: params.transactionBranchId,
      p_home_branch_id: params.homeBranchId,
      p_recorded_by_user_id: SYSTEM_SUSU_COMMISSION_USER_ID,
      p_field_agent_id: params.fieldAgentId,
      p_notes: commissionNotes
    });
    if (commRpcError) {
      // When a customer has loan collateral or savings lock, withdrawable balance may be below
      // commissionAmount even though the parent transaction just posted. Fall back to direct
      // system fee debit so the commission is always recorded on ledger_entries.
      const isLockBlock = /insufficient withdrawable balance/i.test(commRpcError.message);
      if (isLockBlock && (params.balanceBeforeCommission ?? 0) + 1e-6 >= commissionAmount) {
        const { error: directTxErr } = await supabase.from("customer_transactions").insert({
          id: commTxId,
          tenant_id: params.tenantId,
          customer_id: params.customerId,
          type: "withdrawal",
          amount: commissionAmount,
          transaction_branch_id: params.transactionBranchId,
          home_branch_id: params.homeBranchId,
          recorded_by_user_id: SYSTEM_SUSU_COMMISSION_USER_ID,
          field_agent_id: params.fieldAgentId,
          notes: commissionNotes
        });
        if (!directTxErr) {
          await addLedgerEntry({
            tenantId: params.tenantId,
            customerId: params.customerId,
            transactionId: commTxId,
            entryType: "debit",
            amount: commissionAmount,
            transactionBranchId: params.transactionBranchId
          });
          return commTxId;
        }
        console.warn(
          "[susu-commission] fallback direct commission debit failed:",
          directTxErr.message
        );
      } else {
        console.warn(
          "[susu-commission] failed to post separate commission debit:",
          commRpcError.message
        );
      }
      return undefined;
    }
    return commTxId;
  }

  const commTx = transactionSchema.parse({
    id: commTxId,
    tenantId: params.tenantId,
    customerId: params.customerId,
    type: "withdrawal",
    amount: commissionAmount,
    transactionBranchId: params.transactionBranchId,
    homeBranchId: params.homeBranchId,
    recordedByUserId: SYSTEM_SUSU_COMMISSION_USER_ID,
    fieldAgentId: params.fieldAgentId,
    createdAt: new Date().toISOString(),
    notes: commissionNotes
  });
  const currentTxs = getTenantTransactions(params.tenantId);
  setTenantTransactions(params.tenantId, [...currentTxs, commTx]);
  await addLedgerEntry({
    tenantId: params.tenantId,
    customerId: params.customerId,
    transactionId: commTx.id,
    entryType: "debit",
    amount: commissionAmount,
    transactionBranchId: params.transactionBranchId
  });
  return commTx.id;
}

/**
 * Compute exact alert amounts and balances for a withdrawal (and optional deferred Susu commission).
 * - When a follow-up commission alert will be sent:
 *   1) First alert shows exact cash withdrawn + balance after withdrawal (before commission).
 *   2) Second alert shows exact commission + remaining balance after commission.
 * - When no commission alert will be sent (no commission or tenant disabled commission alerts):
 *   1) Single alert shows exact cash withdrawn + actual final balance.
 */
export function computeWithdrawalNotificationPlan(input: {
  withdrawnAmount: number;
  commission: number;
  finalBalanceAfterLedgerDebit: number;
  notifyCustomerOnCommission: boolean;
}): {
  primaryAmount: number;
  primaryBalance: number;
  sendCommissionAlert: boolean;
  commissionAmount: number;
  commissionRemainingBalance: number;
} {
  const round2 = (n: number) => Math.round(n * 100) / 100;
  const withdrawnAmount = round2(Math.max(0, input.withdrawnAmount));
  const commission = round2(Math.max(0, input.commission));
  const finalBalance = round2(input.finalBalanceAfterLedgerDebit);
  const sendCommissionAlert = commission > 0 && input.notifyCustomerOnCommission;
  const balanceAfterWithdrawalOnly = round2(finalBalance + commission);
  return {
    primaryAmount: withdrawnAmount,
    primaryBalance: sendCommissionAlert ? balanceAfterWithdrawalOnly : finalBalance,
    sendCommissionAlert,
    commissionAmount: commission,
    commissionRemainingBalance: finalBalance
  };
}

/**
 * Posts a withdrawal debit for an approved disclosure using the service-role client.
 * Skips branch permission checks (coordinator approval is system-authoritative).
 * Idempotent per disclosure id; verifies ledger balance changed before returning.
 */
export async function postWithdrawalForApprovedDisclosure(params: {
  tenantId: string;
  customerId: string;
  homeBranchId: string;
  amount: number;
  disclosureId: string;
  recordedByUserId: string;
  fieldAgentId: string;
  notes: string;
}): Promise<string> {
  const idempotencyTag = `${DISCLOSURE_WITHDRAWAL_NOTE_TAG}${params.disclosureId}`;
  const reqTag = `req ${params.disclosureId.slice(0, 8)}`;
  const fullNotes = params.notes.includes(idempotencyTag)
    ? params.notes
    : `${params.notes} · ${idempotencyTag}`;

  const customer = await getCustomerById(params.tenantId, params.customerId);
  let commission = 0;
  if (customer?.accountType === "susu") {
    const { resolveSusuWithdrawalCommission } = await import("./susuCycleCommissionService.js");
    const resolved = await resolveSusuWithdrawalCommission(
      {
        userId: params.recordedByUserId,
        tenantId: params.tenantId,
        role: "system",
        branchId: params.homeBranchId
      },
      {
        customerId: params.customerId,
        branchId: params.homeBranchId,
        requestedWithdrawalAmount: params.amount,
        disclosureId: params.disclosureId
      }
    );
    if (resolved.blocked) {
      throw new Error(resolved.blockReason ?? "Withdrawal blocked by Susu cycle policy");
    }
    commission = resolved.commissionToCollect;
  }

  const totalRequired = Math.round((params.amount + commission) * 100) / 100;
  const withdrawable = await getCustomerWithdrawableBalance(params.tenantId, params.customerId);
  if (withdrawable < totalRequired) {
    throw new Error(
      `Insufficient withdrawable balance. Available: GHS ${formatAccountAmount(withdrawable)}${
        commission > 0
          ? ` (includes Susu commission GHS ${formatAccountAmount(commission)})`
          : ""
      }`
    );
  }

  const balanceBefore = await computeCustomerBalance(params.tenantId, params.customerId);
  const transactionId = randomUUID();
  const supabase = getSupabaseAdminClient();
  const { hasLedgerDebitForTransaction } = await import("./ledgerService.js");

  if (supabase) {
    const { data: priorRows, error: existingError } = await supabase
      .from("customer_transactions")
      .select("id, notes")
      .eq("tenant_id", params.tenantId)
      .eq("customer_id", params.customerId)
      .eq("type", "withdrawal")
      .order("created_at", { ascending: false })
      .limit(40);

    if (existingError) {
      throw new Error(`Failed to check prior withdrawal post: ${existingError.message}`);
    }

    for (const row of priorRows ?? []) {
      const notes = String(row.notes ?? "");
      if (!notes.includes(idempotencyTag) && !notes.includes(reqTag)) {
        continue;
      }
      const priorId = String(row.id);
      if (await hasLedgerDebitForTransaction(params.tenantId, priorId)) {
        return priorId;
      }
    }

    const { error: rpcError } = await supabase.rpc("post_customer_transaction_atomic", {
      p_transaction_id: transactionId,
      p_tenant_id: params.tenantId,
      p_customer_id: params.customerId,
      p_type: "withdrawal",
      p_amount: params.amount,
      p_transaction_branch_id: params.homeBranchId,
      p_home_branch_id: params.homeBranchId,
      p_recorded_by_user_id: params.recordedByUserId,
      p_field_agent_id: params.fieldAgentId,
      p_notes: fullNotes
    });

    if (rpcError) {
      throw new Error(
        `Failed to post withdrawal to customer ledger: ${rpcError.message}. Apply Supabase migrations (including 084) — non-atomic fallback is disabled.`
      );
    }

    const balanceAfterWithdrawal = await computeCustomerBalance(params.tenantId, params.customerId);
    let commDebitTxId: string | undefined;
    if (commission > 0) {
      commDebitTxId = await postSeparateSusuCommissionDebit({
        tenantId: params.tenantId,
        customerId: params.customerId,
        transactionBranchId: params.homeBranchId,
        homeBranchId: params.homeBranchId,
        fieldAgentId: params.fieldAgentId,
        parentTransactionId: transactionId,
        commissionAmount: commission,
        balanceBeforeCommission: balanceAfterWithdrawal
      });
    }

    const balanceAfter =
      commission > 0
        ? await computeCustomerBalance(params.tenantId, params.customerId)
        : balanceAfterWithdrawal;
    const expected = Math.round((balanceBefore - totalRequired) * 100) / 100;
    if (Math.abs(balanceAfter - expected) > 0.01) {
      throw new Error(
        `Withdrawal debit did not update the customer ledger (expected GHS ${formatAccountAmount(expected)}, actual GHS ${formatAccountAmount(balanceAfter)}). Apply Supabase migrations 002 and 021.`
      );
    }

    let notifyCustomerOnCommission = false;
    if (commission > 0 && commDebitTxId) {
      const { getActiveSusuCommissionPolicy } = await import("./susuCycleCommissionService.js");
      const commPolicy = await getActiveSusuCommissionPolicy(params.tenantId).catch(() => null);
      notifyCustomerOnCommission = commPolicy?.notifyCustomerOnCommission !== false;
    }

    const plan = computeWithdrawalNotificationPlan({
      withdrawnAmount: params.amount,
      commission: commDebitTxId ? commission : 0,
      finalBalanceAfterLedgerDebit: balanceAfter,
      notifyCustomerOnCommission
    });

    void notifyCustomerTransaction({
      tenantId: params.tenantId,
      customerId: params.customerId,
      transactionId,
      type: "withdrawal",
      amount: plan.primaryAmount,
      balanceOverride: plan.primaryBalance
    }).catch((error) => {
      console.warn(
        "[notifications] withdrawal notification skipped:",
        error instanceof Error ? error.message : error
      );
    });

    if (plan.sendCommissionAlert && commDebitTxId) {
      scheduleCustomerSusuCommissionNotification({
        tenantId: params.tenantId,
        customerId: params.customerId,
        transactionId: commDebitTxId,
        amount: plan.commissionAmount,
        balanceOverride: plan.commissionRemainingBalance
      });
    }

    return transactionId;
  }

  const transactions = getTenantTransactions(params.tenantId);
  const prior = transactions.find(
    (t) => t.notes?.includes(idempotencyTag) || t.notes?.includes(reqTag)
  );
  if (prior) {
    return prior.id;
  }

  const transaction = transactionSchema.parse({
    id: transactionId,
    tenantId: params.tenantId,
    customerId: params.customerId,
    type: "withdrawal",
    amount: params.amount,
    transactionBranchId: params.homeBranchId,
    homeBranchId: params.homeBranchId,
    recordedByUserId: params.recordedByUserId,
    fieldAgentId: params.fieldAgentId,
    createdAt: new Date().toISOString(),
    notes: fullNotes
  });
  setTenantTransactions(params.tenantId, [...transactions, transaction]);
  await addLedgerEntry({
    tenantId: params.tenantId,
    customerId: params.customerId,
    transactionId,
    entryType: "debit",
    amount: params.amount,
    transactionBranchId: params.homeBranchId
  });

  let commDebitTxIdMemory: string | undefined;
  if (commission > 0) {
    commDebitTxIdMemory = await postSeparateSusuCommissionDebit({
      tenantId: params.tenantId,
      customerId: params.customerId,
      transactionBranchId: params.homeBranchId,
      homeBranchId: params.homeBranchId,
      fieldAgentId: params.fieldAgentId,
      parentTransactionId: transactionId,
      commissionAmount: commission
    });
  }

  const balanceAfterMemory = await computeCustomerBalance(params.tenantId, params.customerId);
  let notifyCustomerOnCommissionMemory = false;
  if (commission > 0 && commDebitTxIdMemory) {
    const { getActiveSusuCommissionPolicy } = await import("./susuCycleCommissionService.js");
    const commPolicy = await getActiveSusuCommissionPolicy(params.tenantId).catch(() => null);
    notifyCustomerOnCommissionMemory = commPolicy?.notifyCustomerOnCommission !== false;
  }

  const memoryPlan = computeWithdrawalNotificationPlan({
    withdrawnAmount: params.amount,
    commission: commDebitTxIdMemory ? commission : 0,
    finalBalanceAfterLedgerDebit: balanceAfterMemory,
    notifyCustomerOnCommission: notifyCustomerOnCommissionMemory
  });

  void notifyCustomerTransaction({
    tenantId: params.tenantId,
    customerId: params.customerId,
    transactionId,
    type: "withdrawal",
    amount: memoryPlan.primaryAmount,
    balanceOverride: memoryPlan.primaryBalance
  }).catch((error) => {
    console.warn(
      "[notifications] withdrawal notification skipped:",
      error instanceof Error ? error.message : error
    );
  });

  if (memoryPlan.sendCommissionAlert && commDebitTxIdMemory) {
    scheduleCustomerSusuCommissionNotification({
      tenantId: params.tenantId,
      customerId: params.customerId,
      transactionId: commDebitTxIdMemory,
      amount: memoryPlan.commissionAmount,
      balanceOverride: memoryPlan.commissionRemainingBalance
    });
  }

  return transactionId;
}

/** Backfill ledger debits for approved/paid agent withdrawals that never posted a ledger row. */
export async function reconcileCustomerApprovedWithdrawalDebits(
  tenantId: string,
  customerId: string
): Promise<void> {
  const supabase = getSupabaseAdminClient();
  if (!supabase) {
    return;
  }

  const customer = await getCustomerById(tenantId, customerId);
  if (!customer) {
    return;
  }

  const { data: rows, error } = await supabase
    .from("customer_balance_disclosures")
    .select(
      "id, status, withdrawal_amount, fulfillment_mode, payout_reference, field_agent_id, approved_by, teller_paid_by, linked_transaction_id"
    )
    .eq("tenant_id", tenantId)
    .eq("customer_id", customerId)
    .eq("request_type", "withdrawal")
    .in("status", ["approved", "completed"]);

  if (error || !rows?.length) {
    return;
  }

  const { hasLedgerDebitForTransaction } = await import("./ledgerService.js");

  for (const row of rows) {
    const amount = Number(row.withdrawal_amount ?? 0);
    if (amount <= 0) {
      continue;
    }

    const status = String(row.status);
    // Completed teller Pay now: only backfill when linked tx is missing a ledger debit.
    if (status === "completed") {
      const linkedId = row.linked_transaction_id ? String(row.linked_transaction_id) : null;
      if (linkedId && (await hasLedgerDebitForTransaction(tenantId, linkedId))) {
        continue;
      }
      // MoMo completed-as-approved uses status approved; skip pure bank_executed→completed
      // agency rows that already have a debit under a non-disclosure note by checking tags below.
    }

    const mode = row.fulfillment_mode as string | null;
    const ref = row.payout_reference as string | null;
    const notes =
      status === "completed"
        ? `Teller cash payout · field agent · req ${String(row.id).slice(0, 8)}`
        : `Field agent withdrawal approved (${mode ?? "cash"}) · req ${String(row.id).slice(0, 8)}${ref?.trim() ? ` · Ref ${ref.trim()}` : ""}`;
    try {
      const transactionId = await postWithdrawalForApprovedDisclosure({
        tenantId,
        customerId,
        homeBranchId: customer.homeBranchId,
        amount,
        disclosureId: String(row.id),
        recordedByUserId: String(
          row.teller_paid_by ?? row.approved_by ?? row.field_agent_id
        ),
        fieldAgentId: String(row.field_agent_id),
        notes
      });
      if (status === "completed" && transactionId && transactionId !== row.linked_transaction_id) {
        await supabase
          .from("customer_balance_disclosures")
          .update({ linked_transaction_id: transactionId })
          .eq("id", row.id)
          .eq("tenant_id", tenantId);
      }
    } catch (reconcileError) {
      console.warn(
        `[transaction] Withdrawal reconcile skipped for disclosure ${row.id}:`,
        reconcileError instanceof Error ? reconcileError.message : reconcileError
      );
    }
  }
}

export type CreateTransactionOptions = {
  /**
   * Field-agent call-over batches are received into the branch vault rather than a personal
   * counter till, so posting them bypasses teller counter float requirements and till counters.
   */
  skipBranchFloat?: boolean;
};

export async function createTransaction(
  context: TransactionRequestContext,
  input: unknown,
  options?: CreateTransactionOptions
): Promise<Transaction> {
  const payload = createTransactionInputSchema.parse(input);

  if (payload.type === "susu_reversal") {
    throw new Error("Susu reversals are created only with Reverse collection.");
  }

  if (context.role === "field_agent") {
    if (
      payload.type === "daily_susu" ||
      payload.type === "deposit" ||
      payload.type === "withdrawal"
    ) {
      throw new Error(
        "Field agents cannot post deposits or withdrawals directly. Record collections for coordinator approval, or submit a customer withdrawal request."
      );
    }
  }

  const customer = await getCustomerById(context.tenantId, payload.customerId);
  if (!customer) {
    throw new Error("Customer not found");
  }

  if (customer.status !== "active") {
    throw new Error("Customer is not active. Collections are only allowed for approved customers.");
  }

  if (!canRecordAtBranch(context, payload.transactionBranchId, customer.homeBranchId)) {
    throw new Error("User cannot post transactions outside assigned branch");
  }

  // Enforce company branch counter rules on walk-in withdrawals only (deposits never require verification).
  if (payload.type === "withdrawal") {
    const { getApprovalWorkflow } = await import("./approvalWorkflowService.js");
    const workflow = await getApprovalWorkflow(context.tenantId);
    const isCrossBranch = Boolean(
      customer.homeBranchId &&
        payload.transactionBranchId &&
        payload.transactionBranchId !== customer.homeBranchId
    );
    if (isCrossBranch && !workflow.allowCrossBranchWithdrawals) {
      const { listBranches } = await import("./branchService.js");
      const branches = await listBranches(context.tenantId).catch(() => []);
      const home = branches.find((b) => String(b.id) === String(customer.homeBranchId));
      const homeLabel = home ? `${home.name} (${home.code})` : "their registered home branch";
      throw new Error(
        `Cross-branch withdrawals are disabled for this company. This customer belongs to ${homeLabel} and must withdraw there.`
      );
    }

    const verification = evaluateWalkInWithdrawalVerification({
      type: payload.type,
      mode: workflow.withdrawalVerificationMode,
      isCrossBranch,
      kycTier: customer.kycTier
    });
    if (verification.required && !payload.customerIdentityVerified) {
      throw new Error(withdrawalVerificationRequirementMessage(verification.reason));
    }
  }

  // BoG Tier 1 Simplified KYC balance cap guard on incoming deposits
  if (
    customer.kycTier === "simplified" &&
    (payload.type === "daily_susu" || payload.type === "deposit")
  ) {
    const formSetup = await getRegistrationFormSetup(context.tenantId);
    const cap = formSetup.simplifiedKyc.maxBalanceGhs;
    if (cap > 0) {
      const currentBalance = await computeCustomerBalance(context.tenantId, payload.customerId);
      if (currentBalance + payload.amount > cap) {
        throw new Error(
          `Simplified KYC (Tier 1) balance cap of GHS ${formatAccountAmount(cap)} exceeded (current balance: GHS ${formatAccountAmount(currentBalance)}). Upgrade this customer to Full KYC with a valid ID document to remove the cap.`
        );
      }
    }
  }

  // Validate till float / physical cash BEFORE mutating Susu cycles, institutional income,
  // opening fees, or customer ledgers so a missing/insufficient float never leaves partial commits.
  if (!options?.skipBranchFloat) {
    await assertFloatCapacityForTransaction(context, {
      transactionBranchId: payload.transactionBranchId,
      type: payload.type,
      amount: payload.amount
    });
  }

  if (payload.type === "withdrawal") {
    const withdrawable = await getCustomerWithdrawableBalance(
      context.tenantId,
      payload.customerId
    );
    if (withdrawable < payload.amount) {
      let reserveHint = "";
      try {
        const { getCustomerLoanInstallmentReserve } = await import("./loanReserveService.js");
        const reserve = await getCustomerLoanInstallmentReserve(
          context.tenantId,
          payload.customerId
        );
        if (reserve > 0) {
          reserveHint = ` (GHS ${formatAccountAmount(reserve)} reserved for next loan repayment)`;
        }
      } catch {
        /* ignore */
      }
      const effectiveSavingsLock = resolveSavingsEffectiveLockAmount(customer);
      const lockHint =
        customer.accountType === "savings" && effectiveSavingsLock > 0
          ? ` (GHS ${formatAccountAmount(effectiveSavingsLock)} minimum savings locked balance)`
          : "";
      throw new Error(
        `Insufficient withdrawable balance. Available: GHS ${formatAccountAmount(withdrawable)}${lockHint}${reserveHint}`
      );
    }
  }

  const fieldAgentId =
    context.role === "field_agent"
      ? context.userId
      : (customer.assignedFieldAgentId ?? context.userId);

  const feeDeduction =
    payload.type !== "withdrawal"
      ? computeOpeningFeeDeduction(
          customer,
          payload.amount,
          await getSavingsOpeningFeeGhs(context.tenantId)
        )
      : null;

  // Susu cycle commission (customer fee) — susu accounts only; separate from agent payroll.
  // Applies to both field-agent daily_susu and walk-in branch counter deposits on Susu accounts
  // (excluding agency manual partner bank deposits).
  let susuAllocation: {
    savingsCredit: number;
    commissionCollectNow: number;
    grossContribution: number;
    cycle?: { cycleNumber: number } | null;
    note?: string;
  } | null = null;
  const transactionIdEarly = randomUUID();
  const isAgencyManualPartnerDeposit =
    payload.type === "deposit" &&
    usesAgencyDepositFlow(context) &&
    Boolean(payload.manualPartnerAccount);
  const isSusuContribution =
    customer.accountType === "susu" &&
    (payload.type === "daily_susu" ||
      (payload.type === "deposit" && !isAgencyManualPartnerDeposit));
  if (isSusuContribution) {
    const { applySusuCollectionToCycle } = await import("./susuCycleCommissionService.js");
    const branchId =
      payload.transactionBranchId ?? customer.homeBranchId ?? context.branchId ?? "";
    if (branchId) {
      susuAllocation = await applySusuCollectionToCycle(
        {
          userId: context.userId,
          tenantId: context.tenantId,
          role: context.role,
          permissions: context.permissions,
          branchId: context.branchId
        },
        {
          customerId: payload.customerId,
          branchId,
          paymentAmount: payload.amount,
          dailyContributionAmount: customer.dailyContributionAmount,
          transactionId: transactionIdEarly
        }
      );
    }
  }

  let withdrawalCommission = 0;
  if (payload.type === "withdrawal" && customer.accountType === "susu") {
    const { resolveSusuWithdrawalCommission } = await import("./susuCycleCommissionService.js");
    // Credit Susu cycle commission institutional income to the customer's home branch
    // (where the Susu collections were earned), while physical cash payout stays on transactionBranchId.
    const commissionBranchId =
      customer.homeBranchId || payload.transactionBranchId || context.branchId || "";
    const resolved = await resolveSusuWithdrawalCommission(
      {
        userId: context.userId,
        tenantId: context.tenantId,
        role: context.role,
        permissions: context.permissions,
        branchId: context.branchId
      },
      {
        customerId: payload.customerId,
        branchId: commissionBranchId,
        requestedWithdrawalAmount: payload.amount,
        transactionId: transactionIdEarly
      }
    );
    if (resolved.blocked) {
      throw new Error(resolved.blockReason ?? "Withdrawal blocked by Susu cycle policy");
    }
    withdrawalCommission = resolved.commissionToCollect;
    if (withdrawalCommission > 0) {
      const withdrawable = await getCustomerWithdrawableBalance(
        context.tenantId,
        payload.customerId
      );
      if (withdrawable < payload.amount + withdrawalCommission) {
        // Allow withdrawing net of commission when requesting full-ish balance
        if (withdrawable < withdrawalCommission + 0.01) {
          throw new Error(
            `Insufficient balance to cover Susu commission (GHS ${formatAccountAmount(withdrawalCommission)}).`
          );
        }
        if (payload.amount + withdrawalCommission > withdrawable) {
          throw new Error(
            `Insufficient withdrawable balance after Susu commission of GHS ${formatAccountAmount(withdrawalCommission)}. Available for payout: GHS ${formatAccountAmount(Math.max(0, withdrawable - withdrawalCommission))}.`
          );
        }
      }
    }
  }

  // Withdrawals & Susu contributions both post the exact principal transaction first,
  // then post a separate system commission debit (`susu_comm_tx:<id>`) on `ledger_entries`
  // so the customer statement & ledger clearly show withdrawal/deposit and service charge separately.
  const ledgerAmount = feeDeduction
    ? feeDeduction.creditAmount
    : susuAllocation
      ? susuAllocation.grossContribution
      : payload.amount;
  const noteParts = [
    payload.notes,
    feeDeduction ? openingFeeNote(feeDeduction) : undefined,
    susuAllocation?.note
  ].filter(Boolean);
  const combinedNotes = noteParts.length > 0 ? noteParts.join(" · ") : undefined;

  const bankProductId = await resolveBankProductForTransaction(
    context.tenantId,
    payload.type,
    payload.bankProductId,
    payload.transactionBranchId
  );

  let workflowData: Record<string, unknown> | undefined = payload.workflowData;
  if (payload.type === "withdrawal" && payload.customerIdentityVerified) {
    workflowData = {
      ...(workflowData ?? {}),
      customerIdentityVerified: true,
      customerIdentityVerifiedBy: context.userId,
      customerIdentityVerifiedAt: new Date().toISOString()
    };
  }
  if (bankProductId && payload.type === "deposit" && usesAgencyDepositFlow(context)) {
    const { getBankProductById } = await import("./bankProductService.js");
    const { validateDepositCaptureWorkflow } = await import("@bms/shared");
    const product = await getBankProductById(context.tenantId, bankProductId);
    if (product) {
      const validation = validateDepositCaptureWorkflow(product, payload.workflowData ?? {});
      if (!validation.ok) {
        throw new Error(validation.errors.join("; "));
      }
      workflowData = validation.data;
    }
  }

  const transaction = transactionSchema.parse({
    id: transactionIdEarly,
    tenantId: context.tenantId,
    customerId: payload.customerId,
    type: payload.type,
    amount:
      payload.type === "withdrawal"
        ? payload.amount
        : susuAllocation
          ? susuAllocation.grossContribution
          : ledgerAmount > 0
            ? ledgerAmount
            : payload.amount,
    transactionBranchId: payload.transactionBranchId,
    homeBranchId: customer.homeBranchId,
    recordedByUserId: context.userId,
    fieldAgentId,
    createdAt: new Date().toISOString(),
    notes: combinedNotes,
    bankProductId,
    workflowData
  });

  if (feeDeduction) {
    await recordOpeningFeeRecovery(
      context.tenantId,
      payload.customerId,
      feeDeduction.feeRetained,
      feeDeduction.feeSettled
    );
    // Recognize the full opening fee as institutional income once it is fully recovered.
    if (feeDeduction.feeSettled && feeDeduction.feeRetained > 0) {
      const { postInstitutionalIncome } = await import("./institutionalIncomeService.js");
      const { listBranches } = await import("./branchService.js");
      const incomeBranchId =
        transaction.transactionBranchId ?? customer.homeBranchId ?? context.branchId ?? "";
      if (incomeBranchId) {
        const branches = await listBranches(context.tenantId).catch(() => []);
        const branchName =
          branches.find((b) => String(b.id) === String(incomeBranchId))?.name ?? "Branch";
        const fullFee =
          (customer.savingsOpeningFeeRecovered ?? 0) + feeDeduction.feeRetained;
        await postInstitutionalIncome(
          {
            userId: context.userId,
            tenantId: context.tenantId,
            role: context.role,
            permissions: context.permissions
          },
          {
            branchId: String(incomeBranchId),
            source: "savings_fee",
            amount: fullFee > 0 ? fullFee : feeDeduction.feeRetained,
            customerId: payload.customerId,
            transactionId: transaction.id,
            notes: openingFeeNote(feeDeduction),
            idempotencyKey: `savings_fee:opening:${payload.customerId}`
          },
          { branchName }
        ).catch(() => {
          // Income posting must not block customer collection; ops can reconcile later.
        });
      }
    }
    if (ledgerAmount <= 0) {
      if (!options?.skipBranchFloat) {
        await applyTransactionToFloat(context, { ...transaction, amount: payload.amount });
      }
      return enrichTransactionProduct(context.tenantId, transaction);
    }
  }

  if (
    payload.type === "deposit" &&
    usesAgencyDepositFlow(context) &&
    payload.manualPartnerAccount
  ) {
    return createAgencyPendingDeposit(context, transaction);
  }

  // When Commission Settings "When to deduct" is `withdrawal`, persist the savings locked_balance
  // on the first withdrawal right before the atomic ledger debit so Postgres enforces the hold too.
  if (payload.type === "withdrawal" && customer.accountType === "savings") {
    await enforceSavingsLockOnWithdrawal({
      tenantId: context.tenantId,
      customer,
      recordedByUserId: context.userId,
      branchId: payload.transactionBranchId
    });
  }

  const supabase = getSupabaseAdminClient();
  if (supabase) {
    const { error: rpcError } = await supabase.rpc("post_customer_transaction_atomic", {
      p_transaction_id: transaction.id,
      p_tenant_id: transaction.tenantId,
      p_customer_id: transaction.customerId,
      p_type: transaction.type,
      p_amount: ledgerAmount,
      p_transaction_branch_id: transaction.transactionBranchId,
      p_home_branch_id: transaction.homeBranchId,
      p_recorded_by_user_id: transaction.recordedByUserId,
      p_field_agent_id: transaction.fieldAgentId,
      p_notes: transaction.notes ?? null
    });

    if (rpcError) {
      throw new Error(
        `Failed to save transaction: ${rpcError.message}. Apply Supabase migrations (including 084) — non-atomic fallback is disabled.`
      );
    }
    await persistBankProductId(transaction.id, bankProductId);
  } else {
    const transactions = getTenantTransactions(context.tenantId);
    setTenantTransactions(context.tenantId, [...transactions, transaction]);
    await addLedgerEntry({
      tenantId: context.tenantId,
      customerId: transaction.customerId,
      transactionId: transaction.id,
      entryType: transaction.type === "withdrawal" ? "debit" : "credit",
      amount: ledgerAmount,
      transactionBranchId: transaction.transactionBranchId
    });
  }

  // Capture balance immediately after the primary deposit/withdrawal posts, before any separate
  // Susu commission debit posts, so SMS #1 and ledger_entries reflect each step cleanly.
  const hasSeparateDepositCommissionDebit = Boolean(
    susuAllocation && susuAllocation.commissionCollectNow > 0
  );
  const hasSeparateWithdrawalCommissionDebit =
    payload.type === "withdrawal" && withdrawalCommission > 0;
  const balanceAfterPrimary =
    hasSeparateDepositCommissionDebit || hasSeparateWithdrawalCommissionDebit
      ? await computeCustomerBalance(context.tenantId, transaction.customerId)
      : undefined;
  const balanceAfterFullDeposit = hasSeparateDepositCommissionDebit
    ? balanceAfterPrimary
    : undefined;

  // Post separate system debit on customer_transactions + ledger_entries for Susu cycle commission.
  // Intentionally NOT applied to teller till float because no physical cash leaves the drawer.
  let commissionDebitTxId: string | undefined;
  if (hasSeparateDepositCommissionDebit && susuAllocation) {
    const cardLabel = susuAllocation.cycle?.cycleNumber
      ? `Susu card #${susuAllocation.cycle.cycleNumber}`
      : "Susu card";
    commissionDebitTxId = await postSeparateSusuCommissionDebit({
      tenantId: transaction.tenantId,
      customerId: transaction.customerId,
      transactionBranchId: transaction.transactionBranchId,
      homeBranchId: transaction.homeBranchId,
      fieldAgentId: transaction.fieldAgentId,
      parentTransactionId: transaction.id,
      commissionAmount: susuAllocation.commissionCollectNow,
      cardLabel,
      balanceBeforeCommission: balanceAfterFullDeposit
    });
  }

  let withdrawalCommissionDebitTxId: string | undefined;
  if (hasSeparateWithdrawalCommissionDebit) {
    withdrawalCommissionDebitTxId = await postSeparateSusuCommissionDebit({
      tenantId: transaction.tenantId,
      customerId: transaction.customerId,
      transactionBranchId: transaction.transactionBranchId,
      homeBranchId: transaction.homeBranchId,
      fieldAgentId: transaction.fieldAgentId,
      parentTransactionId: transaction.id,
      commissionAmount: withdrawalCommission,
      balanceBeforeCommission: balanceAfterPrimary
    });
  }

  // Teller till cash & float must reflect the full physical cash handed over (payload.amount),
  // even when Susu Box 1 commission or a retained Savings opening fee splits part of the deposit
  // into institutional income.
  // Field-agent call-over batches bypass teller counter float (cash goes directly to the branch vault).
  if (!options?.skipBranchFloat) {
    const floatTransaction =
      (susuAllocation || feeDeduction) &&
      (transaction.type === "deposit" || transaction.type === "daily_susu")
        ? { ...transaction, amount: payload.amount }
        : transaction;
    await applyTransactionToFloat(context, floatTransaction);
  }

  if (QUALIFYING_TX_TYPES.has(transaction.type)) {
    void touchCustomerQualifyingActivity(context.tenantId, transaction.customerId).catch(() => {
      /* non-blocking */
    });
  }

  const hasDepositCommissionAlertCandidate = Boolean(
    commissionDebitTxId && susuAllocation && susuAllocation.commissionCollectNow > 0
  );
  const hasWithdrawalCommissionAlertCandidate = Boolean(
    withdrawalCommissionDebitTxId && payload.type === "withdrawal" && withdrawalCommission > 0
  );

  let notifyCustomerOnCommission = false;
  if (hasDepositCommissionAlertCandidate || hasWithdrawalCommissionAlertCandidate) {
    const { getActiveSusuCommissionPolicy } = await import("./susuCycleCommissionService.js");
    const commPolicy = await getActiveSusuCommissionPolicy(context.tenantId).catch(() => null);
    notifyCustomerOnCommission = commPolicy?.notifyCustomerOnCommission !== false;
  }

  let withdrawalNotifyPlan: ReturnType<typeof computeWithdrawalNotificationPlan> | null = null;
  if (transaction.type === "withdrawal") {
    if (hasWithdrawalCommissionAlertCandidate) {
      const balanceAfterLedgerDebit = await computeCustomerBalance(
        context.tenantId,
        transaction.customerId
      );
      withdrawalNotifyPlan = computeWithdrawalNotificationPlan({
        withdrawnAmount: payload.amount,
        commission: withdrawalCommission,
        finalBalanceAfterLedgerDebit: balanceAfterLedgerDebit,
        notifyCustomerOnCommission
      });
    }
  }

  if (
    transaction.type === "deposit" ||
    transaction.type === "withdrawal" ||
    transaction.type === "daily_susu"
  ) {
    const primaryAmount =
      transaction.type === "withdrawal"
        ? (withdrawalNotifyPlan?.primaryAmount ?? payload.amount)
        : ledgerAmount > 0
          ? ledgerAmount
          : payload.amount;
    const primaryBalanceOverride =
      transaction.type === "withdrawal"
        ? withdrawalNotifyPlan?.primaryBalance
        : hasDepositCommissionAlertCandidate && notifyCustomerOnCommission
          ? balanceAfterFullDeposit
          : undefined;

    void notifyCustomerTransaction({
      tenantId: context.tenantId,
      customerId: transaction.customerId,
      transactionId: transaction.id,
      type: transaction.type,
      amount: primaryAmount,
      balanceOverride: primaryBalanceOverride,
      subscribedAddons: context.subscribedAddons
    }).catch((error) => {
      console.warn(
        "[notifications] transaction notification skipped:",
        error instanceof Error ? error.message : error
      );
    });
  }

  // Send follow-up commission debit alert ~1 minute after the full deposit credit alert
  // only when the tenant enabled customer notifications for deducted commission.
  if (hasDepositCommissionAlertCandidate && notifyCustomerOnCommission && susuAllocation && commissionDebitTxId) {
    const balanceAfterDepositCommission =
      balanceAfterFullDeposit !== undefined
        ? Math.round((balanceAfterFullDeposit - susuAllocation.commissionCollectNow) * 100) / 100
        : undefined;
    scheduleCustomerSusuCommissionNotification({
      tenantId: context.tenantId,
      customerId: transaction.customerId,
      transactionId: commissionDebitTxId,
      amount: susuAllocation.commissionCollectNow,
      cycleNumber: susuAllocation.cycle?.cycleNumber,
      balanceOverride: balanceAfterDepositCommission,
      subscribedAddons: context.subscribedAddons
    });
  }

  // Also send commission alert on withdrawal when deferred commission was deducted and toggle is ON.
  if (withdrawalNotifyPlan?.sendCommissionAlert && withdrawalCommissionDebitTxId) {
    scheduleCustomerSusuCommissionNotification({
      tenantId: context.tenantId,
      customerId: transaction.customerId,
      transactionId: withdrawalCommissionDebitTxId,
      amount: withdrawalNotifyPlan.commissionAmount,
      balanceOverride: withdrawalNotifyPlan.commissionRemainingBalance,
      subscribedAddons: context.subscribedAddons
    });
  }

  return enrichTransactionProduct(context.tenantId, transaction);
}

export async function listTransactions(
  tenantId: string,
  options?: { branchId?: string }
): Promise<Transaction[]> {
  const supabase = getSupabaseAdminClient();
  const branchId = options?.branchId?.trim() || undefined;
  if (!supabase) {
    const rows = getTenantTransactions(tenantId);
    return branchId ? rows.filter((tx) => tx.transactionBranchId === branchId) : rows;
  }

  let query = supabase
    .from("customer_transactions")
    .select("*")
    .eq("tenant_id", tenantId);

  if (branchId) {
    query = query.eq("transaction_branch_id", branchId);
  }

  const { data, error } = await query.order("created_at", { ascending: false });

  if (error) {
    throw new Error(`Failed to list transactions: ${error.message}`);
  }

  return (data ?? []).map((row) => mapTransactionRow(row as Record<string, unknown>));
}
