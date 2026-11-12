import { z } from "zod";
import { tenantAddonSchema } from "./addons.js";
import { tenantProductModuleSchema } from "./modules.js";

export const subscriptionIntervalSchema = z.enum(["month", "year"]);
export type SubscriptionInterval = z.infer<typeof subscriptionIntervalSchema>;

export const tenantBillingStatusSchema = z.enum([
  "none",
  "active",
  "due_soon",
  "grace",
  "suspended"
]);
export type TenantBillingStatus = z.infer<typeof tenantBillingStatusSchema>;

export const subscriptionPaymentClaimStatusSchema = z.enum(["pending", "approved", "rejected"]);
export type SubscriptionPaymentClaimStatus = z.infer<typeof subscriptionPaymentClaimStatusSchema>;

export const subscriptionReminderKindSchema = z.enum([
  "due_minus_3",
  "grace_day_1",
  "grace_day_2_sms",
  "grace_day_3_suspend"
]);
export type SubscriptionReminderKind = z.infer<typeof subscriptionReminderKindSchema>;

export const subscriptionPackageTierSchema = z.enum([
  "entry",
  "growing",
  "multi_product",
  "institution",
  "enterprise",
  "standard"
]);
export type SubscriptionPackageTier = z.infer<typeof subscriptionPackageTierSchema>;

export const SUBSCRIPTION_PACKAGE_TIER_LABELS: Record<SubscriptionPackageTier, string> = {
  entry: "Entry package",
  growing: "Growing business",
  multi_product: "Multi-product package",
  institution: "Institution package",
  enterprise: "Custom contract",
  standard: "Package"
};

export const subscriptionPlanSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string(),
  interval: subscriptionIntervalSchema,
  /** Recurring package / enrollment fee (monthly or yearly). */
  priceGhs: z.number().nonnegative(),
  /** One-time setup / onboarding fee charged on first enrollment. */
  setupFeeGhs: z.number().nonnegative().default(0),
  packageTier: subscriptionPackageTierSchema.default("standard"),
  modules: z.array(tenantProductModuleSchema),
  addons: z.array(tenantAddonSchema),
  featureBullets: z.array(z.string()).default([]),
  maxBranches: z.number().int().positive().nullable().optional(),
  maxStaff: z.number().int().positive().nullable().optional(),
  maxFieldAgents: z.number().int().positive().nullable().optional(),
  maxActiveCustomers: z.number().int().positive().nullable().optional(),
  isCustom: z.boolean().default(false),
  isActive: z.boolean(),
  sortOrder: z.number().int()
});
export type SubscriptionPlan = z.infer<typeof subscriptionPlanSchema>;

export const platformBillingSettingsSchema = z.object({
  momoNumber: z.string(),
  momoAccountName: z.string(),
  momoNetwork: z.string(),
  reminderDaysBefore: z.number().int().positive().default(3),
  graceDays: z.number().int().positive().default(3)
});
export type PlatformBillingSettings = z.infer<typeof platformBillingSettingsSchema>;

export const updatePlatformBillingSettingsSchema = z.object({
  momoNumber: z.string().min(8, "Enter a valid MoMo number"),
  momoAccountName: z.string().min(2, "Enter the account name"),
  momoNetwork: z.string().min(2).default("MTN"),
  reminderDaysBefore: z.number().int().min(1).max(14).optional(),
  graceDays: z.number().int().min(1).max(14).optional()
});

export const subscriptionPaymentClaimSchema = z.object({
  id: z.string().min(1),
  tenantId: z.string().min(1),
  planId: z.string().min(1),
  amountGhs: z.number().nonnegative(),
  momoReference: z.string().min(1),
  payerName: z.string(),
  payerNumber: z.string(),
  notes: z.string(),
  status: subscriptionPaymentClaimStatusSchema,
  rejectReason: z.string().nullable().optional(),
  submittedBy: z.string().nullable().optional(),
  reviewedBy: z.string().nullable().optional(),
  reviewedAt: z.string().nullable().optional(),
  createdAt: z.string(),
  tenantName: z.string().optional(),
  planName: z.string().optional()
});
export type SubscriptionPaymentClaim = z.infer<typeof subscriptionPaymentClaimSchema>;

export const submitSubscriptionPaymentClaimSchema = z.object({
  planId: z.string().min(1),
  momoReference: z.string().min(4, "Enter the MoMo transaction ID / reference"),
  payerName: z.string().min(2, "Enter the payer name"),
  payerNumber: z.string().min(8, "Enter the MoMo number used to pay"),
  notes: z.string().max(500).optional(),
  /** When true (default), first enrollment includes setup fee. Renewals omit it. */
  includeSetupFee: z.boolean().optional()
});
export type SubmitSubscriptionPaymentClaimInput = z.infer<typeof submitSubscriptionPaymentClaimSchema>;

export const rejectSubscriptionPaymentClaimSchema = z.object({
  reason: z.string().min(3).max(500)
});

export const assignTenantSubscriptionPlanSchema = z.object({
  planId: z.string().min(1),
  periodStart: z.string().optional(),
  activate: z.boolean().optional()
});

export const TENANT_BILLING_STATUS_LABELS: Record<TenantBillingStatus, string> = {
  none: "No plan",
  active: "Active",
  due_soon: "Renewal due soon",
  grace: "Grace period",
  suspended: "Suspended"
};

export function subscriptionClaimAmountGhs(
  plan: Pick<SubscriptionPlan, "priceGhs" | "setupFeeGhs">,
  options?: { includeSetupFee?: boolean }
): number {
  const setup = options?.includeSetupFee ? plan.setupFeeGhs || 0 : 0;
  return Math.round((plan.priceGhs + setup) * 100) / 100;
}

export function addSubscriptionInterval(startIsoDate: string, interval: SubscriptionInterval): string {
  const start = new Date(`${startIsoDate}T12:00:00.000Z`);
  if (Number.isNaN(start.getTime())) {
    throw new Error("Invalid period start date");
  }
  if (interval === "month") {
    start.setUTCMonth(start.getUTCMonth() + 1);
  } else {
    start.setUTCFullYear(start.getUTCFullYear() + 1);
  }
  return start.toISOString().slice(0, 10);
}

export function daysBetweenUtcDates(fromIsoDate: string, toIsoDate: string): number {
  const from = Date.parse(`${fromIsoDate}T12:00:00.000Z`);
  const to = Date.parse(`${toIsoDate}T12:00:00.000Z`);
  if (Number.isNaN(from) || Number.isNaN(to)) {
    return 0;
  }
  return Math.round((to - from) / 86_400_000);
}

export function todayUtcDate(): string {
  return new Date().toISOString().slice(0, 10);
}
