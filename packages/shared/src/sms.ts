import { z } from "zod";
import { formatAccountAmount } from "./money.js";

export const smsEventTypeSchema = z.enum([
  "deposit",
  "withdrawal",
  "daily_susu",
  "account_opened",
  "test"
]);
export type SmsEventType = z.infer<typeof smsEventTypeSchema>;

export const tenantSmsSettingsSchema = z.object({
  tenantId: z.string().min(1),
  enabled: z.boolean(),
  notifyDeposit: z.boolean(),
  notifyWithdrawal: z.boolean(),
  notifyDailySusu: z.boolean(),
  senderId: z.string().max(11).optional(),
  updatedAt: z.string().optional(),
  updatedBy: z.string().optional()
});

export type TenantSmsSettings = z.infer<typeof tenantSmsSettingsSchema>;

export const updateTenantSmsSettingsSchema = z.object({
  enabled: z.boolean().optional(),
  notifyDeposit: z.boolean().optional(),
  notifyWithdrawal: z.boolean().optional(),
  notifyDailySusu: z.boolean().optional(),
  senderId: z.string().max(11).optional().nullable()
});

export type UpdateTenantSmsSettingsInput = z.infer<typeof updateTenantSmsSettingsSchema>;

export const sendTestSmsSchema = z.object({
  phone: z.string().min(9).max(20),
  message: z.string().max(320).optional()
});

export type SendTestSmsInput = z.infer<typeof sendTestSmsSchema>;

export const smsOutboxStatusSchema = z.enum(["pending", "sent", "failed"]);
export type SmsOutboxStatus = z.infer<typeof smsOutboxStatusSchema>;

export function defaultTenantSmsSettings(tenantId: string): TenantSmsSettings {
  return {
    tenantId,
    enabled: true,
    notifyDeposit: true,
    notifyWithdrawal: true,
    notifyDailySusu: true
  };
}

/** Ghana mobile: 0XXXXXXXXX → 233XXXXXXXXX */
export function normalizeGhanaPhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  if (!digits) {
    return null;
  }
  if (digits.startsWith("233") && digits.length === 12) {
    return digits;
  }
  if (digits.startsWith("0") && digits.length === 10) {
    return `233${digits.slice(1)}`;
  }
  if (digits.length === 9) {
    return `233${digits}`;
  }
  return null;
}

/** Mask for outbound SMS, e.g. 130*****2577 (first 3 + stars + last 4). */
export function maskAccountNumber(accountNumber?: string): string {
  const digits = (accountNumber ?? "").replace(/\s+/g, "");
  if (!digits) {
    return "****";
  }
  if (digits.length <= 7) {
    return `${digits.slice(0, 1)}${"*".repeat(Math.max(digits.length - 2, 2))}${digits.slice(-1)}`;
  }
  const head = digits.slice(0, 3);
  const tail = digits.slice(-4);
  const stars = "*".repeat(Math.max(digits.length - 7, 2));
  return `${head}${stars}${tail}`;
}

export function formatSmsAmount(amount: number): string {
  return formatAccountAmount(amount);
}
