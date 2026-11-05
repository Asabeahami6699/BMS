import { Router } from "express";
import { requirePermission } from "../middleware/requirePermission.js";
import {
  getCollectionBatchById,
  listPendingCollectionBatches,
  postAllPendingCollectionBatches,
  postCollectionBatch
} from "../services/collectionBatchService.js";
import {
  creditCustomerFromOverage,
  listCashVariances,
  settleCashVariance,
  type CashVarianceSettlementMethod
} from "../services/cashVarianceService.js";

import { resolveRequestBranchFilter } from "../middleware/branchScope.js";

export const collectionBatchesRouter = Router();

function requireCoordinator(req: { userContext?: { role?: string } }, res: {
  status: (code: number) => { json: (body: unknown) => void };
}): boolean {
  const context = req.userContext;
  if (!context) {
    res.status(401).json({ error: "Unauthorized" });
    return false;
  }
  if (context.role !== "admin" && context.role !== "coordinator") {
    res.status(403).json({ error: "Coordinator access only" });
    return false;
  }
  return true;
}

collectionBatchesRouter.get("/pending", requirePermission("transactions.read"), async (req, res) => {
  const context = req.userContext;
  if (!context) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  if (context.role !== "admin" && context.role !== "coordinator") {
    res.status(403).json({ error: "Coordinator access only" });
    return;
  }

  const businessDate = typeof req.query.businessDate === "string" ? req.query.businessDate : undefined;
  const fieldAgentId = typeof req.query.fieldAgentId === "string" ? req.query.fieldAgentId : undefined;
  const branchId = resolveRequestBranchFilter(req);

  try {
    const batches = await listPendingCollectionBatches(
      {
        tenantId: context.tenantId,
        userId: context.userId,
        role: context.role,
        branchId: context.branchId,
        scopeType: context.scopeType
      },
      { businessDate, fieldAgentId, branchId }
    );
    res.json(batches);
  } catch (error) {
    res.status(400).json({
      error: error instanceof Error ? error.message : "Failed to list pending batches"
    });
  }
});

collectionBatchesRouter.get("/cash-variances", requirePermission("transactions.read"), async (req, res) => {
  if (!requireCoordinator(req, res)) {
    return;
  }
  const context = req.userContext!;

  const statusRaw = typeof req.query.status === "string" ? req.query.status : "open";
  const fieldAgentId = typeof req.query.fieldAgentId === "string" ? req.query.fieldAgentId : undefined;
  const branchId = resolveRequestBranchFilter(req) ?? undefined;
  const varianceType =
    req.query.varianceType === "shortage" || req.query.varianceType === "overage"
      ? req.query.varianceType
      : undefined;
  const businessDate =
    typeof req.query.businessDate === "string" ? req.query.businessDate : undefined;
  const fromDate = typeof req.query.fromDate === "string" ? req.query.fromDate : undefined;
  const toDate = typeof req.query.toDate === "string" ? req.query.toDate : undefined;

  try {
    const cases = await listCashVariances(
      {
        tenantId: context.tenantId,
        userId: context.userId,
        role: context.role,
        branchId: context.branchId
      },
      {
        status: statusRaw as "open" | "all",
        fieldAgentId,
        branchId,
        varianceType,
        businessDate,
        fromDate,
        toDate
      }
    );
    res.json(cases);
  } catch (error) {
    res.status(400).json({
      error: error instanceof Error ? error.message : "Failed to list cash variances"
    });
  }
});

collectionBatchesRouter.post(
  "/cash-variances/:varianceId/settle",
  requirePermission("transactions.create.daily_susu"),
  async (req, res) => {
    if (!requireCoordinator(req, res)) {
      return;
    }
    const context = req.userContext!;

    const varianceId = Array.isArray(req.params.varianceId)
      ? req.params.varianceId[0]
      : req.params.varianceId;
    const amount =
      typeof req.body?.amount === "number"
        ? req.body.amount
        : typeof req.body?.amount === "string"
          ? Number(req.body.amount)
          : NaN;
    const method = req.body?.method as CashVarianceSettlementMethod | undefined;
    const notes = typeof req.body?.notes === "string" ? req.body.notes : undefined;

    if (!method) {
      res.status(400).json({ error: "Settlement method is required" });
      return;
    }

    try {
      const updated = await settleCashVariance(
        {
          tenantId: context.tenantId,
          userId: context.userId,
          role: context.role,
          branchId: context.branchId
        },
        varianceId,
        { amount, method, notes }
      );
      res.json(updated);
    } catch (error) {
      res.status(400).json({
        error: error instanceof Error ? error.message : "Failed to settle cash variance"
      });
    }
  }
);

collectionBatchesRouter.post(
  "/cash-variances/:varianceId/credit-customer",
  requirePermission("transactions.create.daily_susu"),
  async (req, res) => {
    if (!requireCoordinator(req, res)) {
      return;
    }
    const context = req.userContext!;

    const varianceId = Array.isArray(req.params.varianceId)
      ? req.params.varianceId[0]
      : req.params.varianceId;
    const customerId =
      typeof req.body?.customerId === "string" ? req.body.customerId.trim() : "";
    const amount =
      typeof req.body?.amount === "number"
        ? req.body.amount
        : typeof req.body?.amount === "string"
          ? Number(req.body.amount)
          : NaN;
    const notes = typeof req.body?.notes === "string" ? req.body.notes : undefined;

    if (!customerId) {
      res.status(400).json({ error: "Customer is required" });
      return;
    }

    try {
      const result = await creditCustomerFromOverage(
        {
          tenantId: context.tenantId,
          userId: context.userId,
          role: context.role,
          branchId: context.branchId,
          scopeType: context.scopeType
        },
        varianceId,
        { customerId, amount, notes }
      );
      res.json(result);
    } catch (error) {
      res.status(400).json({
        error: error instanceof Error ? error.message : "Failed to credit customer from overage"
      });
    }
  }
);

collectionBatchesRouter.get("/:batchId", requirePermission("transactions.read"), async (req, res) => {
  const context = req.userContext;
  if (!context) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  if (context.role !== "admin" && context.role !== "coordinator") {
    res.status(403).json({ error: "Coordinator access only" });
    return;
  }

  const batchId = Array.isArray(req.params.batchId) ? req.params.batchId[0] : req.params.batchId;

  try {
    res.json(
      await getCollectionBatchById(
        {
          tenantId: context.tenantId,
          userId: context.userId,
          role: context.role,
          branchId: context.branchId,
          scopeType: context.scopeType
        },
        batchId
      )
    );
  } catch (error) {
    res.status(404).json({
      error: error instanceof Error ? error.message : "Batch not found"
    });
  }
});

collectionBatchesRouter.post("/:batchId/post", requirePermission("transactions.create.daily_susu"), async (req, res) => {
  const context = req.userContext;
  if (!context) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  if (context.role !== "admin" && context.role !== "coordinator") {
    res.status(403).json({ error: "Coordinator access only" });
    return;
  }

  const batchId = Array.isArray(req.params.batchId) ? req.params.batchId[0] : req.params.batchId;

  const cashReceivedAmount =
    typeof req.body?.cashReceivedAmount === "number"
      ? req.body.cashReceivedAmount
      : typeof req.body?.cashReceivedAmount === "string"
        ? Number(req.body.cashReceivedAmount)
        : undefined;

  try {
    const batch = await postCollectionBatch(
      {
        tenantId: context.tenantId,
        userId: context.userId,
        role: context.role,
        branchId: context.branchId,
        scopeType: context.scopeType
      },
      batchId,
      { cashReceivedAmount }
    );
    res.json(batch);
  } catch (error) {
    res.status(400).json({
      error: error instanceof Error ? error.message : "Failed to post batch"
    });
  }
});

collectionBatchesRouter.post("/post-all", requirePermission("transactions.create.daily_susu"), async (req, res) => {
  const context = req.userContext;
  if (!context) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  if (context.role !== "admin" && context.role !== "coordinator") {
    res.status(403).json({ error: "Coordinator access only" });
    return;
  }

  const businessDate = typeof req.body?.businessDate === "string" ? req.body.businessDate : undefined;
  const fieldAgentId = typeof req.body?.fieldAgentId === "string" ? req.body.fieldAgentId : undefined;
  const branchId = typeof req.body?.branchId === "string" ? req.body.branchId : undefined;
  const cashByBatchId =
    req.body?.cashByBatchId && typeof req.body.cashByBatchId === "object"
      ? (req.body.cashByBatchId as Record<string, number>)
      : undefined;

  try {
    const result = await postAllPendingCollectionBatches(
      {
        tenantId: context.tenantId,
        userId: context.userId,
        role: context.role,
        branchId: context.branchId,
        scopeType: context.scopeType
      },
      { businessDate, fieldAgentId, branchId, cashByBatchId }
    );
    res.json(result);
  } catch (error) {
    res.status(400).json({
      error: error instanceof Error ? error.message : "Failed to post batches"
    });
  }
});
