import { Router } from "express";
import { requirePermission } from "../middleware/requirePermission.js";
import {
  getCollectionBatchById,
  listPendingCollectionBatches,
  postAllPendingCollectionBatches,
  postCollectionBatch
} from "../services/collectionBatchService.js";

export const collectionBatchesRouter = Router();

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
  const branchId = typeof req.query.branchId === "string" ? req.query.branchId : undefined;

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

  try {
    const batch = await postCollectionBatch(
      {
        tenantId: context.tenantId,
        userId: context.userId,
        role: context.role,
        branchId: context.branchId,
        scopeType: context.scopeType
      },
      batchId
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

  try {
    const result = await postAllPendingCollectionBatches(
      {
        tenantId: context.tenantId,
        userId: context.userId,
        role: context.role,
        branchId: context.branchId,
        scopeType: context.scopeType
      },
      { businessDate, fieldAgentId, branchId }
    );
    res.json(result);
  } catch (error) {
    res.status(400).json({
      error: error instanceof Error ? error.message : "Failed to post batches"
    });
  }
});
