import { commissionPolicySchema } from "@bms/shared";
import { Router } from "express";
import { requirePermission } from "../middleware/requirePermission.js";
import { getCommissionPolicy, upsertCommissionPolicy } from "../services/commissionPolicyService.js";

export const commissionPolicyRouter = Router();

commissionPolicyRouter.get("/", requirePermission("commission_policy.read"), (req, res) => {
  const tenantId = req.userContext?.tenantId;
  if (!tenantId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  res.json(getCommissionPolicy(tenantId));
});

commissionPolicyRouter.put("/", requirePermission("commission_policy.update"), (req, res) => {
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

  const updated = upsertCommissionPolicy(parsed.data);
  res.json(updated);
});
