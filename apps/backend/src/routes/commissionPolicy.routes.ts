import { commissionPolicySchema } from "@bms/shared";
import { Router } from "express";
import { requirePermission } from "../middleware/requirePermission.js";
import { getCommissionPolicy, upsertCommissionPolicy } from "../services/commissionPolicyService.js";

export const commissionPolicyRouter = Router();

commissionPolicyRouter.get("/", requirePermission("commission_policy.read"), async (req, res) => {
  const tenantId = req.userContext?.tenantId;
  if (!tenantId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    res.json(await getCommissionPolicy(tenantId));
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Failed to load policy" });
  }
});

commissionPolicyRouter.put("/", requirePermission("commission_policy.update"), async (req, res) => {
  const tenantId = req.userContext?.tenantId;
  if (!tenantId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const parsed = commissionPolicySchema.safeParse({
    ...req.body,
    tenantId
  });

  if (!parsed.success) {
    res.status(400).json({ error: "Invalid commission policy", details: parsed.error.flatten() });
    return;
  }

  try {
    const updated = await upsertCommissionPolicy(parsed.data);
    res.json(updated);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Failed to save policy" });
  }
});
