import { Router } from "express";
import { requirePermission } from "../middleware/requirePermission.js";
import {
  activateFreeSubscriptionPlan,
  getTenantSubscriptionSnapshot,
  listSubscriptionPlans,
  submitSubscriptionPaymentClaim
} from "../services/subscriptionBillingService.js";

export const subscriptionRouter = Router();

subscriptionRouter.get("/plans", requirePermission("users.read"), async (_req, res) => {
  try {
    res.json(await listSubscriptionPlans(true));
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Failed to list plans" });
  }
});

subscriptionRouter.get("/me", requirePermission("users.read"), async (req, res) => {
  try {
    const tenantId = req.userContext?.tenantId;
    if (!tenantId) {
      res.status(400).json({ error: "Tenant context required" });
      return;
    }
    res.json(await getTenantSubscriptionSnapshot(tenantId));
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Failed to load subscription" });
  }
});

subscriptionRouter.post("/claims", requirePermission("users.update"), async (req, res) => {
  try {
    const tenantId = req.userContext?.tenantId;
    if (!tenantId) {
      res.status(400).json({ error: "Tenant context required" });
      return;
    }
    const claim = await submitSubscriptionPaymentClaim(tenantId, req.userContext?.userId, req.body);
    res.status(201).json(claim);
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Failed to submit claim" });
  }
});

subscriptionRouter.post("/activate-free", requirePermission("users.update"), async (req, res) => {
  try {
    const tenantId = req.userContext?.tenantId;
    if (!tenantId) {
      res.status(400).json({ error: "Tenant context required" });
      return;
    }
    res.json(await activateFreeSubscriptionPlan(tenantId));
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Failed to start free plan" });
  }
});
