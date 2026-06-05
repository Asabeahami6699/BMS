import type { NextFunction, Request, Response } from "express";

type StoredResponse = {
  statusCode: number;
  body: unknown;
  expiresAt: number;
};

const responseStore = new Map<string, StoredResponse>();
const TTL_MS = 1000 * 60 * 15;

function makeKey(req: Request, idempotencyKey: string): string {
  const tenant = req.userContext?.tenantId ?? req.header("x-tenant-id") ?? "unknown";
  return `${tenant}:${req.method}:${req.path}:${idempotencyKey}`;
}

function cleanupExpired(): void {
  const now = Date.now();
  for (const [key, value] of responseStore.entries()) {
    if (value.expiresAt <= now) {
      responseStore.delete(key);
    }
  }
}

export function requireIdempotencyKey(req: Request, res: Response, next: NextFunction): void {
  const key = req.header("Idempotency-Key");
  if (!key) {
    res.status(400).json({ error: "Missing Idempotency-Key header" });
    return;
  }

  cleanupExpired();
  const storageKey = makeKey(req, key);
  const existing = responseStore.get(storageKey);
  if (existing) {
    res.status(existing.statusCode).json(existing.body);
    return;
  }

  const originalJson = res.json.bind(res);
  res.json = ((body: unknown) => {
    responseStore.set(storageKey, {
      statusCode: res.statusCode,
      body,
      expiresAt: Date.now() + TTL_MS
    });
    return originalJson(body);
  }) as typeof res.json;

  next();
}
