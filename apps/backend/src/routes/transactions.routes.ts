import { createTransactionInputSchema } from "@bms/shared";
import { Router } from "express";
import { requireIdempotencyKey } from "../middleware/idempotency.js";
import { requirePermission } from "../middleware/requirePermission.js";
import { validateBody } from "../middleware/validateBody.js";
import { resolveBranchId } from "../services/branchService.js";
import { resolveRequestBranchFilter } from "../middleware/branchScope.js";
import { getBranchCounterBootstrap } from "../services/branchCounterBootstrapService.js";
import {
  listBranchCounterStatement,
  summarizeBranchCounterStatement
} from "../services/branchCounterStatementService.js";
import { listTransactions, createTransaction } from "../services/transactionService.js";
import {
  allocateBranchFloat,
  closeBranchFloat,
  getMyBranchFloatSession,
  listBranchFloatSessions,
  listPendingFloatRequests,
  pushBranchFloat,
  requestBranchFloat,
  settleBranchFloat,
  type FloatSessionStatus
} from "../services/branchFloatService.js";

export const transactionsRouter = Router();

transactionsRouter.get("/branch-counter-bootstrap", requirePermission("transactions.read"), async (req, res) => {
  const context = req.userContext;
  if (!context) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const branchIdParam = typeof req.query.branchId === "string" ? req.query.branchId : "";
  const dateParam =
    typeof req.query.date === "string" && req.query.date.length > 0
      ? req.query.date
      : new Date().toISOString().slice(0, 10);

  const scopedBranch = resolveRequestBranchFilter(req);
  const branchRef =
    context.scopeType === "head_office"
      ? branchIdParam && branchIdParam !== "all"
        ? branchIdParam
        : scopedBranch ?? ""
      : context.branchId || branchIdParam;

  try {
    const resolvedBranchId = branchRef
      ? await resolveBranchId(context.tenantId, branchRef)
      : undefined;
    const data = await getBranchCounterBootstrap(context.tenantId, {
      branchId: resolvedBranchId || undefined,
      date: dateParam,
      cashierUserId: context.userId,
      includePending: context.role === "admin" || context.role === "coordinator"
    });
    res.json(data);
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : "Failed to load branch counter data"
    });
  }
});

transactionsRouter.post(
  "/",
  requirePermission("transactions.read"),
  requireIdempotencyKey,
  validateBody(createTransactionInputSchema),
  async (req, res) => {
  const context = req.userContext;
  if (!context) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const type = req.body?.type;
  const canPost =
    (type === "daily_susu" && context.permissions.includes("transactions.create.daily_susu")) ||
    (type === "deposit" &&
      (context.permissions.includes("transactions.create.deposit") ||
        context.permissions.includes("agency.deposits.record"))) ||
    (type === "withdrawal" && context.permissions.includes("transactions.create.withdrawal"));

  if (!canPost) {
    res.status(403).json({ error: "Forbidden for transaction type" });
    return;
  }

  try {
    const transaction = await createTransaction(context, req.body);
    res.status(201).json(transaction);
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Invalid transaction" });
  }
  }
);

transactionsRouter.get("/branch-counter-statement", requirePermission("transactions.read"), async (req, res) => {
  const context = req.userContext;
  if (!context) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const branchIdParam = typeof req.query.branchId === "string" ? req.query.branchId : "";
  const dateParam =
    typeof req.query.date === "string" && req.query.date.length > 0
      ? req.query.date
      : new Date().toISOString().slice(0, 10);

  const branchId =
    context.scopeType === "head_office"
      ? branchIdParam || context.branchId || ""
      : context.branchId || branchIdParam;

  if (!branchId) {
    res.status(400).json({ error: "Select a branch for the daily statement" });
    return;
  }

  try {
    const lines = await listBranchCounterStatement(context.tenantId, branchId, dateParam);
    res.json({
      lines,
      summary: summarizeBranchCounterStatement(lines, dateParam, branchId)
    });
  } catch (error) {
    res.status(400).json({
      error: error instanceof Error ? error.message : "Failed to load branch counter statement"
    });
  }
});

transactionsRouter.get("/branch-float/me", requirePermission("transactions.read"), async (req, res) => {
  const context = req.userContext;
  if (!context) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const branchId = typeof req.query.branchId === "string" ? req.query.branchId : undefined;
  const businessDate = typeof req.query.date === "string" ? req.query.date : undefined;
  try {
    const session = await getMyBranchFloatSession(
      {
        tenantId: context.tenantId,
        userId: context.userId,
        role: context.role,
        scopeType: context.scopeType as "head_office" | "branch",
        branchId: context.branchId
      },
      { branchId, businessDate }
    );
    res.json({ session });
  } catch (error) {
    res.status(400).json({
      error: error instanceof Error ? error.message : "Failed to load float session"
    });
  }
});

transactionsRouter.post("/branch-float/request", requirePermission("transactions.read"), async (req, res) => {
  const context = req.userContext;
  if (!context) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  try {
    const session = await requestBranchFloat(
      {
        tenantId: context.tenantId,
        userId: context.userId,
        role: context.role,
        scopeType: context.scopeType as "head_office" | "branch",
        branchId: context.branchId
      },
      {
        branchId: String(req.body?.branchId ?? ""),
        requestedAmount: Number(req.body?.requestedAmount ?? 0),
        note: typeof req.body?.note === "string" ? req.body.note : undefined,
        businessDate: typeof req.body?.businessDate === "string" ? req.body.businessDate : undefined
      }
    );
    res.status(201).json({ session });
  } catch (error) {
    res.status(400).json({
      error: error instanceof Error ? error.message : "Failed to request float"
    });
  }
});

transactionsRouter.post(
  "/branch-float/:sessionId/allocate",
  requirePermission("transactions.read"),
  async (req, res) => {
    const context = req.userContext;
    if (!context) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const sessionId = Array.isArray(req.params.sessionId) ? req.params.sessionId[0] : req.params.sessionId;
    try {
      const session = await allocateBranchFloat(
        {
          tenantId: context.tenantId,
          userId: context.userId,
          role: context.role,
          scopeType: context.scopeType as "head_office" | "branch",
          branchId: context.branchId
        },
        sessionId,
        { openingFloat: Number(req.body?.openingFloat ?? 0) }
      );
      res.json({ session });
    } catch (error) {
      res.status(400).json({
        error: error instanceof Error ? error.message : "Failed to allocate float"
      });
    }
  }
);

transactionsRouter.post("/branch-float/push", requirePermission("transactions.read"), async (req, res) => {
  const context = req.userContext;
  if (!context) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  try {
    const session = await pushBranchFloat(
      {
        tenantId: context.tenantId,
        userId: context.userId,
        role: context.role,
        scopeType: context.scopeType as "head_office" | "branch",
        branchId: context.branchId
      },
      {
        branchId: String(req.body?.branchId ?? ""),
        cashierUserId: String(req.body?.cashierUserId ?? ""),
        openingFloat: Number(req.body?.openingFloat ?? 0),
        businessDate: typeof req.body?.businessDate === "string" ? req.body.businessDate : undefined
      }
    );
    res.status(201).json({ session });
  } catch (error) {
    res.status(400).json({
      error: error instanceof Error ? error.message : "Failed to push float"
    });
  }
});

transactionsRouter.get("/branch-float/sessions", requirePermission("transactions.read"), async (req, res) => {
  const context = req.userContext;
  if (!context) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  if (context.role !== "admin" && context.role !== "coordinator") {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  const businessDate = typeof req.query.date === "string" ? req.query.date : undefined;
  const status = typeof req.query.status === "string" ? req.query.status : undefined;
  try {
    res.json({
      sessions: await listBranchFloatSessions(context.tenantId, {
        businessDate,
        status: status as FloatSessionStatus | undefined
      })
    });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : "Failed to list float sessions"
    });
  }
});

transactionsRouter.get("/branch-float/pending", requirePermission("transactions.read"), async (req, res) => {
  const context = req.userContext;
  if (!context) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  if (context.role !== "admin" && context.role !== "coordinator") {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  try {
    res.json({ sessions: await listPendingFloatRequests(context.tenantId) });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : "Failed to list pending floats"
    });
  }
});

transactionsRouter.post(
  "/branch-float/:sessionId/close",
  requirePermission("transactions.read"),
  async (req, res) => {
    const context = req.userContext;
    if (!context) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const sessionId = Array.isArray(req.params.sessionId) ? req.params.sessionId[0] : req.params.sessionId;
    try {
      const session = await closeBranchFloat(
        {
          tenantId: context.tenantId,
          userId: context.userId,
          role: context.role,
          scopeType: context.scopeType as "head_office" | "branch",
          branchId: context.branchId
        },
        sessionId,
        {
          actualClosing: Number(req.body?.actualClosing ?? 0),
          varianceNote: typeof req.body?.varianceNote === "string" ? req.body.varianceNote : undefined
        }
      );
      res.json({ session });
    } catch (error) {
      res.status(400).json({
        error: error instanceof Error ? error.message : "Failed to close float"
      });
    }
  }
);

transactionsRouter.post(
  "/branch-float/:sessionId/settle",
  requirePermission("transactions.read"),
  async (req, res) => {
    const context = req.userContext;
    if (!context) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const sessionId = Array.isArray(req.params.sessionId) ? req.params.sessionId[0] : req.params.sessionId;
    try {
      const session = await settleBranchFloat(
        {
          tenantId: context.tenantId,
          userId: context.userId,
          role: context.role,
          scopeType: context.scopeType as "head_office" | "branch",
          branchId: context.branchId
        },
        sessionId
      );
      res.json({ session });
    } catch (error) {
      res.status(400).json({
        error: error instanceof Error ? error.message : "Failed to settle float"
      });
    }
  }
);

transactionsRouter.get("/", requirePermission("transactions.read"), async (req, res) => {
  const context = req.userContext;
  if (!context) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    res.json(
      await listTransactions(context.tenantId, {
        branchId: resolveRequestBranchFilter(req)
      })
    );
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Failed to fetch transactions" });
  }
});
