import { randomUUID } from "node:crypto";
import {
  INSTITUTIONAL_INCOME_SOURCE_LABELS,
  formatAccountAmount,
  incomePeriodDateRange,
  institutionalIncomeCapitalTransferSchema,
  institutionalIncomeEntrySchema,
  institutionalIncomeReportSchema,
  reverseInstitutionalIncomeCapitalTransferSchema,
  transferInstitutionalIncomeToCapitalSchema,
  type BranchIncomeAccount,
  type IncomeReportPeriod,
  type InstitutionalIncomeCapitalTransfer,
  type InstitutionalIncomeEntry,
  type InstitutionalIncomeReport,
  type InstitutionalIncomeSource,
  type PostInstitutionalIncomeInput,
  type ReverseInstitutionalIncomeInput
} from "@bms/shared";
import { getSupabaseAdminClient } from "../config/supabaseClient.js";
import { branchDisplayLabel, listBranches } from "./branchService.js";
import {
  recordMemoryIncomeAllocationCapitalEntry,
  voidMemoryCapitalEntryById
} from "./branchCapitalService.js";
import { notifyTenantStaff } from "./notificationService.js";
import { fetchTenantUserNameMap } from "./userNameResolver.js";

type RequestContext = {
  userId: string;
  tenantId: string;
  role: string;
  permissions?: string[];
  scopeType?: "head_office" | "branch";
  branchId?: string;
};

const memoryAccounts = new Map<string, BranchIncomeAccount[]>();
const memoryEntries = new Map<string, InstitutionalIncomeEntry[]>();
const memoryCapitalTransfers = new Map<string, InstitutionalIncomeCapitalTransfer[]>();

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

function isMissingCapitalTransferStorage(message: string): boolean {
  return /institutional_income_capital_transfers|transfer_institutional_income_to_capital_atomic|reverse_institutional_income_capital_transfer_atomic|does not exist|schema cache|could not find the (table|function)/i.test(
    message
  );
}

export function clearMemoryInstitutionalIncome(tenantId?: string): void {
  if (tenantId) {
    memoryAccounts.delete(tenantId);
    memoryEntries.delete(tenantId);
    memoryCapitalTransfers.delete(tenantId);
  } else {
    memoryAccounts.clear();
    memoryEntries.clear();
    memoryCapitalTransfers.clear();
  }
}

function mapTransfer(
  row: Record<string, unknown>,
  meta?: { branchName?: string | null; incomeAccountLabel?: string | null }
): InstitutionalIncomeCapitalTransfer {
  return institutionalIncomeCapitalTransferSchema.parse({
    id: row.id,
    tenantId: row.tenant_id,
    branchId: row.branch_id,
    branchName: meta?.branchName ?? (row.branch_name != null ? String(row.branch_name) : null),
    incomeAccountId: row.income_account_id,
    incomeAccountLabel:
      meta?.incomeAccountLabel ??
      (row.income_account_label != null ? String(row.income_account_label) : null),
    capitalEntryId: row.capital_entry_id,
    amount: roundMoney(Number(row.amount ?? 0)),
    businessDate: String(row.business_date).slice(0, 10),
    reference: String(row.reference),
    idempotencyKey: String(row.idempotency_key),
    notes: row.notes != null ? String(row.notes) : null,
    authorizedByUserId: String(row.authorized_by_user_id),
    authorizedByName: row.authorized_by_name != null ? String(row.authorized_by_name) : null,
    reversedAt: row.reversed_at != null ? String(row.reversed_at) : null,
    reversedByUserId: row.reversed_by_user_id != null ? String(row.reversed_by_user_id) : null,
    reversedByName: row.reversed_by_name != null ? String(row.reversed_by_name) : null,
    reversalReason: row.reversal_reason != null ? String(row.reversal_reason) : null,
    createdAt: String(row.created_at ?? new Date().toISOString())
  });
}

function accountsKey(tenantId: string): string {
  return tenantId;
}

function mapAccount(row: Record<string, unknown>): BranchIncomeAccount {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    branchId: String(row.branch_id),
    label: String(row.label),
    currency: String(row.currency ?? "GHS"),
    balance: Number(row.balance ?? 0),
    isActive: row.is_active !== false,
    createdAt: String(row.created_at ?? new Date().toISOString()),
    updatedAt: row.updated_at ? String(row.updated_at) : undefined
  };
}

function mapEntry(row: Record<string, unknown>): InstitutionalIncomeEntry {
  return institutionalIncomeEntrySchema.parse({
    id: row.id,
    tenantId: row.tenant_id,
    branchId: row.branch_id,
    incomeAccountId: row.income_account_id,
    source: row.source,
    amount: Number(row.amount),
    businessDate: row.business_date,
    customerId: row.customer_id ?? null,
    transactionId: row.transaction_id ?? null,
    notes: row.notes ?? null,
    idempotencyKey: row.idempotency_key,
    recordedByUserId: row.recorded_by_user_id,
    reversesEntryId: row.reverses_entry_id ?? null,
    reversedAt: row.reversed_at ?? null,
    reversedByEntryId: row.reversed_by_entry_id ?? null,
    reversalReason: row.reversal_reason ?? null,
    createdAt: row.created_at
  });
}

function incomeLabelForModules(susuOnly: boolean, branchName: string): string {
  return susuOnly ? `${branchName} Susu income` : `${branchName} Institutional income`;
}

export function callerHasFullIncomeAccess(permissions: string[] | undefined): boolean {
  return Boolean(permissions?.includes("income.read"));
}

export function callerHasDailyIncomeAccess(permissions: string[] | undefined): boolean {
  return Boolean(permissions?.includes("income.read") || permissions?.includes("income.read.daily"));
}

export function resolveAllowedIncomePeriods(permissions: string[] | undefined): IncomeReportPeriod[] {
  if (permissions?.includes("income.read")) {
    return ["daily", "weekly", "monthly", "yearly"];
  }
  if (permissions?.includes("income.read.daily")) {
    return ["daily"];
  }
  return [];
}

async function ensureBranchIncomeAccount(
  tenantId: string,
  branchId: string,
  branchName: string,
  susuOnly: boolean
): Promise<BranchIncomeAccount> {
  const supabase = getSupabaseAdminClient();
  const label = incomeLabelForModules(susuOnly, branchName);

  if (!supabase) {
    const key = accountsKey(tenantId);
    const list = memoryAccounts.get(key) ?? [];
    const existing = list.find((a) => a.branchId === branchId && a.isActive);
    if (existing) {
      return existing;
    }
    const created: BranchIncomeAccount = {
      id: randomUUID(),
      tenantId,
      branchId,
      label,
      currency: "GHS",
      balance: 0,
      isActive: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    memoryAccounts.set(key, [...list, created]);
    return created;
  }

  const { data: existing, error: loadError } = await supabase
    .from("branch_income_accounts")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("branch_id", branchId)
    .eq("is_active", true)
    .maybeSingle();
  if (loadError) {
    throw new Error(`Failed to load income account: ${loadError.message}`);
  }
  if (existing) {
    return mapAccount(existing as Record<string, unknown>);
  }

  const now = new Date().toISOString();
  const row = {
    id: randomUUID(),
    tenant_id: tenantId,
    branch_id: branchId,
    label,
    currency: "GHS",
    balance: 0,
    is_active: true,
    created_at: now,
    updated_at: now
  };
  const { data: inserted, error: insertError } = await supabase
    .from("branch_income_accounts")
    .insert(row)
    .select("*")
    .single();
  if (insertError) {
    // Race: unique index — re-read
    const { data: raced } = await supabase
      .from("branch_income_accounts")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("branch_id", branchId)
      .eq("is_active", true)
      .maybeSingle();
    if (raced) {
      return mapAccount(raced as Record<string, unknown>);
    }
    throw new Error(`Failed to create income account: ${insertError.message}`);
  }
  return mapAccount(inserted as Record<string, unknown>);
}

export async function ensureTenantIncomeAccounts(
  tenantId: string,
  subscribedModules?: string[]
): Promise<BranchIncomeAccount[]> {
  const susuOnly =
    Boolean(subscribedModules?.includes("susu_management")) &&
    !(subscribedModules ?? []).some((m) => m === "banking" || m === "treasury" || m === "loans_credit");
  const branches = (await listBranches(tenantId)).filter((b) => b.status !== "inactive");
  const accounts: BranchIncomeAccount[] = [];
  for (const branch of branches) {
    accounts.push(await ensureBranchIncomeAccount(tenantId, branch.id, branch.name, susuOnly));
  }
  return accounts;
}

export async function postInstitutionalIncome(
  context: RequestContext,
  input: PostInstitutionalIncomeInput,
  options?: { subscribedModules?: string[]; branchName?: string }
): Promise<InstitutionalIncomeEntry> {
  const susuOnly =
    Boolean(options?.subscribedModules?.includes("susu_management")) &&
    !(options?.subscribedModules ?? []).some(
      (m) => m === "banking" || m === "treasury" || m === "loans_credit"
    );
  const branchId = String(input.branchId);
  const tenantBranches = await listBranches(context.tenantId).catch(() => []);
  const tenantBranch = tenantBranches.find((b) => String(b.id) === branchId);
  if (tenantBranches.length > 0 && !tenantBranch) {
    throw new Error("Branch does not belong to this company.");
  }
  const branchName = options?.branchName ?? tenantBranch?.name ?? "Branch";
  const account = await ensureBranchIncomeAccount(
    context.tenantId,
    branchId,
    branchName,
    susuOnly
  );
  const businessDate = input.businessDate?.slice(0, 10) ?? new Date().toISOString().slice(0, 10);
  const supabase = getSupabaseAdminClient();

  if (!supabase) {
    const list = memoryEntries.get(context.tenantId) ?? [];
    const existing = list.find((e) => e.idempotencyKey === input.idempotencyKey);
    if (existing) {
      return existing;
    }
    const entry: InstitutionalIncomeEntry = {
      id: randomUUID(),
      tenantId: context.tenantId,
      branchId,
      incomeAccountId: account.id,
      source: input.source,
      amount: input.amount,
      businessDate,
      customerId: input.customerId ?? null,
      transactionId: input.transactionId ?? null,
      notes: input.notes ?? null,
      idempotencyKey: input.idempotencyKey,
      recordedByUserId: context.userId,
      reversesEntryId: null,
      reversedAt: null,
      reversedByEntryId: null,
      reversalReason: null,
      createdAt: new Date().toISOString()
    };
    memoryEntries.set(context.tenantId, [entry, ...list]);
    const accounts = memoryAccounts.get(accountsKey(context.tenantId)) ?? [];
    memoryAccounts.set(
      accountsKey(context.tenantId),
      accounts.map((a) =>
        a.id === account.id ? { ...a, balance: a.balance + input.amount, updatedAt: entry.createdAt } : a
      )
    );
    return entry;
  }

  const { data: existing } = await supabase
    .from("institutional_income_entries")
    .select("*")
    .eq("tenant_id", context.tenantId)
    .eq("idempotency_key", input.idempotencyKey)
    .maybeSingle();
  if (existing) {
    return mapEntry(existing as Record<string, unknown>);
  }

  const entryId = randomUUID();
  const now = new Date().toISOString();
  const { data: inserted, error: insertError } = await supabase
    .from("institutional_income_entries")
    .insert({
      id: entryId,
      tenant_id: context.tenantId,
      branch_id: branchId,
      income_account_id: account.id,
      source: input.source,
      amount: input.amount,
      business_date: businessDate,
      customer_id: input.customerId ?? null,
      transaction_id: input.transactionId ?? null,
      notes: input.notes ?? null,
      idempotency_key: input.idempotencyKey,
      recorded_by_user_id: context.userId,
      created_at: now
    })
    .select("*")
    .single();

  if (insertError) {
    if (insertError.code === "23505") {
      const { data: raced } = await supabase
        .from("institutional_income_entries")
        .select("*")
        .eq("tenant_id", context.tenantId)
        .eq("idempotency_key", input.idempotencyKey)
        .maybeSingle();
      if (raced) {
        return mapEntry(raced as Record<string, unknown>);
      }
    }
    throw new Error(`Failed to post institutional income: ${insertError.message}`);
  }

  const { error: balError } = await supabase
    .from("branch_income_accounts")
    .update({
      balance: Number(account.balance) + input.amount,
      updated_at: now
    })
    .eq("id", account.id)
    .eq("tenant_id", context.tenantId);
  if (balError) {
    throw new Error(`Income posted but balance update failed: ${balError.message}`);
  }

  return mapEntry(inserted as Record<string, unknown>);
}

export async function reverseInstitutionalIncome(
  context: RequestContext,
  input: ReverseInstitutionalIncomeInput
): Promise<InstitutionalIncomeEntry> {
  const supabase = getSupabaseAdminClient();
  const reason = input.reason.trim();
  const now = new Date().toISOString();
  const businessDate = now.slice(0, 10);
  const idempotencyKey = `reverse:${input.entryId}`;

  if (!supabase) {
    const list = memoryEntries.get(context.tenantId) ?? [];
    const existingReversal = list.find((e) => e.idempotencyKey === idempotencyKey);
    if (existingReversal) {
      return existingReversal;
    }
    const original = list.find((e) => e.id === input.entryId);
    if (!original) {
      throw new Error("Income entry not found");
    }
    if (original.reversedAt || original.reversesEntryId) {
      throw new Error("This income entry is already reversed or is a reversal");
    }
    const accounts = memoryAccounts.get(accountsKey(context.tenantId)) ?? [];
    const targetAccount = accounts.find((a) => a.id === original.incomeAccountId);
    const currentBal = roundMoney(targetAccount?.balance ?? 0);
    if (currentBal + 0.0001 < original.amount) {
      throw new Error(
        `Cannot reverse GHS ${formatAccountAmount(original.amount)} because only GHS ${formatAccountAmount(currentBal)} remains available in the branch income account. Reverse a commission capital transfer first.`
      );
    }
    const reversal: InstitutionalIncomeEntry = {
      id: randomUUID(),
      tenantId: context.tenantId,
      branchId: original.branchId,
      incomeAccountId: original.incomeAccountId,
      source: original.source,
      amount: original.amount,
      businessDate,
      customerId: original.customerId ?? null,
      transactionId: original.transactionId ?? null,
      notes: `Reversal of ${original.id}: ${reason}`,
      idempotencyKey,
      recordedByUserId: context.userId,
      reversesEntryId: original.id,
      reversedAt: null,
      reversedByEntryId: null,
      reversalReason: reason,
      createdAt: now
    };
    const patchedOriginal: InstitutionalIncomeEntry = {
      ...original,
      reversedAt: now,
      reversedByEntryId: reversal.id,
      reversalReason: reason
    };
    memoryEntries.set(
      context.tenantId,
      [reversal, ...list.map((e) => (e.id === original.id ? patchedOriginal : e))]
    );
    memoryAccounts.set(
      accountsKey(context.tenantId),
      accounts.map((a) =>
        a.id === original.incomeAccountId
          ? { ...a, balance: roundMoney(Math.max(0, a.balance - original.amount)), updatedAt: now }
          : a
      )
    );
    return reversal;
  }

  const { data: existingReversal } = await supabase
    .from("institutional_income_entries")
    .select("*")
    .eq("tenant_id", context.tenantId)
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();
  if (existingReversal) {
    return mapEntry(existingReversal as Record<string, unknown>);
  }

  const { data: originalRow, error: loadError } = await supabase
    .from("institutional_income_entries")
    .select("*")
    .eq("tenant_id", context.tenantId)
    .eq("id", input.entryId)
    .maybeSingle();
  if (loadError || !originalRow) {
    throw new Error(loadError?.message ?? "Income entry not found");
  }
  const original = mapEntry(originalRow as Record<string, unknown>);
  if (original.reversedAt || original.reversesEntryId) {
    throw new Error("This income entry is already reversed or is a reversal");
  }

  const { data: accountRowBefore } = await supabase
    .from("branch_income_accounts")
    .select("balance")
    .eq("id", original.incomeAccountId)
    .eq("tenant_id", context.tenantId)
    .maybeSingle();
  const availableBefore = roundMoney(Number(accountRowBefore?.balance ?? 0));
  if (availableBefore + 0.0001 < original.amount) {
    throw new Error(
      `Cannot reverse GHS ${formatAccountAmount(original.amount)} because only GHS ${formatAccountAmount(availableBefore)} remains available in the branch income account. Reverse a commission capital transfer first.`
    );
  }

  const reversalId = randomUUID();
  const { data: inserted, error: insertError } = await supabase
    .from("institutional_income_entries")
    .insert({
      id: reversalId,
      tenant_id: context.tenantId,
      branch_id: original.branchId,
      income_account_id: original.incomeAccountId,
      source: original.source,
      amount: original.amount,
      business_date: businessDate,
      customer_id: original.customerId,
      transaction_id: original.transactionId,
      notes: `Reversal of ${original.id}: ${reason}`,
      idempotency_key: idempotencyKey,
      recorded_by_user_id: context.userId,
      reverses_entry_id: original.id,
      reversal_reason: reason,
      created_at: now
    })
    .select("*")
    .single();
  if (insertError) {
    if (insertError.code === "23505") {
      const { data: raced } = await supabase
        .from("institutional_income_entries")
        .select("*")
        .eq("tenant_id", context.tenantId)
        .eq("idempotency_key", idempotencyKey)
        .maybeSingle();
      if (raced) {
        return mapEntry(raced as Record<string, unknown>);
      }
    }
    throw new Error(`Failed to reverse income entry: ${insertError.message}`);
  }

  await supabase
    .from("institutional_income_entries")
    .update({
      reversed_at: now,
      reversed_by_entry_id: reversalId,
      reversal_reason: reason
    })
    .eq("id", original.id)
    .eq("tenant_id", context.tenantId);

  const { data: accountRow } = await supabase
    .from("branch_income_accounts")
    .select("balance")
    .eq("id", original.incomeAccountId)
    .eq("tenant_id", context.tenantId)
    .maybeSingle();
  const currentBal = roundMoney(Number(accountRow?.balance ?? 0));
  await supabase
    .from("branch_income_accounts")
    .update({
      balance: roundMoney(Math.max(0, currentBal - original.amount)),
      updated_at: now
    })
    .eq("id", original.incomeAccountId)
    .eq("tenant_id", context.tenantId);

  return mapEntry(inserted as Record<string, unknown>);
}

export type TransferIncomeToCapitalResult = {
  idempotent: boolean;
  transfer: InstitutionalIncomeCapitalTransfer;
  previousBalance: number;
  newBalance: number;
};

function assertCanManageIncomeCapitalTransfer(context: RequestContext): void {
  if (context.role !== "admin" && context.role !== "accountant") {
    throw new Error(
      "Only authorized administrators or accountants can transfer commission income to Business Capital."
    );
  }
}

export async function transferInstitutionalIncomeToCapital(
  context: RequestContext,
  rawInput: unknown,
  options?: { subscribedModules?: string[] }
): Promise<TransferIncomeToCapitalResult> {
  assertCanManageIncomeCapitalTransfer(context);
  const input = transferInstitutionalIncomeToCapitalSchema.parse(rawInput);

  if (context.scopeType === "branch" && context.branchId && context.branchId !== input.branchId) {
    throw new Error("Cannot transfer institutional income for another branch.");
  }

  const tenantBranches = await listBranches(context.tenantId).catch(() => []);
  const tenantBranch = tenantBranches.find((b) => String(b.id) === String(input.branchId));
  if (tenantBranches.length > 0 && !tenantBranch) {
    throw new Error("Branch does not belong to this company.");
  }

  const susuOnly =
    Boolean(options?.subscribedModules?.includes("susu_management")) &&
    !(options?.subscribedModules ?? []).some(
      (m) => m === "banking" || m === "treasury" || m === "loans_credit"
    );
  const branchName = tenantBranch?.name ?? "Branch";
  const account = await ensureBranchIncomeAccount(
    context.tenantId,
    input.branchId,
    branchName,
    susuOnly
  );

  const amount = roundMoney(input.amount);
  const businessDate = input.businessDate ?? new Date().toISOString().slice(0, 10);
  const transferId = randomUUID();
  const capitalEntryId = randomUUID();
  const reference =
    input.reference?.trim() ||
    `INC-CAP-${businessDate.replace(/-/g, "")}-${transferId.replace(/-/g, "").slice(0, 6).toUpperCase()}`;
  const notes = input.notes?.trim() || undefined;
  const nameMap = await fetchTenantUserNameMap(context.tenantId).catch(() => new Map<string, string>());
  const authorizedByName = nameMap.get(context.userId) ?? context.userId;

  const supabase = getSupabaseAdminClient();
  if (!supabase) {
    const existingList = memoryCapitalTransfers.get(context.tenantId) ?? [];
    const existing = existingList.find((t) => t.idempotencyKey === input.idempotencyKey);
    if (existing) {
      return {
        idempotent: true,
        transfer: existing,
        previousBalance: roundMoney(account.balance),
        newBalance: roundMoney(account.balance)
      };
    }

    const prevBalance = roundMoney(account.balance);
    if (amount > prevBalance + 0.0001) {
      throw new Error(
        `Transfer amount (GHS ${formatAccountAmount(amount)}) exceeds available institutional income balance (GHS ${formatAccountAmount(prevBalance)}).`
      );
    }

    const now = new Date().toISOString();
    const newBalance = roundMoney(prevBalance - amount);
    const accounts = memoryAccounts.get(accountsKey(context.tenantId)) ?? [];
    memoryAccounts.set(
      accountsKey(context.tenantId),
      accounts.map((a) => (a.id === account.id ? { ...a, balance: newBalance, updatedAt: now } : a))
    );

    recordMemoryIncomeAllocationCapitalEntry({
      id: capitalEntryId,
      tenantId: context.tenantId,
      branchId: input.branchId,
      businessDate,
      entryType: "income_allocation",
      amount,
      source: `Commission income allocation (${account.label})`,
      reference,
      notes:
        notes ??
        "Internal allocation from institutional commission income to Business Capital (non-cash)",
      incomeAccountId: account.id,
      recordedBy: context.userId,
      recordedByName: authorizedByName,
      createdAt: now
    });

    const transfer: InstitutionalIncomeCapitalTransfer = {
      id: transferId,
      tenantId: context.tenantId,
      branchId: input.branchId,
      branchName,
      incomeAccountId: account.id,
      incomeAccountLabel: account.label,
      capitalEntryId,
      amount,
      businessDate,
      reference,
      idempotencyKey: input.idempotencyKey,
      notes: notes ?? null,
      authorizedByUserId: context.userId,
      authorizedByName,
      reversedAt: null,
      reversedByUserId: null,
      reversedByName: null,
      reversalReason: null,
      createdAt: now
    };
    memoryCapitalTransfers.set(context.tenantId, [transfer, ...existingList]);

    return {
      idempotent: false,
      transfer,
      previousBalance: prevBalance,
      newBalance
    };
  }

  const { data: rpcResult, error: rpcError } = await supabase.rpc(
    "transfer_institutional_income_to_capital_atomic",
    {
      p_transfer_id: transferId,
      p_capital_entry_id: capitalEntryId,
      p_tenant_id: context.tenantId,
      p_branch_id: input.branchId,
      p_amount: amount,
      p_business_date: businessDate,
      p_reference: reference,
      p_notes: notes ?? null,
      p_idempotency_key: input.idempotencyKey,
      p_authorized_by_user_id: context.userId,
      p_authorized_by_name: authorizedByName
    }
  );

  if (rpcError) {
    if (isMissingCapitalTransferStorage(rpcError.message)) {
      throw new Error(
        "Commission-to-capital transfer storage is not ready. Apply migration 110_commission_income_capital_transfers.sql in Supabase, then try again."
      );
    }
    throw new Error(rpcError.message);
  }

  const payload = (rpcResult ?? {}) as Record<string, unknown>;
  const idempotent = payload.idempotent === true;
  const transferRow = (payload.transfer ?? {}) as Record<string, unknown>;
  const transfer = mapTransfer(transferRow, {
    branchName,
    incomeAccountLabel:
      typeof payload.income_account_label === "string" && payload.income_account_label.trim()
        ? payload.income_account_label
        : account.label
  });
  const previousBalance = roundMoney(Number(payload.previous_balance ?? account.balance));
  const newBalance = roundMoney(Number(payload.new_balance ?? account.balance));

  if (!idempotent) {
    const branchLabel = await branchDisplayLabel(context.tenantId, input.branchId).catch(
      () => branchName
    );
    try {
      await notifyTenantStaff({
        tenantId: context.tenantId,
        roles: ["admin", "accountant", "coordinator"],
        kind: "business_capital_recorded",
        title: "Commission income allocated to Business Capital",
        body: `${branchLabel} · ${transfer.businessDate}: GHS ${formatAccountAmount(transfer.amount)} allocated from ${transfer.incomeAccountLabel || "Institutional income"} to Business Capital (Ref ${transfer.reference}) by ${authorizedByName}.`
      });
    } catch {
      // Non-blocking
    }
  }

  return {
    idempotent,
    transfer,
    previousBalance,
    newBalance
  };
}

export type ReverseIncomeCapitalTransferResult = {
  transfer: InstitutionalIncomeCapitalTransfer;
  previousBalance: number;
  newBalance: number;
};

export async function reverseInstitutionalIncomeCapitalTransfer(
  context: RequestContext,
  transferId: string,
  rawInput: unknown
): Promise<ReverseIncomeCapitalTransferResult> {
  assertCanManageIncomeCapitalTransfer(context);
  const { reason } = reverseInstitutionalIncomeCapitalTransferSchema.parse(rawInput);
  const nameMap = await fetchTenantUserNameMap(context.tenantId).catch(() => new Map<string, string>());
  const actorName = nameMap.get(context.userId) ?? context.userId;

  const supabase = getSupabaseAdminClient();
  if (!supabase) {
    const list = memoryCapitalTransfers.get(context.tenantId) ?? [];
    const idx = list.findIndex((t) => t.id === transferId);
    if (idx < 0) {
      throw new Error("Commission capital transfer not found");
    }
    const existing = list[idx]!;
    if (context.scopeType === "branch" && context.branchId && context.branchId !== existing.branchId) {
      throw new Error("Cannot reverse a commission capital transfer for another branch.");
    }
    if (existing.reversedAt) {
      throw new Error("This commission capital transfer has already been reversed");
    }

    const accounts = memoryAccounts.get(accountsKey(context.tenantId)) ?? [];
    const targetAccount = accounts.find((a) => a.id === existing.incomeAccountId);
    if (!targetAccount) {
      throw new Error("Linked branch income account not found");
    }
    const now = new Date().toISOString();
    const previousBalance = roundMoney(targetAccount.balance);
    const newBalance = roundMoney(previousBalance + existing.amount);

    memoryAccounts.set(
      accountsKey(context.tenantId),
      accounts.map((a) => (a.id === targetAccount.id ? { ...a, balance: newBalance, updatedAt: now } : a))
    );
    voidMemoryCapitalEntryById(
      context.tenantId,
      existing.capitalEntryId,
      context.userId,
      now,
      `Commission transfer reversed: ${reason}`
    );

    const updated: InstitutionalIncomeCapitalTransfer = {
      ...existing,
      reversedAt: now,
      reversedByUserId: context.userId,
      reversedByName: actorName,
      reversalReason: reason
    };
    const nextList = [...list];
    nextList[idx] = updated;
    memoryCapitalTransfers.set(context.tenantId, nextList);

    return {
      transfer: updated,
      previousBalance,
      newBalance
    };
  }

  const { data: existingRow, error: findError } = await supabase
    .from("institutional_income_capital_transfers")
    .select("id, branch_id")
    .eq("tenant_id", context.tenantId)
    .eq("id", transferId)
    .maybeSingle();

  if (findError) {
    if (isMissingCapitalTransferStorage(findError.message)) {
      throw new Error(
        "Commission-to-capital transfer storage is not ready. Apply migration 110_commission_income_capital_transfers.sql in Supabase, then try again."
      );
    }
    throw new Error(`Failed to load commission capital transfer: ${findError.message}`);
  }
  if (!existingRow) {
    throw new Error("Commission capital transfer not found");
  }
  if (
    context.scopeType === "branch" &&
    context.branchId &&
    context.branchId !== String(existingRow.branch_id)
  ) {
    throw new Error("Cannot reverse a commission capital transfer for another branch.");
  }

  const { data: rpcResult, error: rpcError } = await supabase.rpc(
    "reverse_institutional_income_capital_transfer_atomic",
    {
      p_tenant_id: context.tenantId,
      p_transfer_id: transferId,
      p_actor_user_id: context.userId,
      p_actor_name: actorName,
      p_reason: reason
    }
  );

  if (rpcError) {
    if (isMissingCapitalTransferStorage(rpcError.message)) {
      throw new Error(
        "Commission-to-capital transfer storage is not ready. Apply migration 110_commission_income_capital_transfers.sql in Supabase, then try again."
      );
    }
    throw new Error(rpcError.message);
  }

  const payload = (rpcResult ?? {}) as Record<string, unknown>;
  const transferRow = (payload.transfer ?? {}) as Record<string, unknown>;
  const branchLabel = await branchDisplayLabel(
    context.tenantId,
    String(transferRow.branch_id ?? existingRow.branch_id)
  ).catch(() => "Branch");

  const transfer = mapTransfer(transferRow, {
    branchName: branchLabel,
    incomeAccountLabel:
      typeof payload.income_account_label === "string" ? payload.income_account_label : null
  });
  const previousBalance = roundMoney(Number(payload.previous_balance ?? 0));
  const newBalance = roundMoney(Number(payload.new_balance ?? 0));

  try {
    await notifyTenantStaff({
      tenantId: context.tenantId,
      roles: ["admin", "accountant", "coordinator"],
      kind: "business_capital_recorded",
      title: "Commission capital allocation reversed",
      body: `${branchLabel} · Ref ${transfer.reference}: GHS ${formatAccountAmount(transfer.amount)} restored to ${transfer.incomeAccountLabel || "Institutional income"} (${reason}) by ${actorName}.`
    });
  } catch {
    // Non-blocking
  }

  return {
    transfer,
    previousBalance,
    newBalance
  };
}

export async function reverseInstitutionalIncomeCapitalTransferByCapitalEntryId(
  context: RequestContext,
  capitalEntryId: string,
  rawInput: unknown
): Promise<ReverseIncomeCapitalTransferResult> {
  const supabase = getSupabaseAdminClient();
  if (!supabase) {
    const list = memoryCapitalTransfers.get(context.tenantId) ?? [];
    const match = list.find((t) => t.capitalEntryId === capitalEntryId);
    if (!match) {
      throw new Error("Linked commission capital transfer not found");
    }
    return reverseInstitutionalIncomeCapitalTransfer(context, match.id, rawInput);
  }

  const { data: row, error } = await supabase
    .from("institutional_income_capital_transfers")
    .select("id")
    .eq("tenant_id", context.tenantId)
    .eq("capital_entry_id", capitalEntryId)
    .maybeSingle();

  if (error) {
    if (isMissingCapitalTransferStorage(error.message)) {
      throw new Error(
        "Commission-to-capital transfer storage is not ready. Apply migration 110_commission_income_capital_transfers.sql in Supabase, then try again."
      );
    }
    throw new Error(`Failed to locate linked commission transfer: ${error.message}`);
  }
  if (!row?.id) {
    throw new Error("Linked commission capital transfer not found");
  }
  return reverseInstitutionalIncomeCapitalTransfer(context, String(row.id), rawInput);
}

function isActiveIncomeEntry(entry: InstitutionalIncomeEntry): boolean {
  return !entry.reversedAt && !entry.reversesEntryId;
}

type SavingsFeeCandidate = {
  customerId: string;
  branchId: string;
  amount: number;
  businessDate: string;
  transactionId?: string;
  notes: string;
};

/**
 * Backfill institutional income for existing savings opening fees (locked deposit
 * and/or fees recovered from deposits) so period filters include that revenue
 * under each customer’s home branch.
 */
async function ensureLegacySavingsOpeningFeeIncome(context: RequestContext): Promise<void> {
  const supabase = getSupabaseAdminClient();
  if (!supabase) {
    return;
  }

  const { getSavingsOpeningFeeGhs } = await import("./tenantProfileService.js");
  const defaultOpeningFee = await getSavingsOpeningFeeGhs(context.tenantId).catch(() => 0);

  const { data: customers, error } = await supabase
    .from("customers")
    .select(
      "id, home_branch_id, locked_balance, created_at, savings_opening_fee_collected, savings_opening_fee_recovered, status"
    )
    .eq("tenant_id", context.tenantId)
    .eq("account_type", "savings")
    .limit(5000);
  if (error || !customers?.length) {
    return;
  }

  const branches = await listBranches(context.tenantId).catch(() => []);
  const tenantBranchIds = new Set(
    branches.filter((b) => b.status !== "inactive").map((b) => String(b.id))
  );
  const fallbackBranchId =
    [...tenantBranchIds][0] ??
    (branches[0] ? String(branches[0].id) : "");
  const branchNameById = new Map(branches.map((b) => [String(b.id), b.name]));

  const candidates: SavingsFeeCandidate[] = [];
  for (const row of customers) {
    const customerId = String(row.id);
    const locked = Number(row.locked_balance ?? 0);
    const recovered = Number(row.savings_opening_fee_recovered ?? 0);
    const collected = row.savings_opening_fee_collected === true;
    let amount = 0;
    let notes = "Savings opening fee";
    if (locked > 0) {
      amount = locked;
      notes = "Savings opening fee (locked initial deposit)";
    } else if (recovered > 0) {
      amount = recovered;
      notes = "Savings opening fee (recovered from deposits)";
    } else if (collected && defaultOpeningFee > 0) {
      amount = defaultOpeningFee;
      notes = "Savings opening fee (collected)";
    }
    if (!(amount > 0)) {
      continue;
    }
    // Never attribute income to a branch outside this tenant.
    const homeBranch = String(row.home_branch_id ?? "");
    const branchId =
      homeBranch && tenantBranchIds.has(homeBranch) ? homeBranch : fallbackBranchId;
    if (!branchId || (tenantBranchIds.size > 0 && !tenantBranchIds.has(String(branchId)))) {
      continue;
    }
    candidates.push({
      customerId,
      branchId: String(branchId),
      amount,
      businessDate: String(row.created_at ?? new Date().toISOString()).slice(0, 10),
      notes
    });
  }

  if (candidates.length === 0) {
    return;
  }

  const customerIds = candidates.map((c) => c.customerId);
  const alreadyPostedCustomers = new Set<string>();

  // Any prior savings_fee posting for the customer (legacy keys or recovery tx keys).
  for (let i = 0; i < customerIds.length; i += 200) {
    const chunk = customerIds.slice(i, i + 200);
    const { data: existingRows } = await supabase
      .from("institutional_income_entries")
      .select("customer_id, idempotency_key")
      .eq("tenant_id", context.tenantId)
      .eq("source", "savings_fee")
      .in("customer_id", chunk);
    for (const r of existingRows ?? []) {
      if (r.customer_id) {
        alreadyPostedCustomers.add(String(r.customer_id));
      }
    }
    const keyChunk = chunk.flatMap((id) => [
      `savings_fee:opening:${id}`,
      `savings_fee:locked:${id}`
    ]);
    const { data: byKey } = await supabase
      .from("institutional_income_entries")
      .select("idempotency_key")
      .eq("tenant_id", context.tenantId)
      .in("idempotency_key", keyChunk);
    for (const r of byKey ?? []) {
      const key = String(r.idempotency_key ?? "");
      const match = /^savings_fee:(?:opening|locked):(.+)$/.exec(key);
      if (match?.[1]) {
        alreadyPostedCustomers.add(match[1]);
      }
    }
  }

  const pending = candidates.filter((c) => !alreadyPostedCustomers.has(c.customerId));
  if (pending.length === 0) {
    return;
  }

  const pendingIds = pending.map((c) => c.customerId);
  const firstTxByCustomer = new Map<string, { id: string; createdAt: string }>();
  for (let i = 0; i < pendingIds.length; i += 200) {
    const chunk = pendingIds.slice(i, i + 200);
    const { data: txRows } = await supabase
      .from("customer_transactions")
      .select("id, customer_id, created_at, amount, notes")
      .eq("tenant_id", context.tenantId)
      .in("customer_id", chunk)
      .not("notes", "is", null)
      .order("created_at", { ascending: true })
      .limit(2000);
    for (const tx of txRows ?? []) {
      const notes = String(tx.notes ?? "");
      if (
        !/savings initial deposit/i.test(notes) &&
        !/opening fee/i.test(notes)
      ) {
        continue;
      }
      const cid = String(tx.customer_id);
      if (!firstTxByCustomer.has(cid)) {
        firstTxByCustomer.set(cid, { id: String(tx.id), createdAt: String(tx.created_at) });
      }
    }
  }

  // Ensure income accounts exist for every branch that will receive a posting.
  for (const branchId of new Set(pending.map((c) => c.branchId))) {
    const name = branchNameById.get(String(branchId)) ?? "Branch";
    await ensureBranchIncomeAccount(context.tenantId, String(branchId), name, false).catch(
      () => undefined
    );
  }

  const { postSavingsOpeningFeeIncome } = await import("./savingsInitialDepositService.js");
  for (const row of pending) {
    const tx = firstTxByCustomer.get(row.customerId);
    try {
      await postSavingsOpeningFeeIncome({
        tenantId: context.tenantId,
        customerId: row.customerId,
        branchId: row.branchId,
        amount: row.amount,
        transactionId: tx?.id,
        recordedByUserId: context.userId,
        businessDate: (tx?.createdAt ?? row.businessDate).slice(0, 10),
        notes: row.notes,
        throwOnError: true
      });
    } catch {
      /* continue other customers — report still loads */
    }
  }
}

export async function getInstitutionalIncomeReport(
  context: RequestContext,
  options: {
    period: IncomeReportPeriod;
    branchId?: string;
    subscribedModules?: string[];
  }
): Promise<InstitutionalIncomeReport> {
  const allowedPeriods = resolveAllowedIncomePeriods(context.permissions);
  if (allowedPeriods.length === 0) {
    throw new Error("You do not have permission to view institutional income.");
  }
  const period = allowedPeriods.includes(options.period) ? options.period : allowedPeriods[0];
  const dailyOnly = !callerHasFullIncomeAccess(context.permissions);
  const { fromDate, toDate } = incomePeriodDateRange(period);

  // Include historical savings opening fees in institutional income (all branches).
  await ensureLegacySavingsOpeningFeeIncome(context);

  const accounts = await ensureTenantIncomeAccounts(context.tenantId, options.subscribedModules);
  const branches = (await listBranches(context.tenantId)).filter((b) => b.status !== "inactive");
  const tenantBranchIds = new Set(branches.map((b) => String(b.id)));
  const branchNameById = new Map(branches.map((b) => [String(b.id), b.name]));

  let scopedBranchId = options.branchId ? String(options.branchId) : undefined;
  if (context.scopeType === "branch" && context.branchId) {
    scopedBranchId = String(context.branchId);
  }
  // Reject cross-tenant or unknown branch filters — only this tenant's branches.
  if (scopedBranchId && tenantBranchIds.size > 0 && !tenantBranchIds.has(scopedBranchId)) {
    throw new Error("Branch does not belong to this company.");
  }

  const supabase = getSupabaseAdminClient();
  let entries: InstitutionalIncomeEntry[] = [];

  if (!supabase) {
    entries = (memoryEntries.get(context.tenantId) ?? []).filter(
      (e) =>
        e.businessDate >= fromDate &&
        e.businessDate <= toDate &&
        (!scopedBranchId || String(e.branchId) === scopedBranchId) &&
        (tenantBranchIds.size === 0 || tenantBranchIds.has(String(e.branchId)))
    );
  } else {
    let query = supabase
      .from("institutional_income_entries")
      .select("*")
      .eq("tenant_id", context.tenantId)
      .gte("business_date", fromDate)
      .lte("business_date", toDate)
      .order("business_date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(5000);
    if (scopedBranchId) {
      query = query.eq("branch_id", scopedBranchId);
    } else if (tenantBranchIds.size > 0) {
      query = query.in("branch_id", [...tenantBranchIds]);
    }
    const { data, error } = await query;
    if (error) {
      throw new Error(`Failed to load income entries: ${error.message}`);
    }
    entries = (data ?? [])
      .map((row) => mapEntry(row as Record<string, unknown>))
      .filter((e) => tenantBranchIds.size === 0 || tenantBranchIds.has(String(e.branchId)));
  }

  const active = entries.filter(isActiveIncomeEntry);
  const sourceTotals = new Map<InstitutionalIncomeSource, { amount: number; entryCount: number }>();
  const branchTotals = new Map<
    string,
    { amount: number; entryCount: number; bySource: Map<InstitutionalIncomeSource, { amount: number; entryCount: number }> }
  >();

  for (const entry of active) {
    const branchId = String(entry.branchId);
    const src = sourceTotals.get(entry.source) ?? { amount: 0, entryCount: 0 };
    src.amount += entry.amount;
    src.entryCount += 1;
    sourceTotals.set(entry.source, src);

    const branch = branchTotals.get(branchId) ?? {
      amount: 0,
      entryCount: 0,
      bySource: new Map()
    };
    branch.amount += entry.amount;
    branch.entryCount += 1;
    const bs = branch.bySource.get(entry.source) ?? { amount: 0, entryCount: 0 };
    bs.amount += entry.amount;
    bs.entryCount += 1;
    branch.bySource.set(entry.source, bs);
    branchTotals.set(branchId, branch);
  }

  const bySource = [...sourceTotals.entries()].map(([source, stats]) => ({
    source,
    label: INSTITUTIONAL_INCOME_SOURCE_LABELS[source],
    amount: Math.round(stats.amount * 100) / 100,
    entryCount: stats.entryCount
  }));

  const accountByBranch = new Map(
    accounts
      .filter((a) => tenantBranchIds.size === 0 || tenantBranchIds.has(String(a.branchId)))
      .map((a) => [String(a.branchId), a])
  );
  const accountById = new Map(accounts.map((a) => [String(a.id), a]));

  // Load cumulative all-time earned income and commission-to-capital transfer history
  // for the scoped branch(es) so available + transferred reconciles against total earned.
  const earnedAllTimeByBranch = new Map<string, number>();
  const transferredByBranch = new Map<string, number>();
  let capitalStorageReady = true;
  let capitalTransfers: InstitutionalIncomeCapitalTransfer[] = [];

  if (!supabase) {
    const allMemoryEntries = (memoryEntries.get(context.tenantId) ?? []).filter(
      (e) =>
        isActiveIncomeEntry(e) &&
        (!scopedBranchId || String(e.branchId) === scopedBranchId) &&
        (tenantBranchIds.size === 0 || tenantBranchIds.has(String(e.branchId)))
    );
    for (const entry of allMemoryEntries) {
      const bId = String(entry.branchId);
      earnedAllTimeByBranch.set(bId, roundMoney((earnedAllTimeByBranch.get(bId) ?? 0) + entry.amount));
    }

    capitalTransfers = (memoryCapitalTransfers.get(context.tenantId) ?? [])
      .filter(
        (t) =>
          (!scopedBranchId || String(t.branchId) === scopedBranchId) &&
          (tenantBranchIds.size === 0 || tenantBranchIds.has(String(t.branchId)))
      )
      .map((t) => ({
        ...t,
        branchName: t.branchName ?? branchNameById.get(String(t.branchId)) ?? "Branch",
        incomeAccountLabel:
          t.incomeAccountLabel ?? accountById.get(String(t.incomeAccountId))?.label ?? null
      }));
  } else {
    let earnedQuery = supabase
      .from("institutional_income_entries")
      .select("branch_id, amount")
      .eq("tenant_id", context.tenantId)
      .is("reversed_at", null)
      .is("reverses_entry_id", null)
      .limit(20000);
    if (scopedBranchId) {
      earnedQuery = earnedQuery.eq("branch_id", scopedBranchId);
    } else if (tenantBranchIds.size > 0) {
      earnedQuery = earnedQuery.in("branch_id", [...tenantBranchIds]);
    }
    const { data: earnedRows } = await earnedQuery;
    for (const row of earnedRows ?? []) {
      const bId = String(row.branch_id ?? "");
      if (!bId || (tenantBranchIds.size > 0 && !tenantBranchIds.has(bId))) {
        continue;
      }
      earnedAllTimeByBranch.set(
        bId,
        roundMoney((earnedAllTimeByBranch.get(bId) ?? 0) + Number(row.amount ?? 0))
      );
    }

    let transfersQuery = supabase
      .from("institutional_income_capital_transfers")
      .select("*")
      .eq("tenant_id", context.tenantId)
      .order("business_date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(10000);
    if (scopedBranchId) {
      transfersQuery = transfersQuery.eq("branch_id", scopedBranchId);
    } else if (tenantBranchIds.size > 0) {
      transfersQuery = transfersQuery.in("branch_id", [...tenantBranchIds]);
    }
    const { data: transferRows, error: transferErr } = await transfersQuery;
    if (transferErr) {
      if (isMissingCapitalTransferStorage(transferErr.message)) {
        capitalStorageReady = false;
        capitalTransfers = [];
      } else {
        throw new Error(`Failed to load commission capital transfers: ${transferErr.message}`);
      }
    } else {
      capitalTransfers = (transferRows ?? [])
        .map((row) => {
          const r = row as Record<string, unknown>;
          const bId = String(r.branch_id ?? "");
          const acctId = String(r.income_account_id ?? "");
          return mapTransfer(r, {
            branchName: branchNameById.get(bId) ?? "Branch",
            incomeAccountLabel: accountById.get(acctId)?.label ?? null
          });
        })
        .filter((t) => tenantBranchIds.size === 0 || tenantBranchIds.has(String(t.branchId)));
    }
  }

  for (const transfer of capitalTransfers) {
    if (transfer.reversedAt) {
      continue;
    }
    const bId = String(transfer.branchId);
    transferredByBranch.set(
      bId,
      roundMoney((transferredByBranch.get(bId) ?? 0) + transfer.amount)
    );
  }

  const scopedAccounts = scopedBranchId
    ? accounts.filter((a) => String(a.branchId) === scopedBranchId)
    : accounts.filter((a) => tenantBranchIds.size === 0 || tenantBranchIds.has(String(a.branchId)));

  // Only this tenant's branches — never mix in foreign branch ids from orphan rows.
  const branchIds =
    scopedBranchId != null
      ? [scopedBranchId]
      : branches.length > 0
        ? branches.map((b) => String(b.id))
        : [...new Set(scopedAccounts.map((a) => String(a.branchId)))];

  const byBranch = branchIds.map((branchId) => {
    const stats = branchTotals.get(branchId) ?? {
      amount: 0,
      entryCount: 0,
      bySource: new Map<InstitutionalIncomeSource, { amount: number; entryCount: number }>()
    };
    const named = branchNameById.get(branchId);
    return {
      branchId,
      branchName: named && named.trim() ? named : "Branch",
      amount: Math.round(stats.amount * 100) / 100,
      entryCount: stats.entryCount,
      accountBalance: roundMoney(accountByBranch.get(branchId)?.balance ?? 0),
      totalEarnedAllTime: roundMoney(earnedAllTimeByBranch.get(branchId) ?? 0),
      totalTransferredToCapital: roundMoney(transferredByBranch.get(branchId) ?? 0),
      bySource: [...stats.bySource.entries()].map(([source, s]) => ({
        source,
        label: INSTITUTIONAL_INCOME_SOURCE_LABELS[source],
        amount: Math.round(s.amount * 100) / 100,
        entryCount: s.entryCount
      }))
    };
  });

  // Prefer branches with income first, then name.
  byBranch.sort((a, b) => {
    if (b.amount !== a.amount) {
      return b.amount - a.amount;
    }
    return a.branchName.localeCompare(b.branchName);
  });

  const totalAmount = Math.round(active.reduce((sum, e) => sum + e.amount, 0) * 100) / 100;
  const totalEarnedAllTime = roundMoney(
    [...earnedAllTimeByBranch.values()].reduce((sum, v) => sum + v, 0)
  );
  const totalTransferredToCapital = roundMoney(
    [...transferredByBranch.values()].reduce((sum, v) => sum + v, 0)
  );
  const availableBalance = roundMoney(
    scopedAccounts.reduce((sum, a) => sum + Number(a.balance ?? 0), 0)
  );

  const recentEntries = await enrichEntriesWithCustomerDetails(
    context.tenantId,
    entries.slice(0, 100)
  );

  return institutionalIncomeReportSchema.parse({
    period,
    fromDate,
    toDate,
    currency: "GHS",
    totalAmount,
    entryCount: active.length,
    bySource,
    byBranch,
    accounts: scopedAccounts,
    recentEntries,
    capitalAllocation: {
      storageReady: capitalStorageReady,
      totalEarnedAllTime,
      availableBalance,
      totalTransferredToCapital,
      transfers: capitalTransfers.slice(0, 100)
    },
    dailyOnly,
    allowedPeriods
  });
}

async function enrichEntriesWithCustomerDetails(
  tenantId: string,
  entries: InstitutionalIncomeEntry[]
): Promise<InstitutionalIncomeEntry[]> {
  if (entries.length === 0) {
    return entries;
  }

  const supabase = getSupabaseAdminClient();
  const txToCustomer = new Map<string, string>();
  const customerDetails = new Map<string, { fullName: string; accountNumber: string | null }>();

  const missingCustomerTxIds = [
    ...new Set(
      entries
        .filter((e) => !e.customerId && e.transactionId)
        .map((e) => String(e.transactionId))
    )
  ];

  if (supabase) {
    if (missingCustomerTxIds.length > 0) {
      const { data: txRows } = await supabase
        .from("customer_transactions")
        .select("id, customer_id")
        .eq("tenant_id", tenantId)
        .in("id", missingCustomerTxIds);
      for (const row of txRows ?? []) {
        if (row.id && row.customer_id) {
          txToCustomer.set(String(row.id), String(row.customer_id));
        }
      }
    }

    const customerIds = [
      ...new Set(
        entries
          .map((e) => e.customerId ?? (e.transactionId ? txToCustomer.get(e.transactionId) : undefined))
          .filter((id): id is string => Boolean(id))
      )
    ];

    if (customerIds.length > 0) {
      for (let i = 0; i < customerIds.length; i += 200) {
        const chunk = customerIds.slice(i, i + 200);
        const { data: custRows } = await supabase
          .from("customers")
          .select("id, full_name, account_number")
          .eq("tenant_id", tenantId)
          .in("id", chunk);
        for (const row of custRows ?? []) {
          if (row.id) {
            customerDetails.set(String(row.id), {
              fullName: String(row.full_name ?? "").trim(),
              accountNumber: row.account_number ? String(row.account_number).trim() : null
            });
          }
        }
      }
    }
  } else {
    const { listCustomers } = await import("./customerService.js");
    const customers = await listCustomers(tenantId).catch(() => []);
    for (const c of customers) {
      customerDetails.set(c.id, {
        fullName: c.fullName.trim(),
        accountNumber: c.accountNumber?.trim() || null
      });
    }
  }

  return entries.map((entry) => {
    const resolvedCustomerId =
      entry.customerId ??
      (entry.transactionId ? txToCustomer.get(entry.transactionId) ?? null : null);
    const info = resolvedCustomerId ? customerDetails.get(resolvedCustomerId) : undefined;
    return {
      ...entry,
      customerId: resolvedCustomerId,
      customerName: info?.fullName || entry.customerName || null,
      customerAccountNumber: info?.accountNumber || entry.customerAccountNumber || null
    };
  });
}
