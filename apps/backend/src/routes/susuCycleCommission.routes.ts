import { Router } from "express";
import { updateSusuCommissionPolicySchema } from "@bms/shared";
import { requirePermission } from "../middleware/requirePermission.js";
import { validateBody } from "../middleware/validateBody.js";
import {
  getActiveSusuCommissionPolicy,
  getCustomerSusuCycleSummary,
  publishSusuCommissionPolicy
} from "../services/susuCycleCommissionService.js";
import { setRequestAuditContext } from "../services/auditService.js";

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
      const before = await getActiveSusuCommissionPolicy(context.tenantId).catch(() => null);
      const policy = await publishSusuCommissionPolicy(
        {
          userId: context.userId,
          tenantId: context.tenantId,
          role: context.role,
          permissions: context.permissions
        },
        req.body
      );
      setRequestAuditContext(req, {
        entityType: "susu_commission_policy",
        entityId: context.tenantId,
        action: "Updated Susu cycle commission policy",
        before: before ? { ...before } : null,
        after: { ...policy }
      });
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
      if (context.role === "field_agent") {
        const { getCustomerById } = await import("../services/customerService.js");
        const customer = await getCustomerById(context.tenantId, customerId);
        if (
          !customer ||
          (customer.assignedFieldAgentId !== context.userId &&
            customer.createdByFieldAgentId !== context.userId)
        ) {
          res.status(403).json({ error: "You can only view the Susu passbook for your customers." });
          return;
        }
      }
      res.json(await getCustomerSusuCycleSummary(context.tenantId, customerId));
    } catch (error) {
      next(error);
    }
  }
);
