import { createFieldRouteSchema, setRouteMembersSchema, updateFieldRouteSchema } from "@bms/shared";
import { Router } from "express";
import { requirePermission } from "../middleware/requirePermission.js";
import { validateBody } from "../middleware/validateBody.js";
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

routesRouter.post("/", requirePermission("customers.create"), validateBody(createFieldRouteSchema), async (req, res) => {
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
});

routesRouter.patch(
  "/:routeId",
  requirePermission("customers.create"),
  validateBody(updateFieldRouteSchema),
  async (req, res) => {
  const tenantId = req.userContext?.tenantId;
  if (!tenantId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const routeId = Array.isArray(req.params.routeId) ? req.params.routeId[0] : req.params.routeId;
  try {
    res.json(await updateFieldRoute(tenantId, routeId, req.body));
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Failed to update route" });
  }
});

routesRouter.put(
  "/:routeId/members",
  requirePermission("customers.create"),
  validateBody(setRouteMembersSchema),
  async (req, res) => {
  const tenantId = req.userContext?.tenantId;
  if (!tenantId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const routeId = Array.isArray(req.params.routeId) ? req.params.routeId[0] : req.params.routeId;
  try {
    res.json(await setRouteMembers(tenantId, routeId, req.body));
  } catch (error) {
    res.status(400).json({
      error: error instanceof Error ? error.message : "Failed to update route members"
    });
  }
});

routesRouter.delete("/:routeId", requirePermission("customers.create"), async (req, res) => {
  const tenantId = req.userContext?.tenantId;
  if (!tenantId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const routeId = Array.isArray(req.params.routeId) ? req.params.routeId[0] : req.params.routeId;
  try {
    await deleteFieldRoute(tenantId, routeId);
    res.status(204).send();
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Failed to delete route" });
  }
});
