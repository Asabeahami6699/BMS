import { createHash, randomUUID } from "node:crypto";
import type { Request } from "express";
import { resolveAuditActivity } from "@bms/shared";
import { getSupabaseAdminClient } from "../config/supabaseClient.js";
import type { RequestAuditContext } from "../types/express.d.js";
import { notifyTenantStaff } from "./notificationService.js";

export type AuditSnapshot = Record<string, unknown>;

export type AuditLogInput = {
  tenantId: string;
  actorUserId?: string;
  actorRole?: string;
  method: string;
  path: string;
  action?: string;
  statusCode: number;
  branchId?: string;
  ipAddress?: string;
  entityType?: string;
  entityId?: string;
  beforeSnapshot?: AuditSnapshot | null;
  afterSnapshot?: AuditSnapshot | null;
  metadata?: AuditSnapshot | null;
};

export type AuditLogRecord = {
  id: string;
  tenantId: string;
  actorUserId?: string;
  actorRole?: string;
  method: string;
  path: string;
  action: string;
  statusCode: number;
  branchId?: string;
  ipAddress?: string;
  createdAt: string;
  entityType?: string;
  entityId?: string;
  beforeSnapshot?: AuditSnapshot | null;
  afterSnapshot?: AuditSnapshot | null;
  changedFields?: string[];
  metadata?: AuditSnapshot | null;
  seqNo?: number;
  prevHash?: string;
  entryHash?: string;
};

export type AuditChainVerification = {
  valid: boolean;
  checkedCount: number;
  legacyUnchainedCount: number;
  latestSeqNo: number | null;
  latestHash: string | null;
  brokenSeqNo?: number | null;
  brokenId?: string | null;
  reason?: string;
  migrationPending?: boolean;
  verifiedAt: string;
};

const auditStore = new Map<string, AuditLogRecord[]>();

const BELL_ACTIVITY_PREFIXES = [
  "/api/v1/customers",
  "/api/v1/users",
  "/api/v1/transactions/branch-float",
  "/api/v1/admin/roles",
  "/api/v1/branches"
];

const SENSITIVE_KEY_PATTERN =
  /password|passwd|pinhash|pin_hash|transaction_pin|(^|_)pin$|token|secret|apikey|api_key|authorization|private_key/i;

function sanitizeValue(value: unknown, depth = 0): unknown {
  if (value === undefined) {
    return undefined;
  }
  if (value === null || typeof value === "boolean" || typeof value === "number") {
    return typeof value === "number" && !Number.isFinite(value) ? null : value;
  }
  if (typeof value === "string") {
    if (value.startsWith("data:image/")) {
      return "[image data omitted]";
    }
    if (value.length > 500) {
      return `${value.slice(0, 500)}… [truncated]`;
    }
    return value;
  }
  if (depth >= 4) {
    return "[nested]";
  }
  if (Array.isArray(value)) {
    return value
      .slice(0, 50)
      .map((item) => sanitizeValue(item, depth + 1))
      .filter((item) => item !== undefined);
  }
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
      if (raw === undefined) {
        continue;
      }
      if (SENSITIVE_KEY_PATTERN.test(key)) {
        out[key] = "[REDACTED]";
        continue;
      }
      const cleaned = sanitizeValue(raw, depth + 1);
      if (cleaned !== undefined) {
        out[key] = cleaned;
      }
    }
    return out;
  }
  return String(value);
}

export function sanitizeAuditSnapshot(
  snapshot: Record<string, unknown> | null | undefined
): AuditSnapshot | null {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    return null;
  }
  const cleaned = sanitizeValue(snapshot, 0);
  if (!cleaned || typeof cleaned !== "object" || Array.isArray(cleaned)) {
    return null;
  }
  return Object.keys(cleaned as Record<string, unknown>).length > 0
    ? (cleaned as AuditSnapshot)
    : null;
}

function stableJson(value: unknown): string {
  if (value === null || value === undefined) {
    return "null";
  }
  if (typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => stableJson(v)).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`).join(",")}}`;
}

export function computeChangedFields(
  before: AuditSnapshot | null,
  after: AuditSnapshot | null
): string[] | undefined {
  if (!before && !after) {
    return undefined;
  }
  const keys = new Set<string>([
    ...Object.keys(before ?? {}),
    ...Object.keys(after ?? {})
  ]);
  const changed: string[] = [];
  for (const key of [...keys].sort()) {
    const prev = before ? before[key] : undefined;
    const next = after ? after[key] : undefined;
    if (stableJson(prev) !== stableJson(next)) {
      changed.push(key);
    }
  }
  return changed.length > 0 ? changed : undefined;
}

function computeMemoryEntryHash(record: Omit<AuditLogRecord, "id" | "entryHash">): string {
  const payload = [
    record.tenantId ?? "",
    record.seqNo != null ? String(record.seqNo) : "",
    record.createdAt ?? "",
    record.actorUserId ?? "",
    record.actorRole ?? "",
    record.method ?? "",
    record.path ?? "",
    record.action ?? "",
    String(record.statusCode),
    record.branchId ?? "",
    record.ipAddress ?? "",
    record.entityType ?? "",
    record.entityId ?? "",
    record.beforeSnapshot ? stableJson(record.beforeSnapshot) : "",
    record.afterSnapshot ? stableJson(record.afterSnapshot) : "",
    (record.changedFields ?? []).join(","),
    record.metadata ? stableJson(record.metadata) : "",
    record.prevHash ?? ""
  ].join("|");
  return createHash("sha256").update(payload).digest("hex");
}

/**
 * Attach structured domain before/after snapshot metadata to the active Express request
 * so the auditLog middleware seals a single enriched immutable audit entry on response finish.
 */
export function setRequestAuditContext(req: Request, patch: RequestAuditContext): void {
  const current = req.auditContext ?? {};
  req.auditContext = {
    ...current,
    ...patch,
    metadata:
      patch.metadata !== undefined
        ? { ...(current.metadata ?? {}), ...(patch.metadata ?? {}) }
        : current.metadata
  };
}

function shouldNotifyBell(input: AuditLogInput, action: string): boolean {
  if (input.statusCode >= 400 || !action) {
    return false;
  }
  return BELL_ACTIVITY_PREFIXES.some((prefix) => input.path.startsWith(prefix));
}

export function shouldWriteAuditLog(method: string, path: string): boolean {
  return !resolveAuditActivity(method, path, 200).skip;
}

function isMissingAuditV2ColumnError(message: string): boolean {
  return /entity_type|entity_id|before_snapshot|after_snapshot|changed_fields|metadata|seq_no|prev_hash|entry_hash/i.test(
    message
  );
}

export async function writeAuditLog(input: AuditLogInput): Promise<void> {
  const resolved = resolveAuditActivity(input.method, input.path, input.statusCode);
  const explicitAction = input.action?.trim();
  if (resolved.skip && !explicitAction && !input.entityType) {
    return;
  }
  const action = explicitAction || resolved.action;
  const beforeSnapshot = sanitizeAuditSnapshot(input.beforeSnapshot);
  const afterSnapshot = sanitizeAuditSnapshot(input.afterSnapshot);
  const metadata = sanitizeAuditSnapshot(input.metadata);
  const changedFields = computeChangedFields(beforeSnapshot, afterSnapshot);

  const supabase = getSupabaseAdminClient();
  if (supabase) {
    const enrichedRow = {
      tenant_id: input.tenantId,
      actor_user_id: input.actorUserId ?? null,
      actor_role: input.actorRole ?? null,
      method: input.method,
      path: input.path,
      action,
      status_code: input.statusCode,
      branch_id: input.branchId ?? null,
      ip_address: input.ipAddress ?? null,
      entity_type: input.entityType ?? null,
      entity_id: input.entityId ?? null,
      before_snapshot: beforeSnapshot,
      after_snapshot: afterSnapshot,
      changed_fields: changedFields ?? null,
      metadata
    };

    let { error } = await supabase.from("audit_logs").insert(enrichedRow);
    if (error && isMissingAuditV2ColumnError(error.message)) {
      const legacyRow = {
        tenant_id: input.tenantId,
        actor_user_id: input.actorUserId ?? null,
        actor_role: input.actorRole ?? null,
        method: input.method,
        path: input.path,
        action,
        status_code: input.statusCode,
        branch_id: input.branchId ?? null,
        ip_address: input.ipAddress ?? null
      };
      const retry = await supabase.from("audit_logs").insert(legacyRow);
      error = retry.error;
    }

    if (error) {
      throw new Error(`Failed to write audit log: ${error.message}`);
    }
  } else {
    const existing = auditStore.get(input.tenantId) ?? [];
    const last = existing[existing.length - 1];
    const seqNo = (last?.seqNo ?? 0) + 1;
    const prevHash = last?.entryHash ?? "GENESIS";
    const createdAt = new Date().toISOString();
    const baseRecord: Omit<AuditLogRecord, "id" | "entryHash"> = {
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      actorRole: input.actorRole,
      method: input.method,
      path: input.path,
      action,
      statusCode: input.statusCode,
      branchId: input.branchId,
      ipAddress: input.ipAddress,
      createdAt,
      entityType: input.entityType,
      entityId: input.entityId,
      beforeSnapshot,
      afterSnapshot,
      changedFields,
      metadata,
      seqNo,
      prevHash
    };
    const next: AuditLogRecord = {
      ...baseRecord,
      id: randomUUID(),
      entryHash: computeMemoryEntryHash(baseRecord)
    };
    auditStore.set(input.tenantId, [...existing, next]);
  }

  if (shouldNotifyBell(input, action)) {
    try {
      await notifyTenantStaff({
        tenantId: input.tenantId,
        roles: ["admin", "auditor"],
        kind: "workspace_activity",
        title: action,
        body: `Completed successfully${input.actorRole ? ` · ${input.actorRole}` : ""}`
      });
    } catch {
      // Non-blocking
    }
  }
}

export async function listAuditLogs(
  tenantId: string,
  options?: { limit?: number; offset?: number; entityType?: string; entityId?: string }
): Promise<AuditLogRecord[]> {
  const limit = Math.min(Math.max(options?.limit ?? 100, 1), 500);
  const offset = Math.max(options?.offset ?? 0, 0);

  const supabase = getSupabaseAdminClient();
  if (supabase) {
    let query = supabase
      .from("audit_logs")
      .select(
        "id, tenant_id, actor_user_id, actor_role, method, path, action, status_code, branch_id, ip_address, created_at, entity_type, entity_id, before_snapshot, after_snapshot, changed_fields, metadata, seq_no, prev_hash, entry_hash"
      )
      .eq("tenant_id", tenantId);

    if (options?.entityType) {
      query = query.eq("entity_type", options.entityType);
    }
    if (options?.entityId) {
      query = query.eq("entity_id", options.entityId);
    }

    let { data, error } = await query
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (error && isMissingAuditV2ColumnError(error.message)) {
      const legacyRes = await supabase
        .from("audit_logs")
        .select(
          "id, tenant_id, actor_user_id, actor_role, method, path, action, status_code, branch_id, ip_address, created_at"
        )
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: false })
        .range(offset, offset + limit - 1);
      data = legacyRes.data as typeof data;
      error = legacyRes.error;
    }

    if (error) {
      throw new Error(`Failed to list audit logs: ${error.message}`);
    }

    return (data ?? []).map((row) => {
      const r = row as Record<string, unknown>;
      const method = String(r.method ?? "");
      const path = String(r.path ?? "");
      const statusCode = Number(r.status_code ?? 200);
      const storedAction = typeof r.action === "string" ? r.action.trim() : "";
      const resolved = resolveAuditActivity(method, path, statusCode).action;
      const action =
        (r.entity_type && storedAction ? storedAction : null) ||
        resolved?.trim() ||
        storedAction ||
        `${method} ${path}`;

      return {
        id: String(r.id),
        tenantId: String(r.tenant_id),
        actorUserId: r.actor_user_id != null ? String(r.actor_user_id) : undefined,
        actorRole: r.actor_role != null ? String(r.actor_role) : undefined,
        method,
        path,
        action,
        statusCode,
        branchId: r.branch_id != null ? String(r.branch_id) : undefined,
        ipAddress: r.ip_address != null ? String(r.ip_address) : undefined,
        createdAt: String(r.created_at),
        entityType: r.entity_type != null ? String(r.entity_type) : undefined,
        entityId: r.entity_id != null ? String(r.entity_id) : undefined,
        beforeSnapshot:
          r.before_snapshot && typeof r.before_snapshot === "object"
            ? (r.before_snapshot as AuditSnapshot)
            : null,
        afterSnapshot:
          r.after_snapshot && typeof r.after_snapshot === "object"
            ? (r.after_snapshot as AuditSnapshot)
            : null,
        changedFields: Array.isArray(r.changed_fields)
          ? r.changed_fields.filter((f): f is string => typeof f === "string")
          : undefined,
        metadata:
          r.metadata && typeof r.metadata === "object"
            ? (r.metadata as AuditSnapshot)
            : null,
        seqNo: r.seq_no != null ? Number(r.seq_no) : undefined,
        prevHash: r.prev_hash != null ? String(r.prev_hash) : undefined,
        entryHash: r.entry_hash != null ? String(r.entry_hash) : undefined
      };
    });
  }

  let rows = auditStore.get(tenantId) ?? [];
  if (options?.entityType) {
    rows = rows.filter((r) => r.entityType === options.entityType);
  }
  if (options?.entityId) {
    rows = rows.filter((r) => r.entityId === options.entityId);
  }
  return [...rows]
    .reverse()
    .slice(offset, offset + limit)
    .map((row) => {
      const resolved = resolveAuditActivity(row.method, row.path, row.statusCode).action;
      return {
        ...row,
        action: (row.entityType && row.action ? row.action : null) || resolved?.trim() || row.action
      };
    });
}

export async function verifyAuditLogChain(tenantId: string): Promise<AuditChainVerification> {
  const verifiedAt = new Date().toISOString();
  const supabase = getSupabaseAdminClient();
  if (supabase) {
    const { data, error } = await supabase.rpc("verify_audit_log_chain", {
      p_tenant_id: tenantId
    });
    if (error) {
      if (/verify_audit_log_chain|could not find the function|schema cache/i.test(error.message)) {
        return {
          valid: true,
          checkedCount: 0,
          legacyUnchainedCount: 0,
          latestSeqNo: null,
          latestHash: null,
          migrationPending: true,
          reason:
            "Apply migration 106_immutable_audit_trail.sql in Supabase to enable DB-level immutability and SHA-256 hash-chain verification.",
          verifiedAt
        };
      }
      throw new Error(`Failed to verify audit log chain: ${error.message}`);
    }
    const payload = (data ?? {}) as Partial<AuditChainVerification>;
    return {
      valid: Boolean(payload.valid),
      checkedCount: Number(payload.checkedCount ?? 0),
      legacyUnchainedCount: Number(payload.legacyUnchainedCount ?? 0),
      latestSeqNo: payload.latestSeqNo != null ? Number(payload.latestSeqNo) : null,
      latestHash: typeof payload.latestHash === "string" ? payload.latestHash : null,
      brokenSeqNo: payload.brokenSeqNo != null ? Number(payload.brokenSeqNo) : undefined,
      brokenId: typeof payload.brokenId === "string" ? payload.brokenId : undefined,
      reason: typeof payload.reason === "string" ? payload.reason : undefined,
      verifiedAt: typeof payload.verifiedAt === "string" ? payload.verifiedAt : verifiedAt
    };
  }

  const rows = auditStore.get(tenantId) ?? [];
  const legacyUnchainedCount = rows.filter((r) => r.seqNo == null).length;
  const sealed = rows
    .filter((r) => r.seqNo != null)
    .sort((a, b) => (a.seqNo ?? 0) - (b.seqNo ?? 0));

  let expectedSeq = 1;
  let expectedPrev = "GENESIS";
  let checkedCount = 0;
  let latestSeqNo: number | null = null;
  let latestHash: string | null = null;

  for (const rec of sealed) {
    if (rec.seqNo !== expectedSeq) {
      return {
        valid: false,
        checkedCount,
        legacyUnchainedCount,
        latestSeqNo,
        latestHash,
        brokenSeqNo: rec.seqNo ?? null,
        brokenId: rec.id,
        reason: `Sequence gap detected: expected #${expectedSeq} but found #${rec.seqNo}`,
        verifiedAt
      };
    }
    if ((rec.prevHash ?? "") !== expectedPrev) {
      return {
        valid: false,
        checkedCount,
        legacyUnchainedCount,
        latestSeqNo,
        latestHash,
        brokenSeqNo: rec.seqNo ?? null,
        brokenId: rec.id,
        reason: `Hash chain link mismatch at sequence #${rec.seqNo}`,
        verifiedAt
      };
    }
    const { id: _id, entryHash: storedHash, ...rest } = rec;
    void _id;
    const expectedHash = computeMemoryEntryHash(rest);
    if ((storedHash ?? "") !== expectedHash) {
      return {
        valid: false,
        checkedCount,
        legacyUnchainedCount,
        latestSeqNo,
        latestHash,
        brokenSeqNo: rec.seqNo ?? null,
        brokenId: rec.id,
        reason: `Entry digest mismatch (tampering detected) at sequence #${rec.seqNo}`,
        verifiedAt
      };
    }
    checkedCount += 1;
    latestSeqNo = rec.seqNo ?? null;
    latestHash = storedHash ?? null;
    expectedPrev = storedHash ?? "";
    expectedSeq += 1;
  }

  return {
    valid: true,
    checkedCount,
    legacyUnchainedCount,
    latestSeqNo,
    latestHash,
    verifiedAt
  };
}

/** Test-only helper to simulate direct storage tampering and verify chain detection catches it. */
export function _unsafeTamperMemoryAuditLogForTest(
  tenantId: string,
  index: number,
  mutator: (record: AuditLogRecord) => void
): void {
  const rows = auditStore.get(tenantId);
  if (rows && rows[index]) {
    mutator(rows[index]!);
  }
}
