import {
  backOfficeBootstrapSchema,
  createBackOfficeEcashRequestSchema,
  openBackOfficeDaySchema,
  resolveAgencyDepositCustomerName,
  updateBackOfficeAccountEntriesSchema,
  type BackOfficeBootstrap
} from "@bms/shared";
import { randomUUID } from "node:crypto";
import { getSupabaseAdminClient } from "../config/supabaseClient.js";
import { assertBranchAccess } from "../middleware/branchScope.js";
import { executeBankDeposit } from "./agencyBankingService.js";
import { fetchTenantUserNameMap } from "./userNameResolver.js";
import { enrichTransactionsWithBankProducts, getBankProductById, listBankProducts } from "./bankProductService.js";
import { listCustomers } from "./customerService.js";
import { createAgentNotification, notifyTenantStaff } from "./notificationService.js";
import { listBranches, resolveBranchId } from "./branchService.js";
import { assertCompanyAccountCanExecute } from "./companyAccountLimitService.js";
import { resolveCompanyAccountExecutionLimit } from "@bms/shared";
import type { TransactionRequestContext } from "./transactionService.js";

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

async function sumExecutedByAccountsBatch(
  tenantId: string,
  branchId: string,
  businessDate: string,
  executionBankProductIds: string[]
): Promise<Map<string, number>> {
  const totals = new Map<string, number>();
  for (const id of executionBankProductIds) {
    totals.set(id, 0);
  }
  if (executionBankProductIds.length === 0) {
    return totals;
  }
  const supabase = getSupabaseAdminClient();
  if (!supabase) {
    return totals;
  }
  const dayStart = `${businessDate}T00:00:00.000Z`;
  const dayEnd = `${businessDate}T23:59:59.999Z`;
  const { data } = await supabase
    .from("customer_transactions")
    .select("execution_bank_product_id, amount")
    .eq("tenant_id", tenantId)
    .eq("transaction_branch_id", branchId)
    .eq("type", "deposit")
    .eq("execution_status", "completed")
    .in("execution_bank_product_id", executionBankProductIds)
    .gte("bank_executed_at", dayStart)
    .lte("bank_executed_at", dayEnd);
  for (const row of data ?? []) {
    const productId = String(row.execution_bank_product_id);
    totals.set(productId, (totals.get(productId) ?? 0) + Number(row.amount ?? 0));
  }
  return totals;
}

const RECON_KEY_SEP = "\u001f";

function reconKey(branchId: string, tellerUserId: string): string {
  return `${branchId}${RECON_KEY_SEP}${tellerUserId}`;
}

function tellerUserIdFromReconKey(key: string): string {
  const idx = key.indexOf(RECON_KEY_SEP);
  return idx >= 0 ? key.slice(idx + 1) : key;
}

function isAllBranchesRequest(branchId?: string): boolean {
  return branchId?.trim().toLowerCase() === "all";
}

export async function getBackOfficeBootstrap(
  context: TransactionRequestContext,
  options?: { branchId?: string; businessDate?: string }
): Promise<BackOfficeBootstrap> {
  const businessDate = options?.businessDate?.trim() || todayDate();
  const rawBranchId = options?.branchId?.trim();
  const viewAllBranches =
    context.scopeType === "head_office" && (!rawBranchId || isAllBranchesRequest(rawBranchId));

  let branchId: string | undefined;
  if (viewAllBranches) {
    branchId = "all";
  } else {
    branchId = rawBranchId
      ? await resolveBranchId(context.tenantId, rawBranchId)
      : undefined;
    if (!branchId && context.scopeType === "branch" && context.branchId) {
      branchId = await resolveBranchId(context.tenantId, context.branchId);
    }
    if (!branchId) {
      throw new Error("Select a branch for back office");
    }
    assertBranchAccess(context, branchId);
  }

  const [branches, products, customers] = await Promise.all([
    listBranches(context.tenantId).catch(() => []),
    listBankProducts(context.tenantId, { activeOnly: true }),
    listCustomers(context.tenantId, { light: true })
  ]);
  const branchById = new Map(branches.map((b) => [b.id, b]));
  const customerById = new Map(customers.map((c) => [c.id, c]));
  const operationalBranchId = viewAllBranches ? undefined : branchId;
  const companyAccounts = products
    .filter((p) => p.isCompanyBankAccount)
    .filter((p) => {
      if (!operationalBranchId) {
        return true;
      }
      return p.branchId == null || p.branchId === operationalBranchId;
    })
    .map((p) => ({
      id: p.id,
      name: p.name,
      bankLabel: p.bankLabel,
      branchId: p.branchId ?? null,
      branchName: p.branchName,
      executionLimitAmount: p.executionLimitAmount ?? null
    }));

  const supabase = getSupabaseAdminClient();
  const dayStart = `${businessDate}T00:00:00.000Z`;
  const dayEnd = `${businessDate}T23:59:59.999Z`;

  const sessionPromise = operationalBranchId
    ? resolveSession(context.tenantId, operationalBranchId, businessDate)
    : Promise.resolve(null);

  const pendingDepositsPromise = (async () => {
    if (!supabase) {
      return [] as Record<string, unknown>[];
    }
    let query = supabase
      .from("customer_transactions")
      .select("*")
      .eq("tenant_id", context.tenantId)
      .eq("type", "deposit")
      .in("execution_status", ["pending_bank", "pending_accountant"])
      .order("created_at", { ascending: false })
      .limit(200);
    if (operationalBranchId) {
      query = query.eq("transaction_branch_id", operationalBranchId);
    }
    const { data } = await query;
    return data ?? [];
  })();

  const tellerDepositsPromise = (async () => {
    if (!supabase) {
      return [] as Record<string, unknown>[];
    }
    let query = supabase
      .from("customer_transactions")
      .select("recorded_by_user_id, transaction_branch_id, amount")
      .eq("tenant_id", context.tenantId)
      .eq("type", "deposit")
      .gte("created_at", dayStart)
      .lte("created_at", dayEnd);
    if (operationalBranchId) {
      query = query.eq("transaction_branch_id", operationalBranchId);
    }
    const { data } = await query;
    return data ?? [];
  })();

  const executedDepositsPromise = (async () => {
    if (!supabase) {
      return [] as Record<string, unknown>[];
    }
    let query = supabase
      .from("customer_transactions")
      .select("recorded_by_user_id, transaction_branch_id, amount")
      .eq("tenant_id", context.tenantId)
      .eq("type", "deposit")
      .eq("execution_status", "completed")
      .gte("bank_executed_at", dayStart)
      .lte("bank_executed_at", dayEnd);
    if (operationalBranchId) {
      query = query.eq("transaction_branch_id", operationalBranchId);
    }
    const { data } = await query;
    return data ?? [];
  })();

  const userNamesPromise = fetchTenantUserNameMap(context.tenantId);

  const executedTotalsPromise =
    operationalBranchId && companyAccounts.length > 0
      ? sumExecutedByAccountsBatch(
          context.tenantId,
          operationalBranchId,
          businessDate,
          companyAccounts.map((account) => account.id)
        )
      : Promise.resolve(new Map<string, number>());

  const ecashRowsPromise = (async () => {
    if (!supabase) {
      return [] as Record<string, unknown>[];
    }
    let query = supabase
      .from("back_office_ecash_requests")
      .select("*")
      .eq("tenant_id", context.tenantId)
      .order("created_at", { ascending: false })
      .limit(50);
    if (operationalBranchId) {
      query = query.eq("branch_id", operationalBranchId);
    }
    const { data } = await query;
    return data ?? [];
  })();

  const [
    session,
    depositRows,
    tellerDeposits,
    executedDeposits,
    ecashRows,
    nameById,
    executedTotalsByAccount
  ] = await Promise.all([
    sessionPromise,
    pendingDepositsPromise,
    tellerDepositsPromise,
    executedDepositsPromise,
    ecashRowsPromise,
    userNamesPromise,
    executedTotalsPromise
  ]);

  const openingsPromise =
    session && supabase
      ? supabase
          .from("back_office_account_opening")
          .select("*")
          .eq("session_id", session.id)
          .then((result) => result.data ?? [])
      : Promise.resolve([] as Record<string, unknown>[]);

  const [depositQueue, openings] = await Promise.all([
    enrichTransactionsWithBankProducts(
    context.tenantId,
    depositRows.map((row) => {
      const workflow =
        row.workflow_data && typeof row.workflow_data === "object"
          ? (row.workflow_data as Record<string, unknown>)
          : undefined;
      const transactionBranchId = String(row.transaction_branch_id);
      const branch = branchById.get(transactionBranchId);
      const partnerAccountNumber =
        typeof workflow?.account_number === "string" ? workflow.account_number : undefined;
      return {
        id: String(row.id),
        customerId: String(row.customer_id),
        customerName: resolveAgencyDepositCustomerName({
          customerFullName: customerById.get(String(row.customer_id))?.fullName,
          workflow
        }),
        amount: Number(row.amount),
        transactionBranchId,
        branchName: branch?.name,
        branchCode: branch?.code,
        recordedByUserId: String(row.recorded_by_user_id),
        recordedByName: nameById.get(String(row.recorded_by_user_id)),
        createdAt: String(row.created_at),
        notes: row.notes != null ? String(row.notes) : undefined,
        bankProductId: row.bank_product_id != null ? String(row.bank_product_id) : undefined,
        executionStatus: String(row.execution_status ?? "pending_bank") as
          | "pending_bank"
          | "pending_accountant",
        partnerAccountNumber,
        workflowData: workflow
      };
    })
  ),
    openingsPromise
  ]);

  const openingsByProduct = new Map(
    openings.map((opening) => [String(opening.bank_product_id), opening])
  );
  const accountBalances = [];
  if (operationalBranchId) {
    for (const account of companyAccounts) {
      const opening = openingsByProduct.get(account.id);
      const openingBalance = opening ? Number(opening.opening_balance ?? 0) : 0;
      const extraCash = opening ? Number(opening.extra_cash ?? 0) : 0;
      const computedTotalEntries = executedTotalsByAccount.get(account.id) ?? 0;
      const manualTotalEntries =
        opening?.manual_total_entries != null ? Number(opening.manual_total_entries) : null;
      const totalEntries = computedTotalEntries;
      const executionLimit = resolveCompanyAccountExecutionLimit(account.executionLimitAmount);
      const headroom = Math.max(0, executionLimit - totalEntries);
      accountBalances.push({
        bankProductId: account.id,
        accountName: account.name,
        bankLabel: account.bankLabel,
        openingBalance,
        extraCash,
        computedTotalEntries,
        manualTotalEntries,
        totalEntries,
        closingBalance: openingBalance + extraCash - totalEntries,
        executionLimit,
        headroom,
        limitReached: totalEntries >= executionLimit
      });
    }
  }

  const tellerMap = new Map<string, { deposits: number; count: number; branchId: string }>();
  for (const row of tellerDeposits) {
    const tellerUserId = String(row.recorded_by_user_id);
    const rowBranchId = String(row.transaction_branch_id);
    const key = reconKey(rowBranchId, tellerUserId);
    const prev = tellerMap.get(key) ?? { deposits: 0, count: 0, branchId: rowBranchId };
    tellerMap.set(key, {
      deposits: prev.deposits + Number(row.amount ?? 0),
      count: prev.count + 1,
      branchId: rowBranchId
    });
  }

  const executedMap = new Map<string, { amount: number; count: number; branchId: string }>();
  for (const row of executedDeposits) {
    const tellerUserId = String(row.recorded_by_user_id);
    const rowBranchId = String(row.transaction_branch_id);
    const key = reconKey(rowBranchId, tellerUserId);
    const prev = executedMap.get(key) ?? { amount: 0, count: 0, branchId: rowBranchId };
    executedMap.set(key, {
      amount: prev.amount + Number(row.amount ?? 0),
      count: prev.count + 1,
      branchId: rowBranchId
    });
  }

  const reconKeys = new Set([...tellerMap.keys(), ...executedMap.keys()]);
  const tellerReconciliation = [...reconKeys].map((key) => {
    const tellerUserId = tellerUserIdFromReconKey(key);
    const branchIdKey = tellerMap.get(key)?.branchId ?? executedMap.get(key)?.branchId ?? "";
    const branch = branchById.get(branchIdKey);
    const teller = tellerMap.get(key) ?? { deposits: 0, count: 0, branchId: branchIdKey };
    const executed = executedMap.get(key) ?? { amount: 0, count: 0, branchId: branchIdKey };
    return {
      tellerUserId,
      tellerName: nameById.get(tellerUserId) ?? tellerUserId,
      branchId: branchIdKey || undefined,
      branchName: branch?.name,
      branchCode: branch?.code,
      tellerDeposits: teller.deposits,
      backOfficeExecuted: executed.amount,
      difference: teller.deposits - executed.amount,
      depositCount: teller.count,
      executedCount: executed.count
    };
  });

  const ecashRequests: BackOfficeBootstrap["ecashRequests"] = ecashRows.map((row) => ({
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

  const pendingAccountantCount = depositQueue.filter(
    (d) => d.executionStatus === "pending_accountant"
  ).length;

  return backOfficeBootstrapSchema.parse({
    businessDate,
    branchId: operationalBranchId ?? "all",
    viewAllBranches,
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
  let transactionBranchId = "";
  let transactionAmount = 0;
  if (supabase) {
    const { data: row } = await supabase
      .from("customer_transactions")
      .select("execution_status, transaction_branch_id, amount")
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
    transactionBranchId = String(row.transaction_branch_id);
    transactionAmount = Number(row.amount ?? 0);
    const businessDate = todayDate();
    await assertCompanyAccountCanExecute(
      context.tenantId,
      transactionBranchId,
      businessDate,
      executionBankProductId,
      transactionAmount
    );

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
