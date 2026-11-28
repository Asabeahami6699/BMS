import { randomUUID } from "node:crypto";
import {
  INSTITUTIONAL_INCOME_SOURCE_LABELS,
  incomePeriodDateRange,
  institutionalIncomeEntrySchema,
  institutionalIncomeReportSchema,
  type BranchIncomeAccount,
  type IncomeReportPeriod,
  type InstitutionalIncomeEntry,
  type InstitutionalIncomeReport,
  type InstitutionalIncomeSource,
  type PostInstitutionalIncomeInput,
  type ReverseInstitutionalIncomeInput
} from "@bms/shared";
import { getSupabaseAdminClient } from "../config/supabaseClient.js";
import { listBranches } from "./branchService.js";

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
    const accounts = memoryAccounts.get(accountsKey(context.tenantId)) ?? [];
    memoryAccounts.set(
      accountsKey(context.tenantId),
      accounts.map((a) =>
        a.id === original.incomeAccountId
          ? { ...a, balance: Math.max(0, a.balance - original.amount), updatedAt: now }
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
  const currentBal = Number(accountRow?.balance ?? 0);
  await supabase
    .from("branch_income_accounts")
    .update({
      balance: Math.max(0, currentBal - original.amount),
      updated_at: now
    })
    .eq("id", original.incomeAccountId)
    .eq("tenant_id", context.tenantId);

  return mapEntry(inserted as Record<string, unknown>);
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

  // Only this tenant's branches — never mix in foreign branch ids from orphan rows.
  const branchIds =
    scopedBranchId != null
      ? [scopedBranchId]
      : branches.map((b) => String(b.id));

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
      accountBalance: accountByBranch.get(branchId)?.balance ?? 0,
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
    accounts: scopedBranchId ? accounts.filter((a) => String(a.branchId) === scopedBranchId) : accounts,
    recentEntries,
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
