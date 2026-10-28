import { z } from "zod";

export const emailEventTypeSchema = z.enum(["deposit", "withdrawal", "daily_susu", "test"]);
export type EmailEventType = z.infer<typeof emailEventTypeSchema>;

export const tenantEmailSettingsSchema = z.object({
  tenantId: z.string().min(1),
  enabled: z.boolean(),
  notifyDeposit: z.boolean(),
  notifyWithdrawal: z.boolean(),
  notifyDailySusu: z.boolean(),
  fromName: z.string().max(80).optional(),
  replyToEmail: z.string().email().optional().or(z.literal("")),
  updatedAt: z.string().optional(),
  updatedBy: z.string().optional()
});

export type TenantEmailSettings = z.infer<typeof tenantEmailSettingsSchema>;

export const updateTenantEmailSettingsSchema = z.object({
  enabled: z.boolean().optional(),
  notifyDeposit: z.boolean().optional(),
  notifyWithdrawal: z.boolean().optional(),
  notifyDailySusu: z.boolean().optional(),
  fromName: z.string().max(80).optional().nullable(),
  replyToEmail: z.union([z.string().email(), z.literal(""), z.null()]).optional()
});

export type UpdateTenantEmailSettingsInput = z.infer<typeof updateTenantEmailSettingsSchema>;

export const sendTestEmailSchema = z.object({
  email: z.string().email(),
  message: z.string().max(2000).optional()
});

export type SendTestEmailInput = z.infer<typeof sendTestEmailSchema>;

export const emailOutboxStatusSchema = z.enum(["pending", "sent", "failed", "logged"]);
export type EmailOutboxStatus = z.infer<typeof emailOutboxStatusSchema>;

export function defaultTenantEmailSettings(tenantId: string): TenantEmailSettings {
  return {
    tenantId,
    enabled: true,
    notifyDeposit: true,
    notifyWithdrawal: true,
    notifyDailySusu: true
  };
}

export function normalizeCustomerEmail(raw?: string | null): string | null {
  const trimmed = raw?.trim().toLowerCase();
  if (!trimmed) {
    return null;
  }
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed) ? trimmed : null;
}
