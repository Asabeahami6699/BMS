import {
  bulkReorganizeCustomersSchema,
  createFieldRouteSchema,
  setRouteMembersSchema,
  updateFieldRouteSchema,
  updateTenantRouteSettingsSchema
} from "@bms/shared";
import { Router } from "express";
import { requirePermission } from "../middleware/requirePermission.js";
import { validateBody } from "../middleware/validateBody.js";
import { setRequestAuditContext } from "../services/auditService.js";
import {
  bulkReorganizeCustomerAssignments,
  getBranchLocationSuggestions,
  getTenantRouteSettings,
  listCustomerAssignmentHistory,
  updateTenantRouteSettings
} from "../services/routeManagementService.js";
import {
  createFieldRoute,
  deleteFieldRoute,
  getFieldRoute,
  listFieldRoutes,
  listRouteMembers,
  setRouteMembers,
  updateFieldRoute
} from "../services/routeService.js";
import { getRoutesBootstrap } from "../services/routesBootstrapService.js";

export const routesRouter = Router();

routesRouter.get("/bootstrap", requirePermission("customers.read"), async (req, res) => {
  const tenantId = req.userContext?.tenantId;
  if (!tenantId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  try {
    res.json(await getRoutesBootstrap(tenantId));
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : "Failed to load routes bootstrap"
    });
  }
});

routesRouter.get("/settings", requirePermission("customers.read"), async (req, res) => {
  const tenantId = req.userContext?.tenantId;
  if (!tenantId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  try {
    res.json(await getTenantRouteSettings(tenantId));
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : "Failed to load route settings"
    });
  }
});

routesRouter.put(
  "/settings",
  requirePermission("customers.create"),
  validateBody(updateTenantRouteSettingsSchema),
  async (req, res) => {
    const context = req.userContext;
    if (!context) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    if (context.role !== "admin") {
      res.status(403).json({ error: "Only administrators can change tenant route assignment settings" });
      return;
    }
    try {
      const before = await getTenantRouteSettings(context.tenantId);
      const updated = await updateTenantRouteSettings(context.tenantId, context.userId, req.body);
      setRequestAuditContext(req, {
        entityType: "tenant_route_settings",
        entityId: context.tenantId,
        before: {
          strategy: before.strategy,
          autoAssignOnApproval: before.autoAssignOnApproval,
          syncAgentOnRouteChange: before.syncAgentOnRouteChange
        },
        after: {
          strategy: updated.strategy,
          autoAssignOnApproval: updated.autoAssignOnApproval,
          syncAgentOnRouteChange: updated.syncAgentOnRouteChange
        }
      });
      res.json(updated);
    } catch (error) {
      res.status(400).json({
        error: error instanceof Error ? error.message : "Failed to update route settings"
      });
    }
  }
);

routesRouter.get("/reorganization/suggestions", requirePermission("customers.read"), async (req, res) => {
  const context = req.userContext;
  if (!context) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const requestedBranchId =
    typeof req.query.branchId === "string" && req.query.branchId.trim()
      ? req.query.branchId.trim()
      : context.branchId;
  if (!requestedBranchId) {
    res.status(400).json({ error: "branchId is required" });
    return;
  }
  if (context.scopeType === "branch" && context.branchId && context.branchId !== requestedBranchId) {
    res.status(403).json({ error: "Cannot load location suggestions for another branch" });
    return;
  }
  try {
    res.json(await getBranchLocationSuggestions(context.tenantId, requestedBranchId));
  } catch (error) {
    res.status(400).json({
      error: error instanceof Error ? error.message : "Failed to compute location suggestions"
    });
  }
});

routesRouter.post(
  "/reorganization/apply",
  requirePermission("customers.create"),
  validateBody(bulkReorganizeCustomersSchema),
  async (req, res) => {
    const context = req.userContext;
    if (!context) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    if (context.role !== "admin" && context.role !== "coordinator") {
      res.status(403).json({ error: "Only admin or coordinator can reorganize customer routes" });
      return;
    }
    try {
      const result = await bulkReorganizeCustomerAssignments(
        context.tenantId,
        {
          userId: context.userId,
          role: context.role,
          scopeType: context.scopeType,
          branchId: context.branchId
        },
        req.body
      );
      setRequestAuditContext(req, {
        entityType: "route_reorganization",
        entityId: String(req.body.branchId ?? context.tenantId),
        after: {
          branchId: req.body.branchId,
          updatedCount: result.updatedCount,
          skippedCount: result.skippedCount,
          reason: req.body.reason
        },
        metadata: {
          changedCustomerIds: result.changes.map((c) => c.customerId)
        }
      });
      res.json(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to apply route reorganization";
      const status = /only admin|another branch/i.test(message) ? 403 : 400;
      res.status(status).json({ error: message });
    }
  }
);

routesRouter.get("/assignment-history", requirePermission("customers.read"), async (req, res) => {
  const context = req.userContext;
  if (!context) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const customerId =
    typeof req.query.customerId === "string" && req.query.customerId.trim()
      ? req.query.customerId.trim()
      : undefined;
  let branchId =
    typeof req.query.branchId === "string" && req.query.branchId.trim()
      ? req.query.branchId.trim()
      : undefined;
  if (context.scopeType === "branch" && context.branchId) {
    if (branchId && branchId !== context.branchId) {
      res.status(403).json({ error: "Cannot view assignment history for another branch" });
      return;
    }
    branchId = context.branchId;
  }
  const limitRaw = typeof req.query.limit === "string" ? Number(req.query.limit) : undefined;
  const limit = Number.isFinite(limitRaw) ? limitRaw : 100;
  try {
    res.json(
      await listCustomerAssignmentHistory(context.tenantId, {
        customerId,
        branchId,
        limit
      })
    );
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : "Failed to load assignment history"
    });
  }
});

routesRouter.get("/", requirePermission("customers.read"), async (req, res) => {
  const tenantId = req.userContext?.tenantId;
  if (!tenantId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  try {
    res.json(await listFieldRoutes(tenantId));
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Failed to list routes" });
  }
});

routesRouter.get("/:routeId", requirePermission("customers.read"), async (req, res) => {
  const tenantId = req.userContext?.tenantId;
  if (!tenantId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const routeId = Array.isArray(req.params.routeId) ? req.params.routeId[0] : req.params.routeId;
  try {
    const route = await getFieldRoute(tenantId, routeId);
    if (!route) {
      res.status(404).json({ error: "Route not found" });
      return;
    }
    res.json(route);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Failed to load route" });
  }
});

routesRouter.get("/:routeId/members", requirePermission("customers.read"), async (req, res) => {
  const tenantId = req.userContext?.tenantId;
  if (!tenantId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const routeId = Array.isArray(req.params.routeId) ? req.params.routeId[0] : req.params.routeId;
  try {
    res.json(await listRouteMembers(tenantId, routeId));
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : "Failed to list route members"
    });
  }
});

routesRouter.post(
  "/",
  requirePermission("customers.create"),
  validateBody(createFieldRouteSchema),
  async (req, res) => {
    const tenantId = req.userContext?.tenantId;
    if (!tenantId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    try {
      res.status(201).json(await createFieldRoute(tenantId, req.body));
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : "Failed to create route" });
    }
  }
);

routesRouter.patch(
  "/:routeId",
  requirePermission("customers.create"),
  validateBody(updateFieldRouteSchema),
  async (req, res) => {
    const context = req.userContext;
    if (!context) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const routeId = Array.isArray(req.params.routeId) ? req.params.routeId[0] : req.params.routeId;
    try {
      res.json(await updateFieldRoute(context.tenantId, routeId, req.body, context.userId));
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : "Failed to update route" });
    }
  }
);

routesRouter.put(
  "/:routeId/members",
  requirePermission("customers.create"),
  validateBody(setRouteMembersSchema),
  async (req, res) => {
    const context = req.userContext;
    if (!context) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const routeId = Array.isArray(req.params.routeId) ? req.params.routeId[0] : req.params.routeId;
    try {
      res.json(await setRouteMembers(context.tenantId, routeId, req.body, context.userId));
    } catch (error) {
      res.status(400).json({
        error: error instanceof Error ? error.message : "Failed to update route members"
      });
    }
  }
);

routesRouter.delete("/:routeId", requirePermission("customers.create"), async (req, res) => {
  const context = req.userContext;
  if (!context) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const routeId = Array.isArray(req.params.routeId) ? req.params.routeId[0] : req.params.routeId;
  try {
    await deleteFieldRoute(context.tenantId, routeId, context.userId);
    res.status(204).send();
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Failed to delete route" });
  }
});
