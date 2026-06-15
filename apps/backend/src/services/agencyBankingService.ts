import {
  agencyBootstrapSchema,
  AGENCY_BANKING_ACCOUNT_LABEL,
  AGENCY_WALK_IN_CUSTOMER_NAME,
  balanceDisclosureSchema,
  initiateAgencyWithdrawalSchema,
  isManualPartnerWithdrawal,
  resolveAgencyDepositCustomerName,
  resolveAgencyDepositDepositorName,
  transactionSchema,
  cancelTellerAgencyDepositSchema,
  tellerAgencyDepositsSchema,
  updateTellerAgencyDepositSchema,
  validateDepositCaptureWorkflow,
  type AgencyBootstrap,
  type BalanceDisclosure,
  type TellerAgencyDeposits,
  type Transaction
} from "@bms/shared";
import { randomUUID } from "node:crypto";
import { getSupabaseAdminClient } from "../config/supabaseClient.js";
import { assertBranchAccess } from "../middleware/branchScope.js";
import { applyTransactionToFloat, adjustDepositAmountOnFloat, reverseTransactionFromFloat } from "./branchFloatService.js";
import { getCustomerById, getCustomerWithdrawableBalance, listCustomers } from "./customerService.js";
import { addLedgerEntry } from "./ledgerService.js";
import { notifyTenantStaff } from "./notificationService.js";
import type { TransactionRequestContext } from "./transactionService.js";
import {
  enrichTransactionsWithBankProducts,
  getBankProductById,
  resolveBankProductForWithdrawalApproval
} from "./bankProductService.js";
import { evaluateAgencyDepositExecutionStatus } from "./companyAccountLimitService.js";
import {
  validateWorkflowFieldValues,
  workflowFieldsForStage
} from "@bms/shared";

const memoryPendingDeposits = new Map<string, Transaction[]>();

function mapTransactionRow(row: Record<string, unknown>): Transaction {
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
    executionStatus: row.execution_status ?? "completed",
    bankExecutedByUserId: row.bank_executed_by_user_id ?? undefined,
    bankExecutedAt: row.bank_executed_at ?? undefined,
    bankProductId: row.bank_product_id ?? undefined
  });
}

export function usesAgencyDepositFlow(context: TransactionRequestContext): boolean {
  if (context.role === "teller") {
    return true;
  }
  return context.permissions?.includes("agency.deposits.record") ?? false;
}

export async function createAgencyPendingDeposit(
  context: TransactionRequestContext,
  transaction: Transaction
): Promise<Transaction> {
  const executionStatus = await evaluateAgencyDepositExecutionStatus(
    context.tenantId,
    transaction.transactionBranchId,
    transaction.amount
  );

  const pending = transactionSchema.parse({
    ...transaction,
    executionStatus
  });

  const supabase = getSupabaseAdminClient();
  if (supabase) {
    const { error } = await supabase.from("customer_transactions").insert({
      id: pending.id,
      tenant_id: pending.tenantId,
      customer_id: pending.customerId,
      type: pending.type,
      amount: pending.amount,
      transaction_branch_id: pending.transactionBranchId,
      home_branch_id: pending.homeBranchId,
      recorded_by_user_id: pending.recordedByUserId,
      field_agent_id: pending.fieldAgentId,
      notes: pending.notes ?? null,
      execution_status: pending.executionStatus,
      bank_product_id: pending.bankProductId ?? null,
      workflow_data: pending.workflowData ?? {}
    });
    if (error) {
      throw new Error(`Failed to record teller deposit: ${error.message}`);
    }
  } else {
    const list = memoryPendingDeposits.get(context.tenantId) ?? [];
    memoryPendingDeposits.set(context.tenantId, [pending, ...list]);
  }

  await applyTransactionToFloat(context, pending);

  try {
    if (executionStatus === "pending_accountant") {
      await notifyTenantStaff({
        tenantId: context.tenantId,
        roles: ["accountant", "admin"],
        kind: "deposit_pending_accountant",
        customerId: pending.customerId,
        title: "Deposit over agency account cap",
        body: `GHS ${pending.amount.toFixed(2)} exceeds the company account daily cap (GHS 1,000,000) or available headroom — accountant must approve or arrange agent-to-agent transfer.`
      });
    } else {
      await notifyTenantStaff({
        tenantId: context.tenantId,
        roles: ["back_officer", "admin"],
        kind: "deposit_pending_bank",
        customerId: pending.customerId,
        title: "Deposit awaiting bank execution",
        body: `GHS ${pending.amount.toFixed(2)} collected at till — Back Officer must credit customer account.`
      });
    }
  } catch {
    // Non-blocking
  }

  if (pending.bankProductId) {
    const product = await getBankProductById(context.tenantId, pending.bankProductId);
    if (product) {
      return { ...pending, bankProductName: product.name, bankLabel: product.bankLabel };
    }
  }

  return pending;
}

export async function listTellerAgencyDeposits(
  context: TransactionRequestContext,
  options?: { branchId?: string; businessDate?: string }
): Promise<TellerAgencyDeposits> {
  const businessDate = options?.businessDate?.trim() || new Date().toISOString().slice(0, 10);
  let branchId = options?.branchId
    ? await (await import("./branchService.js")).resolveBranchId(context.tenantId, options.branchId)
    : undefined;
  if (!branchId && context.scopeType === "branch" && context.branchId) {
    branchId = await (await import("./branchService.js")).resolveBranchId(
      context.tenantId,
      context.branchId
    );
  }
  if (!branchId) {
    throw new Error("Select a branch to view deposit status");
  }
  assertBranchAccess(context, branchId);

  const dayStart = `${businessDate}T00:00:00.000Z`;
  const dayEnd = `${businessDate}T23:59:59.999Z`;
  const supabase = getSupabaseAdminClient();
  let rows: Record<string, unknown>[] = [];

  if (supabase) {
    let query = supabase
      .from("customer_transactions")
      .select("*")
      .eq("tenant_id", context.tenantId)
      .eq("transaction_branch_id", branchId)
      .eq("type", "deposit")
      .gte("created_at", dayStart)
      .lte("created_at", dayEnd)
      .order("created_at", { ascending: false })
      .limit(100);
    if (context.role === "teller") {
      query = query.eq("recorded_by_user_id", context.userId);
    }
    const { data, error } = await query;
    if (error) {
      throw new Error(`Failed to load teller deposits: ${error.message}`);
    }
    rows = data ?? [];
  }

  const customers = await listCustomers(context.tenantId, { light: true });
  const customerById = new Map(customers.map((c) => [c.id, c]));
  const branches = await (await import("./branchService.js")).listBranches(context.tenantId).catch(() => []);
  const branchById = new Map(branches.map((b) => [b.id, b]));

  const deposits = await enrichTransactionsWithBankProducts(
    context.tenantId,
    rows.map((row) => {
      const workflow =
        row.workflow_data && typeof row.workflow_data === "object"
          ? (row.workflow_data as Record<string, unknown>)
          : undefined;
      const partnerAccountNumber =
        typeof workflow?.account_number === "string" ? workflow.account_number : undefined;
      const customer = customerById.get(String(row.customer_id));
      const customerName = resolveAgencyDepositCustomerName({
        customerFullName: customer?.fullName,
        workflow,
        fallback: AGENCY_BANKING_ACCOUNT_LABEL
      });
      const rowBranchId = String(row.transaction_branch_id);
      const branch = branchById.get(rowBranchId);
      return {
        id: String(row.id),
        createdAt: String(row.created_at),
        amount: Number(row.amount),
        customerId: String(row.customer_id),
        customerName,
        depositorName: resolveAgencyDepositDepositorName(workflow),
        executionStatus: String(row.execution_status ?? "completed"),
        bankProductId: row.bank_product_id != null ? String(row.bank_product_id) : undefined,
        partnerAccountNumber,
        branchName: branch?.name,
        branchCode: branch?.code,
        notes: row.notes != null ? String(row.notes) : undefined,
        workflowData: workflow
      };
    })
  );

  return tellerAgencyDepositsSchema.parse({
    businessDate,
    branchId,
    deposits: deposits.map((row) => ({
      id: row.id,
      createdAt: row.createdAt,
      amount: row.amount,
      customerId: row.customerId,
      customerName: row.customerName,
      depositorName: row.depositorName,
      executionStatus: row.executionStatus,
      bankLabel: row.bankLabel,
      bankProductId: row.bankProductId,
      bankProductName: row.bankProductName,
      partnerAccountNumber: row.partnerAccountNumber,
      branchName: row.branchName,
      branchCode: row.branchCode,
      notes: row.notes,
      workflowData: row.workflowData
    }))
  });
}

async function loadTellerOwnedDeposit(
  context: TransactionRequestContext,
  transactionId: string
): Promise<{ row: Record<string, unknown>; transaction: Transaction }> {
  const supabase = getSupabaseAdminClient();
  if (!supabase) {
    throw new Error("Deposit changes require database connectivity");
  }

  const { data, error } = await supabase
    .from("customer_transactions")
    .select("*")
    .eq("tenant_id", context.tenantId)
    .eq("id", transactionId)
    .maybeSingle();
  if (error) {
    throw new Error(`Failed to load deposit: ${error.message}`);
  }
  if (!data) {
    throw new Error("Deposit not found");
  }

  const row = data as Record<string, unknown>;
  if (String(row.type) !== "deposit") {
    throw new Error("Only deposits can be changed here");
  }

  const status = String(row.execution_status ?? "completed");
  if (status !== "pending_bank" && status !== "pending_accountant") {
    throw new Error("Only pending deposits can be changed or removed");
  }

  if (context.role === "teller" && String(row.recorded_by_user_id) !== context.userId) {
    throw new Error("You can only change deposits you recorded");
  }

  assertBranchAccess(context, String(row.transaction_branch_id));

  return { row, transaction: mapTransactionRow(row) };
}

export async function cancelTellerAgencyDeposit(
  context: TransactionRequestContext,
  transactionId: string,
  input: { reason: string }
): Promise<void> {
  const parsed = cancelTellerAgencyDepositSchema.parse(input);
  const { row, transaction } = await loadTellerOwnedDeposit(context, transactionId);

  await reverseTransactionFromFloat(context, transaction);

  const supabase = getSupabaseAdminClient();
  if (!supabase) {
    throw new Error("Deposit cancellation requires database connectivity");
  }

  const priorNotes = row.notes != null ? String(row.notes).trim() : "";
  const cancellationNote = `Cancelled by teller: ${parsed.reason.trim()}`;
  const combinedNotes = priorNotes ? `${priorNotes} · ${cancellationNote}` : cancellationNote;

  const { error } = await supabase
    .from("customer_transactions")
    .update({
      execution_status: "failed",
      notes: combinedNotes
    })
    .eq("tenant_id", context.tenantId)
    .eq("id", transactionId);
  if (error) {
    throw new Error(`Failed to cancel deposit: ${error.message}`);
  }
}

export async function updateTellerAgencyDeposit(
  context: TransactionRequestContext,
  transactionId: string,
  input: {
    amount?: number;
    notes?: string;
    bankProductId?: string;
    workflowData?: Record<string, unknown>;
  }
): Promise<TellerAgencyDeposits["deposits"][number]> {
  const parsed = updateTellerAgencyDepositSchema.parse(input);
  const { row, transaction } = await loadTellerOwnedDeposit(context, transactionId);

  const nextAmount = parsed.amount ?? transaction.amount;
  const nextBankProductId = parsed.bankProductId ?? transaction.bankProductId;
  let nextWorkflow = {
    ...(row.workflow_data && typeof row.workflow_data === "object"
      ? (row.workflow_data as Record<string, unknown>)
      : {}),
    ...(parsed.workflowData ?? {})
  };

  if (nextBankProductId) {
    const product = await getBankProductById(context.tenantId, nextBankProductId);
    if (product) {
      const validation = validateDepositCaptureWorkflow(product, nextWorkflow);
      if (!validation.ok) {
        throw new Error(validation.errors.join("; "));
      }
      nextWorkflow = validation.data;
    }
  }

  if (nextAmount !== transaction.amount) {
    await adjustDepositAmountOnFloat(context, transaction, transaction.amount, nextAmount);
  }

  const supabase = getSupabaseAdminClient();
  if (!supabase) {
    throw new Error("Deposit update requires database connectivity");
  }

  const { error } = await supabase
    .from("customer_transactions")
    .update({
      amount: nextAmount,
      notes: parsed.notes ?? (row.notes != null ? String(row.notes) : null),
      bank_product_id: nextBankProductId ?? null,
      workflow_data: nextWorkflow
    })
    .eq("tenant_id", context.tenantId)
    .eq("id", transactionId);
  if (error) {
    throw new Error(`Failed to update deposit: ${error.message}`);
  }

  const deposits = await listTellerAgencyDeposits(context, {
    branchId: String(row.transaction_branch_id),
    businessDate: String(row.created_at).slice(0, 10)
  });
  const updated = deposits.deposits.find((deposit) => deposit.id === transactionId);
  if (!updated) {
    throw new Error("Deposit updated but could not be reloaded");
  }
  return updated;
}

async function loadPendingDeposits(tenantId: string, branchId?: string): Promise<Transaction[]> {
  const supabase = getSupabaseAdminClient();
  if (supabase) {
    let query = supabase
      .from("customer_transactions")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("execution_status", "pending_bank")
      .eq("type", "deposit")
      .order("created_at", { ascending: false })
      .limit(100);
    if (branchId) {
      query = query.eq("transaction_branch_id", branchId);
    }
    const { data, error } = await query;
    if (error) {
      throw new Error(`Failed to load pending deposits: ${error.message}`);
    }
    return (data ?? []).map((row) => mapTransactionRow(row));
  }
  const rows = memoryPendingDeposits.get(tenantId) ?? [];
  return branchId ? rows.filter((r) => r.transactionBranchId === branchId) : rows;
}

async function loadDisclosuresByStatus(
  tenantId: string,
  status: string,
  branchId?: string
): Promise<BalanceDisclosure[]> {
  const supabase = getSupabaseAdminClient();
  let rows: Record<string, unknown>[] = [];
  if (supabase) {
    const { data, error } = await supabase
      .from("customer_balance_disclosures")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("request_type", "withdrawal")
      .eq("status", status)
      .order("requested_at", { ascending: false })
      .limit(100);
    if (error) {
      throw new Error(`Failed to load withdrawal queue: ${error.message}`);
    }
    rows = data ?? [];
  }

  const customers = await listCustomers(tenantId);
  const customerById = new Map(customers.map((c) => [c.id, c]));

  const mapped = rows.map((row) => {
    const workflowData =
      row.workflow_data && typeof row.workflow_data === "object"
        ? (row.workflow_data as Record<string, unknown>)
        : undefined;
    const linkedCustomer = customerById.get(String(row.customer_id));
    const holderFromWorkflow =
      typeof workflowData?.account_holder_name === "string"
        ? workflowData.account_holder_name
        : undefined;
    const customerName =
      holderFromWorkflow ??
      (linkedCustomer?.fullName === AGENCY_WALK_IN_CUSTOMER_NAME
        ? "Non-BMS account holder"
        : linkedCustomer?.fullName);

    return balanceDisclosureSchema.parse({
      id: row.id,
      tenantId: row.tenant_id,
      customerId: row.customer_id,
      fieldAgentId: row.field_agent_id,
      customerName,
      requestType: "withdrawal",
      status: row.status,
      withdrawalAmount: row.withdrawal_amount != null ? Number(row.withdrawal_amount) : undefined,
      fulfillmentMode: row.fulfillment_mode ?? undefined,
      requestedAt: row.requested_at,
      csApprovedBy: row.cs_approved_by ?? undefined,
      csApprovedAt: row.cs_approved_at ?? undefined,
      bankExecutedBy: row.bank_executed_by ?? undefined,
      bankExecutedAt: row.bank_executed_at ?? undefined,
      tellerPaidBy: row.teller_paid_by ?? undefined,
      tellerPaidAt: row.teller_paid_at ?? undefined,
      requestReason: row.request_reason ?? undefined,
      bankProductId: row.bank_product_id != null ? String(row.bank_product_id) : undefined,
      workflowData
    });
  });

  if (!branchId) {
    return mapped;
  }
  return mapped.filter((d) => customerById.get(d.customerId)?.homeBranchId === branchId);
}

function isAgencyCashWithdrawal(fulfillmentMode: string | null | undefined): boolean {
  return fulfillmentMode !== "momo";
}

/** Cash withdrawal requests awaiting Customer Service verification. */
async function loadWithdrawalsPendingCsVerify(
  tenantId: string,
  branchId?: string
): Promise<BalanceDisclosure[]> {
  const pending = await loadDisclosuresByStatus(tenantId, "pending", branchId);
  return pending.filter(
    (row) => isAgencyCashWithdrawal(row.fulfillmentMode) && !isManualPartnerWithdrawal(row)
  );
}

/** Cash withdrawals ready for teller payout (CS verified, or legacy bank_executed). */
async function loadWithdrawalsPendingTellerPay(
  tenantId: string,
  branchId?: string
): Promise<BalanceDisclosure[]> {
  const [csApproved, legacyBankExecuted] = await Promise.all([
    loadDisclosuresByStatus(tenantId, "cs_approved", branchId),
    loadDisclosuresByStatus(tenantId, "bank_executed", branchId)
  ]);
  const byId = new Map<string, BalanceDisclosure>();
  for (const row of [...csApproved, ...legacyBankExecuted]) {
    if (isAgencyCashWithdrawal(row.fulfillmentMode)) {
      byId.set(row.id, row);
    }
  }
  return [...byId.values()];
}

async function postAgencyWithdrawalLedgerDebit(
  context: TransactionRequestContext,
  params: {
    disclosureId: string;
    customerId: string;
    fieldAgentId: string;
    amount: number;
    homeBranchId: string;
    bankProductId?: string | null;
    notesSuffix: string;
    /** Partner-bank walk-in: record till movement only — do not debit BMS customer ledger. */
    skipCustomerLedgerDebit?: boolean;
  }
): Promise<string> {
  const supabase = getSupabaseAdminClient();
  const transactionId = randomUUID();
  const notes = `Agency withdrawal · ${params.notesSuffix} · req ${params.disclosureId.slice(0, 8)}`;

  if (supabase && params.skipCustomerLedgerDebit) {
    const { error: insertError } = await supabase.from("customer_transactions").insert({
      id: transactionId,
      tenant_id: context.tenantId,
      customer_id: params.customerId,
      type: "withdrawal",
      amount: params.amount,
      transaction_branch_id: params.homeBranchId,
      home_branch_id: params.homeBranchId,
      recorded_by_user_id: context.userId,
      field_agent_id: params.fieldAgentId,
      notes: `${notes} · partner bank (no BMS debit)`,
      execution_status: "completed",
      bank_product_id: params.bankProductId ?? null
    });
    if (insertError) {
      throw new Error(`Failed to record partner withdrawal: ${insertError.message}`);
    }
    return transactionId;
  }

  if (supabase) {
    const { error: rpcError } = await supabase.rpc("post_customer_transaction_atomic", {
      p_transaction_id: transactionId,
      p_tenant_id: context.tenantId,
      p_customer_id: params.customerId,
      p_type: "withdrawal",
      p_amount: params.amount,
      p_transaction_branch_id: params.homeBranchId,
      p_home_branch_id: params.homeBranchId,
      p_recorded_by_user_id: context.userId,
      p_field_agent_id: params.fieldAgentId,
      p_notes: notes
    });
    if (rpcError) {
      const { error: insertError } = await supabase.from("customer_transactions").insert({
        id: transactionId,
        tenant_id: context.tenantId,
        customer_id: params.customerId,
        type: "withdrawal",
        amount: params.amount,
        transaction_branch_id: params.homeBranchId,
        home_branch_id: params.homeBranchId,
        recorded_by_user_id: context.userId,
        field_agent_id: params.fieldAgentId,
        notes,
        execution_status: "completed",
        bank_product_id: params.bankProductId ?? null
      });
      if (insertError) {
        throw new Error(`Failed to post withdrawal debit: ${insertError.message}`);
      }
      await addLedgerEntry({
        tenantId: context.tenantId,
        customerId: params.customerId,
        transactionId,
        entryType: "debit",
        amount: params.amount,
        transactionBranchId: params.homeBranchId
      });
    } else if (params.bankProductId) {
      await supabase
        .from("customer_transactions")
        .update({ bank_product_id: params.bankProductId })
        .eq("id", transactionId);
    }
  }

  return transactionId;
}

export async function getAgencyBootstrap(
  context: TransactionRequestContext,
  branchId?: string
): Promise<AgencyBootstrap> {
  if (branchId) {
    assertBranchAccess(context, branchId);
  }

  const effectiveBranch = branchId ?? (context.scopeType === "branch" ? context.branchId : undefined);

  const [depositsPendingBank, withdrawalsPendingCs, withdrawalsPendingTeller] = await Promise.all([
      loadPendingDeposits(context.tenantId, effectiveBranch),
      loadWithdrawalsPendingCsVerify(context.tenantId, effectiveBranch),
      loadWithdrawalsPendingTellerPay(context.tenantId, effectiveBranch)
    ]);

  const customers = await listCustomers(context.tenantId, {
    branchId: effectiveBranch,
    light: true
  });
  const customerById = new Map(customers.map((c) => [c.id, c]));

  const enrichedDeposits = await enrichTransactionsWithBankProducts(
    context.tenantId,
    depositsPendingBank.map((d) => ({
      id: d.id,
      customerId: d.customerId,
      customerName: customerById.get(d.customerId)?.fullName,
      amount: d.amount,
      transactionBranchId: d.transactionBranchId,
      recordedByUserId: d.recordedByUserId,
      createdAt: d.createdAt,
      notes: d.notes,
      bankProductId: d.bankProductId
    }))
  );

  const enrichedWithdrawalsPendingTeller = await enrichTransactionsWithBankProducts(
    context.tenantId,
    withdrawalsPendingTeller
  );

  return agencyBootstrapSchema.parse({
    queue: {
      depositsPendingBank: depositsPendingBank.length,
      withdrawalsPendingCs: withdrawalsPendingCs.length,
      withdrawalsPendingBank: 0,
      withdrawalsPendingTeller: withdrawalsPendingTeller.length
    },
    depositsPendingBank: enrichedDeposits,
    withdrawalsPendingCs,
    withdrawalsPendingBank: [],
    withdrawalsPendingTeller: enrichedWithdrawalsPendingTeller
  });
}

export async function executeBankDeposit(
  context: TransactionRequestContext,
  transactionId: string
): Promise<Transaction> {
  const supabase = getSupabaseAdminClient();
  let transaction: Transaction | undefined;

  if (supabase) {
    const { data, error } = await supabase
      .from("customer_transactions")
      .select("*")
      .eq("tenant_id", context.tenantId)
      .eq("id", transactionId)
      .maybeSingle();
    if (error || !data) {
      throw new Error("Deposit transaction not found");
    }
    transaction = mapTransactionRow(data);
  } else {
    transaction = (memoryPendingDeposits.get(context.tenantId) ?? []).find((t) => t.id === transactionId);
  }

  if (!transaction || transaction.executionStatus !== "pending_bank") {
    throw new Error("Only pending teller deposits can be executed at bank");
  }

  assertBranchAccess(context, transaction.transactionBranchId);

  const now = new Date().toISOString();
  if (supabase) {
    const { error: rpcError } = await supabase.rpc("post_customer_transaction_atomic", {
      p_transaction_id: transaction.id,
      p_tenant_id: transaction.tenantId,
      p_customer_id: transaction.customerId,
      p_type: transaction.type,
      p_amount: transaction.amount,
      p_transaction_branch_id: transaction.transactionBranchId,
      p_home_branch_id: transaction.homeBranchId,
      p_recorded_by_user_id: transaction.recordedByUserId,
      p_field_agent_id: transaction.fieldAgentId,
      p_notes: transaction.notes ?? null
    });
    if (rpcError) {
      await addLedgerEntry({
        tenantId: context.tenantId,
        customerId: transaction.customerId,
        transactionId: transaction.id,
        entryType: "credit",
        amount: transaction.amount,
        transactionBranchId: transaction.transactionBranchId
      });
    }
    const { error: updateError } = await supabase
      .from("customer_transactions")
      .update({
        execution_status: "completed",
        bank_executed_by_user_id: context.userId,
        bank_executed_at: now
      })
      .eq("id", transactionId);
    if (updateError) {
      throw new Error(`Failed to complete deposit execution: ${updateError.message}`);
    }
  } else {
    await addLedgerEntry({
      tenantId: context.tenantId,
      customerId: transaction.customerId,
      transactionId: transaction.id,
      entryType: "credit",
      amount: transaction.amount,
      transactionBranchId: transaction.transactionBranchId
    });
  }

  return transactionSchema.parse({
    ...transaction,
    executionStatus: "completed",
    bankExecutedByUserId: context.userId,
    bankExecutedAt: now
  });
}

export async function initiateAgencyWithdrawal(
  context: TransactionRequestContext,
  input: unknown
): Promise<BalanceDisclosure> {
  const payload = initiateAgencyWithdrawalSchema.parse(input ?? {});

  let customerId = payload.customerId;
  if (payload.manualPartnerAccount) {
    const branchKey = payload.branchId ?? context.branchId;
    if (!branchKey) {
      throw new Error("Branch is required for non-BMS partner withdrawals");
    }
    const { ensureAgencyWalkInCustomer } = await import("./agencyWalkInCustomerService.js");
    const { resolveBranchId } = await import("./branchService.js");
    const branchId = await resolveBranchId(context.tenantId, branchKey);
    if (!branchId) {
      throw new Error("Branch not found");
    }
    const walkIn = await ensureAgencyWalkInCustomer(context.tenantId, branchId);
    customerId = walkIn.id;
  }

  if (!customerId) {
    throw new Error("Customer is required");
  }

  const customer = await getCustomerById(context.tenantId, customerId);
  if (!customer) {
    throw new Error("Customer not found");
  }
  if (
    !payload.manualPartnerAccount &&
    context.scopeType === "branch" &&
    context.branchId &&
    customer.homeBranchId !== context.branchId
  ) {
    throw new Error("Customer is not in your branch scope");
  }

  if (!payload.manualPartnerAccount) {
    const withdrawable = await getCustomerWithdrawableBalance(context.tenantId, customerId);
    if (payload.amount > withdrawable) {
      throw new Error(
        `Withdrawal exceeds available funds. Withdrawable: GHS ${withdrawable.toFixed(2)}`
      );
    }
  }

  let workflowData: Record<string, unknown> = {};
  let bankProductId: string | undefined = payload.bankProductId;
  if (bankProductId) {
    const product = await getBankProductById(context.tenantId, bankProductId);
    if (!product || product.direction !== "withdrawal" || !product.isActive) {
      throw new Error("Invalid withdrawal bank product");
    }
    const validation = validateWorkflowFieldValues(
      workflowFieldsForStage(product, "verification"),
      payload.workflowData ?? {},
      "verification"
    );
    if (!validation.ok) {
      throw new Error(validation.errors.join("; "));
    }
    workflowData = validation.data;
  } else if (payload.manualPartnerAccount) {
    throw new Error("Bank product is required for non-BMS partner withdrawals");
  }

  if (payload.manualPartnerAccount) {
    workflowData = { ...workflowData, manual_partner_account: true };
  }

  const supabase = getSupabaseAdminClient();
  if (supabase && !payload.manualPartnerAccount) {
    const { data: existing } = await supabase
      .from("customer_balance_disclosures")
      .select("id, status")
      .eq("tenant_id", context.tenantId)
      .eq("customer_id", customerId)
      .eq("request_type", "withdrawal")
      .in("status", ["pending", "cs_approved", "bank_executed"])
      .limit(1)
      .maybeSingle();
    if (existing) {
      throw new Error("This customer already has an active withdrawal request");
    }
  }

  const id = randomUUID();
  const requestedAt = new Date().toISOString();
  const releaseToTeller = payload.manualPartnerAccount;
  const row = {
    id,
    tenant_id: context.tenantId,
    customer_id: customerId,
    field_agent_id: context.userId,
    request_type: "withdrawal",
    status: releaseToTeller ? "cs_approved" : "pending",
    withdrawal_amount: payload.amount,
    fulfillment_mode: payload.fulfillmentMode,
    requested_at: requestedAt,
    request_reason: payload.reason,
    bank_product_id: bankProductId ?? null,
    workflow_data: workflowData,
    cs_approved_by: releaseToTeller ? context.userId : null,
    cs_approved_at: releaseToTeller ? requestedAt : null
  };

  if (supabase) {
    const { error } = await supabase.from("customer_balance_disclosures").insert(row);
    if (error) {
      throw new Error(`Failed to initiate withdrawal: ${error.message}`);
    }
  }

  const displayName = payload.manualPartnerAccount
    ? String(workflowData.account_holder_name ?? "Non-BMS account holder")
    : customer.fullName;

  if (releaseToTeller) {
    try {
      await notifyTenantStaff({
        tenantId: context.tenantId,
        roles: ["teller", "admin"],
        kind: "withdrawal_ready_for_teller",
        customerId,
        title: "Walk-in withdrawal — pay customer",
        body: `${displayName} GHS ${payload.amount.toFixed(2)} — CS initiated; teller may confirm and pay cash.`
      });
    } catch {
      /* non-blocking */
    }
  }

  return balanceDisclosureSchema.parse({
    id,
    tenantId: context.tenantId,
    customerId,
    fieldAgentId: context.userId,
    customerName: displayName,
    requestType: "withdrawal",
    status: releaseToTeller ? "cs_approved" : "pending",
    withdrawalAmount: payload.amount,
    fulfillmentMode: payload.fulfillmentMode,
    requestedAt,
    requestReason: payload.reason,
    bankProductId,
    workflowData,
    csApprovedBy: releaseToTeller ? context.userId : undefined,
    csApprovedAt: releaseToTeller ? requestedAt : undefined
  });
}

export async function customerServiceApproveWithdrawal(
  context: TransactionRequestContext,
  disclosureId: string,
  options?: { bankProductId?: string; workflowData?: Record<string, unknown> }
): Promise<BalanceDisclosure> {
  const supabase = getSupabaseAdminClient();
  const { data: row } = supabase
    ? await supabase
        .from("customer_balance_disclosures")
        .select("*")
        .eq("tenant_id", context.tenantId)
        .eq("id", disclosureId)
        .maybeSingle()
    : { data: null };

  if (!row) {
    throw new Error("Withdrawal request not found");
  }
  if (row.request_type !== "withdrawal") {
    throw new Error("Only withdrawal requests use Customer Service approval");
  }
  if (row.status !== "pending") {
    throw new Error("Only pending withdrawal requests can be verified");
  }

  const rowWorkflow =
    row.workflow_data && typeof row.workflow_data === "object"
      ? (row.workflow_data as Record<string, unknown>)
      : undefined;
  if (isManualPartnerWithdrawal({ workflowData: rowWorkflow })) {
    throw new Error("Non-BMS walk-in withdrawals are sent directly to the teller for payout");
  }

  const amount = Number(row.withdrawal_amount ?? 0);
  const withdrawable = await getCustomerWithdrawableBalance(context.tenantId, row.customer_id);
  if (withdrawable < amount) {
    throw new Error(`Insufficient withdrawable balance. Available: GHS ${withdrawable.toFixed(2)}`);
  }

  const customer = await getCustomerById(context.tenantId, row.customer_id);
  const resolvedProductId = await resolveBankProductForWithdrawalApproval(
    context.tenantId,
    options?.bankProductId ?? row.bank_product_id ?? undefined,
    customer?.homeBranchId
  );

  let workflowData: Record<string, unknown> = {};
  if (resolvedProductId) {
    const product = await getBankProductById(context.tenantId, resolvedProductId);
    if (product) {
      const validation = validateWorkflowFieldValues(
        workflowFieldsForStage(product, "verification"),
        options?.workflowData ?? {},
        "verification"
      );
      if (!validation.ok) {
        throw new Error(validation.errors.join("; "));
      }
      workflowData = validation.data;
    }
  }

  const now = new Date().toISOString();
  if (supabase) {
    const { error: updateError } = await supabase
      .from("customer_balance_disclosures")
      .update({
        status: "cs_approved",
        cs_approved_by: context.userId,
        cs_approved_at: now,
        bank_product_id: resolvedProductId ?? null,
        workflow_data: workflowData
      })
      .eq("id", disclosureId);
    if (updateError) {
      throw new Error(`Failed to approve withdrawal: ${updateError.message}`);
    }
  }

  try {
    await notifyTenantStaff({
      tenantId: context.tenantId,
      roles: ["teller", "admin"],
      kind: "withdrawal_ready_for_teller",
      customerId: row.customer_id,
      title: "Withdrawal verified — pay customer",
      body: `${customer?.fullName ?? "Customer"} GHS ${amount.toFixed(2)} — Teller may pay cash after CS verification.`
    });
  } catch {
    // Non-blocking
  }

  return balanceDisclosureSchema.parse({
    id: row.id,
    tenantId: row.tenant_id,
    customerId: row.customer_id,
    fieldAgentId: row.field_agent_id,
    customerName: customer?.fullName,
    requestType: "withdrawal",
    status: "cs_approved",
    withdrawalAmount: amount,
    fulfillmentMode: row.fulfillment_mode ?? undefined,
    requestedAt: row.requested_at,
    csApprovedBy: context.userId,
    csApprovedAt: now,
    requestReason: row.request_reason ?? undefined,
    bankProductId: resolvedProductId,
    workflowData
  });
}

export async function executeBankWithdrawal(
  context: TransactionRequestContext,
  disclosureId: string,
  bankProductId?: string
): Promise<BalanceDisclosure> {
  const supabase = getSupabaseAdminClient();
  const { data: row } = supabase
    ? await supabase
        .from("customer_balance_disclosures")
        .select("*")
        .eq("tenant_id", context.tenantId)
        .eq("id", disclosureId)
        .maybeSingle()
    : { data: null };

  if (!row || row.request_type !== "withdrawal") {
    throw new Error("Withdrawal request not found");
  }
  if (row.fulfillment_mode === "momo") {
    throw new Error("MoMo withdrawals are not debited at back office");
  }
  if (row.status !== "pending" && row.status !== "cs_approved") {
    throw new Error("Withdrawal is not awaiting back-office debit");
  }

  const customer = await getCustomerById(context.tenantId, row.customer_id);
  if (!customer) {
    throw new Error("Customer not found");
  }

  const amount = Number(row.withdrawal_amount ?? 0);
  const withdrawable = await getCustomerWithdrawableBalance(context.tenantId, row.customer_id);
  if (withdrawable < amount) {
    throw new Error(`Insufficient withdrawable balance. Available: GHS ${withdrawable.toFixed(2)}`);
  }

  const resolvedProductId = await resolveBankProductForWithdrawalApproval(
    context.tenantId,
    bankProductId ?? row.bank_product_id ?? undefined,
    customer.homeBranchId
  );
  const transactionId = randomUUID();
  const notes = `Agency withdrawal · debit customer account · req ${disclosureId.slice(0, 8)}`;

  if (supabase) {
    const { error: rpcError } = await supabase.rpc("post_customer_transaction_atomic", {
      p_transaction_id: transactionId,
      p_tenant_id: context.tenantId,
      p_customer_id: row.customer_id,
      p_type: "withdrawal",
      p_amount: amount,
      p_transaction_branch_id: customer.homeBranchId,
      p_home_branch_id: customer.homeBranchId,
      p_recorded_by_user_id: context.userId,
      p_field_agent_id: row.field_agent_id,
      p_notes: notes
    });
    if (rpcError) {
      const { error: insertError } = await supabase.from("customer_transactions").insert({
        id: transactionId,
        tenant_id: context.tenantId,
        customer_id: row.customer_id,
        type: "withdrawal",
        amount,
        transaction_branch_id: customer.homeBranchId,
        home_branch_id: customer.homeBranchId,
        recorded_by_user_id: context.userId,
        field_agent_id: row.field_agent_id,
        notes,
        execution_status: "bank_executed",
        bank_product_id: resolvedProductId ?? row.bank_product_id ?? null
      });
      if (insertError) {
        throw new Error(`Failed to post bank withdrawal: ${insertError.message}`);
      }
      await addLedgerEntry({
        tenantId: context.tenantId,
        customerId: row.customer_id,
        transactionId,
        entryType: "debit",
        amount,
        transactionBranchId: customer.homeBranchId
      });
    } else if (resolvedProductId ?? row.bank_product_id) {
      await supabase
        .from("customer_transactions")
        .update({
          execution_status: "bank_executed",
          bank_product_id: resolvedProductId ?? row.bank_product_id
        })
        .eq("id", transactionId);
    } else {
      await supabase
        .from("customer_transactions")
        .update({ execution_status: "bank_executed" })
        .eq("id", transactionId);
    }
  }

  const now = new Date().toISOString();
  if (supabase) {
    await supabase
      .from("customer_balance_disclosures")
      .update({
        status: "bank_executed",
        bank_executed_by: context.userId,
        bank_executed_at: now,
        linked_transaction_id: transactionId,
        bank_product_id: resolvedProductId ?? row.bank_product_id ?? null
      })
      .eq("id", disclosureId);
  }

  try {
    await notifyTenantStaff({
      tenantId: context.tenantId,
      roles: ["teller", "admin"],
      kind: "withdrawal_ready_for_teller",
      customerId: row.customer_id,
      title: "Withdrawal ready for cash payout",
      body: `${customer.fullName} GHS ${amount.toFixed(2)} — Teller may pay customer after account debit.`
    });
  } catch {
    // Non-blocking
  }

  return balanceDisclosureSchema.parse({
    id: row.id,
    tenantId: row.tenant_id,
    customerId: row.customer_id,
    fieldAgentId: row.field_agent_id,
    customerName: customer.fullName,
    requestType: "withdrawal",
    status: "bank_executed",
    withdrawalAmount: amount,
    bankExecutedBy: context.userId,
    bankExecutedAt: now,
    requestedAt: row.requested_at
  });
}

export async function tellerPayWithdrawal(
  context: TransactionRequestContext,
  disclosureId: string
): Promise<BalanceDisclosure> {
  const supabase = getSupabaseAdminClient();
  const { data: row } = supabase
    ? await supabase
        .from("customer_balance_disclosures")
        .select("*")
        .eq("tenant_id", context.tenantId)
        .eq("id", disclosureId)
        .maybeSingle()
    : { data: null };

  if (!row || row.request_type !== "withdrawal") {
    throw new Error("Withdrawal request not found");
  }
  if (row.fulfillment_mode === "momo") {
    throw new Error("MoMo withdrawals are not paid at teller counter");
  }
  if (row.status !== "cs_approved" && row.status !== "bank_executed") {
    throw new Error("Withdrawal must be Customer Service verified before teller cash payout");
  }

  const customer = await getCustomerById(context.tenantId, row.customer_id);
  if (!customer) {
    throw new Error("Customer not found");
  }

  assertBranchAccess(context, customer.homeBranchId);

  const rowWorkflow =
    row.workflow_data && typeof row.workflow_data === "object"
      ? (row.workflow_data as Record<string, unknown>)
      : undefined;
  const manualPartner = isManualPartnerWithdrawal({ workflowData: rowWorkflow });

  const amount = Number(row.withdrawal_amount ?? 0);
  let transactionId = (row.linked_transaction_id as string | null) ?? null;

  if (!transactionId) {
    if (!manualPartner) {
      const withdrawable = await getCustomerWithdrawableBalance(context.tenantId, row.customer_id);
      if (withdrawable < amount) {
        throw new Error(
          `Insufficient withdrawable balance. Available: GHS ${withdrawable.toFixed(2)}`
        );
      }
    }
    transactionId = await postAgencyWithdrawalLedgerDebit(context, {
      disclosureId,
      customerId: row.customer_id,
      fieldAgentId: row.field_agent_id,
      amount,
      homeBranchId: customer.homeBranchId,
      bankProductId: row.bank_product_id ?? null,
      notesSuffix: manualPartner ? "partner walk-in payout" : "teller payout",
      skipCustomerLedgerDebit: manualPartner
    });
  }

  const payoutTx = transactionSchema.parse({
    id: transactionId,
    tenantId: context.tenantId,
    customerId: row.customer_id,
    type: "withdrawal",
    amount,
    transactionBranchId: customer.homeBranchId,
    homeBranchId: customer.homeBranchId,
    recordedByUserId: context.userId,
    fieldAgentId: row.field_agent_id,
    createdAt: new Date().toISOString(),
    notes: `Teller cash payout · req ${disclosureId.slice(0, 8)}`,
    executionStatus: "completed"
  });

  await applyTransactionToFloat(context, payoutTx);

  const now = new Date().toISOString();
  if (supabase) {
    await supabase
      .from("customer_balance_disclosures")
      .update({
        status: "completed",
        teller_paid_by: context.userId,
        teller_paid_at: now,
        paid_at: now,
        linked_transaction_id: transactionId
      })
      .eq("id", disclosureId);
  }

  return balanceDisclosureSchema.parse({
    id: row.id,
    tenantId: row.tenant_id,
    customerId: row.customer_id,
    fieldAgentId: row.field_agent_id,
    customerName: customer.fullName,
    requestType: "withdrawal",
    status: "completed",
    withdrawalAmount: amount,
    tellerPaidBy: context.userId,
    tellerPaidAt: now,
    paidAt: now,
    requestedAt: row.requested_at
  });
}
