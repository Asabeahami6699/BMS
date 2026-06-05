import { z } from "zod";

export const tenantAddonSchema = z.enum([
  "mobile_money",
  "sms_notifications",
  "email_notifications",
  "api_access",
  "multi_branch",
  "advanced_analytics",
  "bulk_import",
  "custom_branding"
]);

export type TenantAddon = z.infer<typeof tenantAddonSchema>;

export const TENANT_ADDONS: TenantAddon[] = [
  "mobile_money",
  "sms_notifications",
  "email_notifications",
  "api_access",
  "multi_branch",
  "advanced_analytics",
  "bulk_import",
  "custom_branding"
];

export const ADDON_LABELS: Record<TenantAddon, string> = {
  mobile_money: "Mobile Money Integration",
  sms_notifications: "SMS Notifications",
  email_notifications: "Email Notifications",
  api_access: "API Access",
  multi_branch: "Multi-Branch",
  advanced_analytics: "Advanced Analytics",
  bulk_import: "Bulk Import",
  custom_branding: "Custom Branding"
};

export const ADDON_DESCRIPTIONS: Record<TenantAddon, string> = {
  mobile_money: "MoMo collections and reconciliation.",
  sms_notifications: "Transactional SMS alerts for staff and customers.",
  email_notifications: "Email alerts and statements.",
  api_access: "REST API keys and webhook integrations.",
  multi_branch: "Extended branch hierarchy and cross-branch reporting.",
  advanced_analytics: "Deep dashboards beyond standard reports.",
  bulk_import: "CSV/Excel import for customers and transactions.",
  custom_branding: "Logo, colors, and white-label login experience."
};

/** Legacy add-on keys stripped on read */
export const LEGACY_ADDON_KEYS = new Set(["whatsapp_notifications"]);

export function normalizeTenantAddon(key: string): TenantAddon | undefined {
  if (LEGACY_ADDON_KEYS.has(key)) {
    return undefined;
  }
  const parsed = tenantAddonSchema.safeParse(key);
  return parsed.success ? parsed.data : undefined;
}

export function hasTenantAddon(addons: TenantAddon[] | undefined, addon: TenantAddon): boolean {
  return Boolean(addons?.includes(addon));
}
