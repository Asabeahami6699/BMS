import { Router } from "express";
import { updateSusuCommissionPolicySchema } from "@bms/shared";
import { requirePermission } from "../middleware/requirePermission.js";
import { validateBody } from "../middleware/validateBody.js";
import {
  getActiveSusuCommissionPolicy,
  getCustomerSusuCycleSummary,
  publishSusuCommissionPolicy
} from "../services/susuCycleCommissionService.js";

export const susuCycleCommissionRouter = Router();

susuCycleCommissionRouter.get(
  "/policy",
  requirePermission("commission_policy.read"),
  async (req, res, next) => {
    try {
      const context = req.userContext!;
      res.json(await getActiveSusuCommissionPolicy(context.tenantId));
    } catch (error) {
      next(error);
    }
  }
);

susuCycleCommissionRouter.put(
  "/policy",
  requirePermission("commission_policy.update"),
  validateBody(updateSusuCommissionPolicySchema),
  async (req, res, next) => {
    try {
      const context = req.userContext!;
      const policy = await publishSusuCommissionPolicy(
        {
          userId: context.userId,
          tenantId: context.tenantId,
          role: context.role,
          permissions: context.permissions
        },
        req.body
      );
      res.json(policy);
    } catch (error) {
      if (error instanceof Error && error.message) {
        res.status(400).json({ error: error.message });
        return;
      }
      next(error);
    }
  }
);

susuCycleCommissionRouter.get(
  "/customers/:customerId/cycle",
  requirePermission("customers.read"),
  async (req, res, next) => {
    try {
      const context = req.userContext!;
      const customerId = String(req.params.customerId ?? "");
      res.json(await getCustomerSusuCycleSummary(context.tenantId, customerId));
    } catch (error) {
      next(error);
    }
  }
);
