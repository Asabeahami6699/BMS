import { randomUUID } from "node:crypto";
import {
  allocateSusuCollection,
  computeAgreedCommissionAmount,
  defaultSusuCommissionPolicy,
  roundMoney,
  susuCommissionPolicySchema,
  susuCustomerCycleSchema,
  updateSusuCommissionPolicySchema,
  type SusuCommissionPolicy,
  type SusuCustomerCycle,
  type UpdateSusuCommissionPolicyInput
} from "@bms/shared";
import { getSupabaseAdminClient } from "../config/supabaseClient.js";
import { postInstitutionalIncome } from "./institutionalIncomeService.js";
import { listBranches } from "./branchService.js";

type Ctx = {
  userId: string;
  tenantId: string;
  role: string;
  permissions?: string[];
  branchId?: string;
};

const memoryPolicies = new Map<string, SusuCommissionPolicy[]>();
const memoryCycles = new Map<string, SusuCustomerCycle[]>();

function mapPolicy(row: Record<string, unknown>): SusuCommissionPolicy {
  return susuCommissionPolicySchema.parse({
    id: row.id,
    tenantId: row.tenant_id,
    version: Number(row.version),
    enabled: row.enabled !== false,
    currency: row.currency ?? "GHS",
    dailyContributionMode: row.daily_contribution_mode,
    defaultDailyContributionGhs: Number(row.default_daily_contribution_ghs ?? 0),
    cycleDays: Number(row.cycle_days),
    commissionBasis: row.commission_basis,
    commissionFixedAmount: Number(row.commission_fixed_amount ?? 0),
    commissionPercent: Number(row.commission_percent ?? 0),
    deductionTiming: row.deduction_timing,
    rolloverTreatment: row.rollover_treatment,
    partialAllocation: row.partial_allocation,
    earlyWithdrawalPolicy: row.early_withdrawal_policy,
    effectiveFrom: row.effective_from,
    createdByUserId: row.created_by_user_id ?? null,
    createdAt: row.created_at
  });
}

function mapCycle(row: Record<string, unknown>): SusuCustomerCycle {
  return susuCustomerCycleSchema.parse({
    id: row.id,
    tenantId: row.tenant_id,
    customerId: row.customer_id,
    branchId: row.branch_id,
    policyId: row.policy_id,
    policyVersion: Number(row.policy_version),
    cycleNumber: Number(row.cycle_number),
    status: row.status,
    dailyContributionAmount: Number(row.daily_contribution_amount),
    cycleDays: Number(row.cycle_days),
    commissionBasis: row.commission_basis,
    commissionAgreedAmount: Number(row.commission_agreed_amount),
    deductionTiming: row.deduction_timing,
    rolloverTreatment: row.rollover_treatment,
    partialAllocation: row.partial_allocation,
    earlyWithdrawalPolicy: row.early_withdrawal_policy,
    grossContributions: Number(row.gross_contributions ?? 0),
    customerSavingsCredited: Number(row.customer_savings_credited ?? 0),
    commissionEarned: Number(row.commission_earned ?? 0),
    commissionCollected: Number(row.commission_collected ?? 0),
    commissionOutstanding: Number(row.commission_outstanding ?? 0),
    collectionsCount: Number(row.collections_count ?? 0),
    contributionDays: Number(row.contribution_days ?? 0),
    openedAt: row.opened_at,
    firstCollectionAt: row.first_collection_at ?? null,
    maturedAt: row.matured_at ?? null,
    closedAt: row.closed_at ?? null,
    rolledFromCycleId: row.rolled_from_cycle_id ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  });
}

export async function getActiveSusuCommissionPolicy(tenantId: string): Promise<SusuCommissionPolicy> {
  const supabase = getSupabaseAdminClient();
  if (!supabase) {
    const list = memoryPolicies.get(tenantId) ?? [];
    if (list.length === 0) {
      const seeded = { ...defaultSusuCommissionPolicy(tenantId), id: randomUUID() };
      memoryPolicies.set(tenantId, [seeded]);
      return seeded;
    }
    return [...list].sort((a, b) => b.version - a.version)[0]!;
  }

  const { data, error } = await supabase
    .from("susu_commission_policies")
    .select("*")
    .eq("tenant_id", tenantId)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    throw new Error(`Failed to load Susu commission policy: ${error.message}`);
  }
  if (!data) {
    const seeded = defaultSusuCommissionPolicy(tenantId);
    const row = {
      id: randomUUID(),
      tenant_id: tenantId,
      version: 1,
      enabled: seeded.enabled,
      currency: "GHS",
      daily_contribution_mode: seeded.dailyContributionMode,
      default_daily_contribution_ghs: seeded.defaultDailyContributionGhs,
      cycle_days: seeded.cycleDays,
      commission_basis: seeded.commissionBasis,
      commission_fixed_amount: seeded.commissionFixedAmount,
      commission_percent: seeded.commissionPercent,
      deduction_timing: seeded.deductionTiming,
      rollover_treatment: seeded.rolloverTreatment,
      partial_allocation: seeded.partialAllocation,
      early_withdrawal_policy: seeded.earlyWithdrawalPolicy,
      effective_from: seeded.effectiveFrom,
      created_by_user_id: "system",
      created_at: new Date().toISOString()
    };
    const { data: inserted, error: insertError } = await supabase
      .from("susu_commission_policies")
      .insert(row)
      .select("*")
      .single();
    if (insertError) {
      // Concurrent seed — re-read
      const { data: raced } = await supabase
        .from("susu_commission_policies")
        .select("*")
        .eq("tenant_id", tenantId)
        .order("version", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (raced) {
        return mapPolicy(raced as Record<string, unknown>);
      }
      throw new Error(`Failed to seed Susu commission policy: ${insertError.message}`);
    }
    return mapPolicy(inserted as Record<string, unknown>);
  }
  return mapPolicy(data as Record<string, unknown>);
}

export async function publishSusuCommissionPolicy(
  context: Ctx,
  input: UpdateSusuCommissionPolicyInput | SusuCommissionPolicy
): Promise<SusuCommissionPolicy> {
  const parsed = updateSusuCommissionPolicySchema.parse(input);
  const current = await getActiveSusuCommissionPolicy(context.tenantId).catch(() => null);
  const nextVersion = (current?.version ?? 0) + 1;
  const supabase = getSupabaseAdminClient();
  const effectiveFrom = parsed.effectiveFrom ?? new Date().toISOString().slice(0, 10);

  if (!supabase) {
    const policy: SusuCommissionPolicy = {
      id: randomUUID(),
      tenantId: context.tenantId,
      version: nextVersion,
      ...parsed,
      currency: "GHS",
      effectiveFrom,
      createdByUserId: context.userId,
      createdAt: new Date().toISOString()
    };
    const list = memoryPolicies.get(context.tenantId) ?? [];
    memoryPolicies.set(context.tenantId, [policy, ...list]);
    return policy;
  }

  const row = {
    id: randomUUID(),
    tenant_id: context.tenantId,
    version: nextVersion,
    enabled: parsed.enabled,
    currency: "GHS",
    daily_contribution_mode: parsed.dailyContributionMode,
    default_daily_contribution_ghs: parsed.defaultDailyContributionGhs,
    cycle_days: parsed.cycleDays,
    commission_basis: parsed.commissionBasis,
    commission_fixed_amount: parsed.commissionFixedAmount ?? 0,
    commission_percent: parsed.commissionPercent ?? 0,
    deduction_timing: parsed.deductionTiming,
    rollover_treatment: parsed.rolloverTreatment,
    partial_allocation: parsed.partialAllocation,
    early_withdrawal_policy: parsed.earlyWithdrawalPolicy,
    effective_from: effectiveFrom,
    created_by_user_id: context.userId,
    created_at: new Date().toISOString()
  };

  const { data, error } = await supabase.from("susu_commission_policies").insert(row).select("*").single();
  if (error) {
    throw new Error(`Failed to save Susu commission policy: ${error.message}`);
  }
  return mapPolicy(data as Record<string, unknown>);
}

async function getOpenCycle(
  tenantId: string,
  customerId: string
): Promise<SusuCustomerCycle | null> {
  const supabase = getSupabaseAdminClient();
  if (!supabase) {
    return (
      (memoryCycles.get(tenantId) ?? []).find(
        (c) => c.customerId === customerId && c.status === "open"
      ) ?? null
    );
  }
  const { data, error } = await supabase
    .from("susu_customer_cycles")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("customer_id", customerId)
    .eq("status", "open")
    .maybeSingle();
  if (error) {
    throw new Error(`Failed to load Susu cycle: ${error.message}`);
  }
  return data ? mapCycle(data as Record<string, unknown>) : null;
}

async function nextCycleNumber(tenantId: string, customerId: string): Promise<number> {
  const supabase = getSupabaseAdminClient();
  if (!supabase) {
    const max = (memoryCycles.get(tenantId) ?? [])
      .filter((c) => c.customerId === customerId)
      .reduce((m, c) => Math.max(m, c.cycleNumber), 0);
    return max + 1;
  }
  const { data } = await supabase
    .from("susu_customer_cycles")
    .select("cycle_number")
    .eq("tenant_id", tenantId)
    .eq("customer_id", customerId)
    .order("cycle_number", { ascending: false })
    .limit(1)
    .maybeSingle();
  return Number(data?.cycle_number ?? 0) + 1;
}

/**
 * Commission / cycle daily plan comes from the customer's registered
 * daily Susu amount — not a tenant-wide fixed fee and not the payment size.
 */
async function resolveRegisteredDailyContribution(
  tenantId: string,
  customerId: string,
  hintedAmount?: number
): Promise<number> {
  if (hintedAmount != null && hintedAmount > 0) {
    return roundMoney(hintedAmount);
  }
  const supabase = getSupabaseAdminClient();
  if (supabase) {
    const { data } = await supabase
      .from("customers")
      .select("daily_contribution_amount")
      .eq("tenant_id", tenantId)
      .eq("id", customerId)
      .maybeSingle();
    const registered = Number(data?.daily_contribution_amount ?? 0);
    if (registered > 0) {
      return roundMoney(registered);
    }
  } else {
    try {
      const { getCustomerById } = await import("./customerService.js");
      const customer = await getCustomerById(tenantId, customerId);
      const registered = Number(customer?.dailyContributionAmount ?? 0);
      if (registered > 0) {
        return roundMoney(registered);
      }
    } catch {
      /* fall through */
    }
  }
  return 0;
}

async function openCycle(options: {
  context: Ctx;
  customerId: string;
  branchId: string;
  dailyContributionAmount: number;
  rolledFromCycleId?: string;
}): Promise<SusuCustomerCycle> {
  const policy = await getActiveSusuCommissionPolicy(options.context.tenantId);
  if (!policy.enabled || policy.commissionBasis === "none") {
    // Still open a tracking cycle with zero commission when policy disabled? Skip cycles if disabled.
  }
  const policyId = policy.id ?? randomUUID();
  if (!policy.id) {
    (policy as SusuCommissionPolicy).id = policyId;
  }
  // Prefer registration daily; policy default only when customer has none saved.
  const daily =
    options.dailyContributionAmount > 0
      ? options.dailyContributionAmount
      : policy.defaultDailyContributionGhs;
  const agreed = policy.enabled
    ? computeAgreedCommissionAmount(policy, daily)
    : 0;
  const cycleNumber = await nextCycleNumber(options.context.tenantId, options.customerId);
  const now = new Date().toISOString();
  const cycle: SusuCustomerCycle = {
    id: randomUUID(),
    tenantId: options.context.tenantId,
    customerId: options.customerId,
    branchId: options.branchId,
    policyId,
    policyVersion: policy.version,
    cycleNumber,
    status: "open",
    dailyContributionAmount: daily,
    cycleDays: policy.cycleDays,
    commissionBasis: policy.commissionBasis,
    commissionAgreedAmount: agreed,
    deductionTiming: policy.deductionTiming,
    rolloverTreatment: policy.rolloverTreatment,
    partialAllocation: policy.partialAllocation,
    earlyWithdrawalPolicy: policy.earlyWithdrawalPolicy,
    grossContributions: 0,
    customerSavingsCredited: 0,
    commissionEarned: agreed,
    commissionCollected: 0,
    commissionOutstanding: agreed,
    collectionsCount: 0,
    contributionDays: 0,
    openedAt: now,
    firstCollectionAt: null,
    maturedAt: null,
    closedAt: null,
    rolledFromCycleId: options.rolledFromCycleId ?? null,
    createdAt: now,
    updatedAt: now
  };

  const supabase = getSupabaseAdminClient();
  if (!supabase) {
    const list = memoryCycles.get(options.context.tenantId) ?? [];
    memoryCycles.set(options.context.tenantId, [cycle, ...list]);
    return cycle;
  }

  // Ensure policy row exists
  if (!policy.id || policy.version === 1) {
    await publishSusuCommissionPolicy(options.context, policy).catch(() => undefined);
  }

  const { data: latestPolicy } = await supabase
    .from("susu_commission_policies")
    .select("id, version")
    .eq("tenant_id", options.context.tenantId)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();

  const resolvedPolicyId = String(latestPolicy?.id ?? policyId);
  const resolvedVersion = Number(latestPolicy?.version ?? policy.version);

  const { data, error } = await supabase
    .from("susu_customer_cycles")
    .insert({
      id: cycle.id,
      tenant_id: cycle.tenantId,
      customer_id: cycle.customerId,
      branch_id: cycle.branchId,
      policy_id: resolvedPolicyId,
      policy_version: resolvedVersion,
      cycle_number: cycle.cycleNumber,
      status: cycle.status,
      daily_contribution_amount: cycle.dailyContributionAmount,
      cycle_days: cycle.cycleDays,
      commission_basis: cycle.commissionBasis,
      commission_agreed_amount: cycle.commissionAgreedAmount,
      deduction_timing: cycle.deductionTiming,
      rollover_treatment: cycle.rolloverTreatment,
      partial_allocation: cycle.partialAllocation,
      early_withdrawal_policy: cycle.earlyWithdrawalPolicy,
      gross_contributions: 0,
      customer_savings_credited: 0,
      commission_earned: cycle.commissionEarned,
      commission_collected: 0,
      commission_outstanding: cycle.commissionOutstanding,
      collections_count: 0,
      contribution_days: 0,
      opened_at: now,
      rolled_from_cycle_id: cycle.rolledFromCycleId,
      created_at: now,
      updated_at: now
    })
    .select("*")
    .single();
  if (error) {
    throw new Error(`Failed to open Susu cycle: ${error.message}`);
  }
  return mapCycle(data as Record<string, unknown>);
}

async function saveCycle(cycle: SusuCustomerCycle): Promise<SusuCustomerCycle> {
  const supabase = getSupabaseAdminClient();
  const now = new Date().toISOString();
  const next = { ...cycle, updatedAt: now };
  if (!supabase) {
    const list = memoryCycles.get(cycle.tenantId) ?? [];
    memoryCycles.set(
      cycle.tenantId,
      list.map((c) => (c.id === cycle.id ? next : c))
    );
    return next;
  }
  const { data, error } = await supabase
    .from("susu_customer_cycles")
    .update({
      status: next.status,
      gross_contributions: next.grossContributions,
      customer_savings_credited: next.customerSavingsCredited,
      commission_earned: next.commissionEarned,
      commission_collected: next.commissionCollected,
      commission_outstanding: next.commissionOutstanding,
      collections_count: next.collectionsCount,
      contribution_days: next.contributionDays,
      first_collection_at: next.firstCollectionAt,
      matured_at: next.maturedAt,
      closed_at: next.closedAt,
      updated_at: now
    })
    .eq("id", next.id)
    .eq("tenant_id", next.tenantId)
    .select("*")
    .single();
  if (error) {
    throw new Error(`Failed to update Susu cycle: ${error.message}`);
  }
  return mapCycle(data as Record<string, unknown>);
}

async function postCommissionIncome(
  context: Ctx,
  options: {
    branchId: string;
    customerId: string;
    amount: number;
    transactionId?: string;
    cycleId: string;
    note: string;
    idempotencyKey: string;
  }
): Promise<void> {
  if (options.amount <= 0) {
    return;
  }
  const branches = await listBranches(context.tenantId).catch(() => []);
  const branchName = branches.find((b) => b.id === options.branchId)?.name ?? "Branch";
  await postInstitutionalIncome(
    context,
    {
      branchId: options.branchId,
      source: "susu_commission",
      amount: options.amount,
      customerId: options.customerId,
      transactionId: options.transactionId,
      notes: options.note,
      idempotencyKey: options.idempotencyKey
    },
    { branchName }
  );
}

export type SusuCollectionApplyResult = {
  /** Net amount to credit the customer ledger. */
  savingsCredit: number;
  /** Institutional commission collected on this posting (first-day and/or maturity). */
  commissionCollectNow: number;
  grossContribution: number;
  cycle: SusuCustomerCycle | null;
  note?: string;
};

/** Apply Susu cycle rules to a daily_susu collection. Susu accounts only. */
export async function applySusuCollectionToCycle(
  context: Ctx,
  options: {
    customerId: string;
    branchId: string;
    paymentAmount: number;
    dailyContributionAmount?: number;
    businessDate?: string;
    transactionId?: string;
  }
): Promise<SusuCollectionApplyResult> {
  const policy = await getActiveSusuCommissionPolicy(context.tenantId);
  if (!policy.enabled) {
    return {
      savingsCredit: roundMoney(options.paymentAmount),
      commissionCollectNow: 0,
      grossContribution: roundMoney(options.paymentAmount),
      cycle: null
    };
  }

  const registeredDaily = await resolveRegisteredDailyContribution(
    context.tenantId,
    options.customerId,
    options.dailyContributionAmount
  );

  let cycle = await getOpenCycle(context.tenantId, options.customerId);
  if (!cycle) {
    cycle = await openCycle({
      context,
      customerId: options.customerId,
      branchId: options.branchId,
      dailyContributionAmount:
        registeredDaily > 0 ? registeredDaily : policy.defaultDailyContributionGhs
    });
  } else if (
    registeredDaily > 0 &&
    cycle.commissionCollected <= 0 &&
    cycle.collectionsCount <= 0 &&
    (cycle.commissionBasis === "first_day" || cycle.commissionBasis === "percentage")
  ) {
    // Correct cycles opened before registration daily was wired (or with wrong default).
    const agreed = computeAgreedCommissionAmount(
      {
        commissionBasis: cycle.commissionBasis,
        commissionFixedAmount: policy.commissionFixedAmount,
        commissionPercent: policy.commissionPercent,
        cycleDays: cycle.cycleDays
      },
      registeredDaily
    );
    if (
      roundMoney(cycle.dailyContributionAmount) !== registeredDaily ||
      roundMoney(cycle.commissionAgreedAmount) !== agreed
    ) {
      cycle = await saveCycle({
        ...cycle,
        dailyContributionAmount: registeredDaily,
        commissionAgreedAmount: agreed,
        commissionEarned: agreed,
        commissionOutstanding: agreed
      });
    }
  }

  const allocation = allocateSusuCollection({
    paymentAmount: options.paymentAmount,
    commissionOutstanding: cycle.commissionOutstanding,
    commissionAgreedAmount: cycle.commissionAgreedAmount,
    commissionCollected: cycle.commissionCollected,
    deductionTiming: cycle.deductionTiming,
    partialAllocation: cycle.partialAllocation
  });

  const businessDate = options.businessDate ?? new Date().toISOString().slice(0, 10);
  const previousDays = cycle.contributionDays;
  // Count this posting as a contribution slot toward cycle length.
  const collectionsCount = cycle.collectionsCount + 1;
  const contributionDays = previousDays + 1;

  let commissionCollectNow = allocation.commissionCollectNow;
  let savingsCredit = allocation.savingsCredit;

  let status = cycle.status;
  let maturedAt = cycle.maturedAt ?? null;
  const reachedMaturity = contributionDays >= cycle.cycleDays || collectionsCount >= cycle.cycleDays;

  // Maturity method: when the cycle completes, withhold remaining agreed fee from this credit
  // (same fee as first-day — never a second charge).
  if (reachedMaturity && cycle.deductionTiming === "cycle_maturity") {
    const stillOwed = roundMoney(
      Math.max(0, cycle.commissionAgreedAmount - (cycle.commissionCollected + commissionCollectNow))
    );
    if (stillOwed > 0) {
      const fromThisCredit = roundMoney(Math.min(savingsCredit, stillOwed));
      savingsCredit = roundMoney(savingsCredit - fromThisCredit);
      commissionCollectNow = roundMoney(commissionCollectNow + fromThisCredit);
      // If still owed beyond this payment, leave outstanding for withdrawal settlement.
    }
  }

  if (reachedMaturity) {
    status = "matured";
    maturedAt = new Date().toISOString();
  }

  const commissionCollected = roundMoney(cycle.commissionCollected + commissionCollectNow);
  const commissionOutstanding = roundMoney(
    Math.max(0, cycle.commissionAgreedAmount - commissionCollected)
  );

  if (commissionCollectNow > 0 && options.transactionId) {
    await postCommissionIncome(context, {
      branchId: options.branchId,
      customerId: options.customerId,
      amount: commissionCollectNow,
      transactionId: options.transactionId,
      cycleId: cycle.id,
      note: `Susu cycle #${cycle.cycleNumber} commission (${cycle.deductionTiming})`,
      idempotencyKey: `susu_commission:collect:${options.transactionId}`
    });
  }

  const updated = await saveCycle({
    ...cycle,
    grossContributions: roundMoney(cycle.grossContributions + allocation.grossContribution),
    customerSavingsCredited: roundMoney(cycle.customerSavingsCredited + savingsCredit),
    commissionCollected,
    commissionOutstanding,
    collectionsCount,
    contributionDays,
    firstCollectionAt: cycle.firstCollectionAt ?? new Date().toISOString(),
    status,
    maturedAt
  });

  const noteParts = [
    `Susu cycle #${updated.cycleNumber}`,
    `gross GHS ${allocation.grossContribution.toFixed(2)}`,
    commissionCollectNow > 0 ? `commission GHS ${commissionCollectNow.toFixed(2)}` : null,
    `savings GHS ${savingsCredit.toFixed(2)}`
  ].filter(Boolean);

  return {
    savingsCredit,
    commissionCollectNow,
    grossContribution: allocation.grossContribution,
    cycle: updated,
    note: noteParts.join(" · ")
  };
}

export type SusuWithdrawalCommissionResult = {
  commissionToCollect: number;
  blocked: boolean;
  blockReason?: string;
  cycle: SusuCustomerCycle | null;
  note?: string;
};

/** Resolve deferred / early-withdrawal commission before paying out a Susu customer. */
export async function resolveSusuWithdrawalCommission(
  context: Ctx,
  options: {
    customerId: string;
    branchId: string;
    requestedWithdrawalAmount: number;
    transactionId?: string;
    disclosureId?: string;
  }
): Promise<SusuWithdrawalCommissionResult> {
  const cycle = await getOpenCycle(context.tenantId, options.customerId);
  // Also check matured-but-not-closed cycles with outstanding
  let active = cycle;
  if (!active) {
    const supabase = getSupabaseAdminClient();
    if (supabase) {
      const { data } = await supabase
        .from("susu_customer_cycles")
        .select("*")
        .eq("tenant_id", context.tenantId)
        .eq("customer_id", options.customerId)
        .in("status", ["open", "matured"])
        .order("cycle_number", { ascending: false })
        .limit(1)
        .maybeSingle();
      active = data ? mapCycle(data as Record<string, unknown>) : null;
    } else {
      active =
        (memoryCycles.get(context.tenantId) ?? []).find(
          (c) =>
            c.customerId === options.customerId &&
            (c.status === "open" || c.status === "matured") &&
            c.commissionOutstanding > 0
        ) ?? null;
    }
  }

  if (!active || active.commissionOutstanding <= 0) {
    return { commissionToCollect: 0, blocked: false, cycle: active };
  }

  const early = active.collectionsCount < active.cycleDays;
  if (early && active.earlyWithdrawalPolicy === "block") {
    return {
      commissionToCollect: 0,
      blocked: true,
      blockReason: "Early withdrawal is blocked until the Susu cycle matures.",
      cycle: active
    };
  }

  let toCollect = active.commissionOutstanding;
  if (early && active.earlyWithdrawalPolicy === "waive") {
    const waived = await saveCycle({
      ...active,
      commissionOutstanding: 0,
      commissionEarned: active.commissionCollected,
      status: active.status === "open" ? "closed" : active.status,
      closedAt: active.closedAt ?? new Date().toISOString()
    });
    return { commissionToCollect: 0, blocked: false, cycle: waived, note: "Commission waived on early withdrawal" };
  }
  if (early && active.earlyWithdrawalPolicy === "deduct_pro_rata") {
    const ratio = Math.min(1, active.collectionsCount / Math.max(1, active.cycleDays));
    toCollect = roundMoney(active.commissionAgreedAmount * ratio - active.commissionCollected);
    toCollect = Math.max(0, toCollect);
  }

  // withdrawal timing or early deduct_full / maturity leftover
  if (
    active.deductionTiming !== "withdrawal" &&
    !early &&
    active.commissionOutstanding > 0 &&
    active.deductionTiming === "cycle_maturity"
  ) {
    // already should have been taken at maturity; collect remainder if any
  }

  if (toCollect <= 0) {
    return { commissionToCollect: 0, blocked: false, cycle: active };
  }

  const idempotencyKey = options.transactionId
    ? `susu_commission:withdrawal:${options.transactionId}`
    : options.disclosureId
      ? `susu_commission:withdrawal-disclosure:${options.disclosureId}`
      : `susu_commission:withdrawal:${active.id}:${Date.now()}`;

  await postCommissionIncome(context, {
    branchId: options.branchId || active.branchId,
    customerId: options.customerId,
    amount: toCollect,
    transactionId: options.transactionId,
    cycleId: active.id,
    note: `Susu cycle #${active.cycleNumber} commission on withdrawal`,
    idempotencyKey
  });

  const updated = await saveCycle({
    ...active,
    commissionCollected: roundMoney(active.commissionCollected + toCollect),
    commissionOutstanding: roundMoney(Math.max(0, active.commissionOutstanding - toCollect)),
    status: "closed",
    closedAt: new Date().toISOString()
  });

  return {
    commissionToCollect: toCollect,
    blocked: false,
    cycle: updated,
    note: `Commission GHS ${toCollect.toFixed(2)} deducted`
  };
}

export async function getCustomerSusuCycleSummary(
  tenantId: string,
  customerId: string
): Promise<{ openCycle: SusuCustomerCycle | null; policy: SusuCommissionPolicy }> {
  const policy = await getActiveSusuCommissionPolicy(tenantId);
  const openCycle = await getOpenCycle(tenantId, customerId);
  return { openCycle, policy };
}
