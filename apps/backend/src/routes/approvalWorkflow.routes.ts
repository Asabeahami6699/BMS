import { Router } from "express";
import { requirePermission } from "../middleware/requirePermission.js";
import { getApprovalWorkflow, updateApprovalWorkflow } from "../services/approvalWorkflowService.js";

export const approvalWorkflowRouter = Router();

function tenantIdOrReject(req: import("express").Request, res: import("express").Response): string | null {
  const tenantId = req.userContext?.tenantId;
  if (!tenantId || tenantId === "platform") {
    res.status(401).json({ error: "Unauthorized" });
    return null;
  }
  return tenantId;
}

approvalWorkflowRouter.get("/", async (req, res) => {
  const tenantId = tenantIdOrReject(req, res);
  if (!tenantId) {
    return;
  }
  try {
    res.json(await getApprovalWorkflow(tenantId));
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : "Failed to load approval workflows"
    });
  }
});

approvalWorkflowRouter.put("/", requirePermission("users.update"), async (req, res) => {
  const tenantId = tenantIdOrReject(req, res);
  if (!tenantId) {
    return;
  }
  try {
    res.json(await updateApprovalWorkflow(tenantId, req.body));
  } catch (error) {
    res.status(400).json({
      error: error instanceof Error ? error.message : "Failed to save approval workflows"
    });
  }
});
