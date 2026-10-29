import type { NextFunction, Request, Response } from "express";
import { getSupabaseAdminClient } from "../config/supabaseClient.js";

type DoneEntry = {
  status: "done";
  statusCode: number;
  body: unknown;
  expiresAt: number;
};

type PendingEntry = {
  status: "pending";
  expiresAt: number;
  promise: Promise<DoneEntry | null>;
  resolve: (entry: DoneEntry | null) => void;
};

type StoreEntry = DoneEntry | PendingEntry;

const responseStore = new Map<string, StoreEntry>();
const SUCCESS_TTL_MS = 1000 * 60 * 15;
const FAILURE_TTL_MS = 1000 * 10;

type IdempotencyClaim =
  | { owned: false; statusCode: number; body: unknown }
  | {
      owned: true;
      finish: (statusCode: number, body: unknown) => Promise<void>;
      abort: () => void;
    };

function storageKey(tenantId: string, idempotencyKey: string): string {
  return `${tenantId}:${idempotencyKey}`;
}

function isMissingTable(error: { code?: string; message?: string }): boolean {
  return error.code === "42P01" || (error.message ?? "").includes("api_idempotency_keys");
}

async function readStoredSuccess(
  tenantId: string,
  idempotencyKey: string
): Promise<{ statusCode: number; body: unknown } | null> {
  const supabase = getSupabaseAdminClient();
  if (!supabase) {
    return null;
  }
  const { data, error } = await supabase
    .from("api_idempotency_keys")
    .select("status_code, response")
    .eq("tenant_id", tenantId)
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();
  if (error) {
    if (!isMissingTable(error)) {
      console.warn("[idempotency] lookup skipped:", error.message);
    }
    return null;
  }
  if (!data || Number(data.status_code) < 200 || Number(data.status_code) >= 300) {
    return null;
  }
  return { statusCode: Number(data.status_code), body: data.response };
}

async function persistSuccess(
  tenantId: string,
  idempotencyKey: string,
  statusCode: number,
  body: unknown
): Promise<void> {
  const supabase = getSupabaseAdminClient();
  if (!supabase) {
    return;
  }
  const { error } = await supabase.from("api_idempotency_keys").upsert(
    {
      tenant_id: tenantId,
      idempotency_key: idempotencyKey,
      status_code: statusCode,
      response: body ?? {}
    },
    { onConflict: "tenant_id,idempotency_key" }
  );
  if (error && !isMissingTable(error)) {
    console.warn("[idempotency] save skipped:", error.message);
  }
}

function rememberDone(
  key: string,
  statusCode: number,
  body: unknown,
  ttlMs: number
): DoneEntry {
  const done: DoneEntry = {
    status: "done",
    statusCode,
    body,
    expiresAt: Date.now() + ttlMs
  };
  responseStore.set(key, done);
  return done;
}

/**
 * One idempotency key runs the work once. A repeat waits for that result
 * instead of posting the money again.
 */
export async function beginIdempotency(
  tenantId: string,
  idempotencyKey: string
): Promise<IdempotencyClaim> {
  const key = storageKey(tenantId, idempotencyKey);
  const now = Date.now();
  const current = responseStore.get(key);

  if (current?.status === "done" && current.expiresAt > now) {
    return { owned: false, statusCode: current.statusCode, body: current.body };
  }

  if (current?.status === "pending") {
    const done = await current.promise;
    if (done && done.expiresAt > Date.now()) {
      return { owned: false, statusCode: done.statusCode, body: done.body };
    }
    return beginIdempotency(tenantId, idempotencyKey);
  }

  let resolve!: (entry: DoneEntry | null) => void;
  const promise = new Promise<DoneEntry | null>((resolvePromise) => {
    resolve = resolvePromise;
  });
  const pending: PendingEntry = {
    status: "pending",
    expiresAt: now + 120_000,
    promise,
    resolve
  };
  responseStore.set(key, pending);

  const stored = await readStoredSuccess(tenantId, idempotencyKey);
  if (stored) {
    const done = rememberDone(key, stored.statusCode, stored.body, SUCCESS_TTL_MS);
    resolve(done);
    return { owned: false, statusCode: done.statusCode, body: done.body };
  }

  let settled = false;
  const settle = (entry: DoneEntry | null) => {
    if (settled) {
      return;
    }
    settled = true;
    resolve(entry);
  };

  return {
    owned: true,
    finish: async (statusCode: number, body: unknown) => {
      const success = statusCode >= 200 && statusCode < 300;
      if (success) {
        await persistSuccess(tenantId, idempotencyKey, statusCode, body);
      }
      const done = rememberDone(key, statusCode, body, success ? SUCCESS_TTL_MS : FAILURE_TTL_MS);
      settle(done);
    },
    abort: () => {
      if (responseStore.get(key)?.status === "pending") {
        responseStore.delete(key);
      }
      settle(null);
    }
  };
}

export function requireIdempotencyKey(req: Request, res: Response, next: NextFunction): void {
  const idempotencyKey = req.header("Idempotency-Key")?.trim();
  if (!idempotencyKey) {
    res.status(400).json({ error: "Missing Idempotency-Key header" });
    return;
  }

  const tenantId = req.userContext?.tenantId ?? req.header("x-tenant-id") ?? "unknown";
  const scopedKey = `${req.method}:${req.path}:${idempotencyKey}`;

  void beginIdempotency(tenantId, scopedKey)
    .then((claim) => {
      if (!claim.owned) {
        res.status(claim.statusCode).json(claim.body);
        return;
      }

      const originalJson = res.json.bind(res);
      let completed = false;
      res.json = ((body: unknown) => {
        if (!completed) {
          completed = true;
          const statusCode = res.statusCode || 200;
          void claim.finish(statusCode, body).finally(() => {
            originalJson(body);
          });
          return res;
        }
        return originalJson(body);
      }) as typeof res.json;

      res.on("finish", () => {
        if (!completed) {
          claim.abort();
        }
      });

      next();
    })
    .catch((error) => {
      next(error);
    });
}
