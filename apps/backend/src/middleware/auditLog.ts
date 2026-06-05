import type { NextFunction, Request, Response } from "express";
import { shouldWriteAuditLog, writeAuditLog } from "../services/auditService.js";

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export function auditLog(req: Request, res: Response, next: NextFunction): void {
  const shouldTrack = MUTATING_METHODS.has(req.method.toUpperCase());
  if (!shouldTrack) {
    next();
    return;
  }

  res.on("finish", () => {
    const tenantId = req.userContext?.tenantId ?? req.header("x-tenant-id");
    if (!tenantId) {
      return;
    }

    if (!shouldWriteAuditLog(req.method, req.originalUrl)) {
      return;
    }

    void writeAuditLog({
      tenantId,
      actorUserId: req.userContext?.userId,
      actorRole: req.userContext?.role,
      method: req.method,
      path: req.originalUrl,
      statusCode: res.statusCode,
      branchId: req.userContext?.branchId,
      ipAddress: req.ip
    }).catch(() => {
      // Non-blocking logging by design.
    });
  });

  next();
}
