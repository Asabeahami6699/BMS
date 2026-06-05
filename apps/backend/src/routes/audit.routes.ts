import { Router } from "express";
import { z } from "zod";
import { requirePermission } from "../middleware/requirePermission.js";
import { listAuditLogs } from "../services/auditService.js";

const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).optional(),
  offset: z.coerce.number().int().min(0).optional()
});

export const auditRouter = Router();

auditRouter.get("/", requirePermission("audit.read"), async (req, res) => {
  const context = req.userContext;
  if (!context) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const parsed = listQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid query", details: parsed.error.flatten() });
    return;
  }

  try {
    const logs = await listAuditLogs(context.tenantId, parsed.data);
    res.json(logs);
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : "Failed to load audit logs"
    });
  }
});
