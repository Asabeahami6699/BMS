import type { Permission } from "@bms/shared";
import type { NextFunction, Request, Response } from "express";

export function requirePermission(permission: Permission) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.userContext) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    if (!req.userContext.permissions.includes(permission)) {
      res.status(403).json({ error: "Forbidden", missingPermission: permission });
      return;
    }

    next();
  };
}

export function requireAnyPermission(...permissions: Permission[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.userContext) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const held = req.userContext.permissions;
    if (!permissions.some((p) => held.includes(p))) {
      res.status(403).json({ error: "Forbidden", missingPermission: permissions[0] });
      return;
    }

    next();
  };
}
