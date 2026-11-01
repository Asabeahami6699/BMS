import { Router } from "express";
import { requirePermission } from "../middleware/requirePermission.js";
import { getNotificationPlatformStatus } from "../services/customerNotificationService.js";
import { listMessageLog } from "../services/messageLogService.js";

export const notificationPlatformRouter = Router();

notificationPlatformRouter.get(
  "/status",
  requirePermission("workspace.notifications"),
  async (_req, res) => {
    const status = await getNotificationPlatformStatus();
    res.json(status);
  }
);

notificationPlatformRouter.get("/log", requirePermission("workspace.notifications"), async (req, res) => {
  const context = req.userContext;
  if (!context?.tenantId || context.tenantId === "platform") {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  try {
    const log = await listMessageLog(context.tenantId, context.subscribedAddons);
    res.json(log);
  } catch (error) {
    res.status(400).json({
      error: error instanceof Error ? error.message : "Failed to load message log"
    });
  }
});
