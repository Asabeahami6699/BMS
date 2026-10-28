import { sendTestSmsSchema, updateTenantSmsSettingsSchema, hasTenantAddon } from "@bms/shared";
import { Router } from "express";
import { requirePermission } from "../middleware/requirePermission.js";
import {
  getSmsPlatformStatus,
  sendTestCustomerSms
} from "../services/customerSmsService.js";
import {
  getTenantSmsSettings,
  upsertTenantSmsSettings
} from "../services/tenantSmsSettingsService.js";

export const smsSettingsRouter = Router();

function requireSmsAddon(req: import("express").Request, res: import("express").Response): boolean {
  const context = req.userContext;
  if (!context) {
    res.status(401).json({ error: "Unauthorized" });
    return false;
  }
  if (!hasTenantAddon(context.subscribedAddons, "sms_notifications")) {
    res.status(403).json({ error: "SMS notifications add-on is not active on this subscription" });
    return false;
  }
  return true;
}

smsSettingsRouter.get("/status", requirePermission("workspace.notifications"), async (req, res) => {
  if (!requireSmsAddon(req, res)) {
    return;
  }
  const platform = await getSmsPlatformStatus();
  res.json(platform);
});

smsSettingsRouter.get("/", requirePermission("workspace.notifications"), async (req, res) => {
  const tenantId = req.userContext?.tenantId;
  if (!tenantId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  if (!requireSmsAddon(req, res)) {
    return;
  }

  try {
    const settings = await getTenantSmsSettings(tenantId);
    res.json(settings);
  } catch (error) {
    res.status(400).json({
      error: error instanceof Error ? error.message : "Failed to load SMS settings"
    });
  }
});

smsSettingsRouter.put("/", requirePermission("workspace.notifications"), async (req, res) => {
  const context = req.userContext;
  if (!context) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  if (!requireSmsAddon(req, res)) {
    return;
  }

  const parsed = updateTenantSmsSettingsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid SMS settings", details: parsed.error.flatten() });
    return;
  }

  try {
    const updated = await upsertTenantSmsSettings(context.tenantId, context.userId, parsed.data);
    res.json(updated);
  } catch (error) {
    res.status(400).json({
      error: error instanceof Error ? error.message : "Failed to save SMS settings"
    });
  }
});

smsSettingsRouter.post("/test", requirePermission("workspace.notifications"), async (req, res) => {
  const context = req.userContext;
  if (!context) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  if (!requireSmsAddon(req, res)) {
    return;
  }

  const parsed = sendTestSmsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid test SMS payload", details: parsed.error.flatten() });
    return;
  }

  try {
    const result = await sendTestCustomerSms({
      tenantId: context.tenantId,
      phone: parsed.data.phone,
      message: parsed.data.message,
      subscribedAddons: context.subscribedAddons
    });
    res.json(result);
  } catch (error) {
    res.status(400).json({
      error: error instanceof Error ? error.message : "Failed to send test SMS"
    });
  }
});
