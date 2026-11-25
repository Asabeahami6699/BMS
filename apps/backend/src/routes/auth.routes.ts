import { Router, type Response } from "express";
import { applyApprovalWorkflowToSusuNav, setTransactionPinSchema, verifyTransactionPinSchema, tenantSignInHost, type ApprovalWorkflow } from "@bms/shared";
import { loginRateLimit } from "../middleware/rateLimit.js";
import { validateBody } from "../middleware/validateBody.js";
import {
  changeOwnPassword,
  loginWithCredentials,
  logoutAccessToken,
  resolveUserFromAccessToken
} from "../services/authService.js";
import { findTenantBySubdomain, findTenantForBranding } from "../services/tenantHostService.js";
import {
  computeTenantBrandVersion,
  parsePwaIconPurpose,
  parsePwaIconSize,
  renderTenantPwaPng
} from "../services/pwaIconService.js";
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
    res.setHeader("Cache-Control", "public, max-age=60, stale-while-revalidate=300");
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

function deriveManifestShortName(name: string): string {
  const clean = name.trim().replace(/\s+/g, " ");
  if (clean.length <= 15) return clean;
  const words = clean.split(" ");
  let out = "";
  for (const word of words) {
    const next = out ? `${out} ${word}` : word;
    if (next.length > 15) break;
    out = next;
  }
  return out || clean.slice(0, 15).trim();
}

function setPublicPwaCorsHeaders(res: Response): void {
  // Public unauthenticated PWA assets must not pair Allow-Origin: * with Allow-Credentials: true.
  res.removeHeader("Access-Control-Allow-Credentials");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
}

authRouter.get("/company-icon", async (req, res) => {
  const subdomain = typeof req.query.subdomain === "string" ? req.query.subdomain : "";
  const tenantId = typeof req.query.tenantId === "string" ? req.query.tenantId : "";
  const size = parsePwaIconSize(req.query.size);
  const purpose = parsePwaIconPurpose(req.query.purpose);
  try {
    const tenant = await findTenantForBranding({ subdomain, tenantId });
    if (!tenant) {
      res.status(404).end();
      return;
    }
    const png = await renderTenantPwaPng(tenant, { size, purpose });
    setPublicPwaCorsHeaders(res);
    res.setHeader("Content-Type", "image/png");
    res.setHeader(
      "Cache-Control",
      typeof req.query.v === "string" && req.query.v.trim()
        ? "public, max-age=86400, immutable"
        : "public, max-age=300"
    );
    res.send(png);
  } catch {
    res.status(404).end();
  }
});

authRouter.get("/manifest.webmanifest", async (req, res) => {
  const subdomain = typeof req.query.subdomain === "string" ? req.query.subdomain : "";
  const tenantId = typeof req.query.tenantId === "string" ? req.query.tenantId : "";
  const rawOrigin = typeof req.query.origin === "string" ? req.query.origin.trim() : "";
  const safeOrigin = /^https?:\/\/[a-z0-9.-]+(?::\d+)?$/i.test(rawOrigin)
    ? rawOrigin.replace(/\/+$/, "")
    : "";
  try {
    const tenant =
      subdomain || tenantId
        ? await findTenantForBranding({ subdomain, tenantId })
        : null;
    const appName = tenant?.name?.trim() || "aabanker — Banking Management System";
    const shortName = tenant?.name?.trim()
      ? deriveManifestShortName(tenant.name)
      : "aabanker";
    // Keep neutral dark title-bar color instead of painting the window top bar in the company brand color.
    const themeColor = "#0b0e14";
    const startUrl = safeOrigin ? `${safeOrigin}/` : "/";
    const scope = safeOrigin ? `${safeOrigin}/` : "/";
    const manifestId =
      tenant && safeOrigin
        ? `${safeOrigin}/?app=${encodeURIComponent(tenant.subdomain || tenant.id)}`
        : startUrl;

    const icons: Array<{ src: string; sizes: string; type: string; purpose?: string }> = [];
    const iconBase = safeOrigin || "";
    let shortcutIcon = `${iconBase}/icons/icon-192.png`;

    if (tenant) {
      const preferSameOrigin = req.query.sameOrigin === "1" && Boolean(safeOrigin);
      const proto =
        (req.headers["x-forwarded-proto"] as string)?.split(",")[0]?.trim() || req.protocol;
      const host = req.get("host");
      const base = preferSameOrigin
        ? `${safeOrigin}/pwa/company-icon`
        : host
          ? `${proto}://${host}/api/v1/auth/company-icon`
          : "/api/v1/auth/company-icon";
      const idQuery = tenant.subdomain
        ? `subdomain=${encodeURIComponent(tenant.subdomain)}`
        : `tenantId=${encodeURIComponent(tenant.id)}`;
      const v = computeTenantBrandVersion(tenant);
      const iconUrl = (size: number, purpose: "any" | "maskable" = "any") =>
        `${base}?${idQuery}&size=${size}&purpose=${purpose}&v=${v}`;
      shortcutIcon = iconUrl(192, "any");
      icons.push(
        { src: iconUrl(48, "any"), sizes: "48x48", type: "image/png", purpose: "any" },
        { src: iconUrl(96, "any"), sizes: "96x96", type: "image/png", purpose: "any" },
        { src: iconUrl(144, "any"), sizes: "144x144", type: "image/png", purpose: "any" },
        { src: iconUrl(192, "any"), sizes: "192x192", type: "image/png", purpose: "any" },
        { src: iconUrl(256, "any"), sizes: "256x256", type: "image/png", purpose: "any" },
        { src: iconUrl(512, "any"), sizes: "512x512", type: "image/png", purpose: "any" },
        { src: iconUrl(512, "maskable"), sizes: "512x512", type: "image/png", purpose: "maskable" }
      );
    } else {
      icons.push(
        { src: `${iconBase}/icons/icon-192.png`, sizes: "192x192", type: "image/png", purpose: "any" },
        { src: `${iconBase}/icons/icon-512.png`, sizes: "512x512", type: "image/png", purpose: "any" },
        { src: `${iconBase}/icons/icon-512.png`, sizes: "512x512", type: "image/png", purpose: "maskable" }
      );
    }

    setPublicPwaCorsHeaders(res);
    res.setHeader("Content-Type", "application/manifest+json; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=60");
    res.json({
      id: manifestId,
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
      icons,
      shortcuts: [
        {
          name: "Dashboard",
          short_name: "Dashboard",
          description: `Open ${appName} dashboard`,
          url: `${iconBase}/app/dashboard`,
          icons: [{ src: shortcutIcon, sizes: "192x192", type: "image/png" }]
        },
        {
          name: "Field agent",
          short_name: "Agent",
          description: `Open ${appName} field agent workspace`,
          url: `${iconBase}/app/agent/home`,
          icons: [{ src: shortcutIcon, sizes: "192x192", type: "image/png" }]
        }
      ]
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
