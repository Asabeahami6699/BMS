import {
  createTransactionInputSchema,
  transactionSchema,
  type Transaction
} from "@bms/shared";
import { randomUUID } from "node:crypto";
import { getSupabaseAdminClient } from "../config/supabaseClient.js";
import { getCustomerById, getCustomerWithdrawableBalance } from "./customerService.js";
import { addLedgerEntry, computeCustomerBalance } from "./ledgerService.js";
import {
  computeOpeningFeeDeduction,
  openingFeeNote,
  recordOpeningFeeRecovery
} from "./savingsOpeningFeeService.js";
import { applyTransactionToFloat } from "./branchFloatService.js";
import { createAgencyPendingDeposit, usesAgencyDepositFlow } from "./agencyBankingService.js";
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
};

function getTenantTransactions(tenantId: string): Transaction[] {
  return transactionStore.get(tenantId) ?? [];
}

function setTenantTransactions(tenantId: string, transactions: Transaction[]): void {
  transactionStore.set(tenantId, transactions);
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
  const fullNotes = params.notes.includes(idempotencyTag)
    ? params.notes
    : `${params.notes} · ${idempotencyTag}`;

  const withdrawable = await getCustomerWithdrawableBalance(params.tenantId, params.customerId);
  if (withdrawable < params.amount) {
    throw new Error(
      `Insufficient withdrawable balance. Available: GHS ${withdrawable.toFixed(2)}`
    );
  }

  const balanceBefore = await computeCustomerBalance(params.tenantId, params.customerId);
  const transactionId = randomUUID();
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
      throw new Error(`Failed to check prior withdrawal post: ${existingError.message}`);
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
      p_transaction_branch_id: params.homeBranchId,
      p_home_branch_id: params.homeBranchId,
      p_recorded_by_user_id: params.recordedByUserId,
      p_field_agent_id: params.fieldAgentId,
      p_notes: fullNotes
    });

    if (rpcError) {
      const { error: insertError } = await supabase.from("customer_transactions").insert({
        id: transactionId,
        tenant_id: params.tenantId,
        customer_id: params.customerId,
        type: "withdrawal",
        amount: params.amount,
        transaction_branch_id: params.homeBranchId,
        home_branch_id: params.homeBranchId,
        recorded_by_user_id: params.recordedByUserId,
        field_agent_id: params.fieldAgentId,
        notes: fullNotes
      });
      if (insertError) {
        throw new Error(
          `Failed to post withdrawal to customer ledger: ${insertError.message} (RPC: ${rpcError.message})`
        );
      }
      await addLedgerEntry({
        tenantId: params.tenantId,
        customerId: params.customerId,
        transactionId,
        entryType: "debit",
        amount: params.amount,
        transactionBranchId: params.homeBranchId
      });
    } else {
      const { data: ledgerRow, error: ledgerCheckError } = await supabase
        .from("ledger_entries")
        .select("id")
        .eq("transaction_id", transactionId)
        .maybeSingle();
      if (ledgerCheckError) {
        throw new Error(`Failed to verify ledger entry: ${ledgerCheckError.message}`);
      }
      if (!ledgerRow) {
        await addLedgerEntry({
          tenantId: params.tenantId,
          customerId: params.customerId,
          transactionId,
          entryType: "debit",
          amount: params.amount,
          transactionBranchId: params.homeBranchId
        });
      }
    }

    const balanceAfter = await computeCustomerBalance(params.tenantId, params.customerId);
    const expected = Math.round((balanceBefore - params.amount) * 100) / 100;
    if (Math.abs(balanceAfter - expected) > 0.01) {
      throw new Error(
        `Withdrawal debit did not update the customer ledger (expected GHS ${expected.toFixed(2)}, actual GHS ${balanceAfter.toFixed(2)}). Apply Supabase migrations 002 and 021.`
      );
    }

    return transactionId;
  }

  const transactions = getTenantTransactions(params.tenantId);
  const prior = transactions.find((t) => t.notes?.includes(idempotencyTag));
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
  return transactionId;
}

/** Backfill ledger debits for approved agent withdrawal requests that never posted a transaction. */
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
      "id, withdrawal_amount, fulfillment_mode, payout_reference, field_agent_id, approved_by"
    )
    .eq("tenant_id", tenantId)
    .eq("customer_id", customerId)
    .eq("request_type", "withdrawal")
    .eq("status", "approved");

  if (error || !rows?.length) {
    return;
  }

  for (const row of rows) {
    const amount = Number(row.withdrawal_amount ?? 0);
    if (amount <= 0) {
      continue;
    }
    const mode = row.fulfillment_mode as string | null;
    const ref = row.payout_reference as string | null;
    const notes = `Field agent withdrawal approved (${mode ?? "cash"}) · req ${String(row.id).slice(0, 8)}${ref?.trim() ? ` · Ref ${ref.trim()}` : ""}`;
    try {
      await postWithdrawalForApprovedDisclosure({
        tenantId,
        customerId,
        homeBranchId: customer.homeBranchId,
        amount,
        disclosureId: String(row.id),
        recordedByUserId: String(row.approved_by ?? row.field_agent_id),
        fieldAgentId: String(row.field_agent_id),
        notes
      });
    } catch (reconcileError) {
      console.warn(
        `[transaction] Withdrawal reconcile skipped for disclosure ${row.id}:`,
        reconcileError instanceof Error ? reconcileError.message : reconcileError
      );
    }
  }
}

export async function createTransaction(
  context: TransactionRequestContext,
  input: unknown
): Promise<Transaction> {
  const payload = createTransactionInputSchema.parse(input);

  if (context.role === "field_agent" && payload.type === "daily_susu") {
    throw new Error(
      "Field agents cannot credit accounts directly. Record collections, complete call-over, then send for coordinator approval."
    );
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

  if (payload.type === "withdrawal") {
    if (context.role === "teller") {
      throw new Error(
        "Tellers pay approved withdrawals from the payout queue after Customer Service and Back Officer steps."
      );
    }
    const withdrawable = await getCustomerWithdrawableBalance(
      context.tenantId,
      payload.customerId
    );
    if (withdrawable < payload.amount) {
      throw new Error(
        `Insufficient withdrawable balance. Available: GHS ${withdrawable.toFixed(2)}`
      );
    }
  }

  const fieldAgentId =
    context.role === "field_agent"
      ? context.userId
      : (customer.assignedFieldAgentId ?? context.userId);

  const feeDeduction =
    payload.type !== "withdrawal"
      ? computeOpeningFeeDeduction(customer, payload.amount)
      : null;

  const ledgerAmount = feeDeduction ? feeDeduction.creditAmount : payload.amount;
  const noteParts = [payload.notes, feeDeduction ? openingFeeNote(feeDeduction) : undefined].filter(
    Boolean
  );
  const combinedNotes = noteParts.length > 0 ? noteParts.join(" · ") : undefined;

  const bankProductId = await resolveBankProductForTransaction(
    context.tenantId,
    payload.type,
    payload.bankProductId,
    payload.transactionBranchId
  );

  let workflowData: Record<string, unknown> | undefined = payload.workflowData;
  if (bankProductId && payload.type === "deposit" && usesAgencyDepositFlow(context)) {
    const { getBankProductById } = await import("./bankProductService.js");
    const { validateWorkflowFieldValues, workflowFieldsForStage } = await import("@bms/shared");
    const product = await getBankProductById(context.tenantId, bankProductId);
    if (product) {
      const validation = validateWorkflowFieldValues(
        workflowFieldsForStage(product, "capture"),
        payload.workflowData ?? {},
        "capture"
      );
      if (!validation.ok) {
        throw new Error(validation.errors.join("; "));
      }
      workflowData = validation.data;
    }
  }

  const transaction = transactionSchema.parse({
    id: randomUUID(),
    tenantId: context.tenantId,
    customerId: payload.customerId,
    type: payload.type,
    amount: ledgerAmount > 0 ? ledgerAmount : payload.amount,
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
    if (ledgerAmount <= 0) {
      return enrichTransactionProduct(context.tenantId, transaction);
    }
  }

  if (payload.type === "deposit" && usesAgencyDepositFlow(context)) {
    return createAgencyPendingDeposit(context, transaction);
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

    // Fallback for environments where RPC migration hasn't been applied yet.
    if (rpcError) {
      const { error } = await supabase.from("customer_transactions").insert({
        id: transaction.id,
        tenant_id: transaction.tenantId,
        customer_id: transaction.customerId,
        type: transaction.type,
        amount: transaction.amount,
        transaction_branch_id: transaction.transactionBranchId,
        home_branch_id: transaction.homeBranchId,
        recorded_by_user_id: transaction.recordedByUserId,
        field_agent_id: transaction.fieldAgentId,
        notes: transaction.notes,
        bank_product_id: bankProductId ?? null
      });
      if (error) {
        throw new Error(`Failed to save transaction: ${error.message}`);
      }
      await addLedgerEntry({
        tenantId: context.tenantId,
        customerId: transaction.customerId,
        transactionId: transaction.id,
        entryType: transaction.type === "withdrawal" ? "debit" : "credit",
        amount: ledgerAmount,
        transactionBranchId: transaction.transactionBranchId
      });
    } else {
      await persistBankProductId(transaction.id, bankProductId);
      const { data: ledgerRow, error: ledgerCheckError } = await supabase
        .from("ledger_entries")
        .select("id")
        .eq("transaction_id", transaction.id)
        .maybeSingle();
      if (ledgerCheckError) {
        throw new Error(`Failed to verify ledger entry: ${ledgerCheckError.message}`);
      }
      if (!ledgerRow) {
        await addLedgerEntry({
          tenantId: context.tenantId,
          customerId: transaction.customerId,
          transactionId: transaction.id,
          entryType: transaction.type === "withdrawal" ? "debit" : "credit",
          amount: ledgerAmount,
          transactionBranchId: transaction.transactionBranchId
        });
      }
    }
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

  await applyTransactionToFloat(context, transaction);

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

  return (data ?? []).map((row) =>
    transactionSchema.parse({
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
      executionStatus: row.execution_status ?? "completed",
      bankExecutedByUserId: row.bank_executed_by_user_id ?? undefined,
      bankExecutedAt: row.bank_executed_at ?? undefined,
      bankProductId: row.bank_product_id ?? undefined
    })
  );
}
