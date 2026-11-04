import type { NextFunction, Request, Response } from "express";
import { hasTenantModule, type TenantProductModule } from "@bms/shared";
import { modulesForApiPath } from "../config/tenantModules.js";
import { getTenantModulesFromStore } from "../services/tenantModuleService.js";

export function requireTenantModuleForRequest(req: Request, res: Response, next: NextFunction): void {
  // Public routes and failed auth are handled by authenticate; skip module checks here.
  if (!req.userContext) {
    next();
    return;
  }

  if (req.userContext.role === "super_admin") {
    next();
    return;
  }

  const path = req.originalUrl.split("?")[0] ?? req.path;
  const required = modulesForApiPath(path);
  if (!required?.length) {
    next();
    return;
  }

  const modules =
    req.userContext.subscribedModules ??
    getTenantModulesFromStore(req.userContext.tenantId) ??
    [];

  if (!required.some((module) => hasTenantModule(modules, module))) {
    const label = required.length === 1 ? required[0]! : required.join(" or ");
    res.status(403).json({
      error: `Product module not enabled: ${label}`,
      requiredModule: required[0],
      requiredModules: required
    });
    return;
  }

  next();
}

export function requireTenantModule(module: TenantProductModule) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.userContext) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    if (req.userContext.role === "super_admin") {
      next();
      return;
    }
    const modules =
      req.userContext.subscribedModules ??
      getTenantModulesFromStore(req.userContext.tenantId) ??
      [];
    if (!hasTenantModule(modules, module)) {
      res.status(403).json({ error: `Product module not enabled: ${module}`, requiredModule: module });
      return;
    }
    next();
  };
}
