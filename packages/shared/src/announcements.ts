import { z } from "zod";

export const announcementScopeSchema = z.enum(["platform", "tenant"]);
export type AnnouncementScope = z.infer<typeof announcementScopeSchema>;

export const announcementToneSchema = z.enum(["info", "warning", "critical", "success"]);
export type AnnouncementTone = z.infer<typeof announcementToneSchema>;

export const announcementTimerModeSchema = z.enum(["duration", "until", "none"]);
export type AnnouncementTimerMode = z.infer<typeof announcementTimerModeSchema>;

export const siteAnnouncementSchema = z.object({
  id: z.string().min(1),
  scope: announcementScopeSchema,
  tenantId: z.string().nullable().default(null),
  title: z.string().max(80).optional(),
  message: z.string().min(1).max(400),
  tone: announcementToneSchema.default("info"),
  isActive: z.boolean().default(true),
  dismissible: z.boolean().default(true),
  startsAt: z.string().min(1),
  expiresAt: z.string().nullable().default(null),
  durationMinutes: z.number().int().positive().nullable().default(null),
  createdBy: z.string().min(1),
  createdByName: z.string().optional(),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1)
});
export type SiteAnnouncement = z.infer<typeof siteAnnouncementSchema>;

export const createSiteAnnouncementSchema = z
  .object({
    title: z.string().trim().max(80).optional(),
    message: z.string().trim().min(3, "Announcement message must be at least 3 characters").max(400, "Keep announcement under 400 characters"),
    tone: announcementToneSchema.default("info"),
    dismissible: z.boolean().default(true),
    timerMode: announcementTimerModeSchema.default("duration"),
    durationMinutes: z.number().int().min(1).max(43_200).optional(),
    expiresAt: z.string().trim().optional(),
    replaceActive: z.boolean().default(true)
  })
  .superRefine((val, ctx) => {
    if (val.timerMode === "duration") {
      if (val.durationMinutes == null || !Number.isFinite(val.durationMinutes) || val.durationMinutes < 1) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["durationMinutes"],
          message: "Set a timer duration of at least 1 minute."
        });
      }
    } else if (val.timerMode === "until") {
      if (!val.expiresAt || Number.isNaN(Date.parse(val.expiresAt))) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["expiresAt"],
          message: "Pick a valid end date and time."
        });
      }
    }
  });
export type CreateSiteAnnouncementInput = z.infer<typeof createSiteAnnouncementSchema>;

export const updateSiteAnnouncementSchema = z.object({
  title: z.string().trim().max(80).nullable().optional(),
  message: z.string().trim().min(3).max(400).optional(),
  tone: announcementToneSchema.optional(),
  isActive: z.boolean().optional(),
  dismissible: z.boolean().optional(),
  timerMode: announcementTimerModeSchema.optional(),
  durationMinutes: z.number().int().min(1).max(43_200).nullable().optional(),
  expiresAt: z.string().trim().nullable().optional(),
  extendMinutes: z.number().int().min(1).max(43_200).optional()
});
export type UpdateSiteAnnouncementInput = z.infer<typeof updateSiteAnnouncementSchema>;

export function isSiteAnnouncementLive(a: SiteAnnouncement, nowMs = Date.now()): boolean {
  if (!a.isActive) return false;
  const startsMs = Date.parse(a.startsAt);
  if (!Number.isNaN(startsMs) && startsMs > nowMs) return false;
  if (a.expiresAt) {
    const expMs = Date.parse(a.expiresAt);
    if (!Number.isNaN(expMs) && expMs <= nowMs) return false;
  }
  return true;
}

export function formatAnnouncementCountdown(expiresAt: string | null, nowMs = Date.now()): string | null {
  if (!expiresAt) return null;
  const expMs = Date.parse(expiresAt);
  if (Number.isNaN(expMs)) return null;
  const diffSec = Math.max(0, Math.floor((expMs - nowMs) / 1000));
  if (diffSec <= 0) return "00:00";
  const days = Math.floor(diffSec / 86_400);
  const hours = Math.floor((diffSec % 86_400) / 3600);
  const mins = Math.floor((diffSec % 3600) / 60);
  const secs = diffSec % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  if (days > 0) {
    return `${days}d ${pad(hours)}h ${pad(mins)}m`;
  }
  if (hours > 0) {
    return `${pad(hours)}:${pad(mins)}:${pad(secs)}`;
  }
  return `${pad(mins)}:${pad(secs)}`;
}
