import { randomUUID } from "node:crypto";
import {
  allocateSusuCollection,
  buildSusuCustomerPassbook,
  computeAgreedCommissionAmount,
  defaultSusuCommissionPolicy,
  extractGrossSusuContribution,
  roundMoney,
  susuCommissionPolicySchema,
  susuCustomerCycleSchema,
  updateSusuCommissionPolicySchema,
  type SusuCommissionPolicy,
  type SusuCustomerCycle,
  type SusuCustomerCycleSummary,
  type SusuPassbookCollectionInput,
  type UpdateSusuCommissionPolicyInput
} from "@bms/shared";
import { getSupabaseAdminClient } from "../config/supabaseClient.js";
import {
  postInstitutionalIncome,
  reverseInstitutionalIncome
} from "./institutionalIncomeService.js";
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

/** Apply Susu cycle rules to a daily_susu collection (box counting + overflow). Susu accounts only. */
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
  const totalGross = roundMoney(Math.max(0, options.paymentAmount));
  if (!policy.enabled || totalGross <= 0) {
    return {
      savingsCredit: totalGross,
      commissionCollectNow: 0,
      grossContribution: totalGross,
      cycle: null
    };
  }

  const registeredDaily = await resolveRegisteredDailyContribution(
    context.tenantId,
    options.customerId,
    options.dailyContributionAmount
  );
  const fallbackDaily =
    registeredDaily > 0 ? registeredDaily : policy.defaultDailyContributionGhs;

  let cycle = await getOpenCycle(context.tenantId, options.customerId);
  if (!cycle) {
    cycle = await openCycle({
      context,
      customerId: options.customerId,
      branchId: options.branchId,
      dailyContributionAmount: fallbackDaily
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

  const EPS = 0.005;
  let remainingPayment = totalGross;
  let totalCommission = 0;
  let totalSavings = 0;
  let latestCycle: SusuCustomerCycle = cycle;
  const touchedCards: number[] = [];
  let sliceIndex = 0;

  while (remainingPayment > EPS && sliceIndex < 24) {
    const daily = roundMoney(cycle.dailyContributionAmount);
    let sliceAmount = remainingPayment;
    let nextContributionDays = cycle.contributionDays + 1;
    let reachedMaturity = false;

    if (daily > 0) {
      const cardCapacity = roundMoney(daily * cycle.cycleDays);
      const cardRemaining = roundMoney(Math.max(0, cardCapacity - cycle.grossContributions));
      if (cardRemaining <= EPS) {
        // Current open card is already full — mature it and roll into the next card.
        const matured = await saveCycle({
          ...cycle,
          status: "matured",
          maturedAt: cycle.maturedAt ?? new Date().toISOString()
        });
        cycle = await openCycle({
          context,
          customerId: options.customerId,
          branchId: options.branchId,
          dailyContributionAmount: fallbackDaily,
          rolledFromCycleId: matured.id
        });
        latestCycle = cycle;
        continue;
      }
      sliceAmount = roundMoney(Math.min(remainingPayment, cardRemaining));
      const nextGross = roundMoney(cycle.grossContributions + sliceAmount);
      // Full boxes covered = floor(gross / daily); partial remainder waits on the next box.
      nextContributionDays = Math.min(cycle.cycleDays, Math.floor((nextGross + 0.0001) / daily));
      reachedMaturity = nextContributionDays >= cycle.cycleDays || nextGross >= cardCapacity - EPS;
    } else {
      reachedMaturity = nextContributionDays >= cycle.cycleDays;
    }

    const allocation = allocateSusuCollection({
      paymentAmount: sliceAmount,
      commissionOutstanding: cycle.commissionOutstanding,
      commissionAgreedAmount: cycle.commissionAgreedAmount,
      commissionCollected: cycle.commissionCollected,
      deductionTiming: cycle.deductionTiming,
      partialAllocation: cycle.partialAllocation
    });

    let sliceCommission = allocation.commissionCollectNow;
    let sliceSavings = allocation.savingsCredit;

    // Maturity method: when the cycle completes, withhold remaining agreed fee from this credit
    // (same fee as first-day — never a second charge).
    if (reachedMaturity && cycle.deductionTiming === "cycle_maturity") {
      const stillOwed = roundMoney(
        Math.max(0, cycle.commissionAgreedAmount - (cycle.commissionCollected + sliceCommission))
      );
      if (stillOwed > 0) {
        const fromThisCredit = roundMoney(Math.min(sliceSavings, stillOwed));
        sliceSavings = roundMoney(sliceSavings - fromThisCredit);
        sliceCommission = roundMoney(sliceCommission + fromThisCredit);
      }
    }

    const commissionCollected = roundMoney(cycle.commissionCollected + sliceCommission);
    const commissionOutstanding = roundMoney(
      Math.max(0, cycle.commissionAgreedAmount - commissionCollected)
    );

    if (sliceCommission > 0 && options.transactionId) {
      await postCommissionIncome(context, {
        branchId: options.branchId,
        customerId: options.customerId,
        amount: sliceCommission,
        transactionId: options.transactionId,
        cycleId: cycle.id,
        note: `Susu card #${cycle.cycleNumber} commission (${cycle.deductionTiming})`,
        idempotencyKey:
          sliceIndex === 0
            ? `susu_commission:collect:${options.transactionId}`
            : `susu_commission:collect:${options.transactionId}:cycle:${cycle.cycleNumber}`
      });
    }

    const updated = await saveCycle({
      ...cycle,
      grossContributions: roundMoney(cycle.grossContributions + sliceAmount),
      customerSavingsCredited: roundMoney(cycle.customerSavingsCredited + sliceSavings),
      commissionCollected,
      commissionOutstanding,
      collectionsCount: cycle.collectionsCount + 1,
      contributionDays: nextContributionDays,
      firstCollectionAt: cycle.firstCollectionAt ?? new Date().toISOString(),
      status: reachedMaturity ? "matured" : cycle.status,
      maturedAt: reachedMaturity ? cycle.maturedAt ?? new Date().toISOString() : cycle.maturedAt
    });

    latestCycle = updated;
    touchedCards.push(updated.cycleNumber);
    totalCommission = roundMoney(totalCommission + sliceCommission);
    totalSavings = roundMoney(totalSavings + sliceSavings);
    remainingPayment = roundMoney(remainingPayment - sliceAmount);
    sliceIndex += 1;

    if (remainingPayment > EPS && reachedMaturity) {
      cycle = await openCycle({
        context,
        customerId: options.customerId,
        branchId: options.branchId,
        dailyContributionAmount: fallbackDaily,
        rolledFromCycleId: updated.id
      });
      latestCycle = cycle;
    }
  }

  const cardLabel =
    touchedCards.length > 1
      ? `Susu cards #${touchedCards[0]}–#${touchedCards[touchedCards.length - 1]}`
      : `Susu cycle #${latestCycle.cycleNumber}`;
  const noteParts = [
    cardLabel,
    `gross GHS ${totalGross.toFixed(2)}`,
    totalCommission > 0 ? `commission GHS ${totalCommission.toFixed(2)}` : null,
    `savings GHS ${totalSavings.toFixed(2)}`
  ].filter(Boolean);

  return {
    savingsCredit: totalSavings,
    commissionCollectNow: totalCommission,
    grossContribution: totalGross,
    cycle: latestCycle,
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

  const early = active.contributionDays < active.cycleDays;
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
    const ratio = Math.min(1, active.contributionDays / Math.max(1, active.cycleDays));
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

async function listCustomerCycles(
  tenantId: string,
  customerId: string
): Promise<SusuCustomerCycle[]> {
  const supabase = getSupabaseAdminClient();
  if (!supabase) {
    return (memoryCycles.get(tenantId) ?? [])
      .filter((c) => c.customerId === customerId)
      .sort((a, b) => a.cycleNumber - b.cycleNumber);
  }
  const { data, error } = await supabase
    .from("susu_customer_cycles")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("customer_id", customerId)
    .order("cycle_number", { ascending: true });
  if (error) {
    throw new Error(`Failed to load customer Susu cycles: ${error.message}`);
  }
  return (data ?? []).map((row) => mapCycle(row as Record<string, unknown>));
}

const NON_SUSU_BRIDGE_DEPOSIT_TAGS = [
  "loan_disburse:",
  "loan_repay_reverse:",
  "loan_repay:"
];

function isExcludedNonSusuDepositNote(notes?: string | null): boolean {
  if (!notes) {
    return false;
  }
  const lower = notes.toLowerCase();
  return NON_SUSU_BRIDGE_DEPOSIT_TAGS.some((tag) => lower.includes(tag));
}

async function loadCustomerNonReversedSusuCollections(
  tenantId: string,
  customerId: string
): Promise<SusuPassbookCollectionInput[]> {
  const supabase = getSupabaseAdminClient();
  if (!supabase) {
    const { listTransactions } = await import("./transactionService.js");
    const all = await listTransactions(tenantId);
    return all
      .filter(
        (tx) =>
          tx.customerId === customerId &&
          (tx.type === "daily_susu" || tx.type === "deposit") &&
          !isExcludedNonSusuDepositNote(tx.notes) &&
          !tx.reversedAt &&
          !tx.reversedByTransactionId
      )
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
      .map((tx) => ({
        id: tx.id,
        grossAmount: extractGrossSusuContribution(tx.amount, tx.notes),
        ledgerAmount: roundMoney(Math.max(0, Number(tx.amount ?? 0))),
        createdAt: tx.createdAt
      }));
  }

  const { data, error } = await supabase
    .from("customer_transactions")
    .select("id, type, amount, notes, created_at, reversed_at, reversed_by_transaction_id, execution_status")
    .eq("tenant_id", tenantId)
    .eq("customer_id", customerId)
    .in("type", ["daily_susu", "deposit"])
    .is("reversed_at", null)
    .is("reversed_by_transaction_id", null)
    .order("created_at", { ascending: true })
    .limit(5000);
  if (error) {
    throw new Error(`Failed to load Susu collections: ${error.message}`);
  }
  return (data ?? [])
    .filter(
      (row) =>
        (!row.execution_status || row.execution_status === "completed") &&
        !isExcludedNonSusuDepositNote(row.notes as string | null)
    )
    .map((row) => ({
      id: String(row.id),
      grossAmount: extractGrossSusuContribution(Number(row.amount ?? 0), row.notes as string | null),
      ledgerAmount: roundMoney(Math.max(0, Number(row.amount ?? 0))),
      createdAt: String(row.created_at)
    }));
}

async function loadCustomerLedgerTotals(
  tenantId: string,
  customerId: string
): Promise<{ totalCredits: number; totalDebits: number; accountBalance: number }> {
  const supabase = getSupabaseAdminClient();
  if (!supabase) {
    const { getCustomerLedger } = await import("./ledgerService.js");
    const entries = await getCustomerLedger(tenantId, customerId);
    let totalCredits = 0;
    let totalDebits = 0;
    for (const e of entries) {
      if (e.entryType === "credit") {
        totalCredits += Number(e.amount ?? 0);
      } else {
        totalDebits += Number(e.amount ?? 0);
      }
    }
    const accountBalance =
      entries.length > 0 ? Number(entries[entries.length - 1]!.balanceAfter ?? 0) : 0;
    return {
      totalCredits: roundMoney(totalCredits),
      totalDebits: roundMoney(totalDebits),
      accountBalance: roundMoney(accountBalance)
    };
  }

  const { data, error } = await supabase
    .from("ledger_entries")
    .select("entry_type, amount, balance_after")
    .eq("tenant_id", tenantId)
    .eq("customer_id", customerId)
    .order("created_at", { ascending: true })
    .limit(10000);
  if (error) {
    throw new Error(`Failed to load ledger reconciliation: ${error.message}`);
  }
  let totalCredits = 0;
  let totalDebits = 0;
  for (const row of data ?? []) {
    const amt = Number(row.amount ?? 0);
    if (row.entry_type === "credit") {
      totalCredits += amt;
    } else {
      totalDebits += amt;
    }
  }
  const accountBalance =
    data && data.length > 0
      ? Number(data[data.length - 1]!.balance_after ?? roundMoney(totalCredits - totalDebits))
      : 0;
  return {
    totalCredits: roundMoney(totalCredits),
    totalDebits: roundMoney(totalDebits),
    accountBalance: roundMoney(accountBalance)
  };
}

/**
 * After a daily_susu collection is reversed:
 * 1. Reverse any institutional income posted from that transaction.
 * 2. Reconcile persisted Susu cycles from the remaining non-reversed collections so
 *    unchecked boxes and overflow cards stay in sync.
 */
export async function reverseSusuCollectionFromCycles(
  context: Ctx,
  options: {
    customerId: string;
    transactionId: string;
    reason: string;
  }
): Promise<void> {
  const supabase = getSupabaseAdminClient();

  // 1. Reverse any active institutional commission entries tied to this collection.
  if (supabase) {
    const { data: incomeRows } = await supabase
      .from("institutional_income_entries")
      .select("id")
      .eq("tenant_id", context.tenantId)
      .eq("transaction_id", options.transactionId)
      .eq("source", "susu_commission")
      .is("reversed_at", null)
      .is("reverses_entry_id", null);
    for (const row of incomeRows ?? []) {
      await reverseInstitutionalIncome(context, {
        entryId: String(row.id),
        reason: `Susu collection reversed: ${options.reason}`
      }).catch(() => undefined);
    }
  }

  // 2. Rebuild passbook from remaining non-reversed collections and sync persisted cycles.
  const [policy, cycles, collections, registeredDaily] = await Promise.all([
    getActiveSusuCommissionPolicy(context.tenantId),
    listCustomerCycles(context.tenantId, options.customerId),
    loadCustomerNonReversedSusuCollections(context.tenantId, options.customerId),
    resolveRegisteredDailyContribution(context.tenantId, options.customerId)
  ]);

  if (cycles.length === 0) {
    return;
  }

  const passbook = buildSusuCustomerPassbook({
    customerId: options.customerId,
    dailyContributionAmount: registeredDaily,
    policy,
    cycles,
    collections
  });
  const cardByNumber = new Map(passbook.cards.map((c) => [c.cycleNumber, c]));

  // Demote/remove any overflow cycle that no longer exists in the rebuilt passbook first
  // so the unique partial index on status='open' never collides when re-opening an earlier card.
  const descending = [...cycles].sort((a, b) => b.cycleNumber - a.cycleNumber);
  for (const cycle of descending) {
    const rebuilt = cardByNumber.get(cycle.cycleNumber);
    if (!rebuilt) {
      if (supabase) {
        await supabase
          .from("susu_customer_cycles")
          .delete()
          .eq("tenant_id", context.tenantId)
          .eq("id", cycle.id);
      } else {
        const list = memoryCycles.get(context.tenantId) ?? [];
        memoryCycles.set(
          context.tenantId,
          list.filter((c) => c.id !== cycle.id)
        );
      }
      continue;
    }

    const txCount = new Set(rebuilt.boxes.flatMap((b) => b.transactionIds)).size;
    await saveCycle({
      ...cycle,
      grossContributions: rebuilt.grossContributions,
      customerSavingsCredited: rebuilt.customerSavingsCredited,
      commissionCollected: rebuilt.commissionCollected,
      commissionOutstanding: rebuilt.commissionOutstanding,
      contributionDays: rebuilt.checkedBoxes,
      collectionsCount: txCount,
      status: rebuilt.status,
      maturedAt: rebuilt.status === "open" ? null : (rebuilt.maturedAt ?? cycle.maturedAt)
    });
  }
}

export async function getCustomerSusuCycleSummary(
  tenantId: string,
  customerId: string
): Promise<SusuCustomerCycleSummary> {
  const [policy, cycles, collections, registeredDaily, ledgerTotals] = await Promise.all([
    getActiveSusuCommissionPolicy(tenantId),
    listCustomerCycles(tenantId, customerId),
    loadCustomerNonReversedSusuCollections(tenantId, customerId),
    resolveRegisteredDailyContribution(tenantId, customerId),
    loadCustomerLedgerTotals(tenantId, customerId)
  ]);
  const openCycle = cycles.find((c) => c.status === "open") ?? null;
  const passbookNetCredited = roundMoney(
    collections.reduce((sum, c) => sum + (c.ledgerAmount ?? c.grossAmount), 0)
  );
  const otherCredits = roundMoney(Math.max(0, ledgerTotals.totalCredits - passbookNetCredited));
  const passbook = buildSusuCustomerPassbook({
    customerId,
    dailyContributionAmount: registeredDaily,
    policy,
    cycles,
    collections,
    reconciliation: {
      totalWithdrawalsAndCharges: ledgerTotals.totalDebits,
      otherCredits,
      accountBalance: ledgerTotals.accountBalance
    }
  });
  return { openCycle, cycles, policy, passbook };
}
