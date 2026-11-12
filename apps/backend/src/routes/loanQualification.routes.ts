import { canUseSusuLoanBridge, loanQualificationSetupSchema, type TenantProductModule } from "@bms/shared";
import { Router } from "express";
import { requirePermission } from "../middleware/requirePermission.js";
import {
  evaluateCustomerLoanQualification,
  getLoanQualificationSetup,
  updateLoanQualificationSetup
} from "../services/loanQualificationService.js";
import { getSusuLoanBridgeEnabled } from "../services/tenantProfileService.js";
import { loadTenantModules } from "../services/tenantModuleService.js";

export const loanQualificationRouter = Router();

async function requireBridge(req: import("express").Request, res: import("express").Response): Promise<boolean> {
  const tenantId = req.userContext?.tenantId;
  if (!tenantId) {
    res.status(401).json({ error: "Unauthorized" });
    return false;
  }
  const [modules, enabled] = await Promise.all([
    loadTenantModules(tenantId),
    getSusuLoanBridgeEnabled(tenantId)
  ]);
  if (!canUseSusuLoanBridge(modules as TenantProductModule[], enabled)) {
    res.status(403).json({
      error: "Enable Susu and Loans products plus the Susu↔Loans bridge to use loan qualification."
    });
    return false;
  }
  return true;
}

loanQualificationRouter.get("/", requirePermission("loans.qualification.manage"), async (req, res) => {
  const tenantId = req.userContext?.tenantId;
  if (!tenantId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  if (!(await requireBridge(req, res))) {
    return;
  }
  try {
    const setup = await getLoanQualificationSetup(tenantId);
    res.json(setup);
  } catch (error) {
    res.status(400).json({
      error: error instanceof Error ? error.message : "Failed to load loan qualification setup"
    });
  }
});

loanQualificationRouter.put("/", requirePermission("loans.qualification.manage"), async (req, res) => {
  const tenantId = req.userContext?.tenantId;
  if (!tenantId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  if (!(await requireBridge(req, res))) {
    return;
  }
  const parsed = loanQualificationSetupSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid loan qualification setup", details: parsed.error.flatten() });
    return;
  }
  try {
    const setup = await updateLoanQualificationSetup(tenantId, parsed.data);
    res.json(setup);
  } catch (error) {
    res.status(400).json({
      error: error instanceof Error ? error.message : "Failed to save loan qualification setup"
    });
  }
});

loanQualificationRouter.get(
  "/customers/:customerId",
  requirePermission("customers.read"),
  async (req, res) => {
    const tenantId = req.userContext?.tenantId;
    if (!tenantId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    if (!(await requireBridge(req, res))) {
      return;
    }
    try {
      const result = await evaluateCustomerLoanQualification(
        tenantId,
        String(req.params.customerId)
      );
      res.json(result);
    } catch (error) {
      res.status(400).json({
        error: error instanceof Error ? error.message : "Failed to evaluate loan qualification"
      });
    }
  }
);
