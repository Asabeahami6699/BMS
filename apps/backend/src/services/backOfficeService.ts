import {
  backOfficeBootstrapSchema,
  createBackOfficeEcashRequestSchema,
  openBackOfficeDaySchema,
  updateBackOfficeAccountEntriesSchema,
  type BackOfficeBootstrap
} from "@bms/shared";
import { randomUUID } from "node:crypto";
import { getSupabaseAdminClient } from "../config/supabaseClient.js";
import { assertBranchAccess } from "../middleware/branchScope.js";
import { executeBankDeposit } from "./agencyBankingService.js";
import { listUsersByTenant } from "./authStore.js";
import { enrichTransactionsWithBankProducts, getBankProductById, listBankProducts } from "./bankProductService.js";
import { listCustomers } from "./customerService.js";
import { createAgentNotification, notifyTenantStaff } from "./notificationService.js";
import { resolveBranchId } from "./branchService.js";
import type { TransactionRequestContext } from "./transactionService.js";
import { userDisplayName } from "./userNameResolver.js";

function todayDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function businessDateFromIso(iso: string): string {
  return iso.slice(0, 10);
}

async function resolveSession(
  tenantId: string,
  branchId: string,
  businessDate: string
): Promise<{ id: string; status: string } | null> {
  const supabase = getSupabaseAdminClient();
  if (!supabase) return null;
  const { data } = await supabase
    .from("back_office_day_sessions")
    .select("id, status")
    .eq("tenant_id", tenantId)
    .eq("branch_id", branchId)
    .eq("business_date", businessDate)
    .maybeSingle();
  return data ? { id: String(data.id), status: String(data.status) } : null;
}

async function sumExecutedByAccount(
  tenantId: string,
  branchId: string,
  businessDate: string,
  executionBankProductId: string
): Promise<number> {
  const supabase = getSupabaseAdminClient();
  if (!supabase) return 0;
  const dayStart = `${businessDate}T00:00:00.000Z`;
  const dayEnd = `${businessDate}T23:59:59.999Z`;
  const { data } = await supabase
    .from("customer_transactions")
    .select("amount")
    .eq("tenant_id", tenantId)
    .eq("transaction_branch_id", branchId)
    .eq("type", "deposit")
    .eq("execution_status", "completed")
    .eq("execution_bank_product_id", executionBankProductId)
    .gte("bank_executed_at", dayStart)
    .lte("bank_executed_at", dayEnd);
  return (data ?? []).reduce((sum, row) => sum + Number(row.amount ?? 0), 0);
}

export async function getBackOfficeBootstrap(
  context: TransactionRequestContext,
  options?: { branchId?: string; businessDate?: string }
): Promise<BackOfficeBootstrap> {
  const businessDate = options?.businessDate?.trim() || todayDate();
  let branchId = options?.branchId
    ? await resolveBranchId(context.tenantId, options.branchId)
    : undefined;
  if (!branchId && context.scopeType === "branch" && context.branchId) {
    branchId = await resolveBranchId(context.tenantId, context.branchId);
  }
  if (!branchId) {
    throw new Error("Select a branch for back office");
  }
  assertBranchAccess(context, branchId);

  const products = await listBankProducts(context.tenantId, { activeOnly: true });
  const companyAccounts = products
    .filter((p) => p.isCompanyBankAccount)
    .map((p) => ({
      id: p.id,
      name: p.name,
      bankLabel: p.bankLabel,
      executionLimitAmount: p.executionLimitAmount ?? null
    }));

  const supabase = getSupabaseAdminClient();
  const session = await resolveSession(context.tenantId, branchId, businessDate);

  const users = listUsersByTenant(context.tenantId);
  const nameById = new Map(
    users.map((u) => [u.id, userDisplayName(u.fullName, u.email, u.id)])
  );

  let depositRows: Record<string, unknown>[] = [];
  if (supabase) {
    const { data } = await supabase
      .from("customer_transactions")
      .select("*")
      .eq("tenant_id", context.tenantId)
      .eq("transaction_branch_id", branchId)
      .eq("type", "deposit")
      .in("execution_status", ["pending_bank", "pending_accountant"])
      .order("created_at", { ascending: false })
      .limit(200);
    depositRows = data ?? [];
  }

  const customers = await listCustomers(context.tenantId, { branchId, light: true });
  const customerById = new Map(customers.map((c) => [c.id, c]));

  const depositQueue = await enrichTransactionsWithBankProducts(
    context.tenantId,
    depositRows.map((row) => ({
      id: String(row.id),
      customerId: String(row.customer_id),
      customerName: customerById.get(String(row.customer_id))?.fullName,
      amount: Number(row.amount),
      transactionBranchId: String(row.transaction_branch_id),
      recordedByUserId: String(row.recorded_by_user_id),
      recordedByName: nameById.get(String(row.recorded_by_user_id)),
      createdAt: String(row.created_at),
      notes: row.notes != null ? String(row.notes) : undefined,
      bankProductId: row.bank_product_id != null ? String(row.bank_product_id) : undefined,
      executionStatus: String(row.execution_status ?? "pending_bank") as
        | "pending_bank"
        | "pending_accountant",
      workflowData:
        row.workflow_data && typeof row.workflow_data === "object"
          ? (row.workflow_data as Record<string, unknown>)
          : undefined
    }))
  );

  const accountBalances = [];
  if (session) {
    const { data: openings } = await supabase!
      .from("back_office_account_opening")
      .select("*")
      .eq("session_id", session.id);
    for (const opening of openings ?? []) {
      const productId = String(opening.bank_product_id);
      const product = products.find((p) => p.id === productId);
      const openingBalance = Number(opening.opening_balance ?? 0);
      const extraCash = Number(opening.extra_cash ?? 0);
      const computedTotalEntries = await sumExecutedByAccount(
        context.tenantId,
        branchId,
        businessDate,
        productId
      );
      const manualTotalEntries =
        opening.manual_total_entries != null ? Number(opening.manual_total_entries) : null;
      const totalEntries = manualTotalEntries ?? computedTotalEntries;
      accountBalances.push({
        bankProductId: productId,
        accountName: product?.name ?? productId,
        bankLabel: product?.bankLabel ?? "—",
        openingBalance,
        extraCash,
        computedTotalEntries,
        manualTotalEntries,
        totalEntries,
        closingBalance: openingBalance + extraCash - totalEntries
      });
    }
  }

  let tellerDeposits: Record<string, unknown>[] = [];
  let executedDeposits: Record<string, unknown>[] = [];
  if (supabase) {
    const dayStart = `${businessDate}T00:00:00.000Z`;
    const dayEnd = `${businessDate}T23:59:59.999Z`;
    const { data: tellerRows } = await supabase
      .from("customer_transactions")
      .select("recorded_by_user_id, amount")
      .eq("tenant_id", context.tenantId)
      .eq("transaction_branch_id", branchId)
      .eq("type", "deposit")
      .gte("created_at", dayStart)
      .lte("created_at", dayEnd);
    tellerDeposits = tellerRows ?? [];

    const { data: executedRows } = await supabase
      .from("customer_transactions")
      .select("recorded_by_user_id, amount")
      .eq("tenant_id", context.tenantId)
      .eq("transaction_branch_id", branchId)
      .eq("type", "deposit")
      .eq("execution_status", "completed")
      .gte("bank_executed_at", dayStart)
      .lte("bank_executed_at", dayEnd);
    executedDeposits = executedRows ?? [];
  }

  const tellerMap = new Map<string, { deposits: number; count: number }>();
  for (const row of tellerDeposits) {
    const id = String(row.recorded_by_user_id);
    const prev = tellerMap.get(id) ?? { deposits: 0, count: 0 };
    tellerMap.set(id, {
      deposits: prev.deposits + Number(row.amount ?? 0),
      count: prev.count + 1
    });
  }

  const executedMap = new Map<string, { amount: number; count: number }>();
  for (const row of executedDeposits) {
    const id = String(row.recorded_by_user_id);
    const prev = executedMap.get(id) ?? { amount: 0, count: 0 };
    executedMap.set(id, {
      amount: prev.amount + Number(row.amount ?? 0),
      count: prev.count + 1
    });
  }

  const tellerIds = new Set([...tellerMap.keys(), ...executedMap.keys()]);
  const tellerReconciliation = [...tellerIds].map((tellerUserId) => {
    const teller = tellerMap.get(tellerUserId) ?? { deposits: 0, count: 0 };
    const executed = executedMap.get(tellerUserId) ?? { amount: 0, count: 0 };
    return {
      tellerUserId,
      tellerName: nameById.get(tellerUserId) ?? tellerUserId,
      tellerDeposits: teller.deposits,
      backOfficeExecuted: executed.amount,
      difference: teller.deposits - executed.amount,
      depositCount: teller.count,
      executedCount: executed.count
    };
  });

  let ecashRequests: BackOfficeBootstrap["ecashRequests"] = [];
  if (supabase) {
    const { data } = await supabase
      .from("back_office_ecash_requests")
      .select("*")
      .eq("tenant_id", context.tenantId)
      .eq("branch_id", branchId)
      .order("created_at", { ascending: false })
      .limit(50);
    ecashRequests = (data ?? []).map((row) => ({
      id: String(row.id),
      branchId: String(row.branch_id),
      bankProductId: row.bank_product_id != null ? String(row.bank_product_id) : undefined,
      amount: Number(row.amount),
      status: row.status as "pending" | "approved" | "rejected",
      notes: row.notes != null ? String(row.notes) : undefined,
      requestedByUserId: String(row.requested_by_user_id),
      requestedByName: nameById.get(String(row.requested_by_user_id)),
      createdAt: String(row.created_at)
    }));
  }

  const pendingAccountantCount = depositQueue.filter(
    (d) => d.executionStatus === "pending_accountant"
  ).length;

  return backOfficeBootstrapSchema.parse({
    businessDate,
    branchId,
    sessionId: session?.id ?? null,
    sessionOpen: session?.status === "open",
    companyAccounts,
    depositQueue,
    accountBalances,
    tellerReconciliation,
    ecashRequests,
    pendingEcashCount: ecashRequests.filter((r) => r.status === "pending").length,
    pendingAccountantCount
  });
}

export async function openBackOfficeDay(
  context: TransactionRequestContext,
  input: unknown
): Promise<BackOfficeBootstrap> {
  const payload = openBackOfficeDaySchema.parse(input ?? {});
  const branchId = await resolveBranchId(context.tenantId, payload.branchId);
  if (!branchId) {
    throw new Error("Branch not found");
  }
  assertBranchAccess(context, branchId);

  const supabase = getSupabaseAdminClient();
  if (!supabase) {
    throw new Error("Back office day opening requires database");
  }

  for (const opening of payload.openings) {
    const product = await getBankProductById(context.tenantId, opening.bankProductId);
    if (!product?.isCompanyBankAccount) {
      throw new Error(`${product?.name ?? "Product"} is not marked as a company bank account`);
    }
  }

  const { data: session, error: sessionError } = await supabase
    .from("back_office_day_sessions")
    .upsert(
      {
        tenant_id: context.tenantId,
        branch_id: branchId,
        business_date: payload.businessDate,
        opened_by_user_id: context.userId,
        status: "open"
      },
      { onConflict: "tenant_id,branch_id,business_date" }
    )
    .select("id")
    .single();
  if (sessionError) {
    throw new Error(`Failed to open back office day: ${sessionError.message}`);
  }

  for (const opening of payload.openings) {
    const { error } = await supabase.from("back_office_account_opening").upsert(
      {
        session_id: session.id,
        bank_product_id: opening.bankProductId,
        opening_balance: opening.openingBalance,
        extra_cash: opening.extraCash ?? 0,
        notes: opening.notes ?? null
      },
      { onConflict: "session_id,bank_product_id" }
    );
    if (error) {
      throw new Error(`Failed to save opening balance: ${error.message}`);
    }
  }

  return getBackOfficeBootstrap(context, {
    branchId,
    businessDate: payload.businessDate
  });
}

export async function updateBackOfficeAccountEntries(
  context: TransactionRequestContext,
  input: unknown
): Promise<BackOfficeBootstrap> {
  const payload = updateBackOfficeAccountEntriesSchema.parse(input ?? {});
  const supabase = getSupabaseAdminClient();
  if (!supabase) {
    throw new Error("Database required");
  }

  const businessDate = todayDate();
  const branchId =
    context.scopeType === "branch" && context.branchId
      ? await resolveBranchId(context.tenantId, context.branchId)
      : undefined;
  if (!branchId) {
    throw new Error("Branch scope required");
  }

  const session = await resolveSession(context.tenantId, branchId, businessDate);
  if (!session) {
    throw new Error("Open the back office day before recording total entries");
  }

  const { error } = await supabase
    .from("back_office_account_opening")
    .update({ manual_total_entries: payload.manualTotalEntries })
    .eq("session_id", session.id)
    .eq("bank_product_id", payload.bankProductId);
  if (error) {
    throw new Error(`Failed to update total entries: ${error.message}`);
  }

  return getBackOfficeBootstrap(context, { branchId, businessDate });
}

export async function createBackOfficeEcashRequest(
  context: TransactionRequestContext,
  input: unknown
): Promise<BackOfficeBootstrap> {
  const payload = createBackOfficeEcashRequestSchema.parse(input ?? {});
  const branchId = await resolveBranchId(context.tenantId, payload.branchId);
  if (!branchId) {
    throw new Error("Branch not found");
  }
  assertBranchAccess(context, branchId);

  const supabase = getSupabaseAdminClient();
  if (!supabase) {
    throw new Error("Database required");
  }

  const session = await resolveSession(context.tenantId, branchId, todayDate());
  const id = randomUUID();
  const { error } = await supabase.from("back_office_ecash_requests").insert({
    id,
    tenant_id: context.tenantId,
    branch_id: branchId,
    session_id: session?.id ?? null,
    bank_product_id: payload.bankProductId ?? null,
    requested_by_user_id: context.userId,
    amount: payload.amount,
    status: "pending",
    notes: payload.notes ?? null
  });
  if (error) {
    throw new Error(`Failed to request ecash: ${error.message}`);
  }

  try {
    await notifyTenantStaff({
      tenantId: context.tenantId,
      roles: ["accountant", "admin"],
      kind: "back_office_ecash_requested",
      title: "Back office ecash request",
      body: `GHS ${payload.amount.toFixed(2)} requested — allocate or approve ecash.`
    });
  } catch {
    /* non-blocking */
  }

  return getBackOfficeBootstrap(context, { branchId });
}

export async function approveBackOfficeEcashRequest(
  context: TransactionRequestContext,
  requestId: string,
  approve: boolean
): Promise<BackOfficeBootstrap> {
  const supabase = getSupabaseAdminClient();
  if (!supabase) {
    throw new Error("Database required");
  }

  const { data: row } = await supabase
    .from("back_office_ecash_requests")
    .select("*")
    .eq("tenant_id", context.tenantId)
    .eq("id", requestId)
    .maybeSingle();
  if (!row || row.status !== "pending") {
    throw new Error("Ecash request not found or already reviewed");
  }

  const now = new Date().toISOString();
  const status = approve ? "approved" : "rejected";
  const { error } = await supabase
    .from("back_office_ecash_requests")
    .update({
      status,
      reviewed_by_user_id: context.userId,
      reviewed_at: now
    })
    .eq("id", requestId);
  if (error) {
    throw new Error(`Failed to review ecash request: ${error.message}`);
  }

  if (approve && row.bank_product_id && row.session_id) {
    const { data: opening } = await supabase
      .from("back_office_account_opening")
      .select("extra_cash")
      .eq("session_id", row.session_id)
      .eq("bank_product_id", row.bank_product_id)
      .maybeSingle();
    const nextExtra = Number(opening?.extra_cash ?? 0) + Number(row.amount);
    await supabase
      .from("back_office_account_opening")
      .update({ extra_cash: nextExtra })
      .eq("session_id", row.session_id)
      .eq("bank_product_id", row.bank_product_id);
  }

  try {
    await createAgentNotification({
      tenantId: context.tenantId,
      userId: String(row.requested_by_user_id),
      kind: approve ? "back_office_ecash_approved" : "workspace_activity",
      title: approve ? "Ecash approved" : "Ecash request declined",
      body: approve
        ? `GHS ${Number(row.amount).toFixed(2)} ecash has been added to your account opening.`
        : "Your ecash request was declined. Contact the accountant."
    });
  } catch {
    /* non-blocking */
  }

  return getBackOfficeBootstrap(context, { branchId: String(row.branch_id) });
}

export async function approveAccountantDeposit(
  context: TransactionRequestContext,
  transactionId: string
): Promise<void> {
  const supabase = getSupabaseAdminClient();
  if (!supabase) {
    throw new Error("Database required");
  }

  const { data: row } = await supabase
    .from("customer_transactions")
    .select("*")
    .eq("tenant_id", context.tenantId)
    .eq("id", transactionId)
    .maybeSingle();
  if (!row || row.execution_status !== "pending_accountant") {
    throw new Error("Deposit is not awaiting accountant approval");
  }

  const now = new Date().toISOString();
  const { error } = await supabase
    .from("customer_transactions")
    .update({
      execution_status: "pending_bank",
      accountant_approved_by: context.userId,
      accountant_approved_at: now
    })
    .eq("id", transactionId);
  if (error) {
    throw new Error(`Failed to approve deposit: ${error.message}`);
  }

  try {
    await notifyTenantStaff({
      tenantId: context.tenantId,
      roles: ["back_officer", "admin"],
      kind: "deposit_pending_bank",
      customerId: String(row.customer_id),
      title: "Large deposit approved — execute at bank",
      body: `GHS ${Number(row.amount).toFixed(2)} approved by accountant — ready for bank execution.`
    });
  } catch {
    /* non-blocking */
  }
}

export async function executeBackOfficeDeposit(
  context: TransactionRequestContext,
  transactionId: string,
  executionBankProductId: string
): Promise<BackOfficeBootstrap> {
  const product = await getBankProductById(context.tenantId, executionBankProductId);
  if (!product?.isCompanyBankAccount) {
    throw new Error("Select a valid company bank account for execution");
  }

  const supabase = getSupabaseAdminClient();
  if (supabase) {
    const { data: row } = await supabase
      .from("customer_transactions")
      .select("execution_status, transaction_branch_id")
      .eq("tenant_id", context.tenantId)
      .eq("id", transactionId)
      .maybeSingle();
    if (!row) {
      throw new Error("Deposit not found");
    }
    if (row.execution_status === "pending_accountant") {
      throw new Error("Accountant must approve this deposit before bank execution");
    }
    if (row.execution_status !== "pending_bank") {
      throw new Error("Only pending teller deposits can be marked done");
    }

    await supabase
      .from("customer_transactions")
      .update({ execution_bank_product_id: executionBankProductId })
      .eq("id", transactionId);
  }

  const result = await executeBankDeposit(context, transactionId);

  try {
    await createAgentNotification({
      tenantId: context.tenantId,
      userId: result.recordedByUserId,
      kind: "deposit_completed",
      customerId: result.customerId,
      title: "Deposit completed at bank",
      body: `GHS ${result.amount.toFixed(2)} — back office marked done. Customer account credited.`
    });
  } catch {
    /* non-blocking */
  }

  return getBackOfficeBootstrap(context, {
    branchId: result.transactionBranchId
  });
}
