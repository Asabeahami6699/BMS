import type { NextFunction, Request, Response } from "express";
import { isSupabaseAuthNetworkError } from "../lib/networkError.js";
import { resolveUserFromAccessToken } from "../services/authService.js";
import { resolveUserContextFromHeaders } from "../services/userContextService.js";

const PUBLIC_PATHS = new Set(["/api/v1/auth/login"]);

function isPublicChatPath(path: string, method: string): boolean {
  if (path === "/api/v1/chat/threads" && method === "POST") {
    return true;
  }
  if (/^\/api\/v1\/chat\/threads\/[^/]+\/messages$/.test(path) && (method === "GET" || method === "POST")) {
    return true;
  }
  return false;
}

export async function authenticate(req: Request, res: Response, next: NextFunction): Promise<void> {
  const path = req.originalUrl.split("?")[0] ?? req.path;
  if ((PUBLIC_PATHS.has(path) && req.method === "POST") || isPublicChatPath(path, req.method)) {
    next();
    return;
  }

  const authHeader = req.header("authorization");
  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.slice("Bearer ".length).trim();
    try {
      const context = await resolveUserFromAccessToken(token);
      if (!context) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }
      req.userContext = context;
      next();
      return;
    } catch (error) {
      if (isSupabaseAuthNetworkError(error)) {
        res.status(503).json({
          error:
            "Cannot reach Supabase Auth. Check your network, VPN, or firewall, or set SUPABASE_JWT_SECRET in apps/backend/.env for offline token verification."
        });
        return;
      }
      throw error;
    }
  }

  if (req.header("x-user-id")) {
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
      return;
    } catch (error) {
      res.status(400).json({
        error: error instanceof Error ? error.message : "Failed to resolve user context"
      });
      return;
    }
  }

  if (path === "/api/v1/auth/me" || path.startsWith("/api/v1/")) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  next();
}
