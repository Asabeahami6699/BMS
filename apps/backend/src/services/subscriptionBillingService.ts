import {
  addSubscriptionInterval,
  assignTenantSubscriptionPlanSchema,
  daysBetweenUtcDates,
  rejectSubscriptionPaymentClaimSchema,
  FREE_SUBSCRIPTION_PLAN_ID,
  isFreeSubscriptionPlan,
  subscriptionClaimAmountGhs,
  submitSubscriptionPaymentClaimSchema,
  todayUtcDate,
  updatePlatformBillingSettingsSchema,
  type PlatformBillingSettings,
  type SubscriptionPackageTier,
  type SubscriptionPaymentClaim,
  type SubscriptionPlan,
  type TenantAddon,
  type TenantBillingStatus,
  type TenantProductModule
} from "@bms/shared";
import { getSupabaseAdminClient } from "../config/supabaseClient.js";
import { env } from "../config/env.js";
import { getTenantFromStore, upsertTenantInStore, type StoredTenant } from "./authStore.js";
import { sendArkeselSms } from "./arkeselSmsProvider.js";
import { hasArkeselSmsConfig } from "../config/env.js";
import { saveTenantAddons } from "./tenantAddonService.js";
import { saveTenantModules, toTenantRecord } from "./tenantModuleService.js";

type PlanRow = {
  id: string;
  name: string;
  description: string | null;
  interval: "month" | "year";
  price_ghs: number | string;
  setup_fee_ghs?: number | string | null;
  package_tier?: string | null;
  modules: string[] | null;
  addons: string[] | null;
  feature_bullets?: string[] | null;
  max_branches?: number | null;
  max_staff?: number | null;
  max_field_agents?: number | null;
  max_active_customers?: number | null;
  is_custom?: boolean | null;
  is_active: boolean | null;
  sort_order: number | null;
};

type ClaimRow = {
  id: string;
  tenant_id: string;
  plan_id: string;
  amount_ghs: number | string;
  momo_reference: string;
  payer_name: string | null;
  payer_number: string | null;
  notes: string | null;
  status: "pending" | "approved" | "rejected";
  reject_reason: string | null;
  submitted_by: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
};

type SettingsRow = {
  momo_number: string | null;
  momo_account_name: string | null;
  momo_network: string | null;
  reminder_days_before: number | null;
  grace_days: number | null;
};

const memoryPlans: SubscriptionPlan[] = [
  {
    id: FREE_SUBSCRIPTION_PLAN_ID,
    name: "BMS Free",
    description:
      "Free one-month access to core Susu site resources. No package or setup fee — you only pay SMS usage when you send messages. Capacity limits apply for the free month.",
    interval: "month",
    priceGhs: 0,
    setupFeeGhs: 0,
    packageTier: "free",
    modules: ["susu_management"],
    addons: ["email_notifications", "sms_notifications"],
    featureBullets: [
      "1 branch",
      "10 staff / users",
      "10 mobilizers (field agents)",
      "1,000 active customers",
      "Unlimited platform usage for one month within those limits",
      "Pay only for SMS usage (Arkesel) — no monthly package fee"
    ],
    maxBranches: 1,
    maxStaff: 10,
    maxFieldAgents: 10,
    maxActiveCustomers: 1000,
    isCustom: false,
    isActive: true,
    sortOrder: 5
  },
  {
    id: "pkg-susu-starter",
    name: "BMS Susu Starter",
    description:
      "Entry package for single-branch Susu operations. Monthly fee covers the platform seat; SMS is billed separately per message when the SMS add-on is used.",
    interval: "month",
    priceGhs: 399,
    setupFeeGhs: 500,
    packageTier: "entry",
    modules: ["susu_management"],
    addons: ["email_notifications"],
    featureBullets: [
      "1 branch",
      "5 staff",
      "5 field agents",
      "500 active customers",
      "Susu collections, callover, withdrawals, float management and basic reports",
      "SMS alerts billed separately per message (Arkesel)"
    ],
    maxBranches: 1,
    maxStaff: 5,
    maxFieldAgents: 5,
    maxActiveCustomers: 500,
    isCustom: false,
    isActive: true,
    sortOrder: 10
  },
  {
    id: "pkg-susu-professional",
    name: "BMS Susu Professional",
    description:
      "Growing Susu business package with stronger controls and reporting. SMS remains usage-based on top of the monthly package.",
    interval: "month",
    priceGhs: 699,
    setupFeeGhs: 750,
    packageTier: "growing",
    modules: ["susu_management"],
    addons: ["email_notifications", "sms_notifications", "multi_branch", "advanced_analytics"],
    featureBullets: [
      "3 branches",
      "15 staff",
      "20 field agents",
      "1,500 active customers",
      "Advanced reporting, reconciliation, performance tracking, group savings and enhanced controls",
      "SMS alerts billed separately per message (Arkesel)"
    ],
    maxBranches: 3,
    maxStaff: 15,
    maxFieldAgents: 20,
    maxActiveCustomers: 1500,
    isCustom: false,
    isActive: true,
    sortOrder: 20
  },
  {
    id: "pkg-financial-plus",
    name: "BMS Financial Plus",
    description:
      "Multi-product package for Susu + Agency Banking + Loans with shared customers and ledger.",
    interval: "month",
    priceGhs: 1199,
    setupFeeGhs: 1200,
    packageTier: "multi_product",
    modules: ["susu_management", "banking", "loans_credit", "treasury"],
    addons: [
      "email_notifications",
      "sms_notifications",
      "multi_branch",
      "mobile_money",
      "advanced_analytics"
    ],
    featureBullets: [
      "5 branches",
      "25 staff",
      "40 field agents",
      "2,500 active customers",
      "Susu, Agency Banking, Loans, shared customers and ledger, plus basic Treasury",
      "SMS alerts billed separately per message (Arkesel)"
    ],
    maxBranches: 5,
    maxStaff: 25,
    maxFieldAgents: 40,
    maxActiveCustomers: 2500,
    isCustom: false,
    isActive: true,
    sortOrder: 30
  },
  {
    id: "pkg-financial-institution",
    name: "BMS Financial Institution",
    description: "Institution package with full product suite, operations and audit workspaces.",
    interval: "month",
    priceGhs: 1999,
    setupFeeGhs: 2000,
    packageTier: "institution",
    modules: ["susu_management", "banking", "loans_credit", "treasury", "investment_management"],
    addons: [
      "email_notifications",
      "sms_notifications",
      "multi_branch",
      "mobile_money",
      "advanced_analytics",
      "api_access",
      "bulk_import",
      "custom_branding"
    ],
    featureBullets: [
      "10 branches",
      "50 staff",
      "100 field agents",
      "3,500 active customers",
      "Susu, Agency Banking, Loans, Investments, full Treasury, Operations, advanced reports and audit workspaces",
      "SMS alerts billed separately per message (Arkesel)"
    ],
    maxBranches: 10,
    maxStaff: 50,
    maxFieldAgents: 100,
    maxActiveCustomers: 3500,
    isCustom: false,
    isActive: true,
    sortOrder: 40
  },
  {
    id: "pkg-enterprise",
    name: "BMS Enterprise",
    description:
      "Custom contract for large deployments — capacity, integrations, migration and SLAs agreed in writing. Listed price is a starting monthly floor.",
    interval: "month",
    priceGhs: 3000,
    setupFeeGhs: 5000,
    packageTier: "enterprise",
    modules: ["susu_management", "banking", "loans_credit", "treasury", "investment_management"],
    addons: [
      "email_notifications",
      "sms_notifications",
      "multi_branch",
      "mobile_money",
      "advanced_analytics",
      "api_access",
      "bulk_import",
      "custom_branding"
    ],
    featureBullets: [
      "Custom branches, staff and customer capacity",
      "Custom integrations and onboarding",
      "Data migration and dedicated support arrangements",
      "Contract-specific service levels",
      "SMS alerts billed separately per message (Arkesel)"
    ],
    maxBranches: null,
    maxStaff: null,
    maxFieldAgents: null,
    maxActiveCustomers: null,
    isCustom: true,
    isActive: true,
    sortOrder: 50
  }
];

function parsePackageTier(value: string | null | undefined): SubscriptionPackageTier {
  if (
    value === "free" ||
    value === "entry" ||
    value === "growing" ||
    value === "multi_product" ||
    value === "institution" ||
    value === "enterprise" ||
    value === "standard"
  ) {
    return value;
  }
  return "standard";
}

let memorySettings: PlatformBillingSettings = {
  momoNumber: env.PLATFORM_MOMO_NUMBER ?? "",
  momoAccountName: env.PLATFORM_MOMO_ACCOUNT_NAME ?? "",
  momoNetwork: env.PLATFORM_MOMO_NETWORK ?? "MTN",
  reminderDaysBefore: 3,
  graceDays: 3
};

const memoryClaims = new Map<string, SubscriptionPaymentClaim>();

function mapPlan(row: PlanRow): SubscriptionPlan {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? "",
    interval: row.interval,
    priceGhs: Number(row.price_ghs),
    setupFeeGhs: Number(row.setup_fee_ghs ?? 0),
    packageTier: parsePackageTier(row.package_tier),
    modules: (row.modules ?? []) as TenantProductModule[],
    addons: (row.addons ?? []) as TenantAddon[],
    featureBullets: row.feature_bullets ?? [],
    maxBranches: row.max_branches ?? null,
    maxStaff: row.max_staff ?? null,
    maxFieldAgents: row.max_field_agents ?? null,
    maxActiveCustomers: row.max_active_customers ?? null,
    isCustom: Boolean(row.is_custom),
    isActive: row.is_active !== false,
    sortOrder: row.sort_order ?? 100
  };
}

async function tenantNeedsSetupFee(tenantId: string): Promise<boolean> {
  const row = await loadTenantBillingRow(tenantId);
  if (!row?.periodStart) {
    return true;
  }
  const supabase = getSupabaseAdminClient();
  if (!supabase) {
    return ![...memoryClaims.values()].some(
      (c) => c.tenantId === tenantId && c.status === "approved"
    );
  }
  const { data } = await supabase
    .from("subscription_payment_claims")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("status", "approved")
    .limit(1);
  return !data?.length;
}

function mapClaim(row: ClaimRow, extras?: { tenantName?: string; planName?: string }): SubscriptionPaymentClaim {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    planId: row.plan_id,
    amountGhs: Number(row.amount_ghs),
    momoReference: row.momo_reference,
    payerName: row.payer_name ?? "",
    payerNumber: row.payer_number ?? "",
    notes: row.notes ?? "",
    status: row.status,
    rejectReason: row.reject_reason,
    submittedBy: row.submitted_by,
    reviewedBy: row.reviewed_by,
    reviewedAt: row.reviewed_at,
    createdAt: row.created_at,
    tenantName: extras?.tenantName,
    planName: extras?.planName
  };
}

const LEGACY_PLAN_IDS = new Set([
  "plan-starter-month",
  "plan-growth-month",
  "plan-enterprise-year"
]);

function finalizePlans(plans: SubscriptionPlan[], activeOnly: boolean): SubscriptionPlan[] {
  const byId = new Map<string, SubscriptionPlan>();
  for (const plan of plans) {
    if (LEGACY_PLAN_IDS.has(plan.id)) {
      continue;
    }
    if (activeOnly && !plan.isActive) {
      continue;
    }
    byId.set(plan.id, plan);
  }
  return [...byId.values()].sort((a, b) => a.sortOrder - b.sortOrder);
}

export async function listSubscriptionPlans(activeOnly = true): Promise<SubscriptionPlan[]> {
  const supabase = getSupabaseAdminClient();
  if (!supabase) {
    return finalizePlans(memoryPlans, activeOnly);
  }
  let query = supabase.from("subscription_plans").select("*").order("sort_order", { ascending: true });
  if (activeOnly) {
    query = query.eq("is_active", true);
  }
  const { data, error } = await query;
  if (error || !data) {
    console.warn("[billing] list plans failed:", error?.message);
    return finalizePlans(memoryPlans, activeOnly);
  }
  const mapped = (data as PlanRow[]).map(mapPlan);
  const cleaned = finalizePlans(mapped, activeOnly);
  // If migration 089 isn't applied yet, fall back to the in-memory commercial catalog.
  if (cleaned.length === 0) {
    return finalizePlans(memoryPlans, activeOnly);
  }
  return cleaned;
}

export async function getSubscriptionPlan(planId: string): Promise<SubscriptionPlan | null> {
  const plans = await listSubscriptionPlans(false);
  return plans.find((p) => p.id === planId) ?? null;
}

export async function getPlatformBillingSettings(): Promise<PlatformBillingSettings> {
  const supabase = getSupabaseAdminClient();
  if (!supabase) {
    return {
      ...memorySettings,
      momoNumber: memorySettings.momoNumber || env.PLATFORM_MOMO_NUMBER || "",
      momoAccountName: memorySettings.momoAccountName || env.PLATFORM_MOMO_ACCOUNT_NAME || "",
      momoNetwork: memorySettings.momoNetwork || env.PLATFORM_MOMO_NETWORK || "MTN"
    };
  }
  const { data, error } = await supabase
    .from("platform_billing_settings")
    .select("*")
    .eq("id", "default")
    .maybeSingle();
  if (error || !data) {
    return getPlatformBillingSettingsFallback();
  }
  const row = data as SettingsRow;
  return {
    momoNumber: row.momo_number || env.PLATFORM_MOMO_NUMBER || "",
    momoAccountName: row.momo_account_name || env.PLATFORM_MOMO_ACCOUNT_NAME || "",
    momoNetwork: row.momo_network || env.PLATFORM_MOMO_NETWORK || "MTN",
    reminderDaysBefore: row.reminder_days_before ?? 3,
    graceDays: row.grace_days ?? 3
  };
}

function getPlatformBillingSettingsFallback(): PlatformBillingSettings {
  return {
    momoNumber: env.PLATFORM_MOMO_NUMBER || memorySettings.momoNumber || "",
    momoAccountName: env.PLATFORM_MOMO_ACCOUNT_NAME || memorySettings.momoAccountName || "",
    momoNetwork: env.PLATFORM_MOMO_NETWORK || memorySettings.momoNetwork || "MTN",
    reminderDaysBefore: 3,
    graceDays: 3
  };
}

export async function updatePlatformBillingSettings(raw: unknown): Promise<PlatformBillingSettings> {
  const parsed = updatePlatformBillingSettingsSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Invalid billing settings");
  }
  const next: PlatformBillingSettings = {
    momoNumber: parsed.data.momoNumber.trim(),
    momoAccountName: parsed.data.momoAccountName.trim(),
    momoNetwork: (parsed.data.momoNetwork ?? "MTN").trim(),
    reminderDaysBefore: parsed.data.reminderDaysBefore ?? 3,
    graceDays: parsed.data.graceDays ?? 3
  };
  memorySettings = next;
  const supabase = getSupabaseAdminClient();
  if (supabase) {
    const { error } = await supabase.from("platform_billing_settings").upsert({
      id: "default",
      momo_number: next.momoNumber,
      momo_account_name: next.momoAccountName,
      momo_network: next.momoNetwork,
      reminder_days_before: next.reminderDaysBefore,
      grace_days: next.graceDays,
      updated_at: new Date().toISOString()
    });
    if (error) {
      throw new Error(`Failed to save billing settings: ${error.message}`);
    }
  }
  return next;
}

export type TenantSubscriptionSnapshot = {
  tenantId: string;
  tenantName: string;
  subscriptionStatus: "active" | "inactive";
  billingStatus: TenantBillingStatus;
  plan: SubscriptionPlan | null;
  periodStart: string | null;
  periodEnd: string | null;
  daysRemaining: number | null;
  daysOverdue: number | null;
  graceDay: number | null;
  payInstructions: PlatformBillingSettings;
  claims: SubscriptionPaymentClaim[];
  subscribedModules: TenantProductModule[];
  subscribedAddons: TenantAddon[];
  bannerMessage: string | null;
};

function computeBanner(input: {
  billingStatus: TenantBillingStatus;
  periodEnd: string | null;
  daysRemaining: number | null;
  graceDay: number | null;
}): string | null {
  if (input.billingStatus === "due_soon" && input.daysRemaining != null) {
    return `Your subscription renews in ${input.daysRemaining} day${input.daysRemaining === 1 ? "" : "s"} (${input.periodEnd}). Pay via MoMo to avoid interruption.`;
  }
  if (input.billingStatus === "grace") {
    const day = input.graceDay ?? 1;
    if (day >= 2) {
      return `Final warning — day ${day} of grace. Pay today or your system will be suspended.`;
    }
    return `Payment overdue. You are on grace day ${day} of 3. Renew via MoMo to keep the system live.`;
  }
  if (input.billingStatus === "suspended") {
    return "Your subscription is suspended for non-payment. Submit a MoMo payment claim for platform approval to go live again.";
  }
  return null;
}

async function loadTenantBillingRow(tenantId: string): Promise<{
  planId: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  billingStatus: TenantBillingStatus;
  name: string;
  subscriptionStatus: "active" | "inactive";
  phone: string | null;
} | null> {
  const local = getTenantFromStore(tenantId);
  const supabase = getSupabaseAdminClient();
  if (!supabase) {
    if (!local) {
      return null;
    }
    return {
      planId: local.planId ?? null,
      periodStart: local.periodStart ?? null,
      periodEnd: local.periodEnd ?? null,
      billingStatus: local.billingStatus ?? "none",
      name: local.name,
      subscriptionStatus: local.subscriptionStatus,
      phone: null
    };
  }
  const { data, error } = await supabase
    .from("tenants")
    .select("id, name, subscription_status, plan_id, period_start, period_end, billing_status, phone")
    .eq("id", tenantId)
    .maybeSingle();
  if (error) {
    // Migration may not be applied yet — fall back to core columns.
    const retry = await supabase
      .from("tenants")
      .select("id, name, subscription_status")
      .eq("id", tenantId)
      .maybeSingle();
    if (retry.error || !retry.data) {
      return local
        ? {
            planId: local.planId ?? null,
            periodStart: local.periodStart ?? null,
            periodEnd: local.periodEnd ?? null,
            billingStatus: local.billingStatus ?? "none",
            name: local.name,
            subscriptionStatus: local.subscriptionStatus,
            phone: null
          }
        : null;
    }
    return {
      planId: local?.planId ?? null,
      periodStart: local?.periodStart ?? null,
      periodEnd: local?.periodEnd ?? null,
      billingStatus: local?.billingStatus ?? "none",
      name: retry.data.name,
      subscriptionStatus: retry.data.subscription_status === "inactive" ? "inactive" : "active",
      phone: null
    };
  }
  if (!data) {
    return null;
  }
  return {
    planId: (data.plan_id as string | null) ?? null,
    periodStart: (data.period_start as string | null) ?? null,
    periodEnd: (data.period_end as string | null) ?? null,
    billingStatus: ((data.billing_status as TenantBillingStatus | null) ?? "none") as TenantBillingStatus,
    name: data.name as string,
    subscriptionStatus: data.subscription_status === "inactive" ? "inactive" : "active",
    phone: (data.phone as string | null) ?? null
  };
}

export async function listPaymentClaimsForTenant(tenantId: string): Promise<SubscriptionPaymentClaim[]> {
  const supabase = getSupabaseAdminClient();
  if (!supabase) {
    return [...memoryClaims.values()]
      .filter((c) => c.tenantId === tenantId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  const { data, error } = await supabase
    .from("subscription_payment_claims")
    .select("*")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error || !data) {
    return [];
  }
  return (data as ClaimRow[]).map((row) => mapClaim(row));
}

export async function listPendingPaymentClaims(): Promise<SubscriptionPaymentClaim[]> {
  const supabase = getSupabaseAdminClient();
  const plans = await listSubscriptionPlans(false);
  const planName = (id: string) => plans.find((p) => p.id === id)?.name;
  if (!supabase) {
    return [...memoryClaims.values()]
      .filter((c) => c.status === "pending")
      .map((c) => ({
        ...c,
        tenantName: getTenantFromStore(c.tenantId)?.name,
        planName: planName(c.planId)
      }))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  const { data, error } = await supabase
    .from("subscription_payment_claims")
    .select("*")
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(100);
  if (error || !data) {
    return [];
  }
  return (data as ClaimRow[]).map((row) =>
    mapClaim(row, {
      tenantName: getTenantFromStore(row.tenant_id)?.name,
      planName: planName(row.plan_id)
    })
  );
}

export async function getTenantSubscriptionSnapshot(tenantId: string): Promise<TenantSubscriptionSnapshot> {
  const row = await loadTenantBillingRow(tenantId);
  if (!row) {
    throw new Error("Tenant not found");
  }
  const plan = row.planId ? await getSubscriptionPlan(row.planId) : null;
  const today = todayUtcDate();
  const daysRemaining =
    row.periodEnd && row.periodEnd >= today ? daysBetweenUtcDates(today, row.periodEnd) : null;
  const daysOverdue =
    row.periodEnd && row.periodEnd < today ? daysBetweenUtcDates(row.periodEnd, today) : null;
  const graceDay = daysOverdue != null && daysOverdue >= 0 ? Math.min(daysOverdue + 1, 3) : null;
  const store = getTenantFromStore(tenantId);
  const record = store ? toTenantRecord(store) : null;
  const base = {
    billingStatus: row.billingStatus,
    periodEnd: row.periodEnd,
    daysRemaining,
    graceDay
  };
  return {
    tenantId,
    tenantName: row.name,
    subscriptionStatus: row.subscriptionStatus,
    billingStatus: row.billingStatus,
    plan,
    periodStart: row.periodStart,
    periodEnd: row.periodEnd,
    daysRemaining,
    daysOverdue,
    graceDay,
    payInstructions: await getPlatformBillingSettings(),
    claims: await listPaymentClaimsForTenant(tenantId),
    subscribedModules: (record?.subscribedModules ?? store?.subscribedModules ?? []) as TenantProductModule[],
    subscribedAddons: (record?.subscribedAddons ?? store?.subscribedAddons ?? []) as TenantAddon[],
    bannerMessage: computeBanner(base)
  };
}

async function persistTenantBilling(
  tenantId: string,
  patch: {
    planId?: string | null;
    periodStart?: string | null;
    periodEnd?: string | null;
    billingStatus?: TenantBillingStatus;
    subscriptionStatus?: "active" | "inactive";
  }
): Promise<StoredTenant> {
  const existing = getTenantFromStore(tenantId);
  if (!existing) {
    throw new Error("Tenant not found");
  }
  const next: StoredTenant = {
    ...existing,
    planId: patch.planId !== undefined ? patch.planId : existing.planId,
    periodStart: patch.periodStart !== undefined ? patch.periodStart : existing.periodStart,
    periodEnd: patch.periodEnd !== undefined ? patch.periodEnd : existing.periodEnd,
    billingStatus: patch.billingStatus ?? existing.billingStatus,
    subscriptionStatus: patch.subscriptionStatus ?? existing.subscriptionStatus
  };
  const supabase = getSupabaseAdminClient();
  if (supabase) {
    const payload: Record<string, unknown> = {};
    if (patch.planId !== undefined) payload.plan_id = patch.planId;
    if (patch.periodStart !== undefined) payload.period_start = patch.periodStart;
    if (patch.periodEnd !== undefined) payload.period_end = patch.periodEnd;
    if (patch.billingStatus !== undefined) payload.billing_status = patch.billingStatus;
    if (patch.subscriptionStatus !== undefined) payload.subscription_status = patch.subscriptionStatus;
    if (Object.keys(payload).length > 0) {
      const { error } = await supabase.from("tenants").update(payload).eq("id", tenantId);
      if (error && !/plan_id|period_start|billing_status/i.test(error.message)) {
        throw new Error(`Failed to update billing: ${error.message}`);
      }
      if (error && /plan_id|period_start|billing_status/i.test(error.message)) {
        console.warn("[billing] apply migration 088_tenant_subscription_billing.sql:", error.message);
      }
    }
  }
  return upsertTenantInStore(next);
}

export async function assignTenantSubscriptionPlan(
  tenantId: string,
  raw: unknown,
  options?: { reviewedBy?: string }
): Promise<TenantSubscriptionSnapshot> {
  const parsed = assignTenantSubscriptionPlanSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Invalid plan assignment");
  }
  const plan = await getSubscriptionPlan(parsed.data.planId);
  if (!plan || !plan.isActive) {
    throw new Error("Plan not found");
  }
  const periodStart = parsed.data.periodStart?.slice(0, 10) || todayUtcDate();
  const periodEnd = addSubscriptionInterval(periodStart, plan.interval);
  await saveTenantModules(tenantId, plan.modules);
  await saveTenantAddons(tenantId, plan.addons);
  await persistTenantBilling(tenantId, {
    planId: plan.id,
    periodStart,
    periodEnd,
    billingStatus: "active",
    subscriptionStatus: parsed.data.activate === false ? undefined : "active"
  });
  void options;
  return getTenantSubscriptionSnapshot(tenantId);
}

/** Tenant self-serve: start the free one-month package (no MoMo claim). */
export async function activateFreeSubscriptionPlan(tenantId: string): Promise<TenantSubscriptionSnapshot> {
  const plan = await getSubscriptionPlan(FREE_SUBSCRIPTION_PLAN_ID);
  if (!plan || !plan.isActive || !isFreeSubscriptionPlan(plan)) {
    throw new Error("Free plan is not available");
  }
  const row = await loadTenantBillingRow(tenantId);
  const today = todayUtcDate();
  if (
    row?.planId === FREE_SUBSCRIPTION_PLAN_ID &&
    row.periodEnd &&
    row.periodEnd >= today &&
    row.subscriptionStatus === "active"
  ) {
    throw new Error("Your free month is already active");
  }
  return assignTenantSubscriptionPlan(tenantId, {
    planId: FREE_SUBSCRIPTION_PLAN_ID,
    activate: true
  });
}

export async function submitSubscriptionPaymentClaim(
  tenantId: string,
  userId: string | undefined,
  raw: unknown
): Promise<SubscriptionPaymentClaim> {
  const parsed = submitSubscriptionPaymentClaimSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Invalid payment claim");
  }
  const plan = await getSubscriptionPlan(parsed.data.planId);
  if (!plan || !plan.isActive) {
    throw new Error("Select a valid subscription plan");
  }
  if (isFreeSubscriptionPlan(plan)) {
    throw new Error("Free plan does not need MoMo payment. Use Start free month instead.");
  }
  const settings = await getPlatformBillingSettings();
  if (!settings.momoNumber) {
    throw new Error("Platform MoMo number is not configured yet. Contact support.");
  }

  const includeSetupFee =
    parsed.data.includeSetupFee ?? (await tenantNeedsSetupFee(tenantId));
  const amountGhs = subscriptionClaimAmountGhs(plan, { includeSetupFee });
  const amountNote = includeSetupFee
    ? `Includes first-month package (${plan.priceGhs}) + setup fee (${plan.setupFeeGhs}). SMS usage is billed separately.`
    : `Monthly package renewal (${plan.priceGhs}). SMS usage is billed separately.`;

  const supabase = getSupabaseAdminClient();
  if (!supabase) {
    const claim: SubscriptionPaymentClaim = {
      id: `claim-${Date.now()}`,
      tenantId,
      planId: plan.id,
      amountGhs,
      momoReference: parsed.data.momoReference.trim(),
      payerName: parsed.data.payerName.trim(),
      payerNumber: parsed.data.payerNumber.trim(),
      notes: [parsed.data.notes?.trim() ?? "", amountNote].filter(Boolean).join(" · "),
      status: "pending",
      submittedBy: userId ?? null,
      reviewedBy: null,
      reviewedAt: null,
      createdAt: new Date().toISOString(),
      planName: plan.name,
      tenantName: getTenantFromStore(tenantId)?.name
    };
    memoryClaims.set(claim.id, claim);
    return claim;
  }

  const { data: pending } = await supabase
    .from("subscription_payment_claims")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("status", "pending")
    .limit(1);
  if (pending && pending.length > 0) {
    throw new Error("You already have a pending payment claim. Wait for platform approval.");
  }

  const { data, error } = await supabase
    .from("subscription_payment_claims")
    .insert({
      tenant_id: tenantId,
      plan_id: plan.id,
      amount_ghs: amountGhs,
      momo_reference: parsed.data.momoReference.trim(),
      payer_name: parsed.data.payerName.trim(),
      payer_number: parsed.data.payerNumber.trim(),
      notes: [parsed.data.notes?.trim() ?? "", amountNote].filter(Boolean).join(" · "),
      status: "pending",
      submitted_by: userId ?? null
    })
    .select("*")
    .single();
  if (error || !data) {
    throw new Error(error?.message ?? "Failed to submit payment claim");
  }
  return mapClaim(data as ClaimRow, {
    planName: plan.name,
    tenantName: getTenantFromStore(tenantId)?.name
  });
}

async function activateFromPlan(
  tenantId: string,
  plan: SubscriptionPlan,
  options?: { extendFromCurrentEnd?: boolean }
): Promise<void> {
  const row = await loadTenantBillingRow(tenantId);
  const today = todayUtcDate();
  let periodStart = today;
  if (options?.extendFromCurrentEnd && row?.periodEnd && row.periodEnd >= today) {
    periodStart = row.periodEnd;
  } else if (options?.extendFromCurrentEnd && row?.periodEnd && row.periodEnd < today) {
    periodStart = today;
  }
  const periodEnd = addSubscriptionInterval(periodStart, plan.interval);
  await saveTenantModules(tenantId, plan.modules);
  await saveTenantAddons(tenantId, plan.addons);
  await persistTenantBilling(tenantId, {
    planId: plan.id,
    periodStart,
    periodEnd,
    billingStatus: "active",
    subscriptionStatus: "active"
  });
}

export async function approveSubscriptionPaymentClaim(
  claimId: string,
  reviewedBy: string
): Promise<SubscriptionPaymentClaim> {
  const supabase = getSupabaseAdminClient();
  let claim: SubscriptionPaymentClaim | null = null;
  if (!supabase) {
    claim = memoryClaims.get(claimId) ?? null;
    if (!claim || claim.status !== "pending") {
      throw new Error("Pending claim not found");
    }
  } else {
    const { data, error } = await supabase
      .from("subscription_payment_claims")
      .select("*")
      .eq("id", claimId)
      .maybeSingle();
    if (error || !data) {
      throw new Error("Payment claim not found");
    }
    claim = mapClaim(data as ClaimRow);
    if (claim.status !== "pending") {
      throw new Error("Claim is not pending");
    }
  }

  const plan = await getSubscriptionPlan(claim.planId);
  if (!plan) {
    throw new Error("Plan not found");
  }
  await activateFromPlan(claim.tenantId, plan, { extendFromCurrentEnd: true });

  const reviewedAt = new Date().toISOString();
  if (!supabase) {
    const next = { ...claim, status: "approved" as const, reviewedBy, reviewedAt };
    memoryClaims.set(claimId, next);
    return next;
  }
  const { data, error } = await supabase
    .from("subscription_payment_claims")
    .update({
      status: "approved",
      reviewed_by: reviewedBy,
      reviewed_at: reviewedAt,
      reject_reason: null
    })
    .eq("id", claimId)
    .select("*")
    .single();
  if (error || !data) {
    throw new Error(error?.message ?? "Failed to approve claim");
  }
  return mapClaim(data as ClaimRow, {
    planName: plan.name,
    tenantName: getTenantFromStore(claim.tenantId)?.name
  });
}

export async function rejectSubscriptionPaymentClaim(
  claimId: string,
  reviewedBy: string,
  raw: unknown
): Promise<SubscriptionPaymentClaim> {
  const parsed = rejectSubscriptionPaymentClaimSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Invalid rejection");
  }
  const supabase = getSupabaseAdminClient();
  const reviewedAt = new Date().toISOString();
  if (!supabase) {
    const claim = memoryClaims.get(claimId);
    if (!claim || claim.status !== "pending") {
      throw new Error("Pending claim not found");
    }
    const next = {
      ...claim,
      status: "rejected" as const,
      reviewedBy,
      reviewedAt,
      rejectReason: parsed.data.reason
    };
    memoryClaims.set(claimId, next);
    return next;
  }
  const { data, error } = await supabase
    .from("subscription_payment_claims")
    .update({
      status: "rejected",
      reviewed_by: reviewedBy,
      reviewed_at: reviewedAt,
      reject_reason: parsed.data.reason
    })
    .eq("id", claimId)
    .eq("status", "pending")
    .select("*")
    .single();
  if (error || !data) {
    throw new Error(error?.message ?? "Failed to reject claim");
  }
  return mapClaim(data as ClaimRow);
}

async function reminderAlreadySent(
  tenantId: string,
  periodEnd: string,
  kind: string
): Promise<boolean> {
  const supabase = getSupabaseAdminClient();
  if (!supabase) {
    return false;
  }
  const { data } = await supabase
    .from("subscription_reminder_log")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("period_end", periodEnd)
    .eq("reminder_kind", kind)
    .maybeSingle();
  return Boolean(data);
}

async function logReminder(
  tenantId: string,
  periodEnd: string,
  kind: string,
  channel: "in_app" | "sms" | "system"
): Promise<void> {
  const supabase = getSupabaseAdminClient();
  if (!supabase) {
    return;
  }
  await supabase.from("subscription_reminder_log").upsert(
    {
      tenant_id: tenantId,
      period_end: periodEnd,
      reminder_kind: kind,
      channel
    },
    { onConflict: "tenant_id,period_end,reminder_kind" }
  );
}

async function sendBillingSms(tenantId: string, message: string): Promise<boolean> {
  if (!hasArkeselSmsConfig()) {
    console.warn("[billing] SMS skipped — Arkesel not configured");
    return false;
  }
  const row = await loadTenantBillingRow(tenantId);
  const phone = row?.phone?.trim();
  if (!phone) {
    console.warn(`[billing] SMS skipped — no company phone for ${tenantId}`);
    return false;
  }
  try {
    await sendArkeselSms({ to: phone, content: message });
    return true;
  } catch (error) {
    console.warn(
      "[billing] SMS failed:",
      error instanceof Error ? error.message : error
    );
    return false;
  }
}

export async function runSubscriptionBillingSweep(): Promise<{
  dueSoon: number;
  grace: number;
  sms: number;
  suspended: number;
}> {
  const settings = await getPlatformBillingSettings();
  const today = todayUtcDate();
  const supabase = getSupabaseAdminClient();
  let tenants: Array<{
    id: string;
    periodEnd: string | null;
    billingStatus: TenantBillingStatus;
    subscriptionStatus: "active" | "inactive";
    name: string;
  }> = [];

  if (supabase) {
    const { data, error } = await supabase
      .from("tenants")
      .select("id, name, subscription_status, period_end, billing_status")
      .not("period_end", "is", null);
    if (!error && data) {
      tenants = data.map((row) => ({
        id: row.id as string,
        name: row.name as string,
        periodEnd: (row.period_end as string | null) ?? null,
        billingStatus: ((row.billing_status as TenantBillingStatus | null) ?? "none") as TenantBillingStatus,
        subscriptionStatus: row.subscription_status === "inactive" ? "inactive" : "active"
      }));
    }
  }

  if (tenants.length === 0) {
    const { listTenantsFromStore } = await import("./authStore.js");
    tenants = listTenantsFromStore()
      .filter((t) => t.id !== "platform" && t.periodEnd)
      .map((t) => ({
        id: t.id,
        name: t.name,
        periodEnd: t.periodEnd ?? null,
        billingStatus: t.billingStatus ?? "none",
        subscriptionStatus: t.subscriptionStatus
      }));
  }

  let dueSoon = 0;
  let grace = 0;
  let sms = 0;
  let suspended = 0;

  for (const tenant of tenants) {
    if (!tenant.periodEnd) {
      continue;
    }
    const daysRemaining = daysBetweenUtcDates(today, tenant.periodEnd);
    const daysOverdue = daysBetweenUtcDates(tenant.periodEnd, today);

    // Due-minus-N reminder (default 3 days before)
    if (
      daysRemaining === settings.reminderDaysBefore &&
      tenant.subscriptionStatus === "active"
    ) {
      if (!(await reminderAlreadySent(tenant.id, tenant.periodEnd, "due_minus_3"))) {
        await persistTenantBilling(tenant.id, { billingStatus: "due_soon" });
        await logReminder(tenant.id, tenant.periodEnd, "due_minus_3", "in_app");
        dueSoon += 1;
      }
    }

    if (daysOverdue < 0) {
      continue;
    }

    // Enter / stay in grace for days 0..graceDays-1 after due (day 1..3)
    const graceDay = daysOverdue + 1;
    if (graceDay >= 1 && graceDay < settings.graceDays) {
      if (tenant.billingStatus !== "grace" && tenant.billingStatus !== "suspended") {
        await persistTenantBilling(tenant.id, { billingStatus: "grace" });
        grace += 1;
      }
      if (graceDay === 1 && !(await reminderAlreadySent(tenant.id, tenant.periodEnd, "grace_day_1"))) {
        await logReminder(tenant.id, tenant.periodEnd, "grace_day_1", "in_app");
      }
      if (graceDay === 2 && !(await reminderAlreadySent(tenant.id, tenant.periodEnd, "grace_day_2_sms"))) {
        const sent = await sendBillingSms(
          tenant.id,
          `aabanker: ${tenant.name} subscription is overdue (grace day 2/3). Pay via MoMo now or the system will be suspended tomorrow.`
        );
        await logReminder(tenant.id, tenant.periodEnd, "grace_day_2_sms", sent ? "sms" : "in_app");
        if (sent) sms += 1;
      }
    }

    // Suspend on grace day 3 (daysOverdue + 1 === graceDays, i.e. daysOverdue === graceDays - 1)
    if (graceDay >= settings.graceDays) {
      if (!(await reminderAlreadySent(tenant.id, tenant.periodEnd, "grace_day_3_suspend"))) {
        await persistTenantBilling(tenant.id, {
          billingStatus: "suspended",
          subscriptionStatus: "inactive"
        });
        await logReminder(tenant.id, tenant.periodEnd, "grace_day_3_suspend", "system");
        suspended += 1;
      }
    }
  }

  return { dueSoon, grace, sms, suspended };
}
