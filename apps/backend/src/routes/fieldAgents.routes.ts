import { requestBalanceDisclosureSchema, requestCustomerApprovalSchema } from "@bms/shared";
import { Router, type Request, type Response } from "express";
import { requirePermission } from "../middleware/requirePermission.js";
import { validateBody } from "../middleware/validateBody.js";
import {
  listAgentBalanceDisclosures,
  requestCustomerApproval,
  requestCustomerBalanceDisclosure
} from "../services/balanceDisclosureService.js";
import { submitCalloverReport } from "../services/calloverReportService.js";
import {
  addCollectionBatchLine,
  submitCollectionBatchForApproval
} from "../services/collectionBatchService.js";
import {
  getFieldAgentDashboard,
  getFieldAgentTodayCollections
} from "../services/fieldAgentService.js";

export const fieldAgentsRouter = Router();

fieldAgentsRouter.get("/me/dashboard", requirePermission("payroll.read"), async (req, res) => {
  const context = req.userContext;
  if (!context) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  if (context.role !== "field_agent") {
    res.status(403).json({ error: "Field agent access only" });
    return;
  }

  try {
    const dashboard = await getFieldAgentDashboard({
      userId: context.userId,
      tenantId: context.tenantId,
      role: context.role,
      email: context.email,
      fullName: context.fullName,
      branchId: context.branchId,
      tenantName: context.tenantName
    });
    res.json(dashboard);
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : "Failed to load agent dashboard"
    });
  }
});

fieldAgentsRouter.get("/me/collections/today", requirePermission("transactions.read"), async (req, res) => {
  const context = req.userContext;
  if (!context) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  if (context.role !== "field_agent") {
    res.status(403).json({ error: "Field agent access only" });
    return;
  }

  try {
    const collections = await getFieldAgentTodayCollections({
      userId: context.userId,
      tenantId: context.tenantId,
      role: context.role
    });
    res.json(collections);
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : "Failed to load today's collections"
    });
  }
});

fieldAgentsRouter.get("/me/balance-disclosures", requirePermission("customers.read"), async (req, res) => {
  const context = req.userContext;
  if (!context) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  if (context.role !== "field_agent") {
    res.status(403).json({ error: "Field agent access only" });
    return;
  }

  try {
    res.json(await listAgentBalanceDisclosures(context.tenantId, context.userId));
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : "Failed to load balance disclosures"
    });
  }
});

async function handleCustomerRequest(req: Request, res: Response): Promise<void> {
  const context = req.userContext;
  if (!context) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  if (context.role !== "field_agent") {
    res.status(403).json({ error: "Field agent access only" });
    return;
  }

  const customerId = Array.isArray(req.params.customerId)
    ? req.params.customerId[0]
    : req.params.customerId;

  try {
    const disclosure = await requestCustomerApproval(
      context.tenantId,
      context.userId,
      customerId,
      req.body
    );
    res.status(201).json(disclosure);
  } catch (error) {
    res.status(400).json({
      error: error instanceof Error ? error.message : "Failed to submit request"
    });
  }
}

fieldAgentsRouter.post(
  "/me/customers/:customerId/customer-request",
  requirePermission("customers.read"),
  validateBody(requestCustomerApprovalSchema),
  handleCustomerRequest
);

fieldAgentsRouter.post(
  "/me/customers/:customerId/balance-request",
  requirePermission("customers.read"),
  validateBody(requestBalanceDisclosureSchema),
  async (req, res) => {
    const context = req.userContext;
    if (!context) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    if (context.role !== "field_agent") {
      res.status(403).json({ error: "Field agent access only" });
      return;
    }
    const customerId = Array.isArray(req.params.customerId)
      ? req.params.customerId[0]
      : req.params.customerId;
    try {
      const disclosure = await requestCustomerBalanceDisclosure(
        context.tenantId,
        context.userId,
        customerId,
        { type: "balance", reason: req.body.reason }
      );
      res.status(201).json(disclosure);
    } catch (error) {
      res.status(400).json({
        error: error instanceof Error ? error.message : "Failed to request balance"
      });
    }
  }
);

fieldAgentsRouter.post("/me/collection-batches/lines", requirePermission("transactions.read"), async (req, res) => {
  const context = req.userContext;
  if (!context) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  if (context.role !== "field_agent") {
    res.status(403).json({ error: "Field agent access only" });
    return;
  }

  try {
    const collections = await addCollectionBatchLine(
      {
        tenantId: context.tenantId,
        userId: context.userId,
        role: context.role,
        branchId: context.branchId
      },
      req.body
    );
    res.status(201).json(collections);
  } catch (error) {
    res.status(400).json({
      error: error instanceof Error ? error.message : "Failed to record collection"
    });
  }
});

fieldAgentsRouter.post(
  "/me/collection-batches/submit-for-approval",
  requirePermission("transactions.read"),
  async (req, res) => {
    const context = req.userContext;
    if (!context) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    if (context.role !== "field_agent") {
      res.status(403).json({ error: "Field agent access only" });
      return;
    }

    try {
      const result = await submitCollectionBatchForApproval(
        {
          tenantId: context.tenantId,
          userId: context.userId,
          role: context.role,
          branchId: context.branchId
        },
        req.body
      );
      res.status(201).json(result);
    } catch (error) {
      res.status(400).json({
        error: error instanceof Error ? error.message : "Failed to submit for approval"
      });
    }
  }
);

fieldAgentsRouter.post("/me/callover/report", requirePermission("transactions.read"), async (req, res) => {
  const context = req.userContext;
  if (!context) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  if (context.role !== "field_agent") {
    res.status(403).json({ error: "Field agent access only" });
    return;
  }

  try {
    const result = await submitCalloverReport(context.tenantId, context.userId, req.body);
    res.status(201).json(result);
  } catch (error) {
    res.status(400).json({
      error: error instanceof Error ? error.message : "Failed to submit call-over report"
    });
  }
});
