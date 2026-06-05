import type { NextFunction, Request, Response } from "express";
import { resolveUserContextFromHeaders } from "../services/userContextService.js";

export async function mockAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const context = await resolveUserContextFromHeaders({
      userId: req.header("x-user-id") ?? undefined,
      tenantId: req.header("x-tenant-id") ?? undefined,
      role: req.header("x-role") ?? undefined,
      scopeType: req.header("x-scope-type") ?? undefined,
      branchId: req.header("x-branch-id") ?? undefined
    });
    req.userContext = context;
    next();
  } catch (error) {
    res.status(400).json({
      error: error instanceof Error ? error.message : "Failed to resolve user context"
    });
  }
}
