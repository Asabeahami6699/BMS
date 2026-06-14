import { Router } from "express";
import { setTransactionPinSchema, verifyTransactionPinSchema } from "@bms/shared";
import { validateBody } from "../middleware/validateBody.js";
import { changeOwnPassword, loginWithCredentials, logoutAccessToken } from "../services/authService.js";
import { extendSession } from "../services/authStore.js";
import { resolveEffectiveSusuNavVisibility } from "../services/susuNavVisibilityService.js";
import {
  getTransactionPinStatus,
  setTransactionPin,
  verifyTransactionPin
} from "../services/transactionPinService.js";

export const authRouter = Router();

authRouter.post("/login", async (req, res) => {
  try {
    const result = await loginWithCredentials(req.body);
    res.json(result);
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

  const context = req.userContext;
  let susuNavVisibility;
  if (context.tenantId && context.tenantId !== "platform" && context.role !== "field_agent") {
    try {
      susuNavVisibility = await resolveEffectiveSusuNavVisibility(context.tenantId);
    } catch {
      susuNavVisibility = undefined;
    }
  }

  res.json({
    ...context,
    susuNavVisibility,
    transactionPin: await getTransactionPinStatus(context.userId, context.tenantId, context.role)
  });
});

authRouter.post("/refresh", (req, res) => {
  if (!req.userContext) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const authHeader = req.header("authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice("Bearer ".length).trim() : "";
  if (token.startsWith("sess_") && !extendSession(token)) {
    res.status(401).json({ error: "Session expired" });
    return;
  }

  res.json({ ok: true });
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
      res.status(401).json({
        error: error instanceof Error ? error.message : "Transaction PIN verification failed"
      });
    }
  }
);
