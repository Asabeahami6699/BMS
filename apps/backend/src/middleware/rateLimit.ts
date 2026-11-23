import rateLimit from "express-rate-limit";
import type { Request } from "express";

function clientKey(req: Request): string {
  const ip = req.ip ?? "unknown-ip";
  // Only include tenantId once authenticated — never trust client-supplied x-tenant-id headers.
  const tenant = req.userContext?.tenantId ?? "anon";
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

export const loginRateLimit = rateLimit({
  windowMs: 15 * 60_000,
  limit: 15,
  skipSuccessfulRequests: true,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  keyGenerator: (req: Request) => {
    const ip = req.ip ?? "unknown-ip";
    const email =
      typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase().slice(0, 120) : "";
    return `login:${ip}:${email}`;
  },
  message: { error: "Too many failed sign-in attempts. Please wait a few minutes and try again." }
});

export const publicChatRateLimit = rateLimit({
  windowMs: 60_000,
  limit: 20,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  keyGenerator: (req: Request) => `chat:${req.ip ?? "unknown-ip"}`,
  message: { error: "Too many chat requests. Please wait a moment." }
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
