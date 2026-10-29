import type { Permission } from "@bms/shared";
import type { NextFunction, Request, Response } from "express";

export const PERMISSION_DENIED_MESSAGE = "You do not have permission to access this.";

export function requirePermission(permission: Permission) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.userContext) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    if (!req.userContext.permissions.includes(permission)) {
      res.status(403).json({ error: PERMISSION_DENIED_MESSAGE, missingPermission: permission });
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
      res.status(403).json({ error: PERMISSION_DENIED_MESSAGE, missingPermission: permissions[0] });
      return;
    }

    next();
  };
}
