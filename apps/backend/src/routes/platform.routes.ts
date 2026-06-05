import { createTenantSchema } from "@bms/shared";
import { Router } from "express";
import { z } from "zod";
import {
  createPlatformTenant,
  createTenantCompanyAdmin,
  listPlatformTenants,
  updateTenantProductModules,
  updateTenantAddons,
  updateTenantSubscription
} from "../services/authService.js";
import { requirePermission } from "../middleware/requirePermission.js";

const subscriptionUpdateSchema = z.object({
  subscriptionStatus: z.enum(["active", "inactive"])
});

export const platformRouter = Router();

import type { NextFunction, Request, Response } from "express";

function requireSuperAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.userContext || req.userContext.role !== "super_admin") {
    res.status(403).json({ error: "Platform super admin access required" });
    return;
  }
  next();
}

platformRouter.use(requireSuperAdmin);

platformRouter.get("/tenants", requirePermission("platform.tenants.read"), async (_req, res) => {
  try {
    res.json(await listPlatformTenants());
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Failed to list tenants" });
  }
});

platformRouter.post("/tenants", requirePermission("platform.tenants.create"), async (req, res) => {
  try {
    const parsed = createTenantSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid tenant payload", details: parsed.error.flatten() });
      return;
    }
    const tenant = await createPlatformTenant(parsed.data);
    res.status(201).json(tenant);
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Failed to create tenant" });
  }
});

platformRouter.patch(
  "/tenants/:tenantId/modules",
  requirePermission("platform.tenants.update"),
  async (req, res) => {
    try {
      const tenant = await updateTenantProductModules(String(req.params.tenantId), req.body);
      res.json(tenant);
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : "Failed to update modules" });
    }
  }
);

platformRouter.patch(
  "/tenants/:tenantId/addons",
  requirePermission("platform.tenants.update"),
  async (req, res) => {
    try {
      const tenant = await updateTenantAddons(String(req.params.tenantId), req.body);
      res.json(tenant);
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : "Failed to update add-ons" });
    }
  }
);

platformRouter.patch(
  "/tenants/:tenantId/subscription",
  requirePermission("platform.tenants.update"),
  async (req, res) => {
    const parsed = subscriptionUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid subscription payload" });
      return;
    }

    try {
      const tenantId = String(req.params.tenantId);
      const tenant = await updateTenantSubscription(tenantId, parsed.data.subscriptionStatus);
      res.json(tenant);
    } catch (error) {
      res.status(404).json({ error: error instanceof Error ? error.message : "Tenant not found" });
    }
  }
);

platformRouter.post("/tenants/:tenantId/admins", requirePermission("users.create"), async (req, res) => {
  try {
    const tenantId = String(req.params.tenantId);
    const admin = await createTenantCompanyAdmin(tenantId, req.body);
    res.status(201).json(admin);
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Failed to create company admin" });
  }
});
