import { sendTestEmailSchema, updateTenantEmailSettingsSchema, hasTenantAddon } from "@bms/shared";
import { Router } from "express";
import { requirePermission } from "../middleware/requirePermission.js";
import { sendTestCustomerEmail, getEmailPlatformStatus } from "../services/customerEmailService.js";
import {
  getTenantEmailSettings,
  upsertTenantEmailSettings
} from "../services/tenantEmailSettingsService.js";

export const emailSettingsRouter = Router();

function requireEmailAddon(req: import("express").Request, res: import("express").Response): boolean {
  const context = req.userContext;
  if (!context) {
    res.status(401).json({ error: "Unauthorized" });
    return false;
  }
  if (!hasTenantAddon(context.subscribedAddons, "email_notifications")) {
    res.status(403).json({ error: "Email notifications add-on is not active on this subscription" });
    return false;
  }
  return true;
}

emailSettingsRouter.get("/status", requirePermission("workspace.notifications"), async (req, res) => {
  if (!requireEmailAddon(req, res)) {
    return;
  }
  res.json(getEmailPlatformStatus());
});

emailSettingsRouter.get("/", requirePermission("workspace.notifications"), async (req, res) => {
  const tenantId = req.userContext?.tenantId;
  if (!tenantId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  if (!requireEmailAddon(req, res)) {
    return;
  }

  try {
    const settings = await getTenantEmailSettings(tenantId);
    res.json(settings);
  } catch (error) {
    res.status(400).json({
      error: error instanceof Error ? error.message : "Failed to load email settings"
    });
  }
});

emailSettingsRouter.put("/", requirePermission("workspace.notifications"), async (req, res) => {
  const context = req.userContext;
  if (!context) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  if (!requireEmailAddon(req, res)) {
    return;
  }

  const parsed = updateTenantEmailSettingsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid email settings", details: parsed.error.flatten() });
    return;
  }

  try {
    const updated = await upsertTenantEmailSettings(context.tenantId, context.userId, parsed.data);
    res.json(updated);
  } catch (error) {
    res.status(400).json({
      error: error instanceof Error ? error.message : "Failed to save email settings"
    });
  }
});

emailSettingsRouter.post("/test", requirePermission("workspace.notifications"), async (req, res) => {
  const context = req.userContext;
  if (!context) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  if (!requireEmailAddon(req, res)) {
    return;
  }

  const parsed = sendTestEmailSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid test email payload", details: parsed.error.flatten() });
    return;
  }

  try {
    const result = await sendTestCustomerEmail({
      tenantId: context.tenantId,
      email: parsed.data.email,
      message: parsed.data.message,
      subscribedAddons: context.subscribedAddons
    });
    res.json(result);
  } catch (error) {
    res.status(400).json({
      error: error instanceof Error ? error.message : "Failed to send test email"
    });
  }
});
