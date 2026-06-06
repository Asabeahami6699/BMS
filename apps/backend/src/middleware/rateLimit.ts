import rateLimit from "express-rate-limit";
import type { Request } from "express";

function clientKey(req: Request): string {
  const ip = req.ip ?? "unknown-ip";
  const tenant = req.userContext?.tenantId ?? req.header("x-tenant-id") ?? "unknown-tenant";
  return `${tenant}:${ip}`;
}

export const globalRateLimit = rateLimit({
  windowMs: 60_000,
  limit: 300,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  keyGenerator: clientKey,
  message: { error: "Too many requests. Try again shortly." }
});

export const moneyMutationRateLimit = rateLimit({
  windowMs: 60_000,
  limit: 60,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  keyGenerator: clientKey,
  message: { error: "Too many money operations. Slow down." }
});

export const adminMutationRateLimit = rateLimit({
  windowMs: 60_000,
  limit: 30,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  keyGenerator: clientKey,
  message: { error: "Too many admin actions. Try again later." }
});

export const aiRateLimit = rateLimit({
  windowMs: 60_000,
  limit: 20,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  keyGenerator: clientKey,
  message: { error: "Too many AI requests. Try again shortly." }
});
