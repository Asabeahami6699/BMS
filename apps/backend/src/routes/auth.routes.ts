import { Router } from "express";
import { applyApprovalWorkflowToSusuNav, setTransactionPinSchema, verifyTransactionPinSchema, tenantSignInHost, type ApprovalWorkflow } from "@bms/shared";
import { loginRateLimit } from "../middleware/rateLimit.js";
import { validateBody } from "../middleware/validateBody.js";
import {
  changeOwnPassword,
  loginWithCredentials,
  logoutAccessToken,
  resolveUserFromAccessToken
} from "../services/authService.js";
import { findTenantBySubdomain } from "../services/tenantHostService.js";
import { extendSession } from "../services/authStore.js";
import { getSupabaseAuthClient } from "../config/supabaseClient.js";
import { getApprovalWorkflow } from "../services/approvalWorkflowService.js";
import { resolveEffectiveSusuNavVisibility } from "../services/susuNavVisibilityService.js";
import {
  getTransactionPinStatus,
  setTransactionPin,
  TransactionPinError,
  verifyTransactionPin
} from "../services/transactionPinService.js";

export const authRouter = Router();

authRouter.get("/company-host", async (req, res) => {
  const subdomain = typeof req.query.subdomain === "string" ? req.query.subdomain : "";
  try {
    const tenant = await findTenantBySubdomain(subdomain);
    if (!tenant) {
      res.status(404).json({ error: "This company address is not set up yet." });
      return;
    }
    res.json({
      name: tenant.name,
      subdomain: tenant.subdomain,
      signInHost: tenantSignInHost(tenant.subdomain),
      logoUrl: tenant.logoUrl,
      brandColor: tenant.brandColor
    });
  } catch (error) {
    res.status(400).json({
      error: error instanceof Error ? error.message : "Failed to look up company address"
    });
  }
});

function parseBase64DataImage(dataUrl: string): { mime: string; buffer: Buffer } | null {
  const match = /^data:(image\/(?:png|jpeg|jpg|webp|gif));base64,([A-Za-z0-9+/=\s]+)$/i.exec(dataUrl.trim());
  if (!match) {
    return null;
  }
  const mime = match[1]!.toLowerCase() === "image/jpg" ? "image/jpeg" : match[1]!.toLowerCase();
  const buffer = Buffer.from(match[2]!.replace(/\s+/g, ""), "base64");
  return buffer.length > 0 ? { mime, buffer } : null;
}

authRouter.get("/company-icon", async (req, res) => {
  const subdomain = typeof req.query.subdomain === "string" ? req.query.subdomain : "";
  try {
    const tenant = await findTenantBySubdomain(subdomain);
    if (!tenant?.logoUrl) {
      res.status(404).end();
      return;
    }
    const decoded = parseBase64DataImage(tenant.logoUrl);
    if (!decoded) {
      res.status(404).end();
      return;
    }
    res.setHeader("Content-Type", decoded.mime);
    res.setHeader("Cache-Control", "public, max-age=3600");
    res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
    res.send(decoded.buffer);
  } catch {
    res.status(404).end();
  }
});

authRouter.get("/manifest.webmanifest", async (req, res) => {
  const subdomain = typeof req.query.subdomain === "string" ? req.query.subdomain : "";
  const rawOrigin = typeof req.query.origin === "string" ? req.query.origin.trim() : "";
  const safeOrigin = /^https?:\/\/[a-z0-9.-]+(?::\d+)?$/i.test(rawOrigin)
    ? rawOrigin.replace(/\/+$/, "")
    : "";
  try {
    const tenant = subdomain ? await findTenantBySubdomain(subdomain) : null;
    const appName = tenant?.name?.trim() || "aabanker — Banking Management System";
    const shortName = tenant?.name?.trim()
      ? tenant.name.trim().slice(0, 16)
      : "aabanker";
    const themeColor = tenant?.brandColor || "#0b0e14";
    const startUrl = safeOrigin ? `${safeOrigin}/` : "/";
    const scope = safeOrigin ? `${safeOrigin}/` : "/";

    const icons: Array<{ src: string; sizes: string; type: string; purpose?: string }> = [];
    if (tenant?.logoUrl && parseBase64DataImage(tenant.logoUrl)) {
      const parsed = parseBase64DataImage(tenant.logoUrl)!;
      const proto = (req.headers["x-forwarded-proto"] as string)?.split(",")[0]?.trim() || req.protocol;
      const host = req.get("host");
      const iconUrl = host
        ? `${proto}://${host}/api/v1/auth/company-icon?subdomain=${encodeURIComponent(tenant.subdomain)}`
        : `/api/v1/auth/company-icon?subdomain=${encodeURIComponent(tenant.subdomain)}`;
      icons.push(
        { src: iconUrl, sizes: "192x192", type: parsed.mime, purpose: "any" },
        { src: iconUrl, sizes: "512x512", type: parsed.mime, purpose: "any" }
      );
    } else {
      const iconBase = safeOrigin || "";
      icons.push(
        { src: `${iconBase}/icons/icon-192.png`, sizes: "192x192", type: "image/png", purpose: "any" },
        { src: `${iconBase}/icons/icon-512.png`, sizes: "512x512", type: "image/png", purpose: "any" }
      );
    }

    res.setHeader("Content-Type", "application/manifest+json; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=300");
    res.json({
      id: startUrl,
      name: appName,
      short_name: shortName,
      description: `${appName} — Staff & Operations Portal`,
      start_url: startUrl,
      scope,
      display: "standalone",
      orientation: "any",
      lang: "en",
      dir: "ltr",
      theme_color: themeColor,
      background_color: "#0b0e14",
      categories: ["finance", "business"],
      prefer_related_applications: false,
      icons
    });
  } catch {
    res.status(404).json({ error: "Manifest unavailable" });
  }
});

async function buildAuthMePayload<T extends { userId: string; tenantId: string; role: string }>(
  context: T
) {
  let susuNavVisibility;
  let approvalWorkflow: ApprovalWorkflow | undefined;
  if (context.tenantId && context.tenantId !== "platform") {
    try {
      approvalWorkflow = await getApprovalWorkflow(context.tenantId);
    } catch {
      approvalWorkflow = undefined;
    }
  }
  if (context.tenantId && context.tenantId !== "platform" && context.role !== "field_agent") {
    try {
      const rows = await resolveEffectiveSusuNavVisibility(context.tenantId);
      susuNavVisibility = approvalWorkflow ? applyApprovalWorkflowToSusuNav(rows, approvalWorkflow) : rows;
    } catch {
      susuNavVisibility = undefined;
    }
  }

  return {
    ...context,
    susuNavVisibility,
    approvalWorkflow,
    transactionPin: await getTransactionPinStatus(context.userId, context.tenantId, context.role)
  };
}

authRouter.post("/login", loginRateLimit, async (req, res) => {
  try {
    const result = await loginWithCredentials(req.body);
    const enrichedUser = await buildAuthMePayload(result.user);
    res.json({
      ...result,
      user: enrichedUser
    });
  } catch (error) {
    res.status(401).json({ error: error instanceof Error ? error.message : "Login failed" });
  }
});

authRouter.post("/logout", (req, res) => {
  const authHeader = req.header("authorization");
  if (authHeader?.startsWith("Bearer ")) {
    logoutAccessToken(authHeader.slice("Bearer ".length).trim());
  }
  res.status(204).send();
});

authRouter.get("/me", async (req, res) => {
  if (!req.userContext) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  res.json(await buildAuthMePayload(req.userContext));
});

authRouter.post("/refresh", async (req, res) => {
  const authHeader = req.header("authorization");
  const accessToken = authHeader?.startsWith("Bearer ") ? authHeader.slice("Bearer ".length).trim() : "";
  const refreshToken =
    typeof req.body?.refreshToken === "string" ? req.body.refreshToken.trim() : "";

  if (accessToken.startsWith("sess_")) {
    if (!extendSession(accessToken)) {
      res.status(401).json({ error: "Session expired" });
      return;
    }
    res.json({ ok: true, accessToken });
    return;
  }

  const authClient = getSupabaseAuthClient();
  if (refreshToken && authClient) {
    const { data, error } = await authClient.auth.refreshSession({ refresh_token: refreshToken });
    if (error || !data.session?.access_token) {
      res.status(401).json({ error: "Session expired" });
      return;
    }

    const user = await resolveUserFromAccessToken(data.session.access_token);
    if (!user) {
      res.status(401).json({ error: "Session expired" });
      return;
    }

    res.json({
      ok: true,
      accessToken: data.session.access_token,
      refreshToken: data.session.refresh_token,
      user
    });
    return;
  }

  if (accessToken && req.userContext) {
    res.json({ ok: true, accessToken });
    return;
  }

  res.status(401).json({ error: "Session expired" });
});

authRouter.post("/change-password", async (req, res) => {
  const context = req.userContext;
  if (!context?.tenantId || context.tenantId === "platform") {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    await changeOwnPassword(context, req.body);
    res.json({ ok: true });
  } catch (error) {
    res.status(400).json({
      error: error instanceof Error ? error.message : "Failed to change password"
    });
  }
});

authRouter.get("/transaction-pin/status", async (req, res) => {
  const context = req.userContext;
  if (!context?.tenantId || context.tenantId === "platform") {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  try {
    const status = await getTransactionPinStatus(context.userId, context.tenantId, context.role);
    res.json(status);
  } catch (error) {
    res.status(400).json({
      error: error instanceof Error ? error.message : "Failed to load transaction PIN status"
    });
  }
});

authRouter.post(
  "/transaction-pin/setup",
  validateBody(setTransactionPinSchema),
  async (req, res) => {
    const context = req.userContext;
    if (!context?.tenantId || context.tenantId === "platform") {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    try {
      await setTransactionPin(context.userId, context.tenantId, context.role, req.body.pin);
      res.json({ ok: true });
    } catch (error) {
      res.status(400).json({
        error: error instanceof Error ? error.message : "Failed to set transaction PIN"
      });
    }
  }
);

authRouter.post(
  "/transaction-pin/verify",
  validateBody(verifyTransactionPinSchema),
  async (req, res) => {
    const context = req.userContext;
    if (!context?.tenantId || context.tenantId === "platform") {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    try {
      const result = await verifyTransactionPin(
        context.userId,
        context.tenantId,
        context.role,
        req.body.pin
      );
      res.json(result);
    } catch (error) {
      if (error instanceof TransactionPinError) {
        res.status(400).json({ error: error.message, code: error.code });
        return;
      }
      res.status(400).json({
        error: error instanceof Error ? error.message : "Transaction PIN verification failed"
      });
    }
  }
);
