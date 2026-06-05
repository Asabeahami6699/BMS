import { Router } from "express";
import { requirePermission } from "../middleware/requirePermission.js";
import {
  getAccountNumberPolicy,
  upsertAccountNumberPolicy
} from "../services/accountNumberPolicyService.js";

export const accountNumberPolicyRouter = Router();

accountNumberPolicyRouter.get("/", requirePermission("commission_policy.read"), async (req, res) => {
  const tenantId = req.userContext?.tenantId;
  if (!tenantId || tenantId === "platform") {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    res.json(await getAccountNumberPolicy(tenantId));
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : "Failed to load account number policy"
    });
  }
});

accountNumberPolicyRouter.put("/", requirePermission("commission_policy.update"), async (req, res) => {
  const tenantId = req.userContext?.tenantId;
  if (!tenantId || tenantId === "platform") {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    const updated = await upsertAccountNumberPolicy(tenantId, req.body);
    res.json(updated);
  } catch (error) {
    res.status(400).json({
      error: error instanceof Error ? error.message : "Failed to save account number policy"
    });
  }
});
