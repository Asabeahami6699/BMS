import { Router } from "express";
import { requirePermission } from "../middleware/requirePermission.js";
import { getNotificationPlatformStatus } from "../services/customerNotificationService.js";

export const notificationPlatformRouter = Router();

notificationPlatformRouter.get(
  "/status",
  requirePermission("workspace.notifications"),
  async (_req, res) => {
    const status = await getNotificationPlatformStatus();
    res.json(status);
  }
);
