import type { NextFunction, Request, Response } from "express";

export const ALL_BRANCHES_QUERY = "all";

export class BranchAccessError extends Error {
  constructor(message = "You do not have access to this branch") {
    super(message);
    this.name = "BranchAccessError";
  }
}

/** Head office may target any branch or all branches; branch-scoped users are pinned to their branch. */
export function resolveEffectiveBranchId(
  context: { scopeType: "head_office" | "branch"; branchId?: string },
  requestedBranchId?: string | null
): string | undefined {
  if (context.scopeType === "branch") {
    return context.branchId;
  }
  const trimmed = requestedBranchId?.trim();
  if (!trimmed || trimmed.toLowerCase() === ALL_BRANCHES_QUERY) {
    return undefined;
  }
  return trimmed;
}

export function assertBranchAccess(
  context: { scopeType: "head_office" | "branch"; branchId?: string },
  targetBranchId: string | undefined
): void {
  if (!targetBranchId) {
    return;
  }
  if (context.scopeType === "head_office") {
    return;
  }
  if (context.branchId && context.branchId === targetBranchId) {
    return;
  }
  throw new BranchAccessError();
}

/** Resolved branch filter for list/report queries (undefined = all branches). */
export function resolveRequestBranchFilter(req: Request): string | undefined {
  const context = req.userContext;
  if (!context) {
    return undefined;
  }
  if (context.scopeType === "branch") {
    return context.branchId;
  }
  return req.effectiveBranchId;
}

/** Attach effectiveBranchId from ?branchId= on every authenticated tenant request. */
export function attachBranchScope(req: Request, _res: Response, next: NextFunction): void {
  const context = req.userContext;
  if (!context) {
    next();
    return;
  }
  const raw = req.query.branchId;
  const requested = typeof raw === "string" ? raw : undefined;
  try {
    if (requested && requested.toLowerCase() !== ALL_BRANCHES_QUERY) {
      assertBranchAccess(context, requested);
    }
    req.effectiveBranchId = resolveEffectiveBranchId(context, requested);
  } catch {
    req.effectiveBranchId = context.scopeType === "branch" ? context.branchId : undefined;
  }
  next();
}

export function requireQueryBranchAccess(paramName = "branchId") {
  return (req: Request, res: Response, next: NextFunction) => {
    const context = req.userContext;
    if (!context) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const raw = req.query[paramName];
    const requested = typeof raw === "string" ? raw : undefined;
    try {
      if (requested && requested.toLowerCase() !== ALL_BRANCHES_QUERY) {
        assertBranchAccess(context, requested);
      }
      req.effectiveBranchId = resolveEffectiveBranchId(context, requested);
      next();
    } catch (error) {
      if (error instanceof BranchAccessError) {
        res.status(403).json({ error: error.message });
        return;
      }
      next(error);
    }
  };
}
