import { resolveAuditActivity } from "@bms/shared";
import { getSupabaseAdminClient } from "../config/supabaseClient.js";
import { notifyTenantStaff } from "./notificationService.js";

type AuditLogInput = {
  tenantId: string;
  actorUserId?: string;
  actorRole?: string;
  method: string;
  path: string;
  statusCode: number;
  branchId?: string;
  ipAddress?: string;
};

export type AuditLogRecord = AuditLogInput & {
  id: string;
  action: string;
  createdAt: string;
};

const auditStore = new Map<string, AuditLogRecord[]>();

const BELL_ACTIVITY_PREFIXES = [
  "/api/v1/customers",
  "/api/v1/users",
  "/api/v1/transactions/branch-float",
  "/api/v1/admin/roles",
  "/api/v1/branches"
];

function shouldNotifyBell(input: AuditLogInput, action: string): boolean {
  if (input.statusCode >= 400 || !action) {
    return false;
  }
  return BELL_ACTIVITY_PREFIXES.some((prefix) => input.path.startsWith(prefix));
}

export function shouldWriteAuditLog(method: string, path: string): boolean {
  return !resolveAuditActivity(method, path, 200).skip;
}

export async function writeAuditLog(input: AuditLogInput): Promise<void> {
  const { skip, action } = resolveAuditActivity(input.method, input.path, input.statusCode);
  if (skip) {
    return;
  }

  const supabase = getSupabaseAdminClient();
  if (supabase) {
    const { error } = await supabase.from("audit_logs").insert({
      tenant_id: input.tenantId,
      actor_user_id: input.actorUserId ?? null,
      actor_role: input.actorRole ?? null,
      method: input.method,
      path: input.path,
      action,
      status_code: input.statusCode,
      branch_id: input.branchId ?? null,
      ip_address: input.ipAddress ?? null
    });

    if (error) {
      throw new Error(`Failed to write audit log: ${error.message}`);
    }
  } else {
    const existing = auditStore.get(input.tenantId) ?? [];
    const next: AuditLogRecord = {
      ...input,
      action,
      id: `${Date.now()}-${Math.round(Math.random() * 1000)}`,
      createdAt: new Date().toISOString()
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
  options?: { limit?: number; offset?: number }
): Promise<AuditLogRecord[]> {
  const limit = Math.min(Math.max(options?.limit ?? 100, 1), 500);
  const offset = Math.max(options?.offset ?? 0, 0);

  const supabase = getSupabaseAdminClient();
  if (supabase) {
    const { data, error } = await supabase
      .from("audit_logs")
      .select(
        "id, tenant_id, actor_user_id, actor_role, method, path, action, status_code, branch_id, ip_address, created_at"
      )
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      throw new Error(`Failed to list audit logs: ${error.message}`);
    }

    return (data ?? []).map((row) => {
      const method = row.method;
      const path = row.path;
      const statusCode = row.status_code;
      const action =
        row.action?.trim() ||
        resolveAuditActivity(method, path, statusCode).action ||
        `${method} ${path}`;

      return {
        id: String(row.id),
        tenantId: row.tenant_id,
        actorUserId: row.actor_user_id ?? undefined,
        actorRole: row.actor_role ?? undefined,
        method,
        path,
        action,
        statusCode,
        branchId: row.branch_id ?? undefined,
        ipAddress: row.ip_address ?? undefined,
        createdAt: row.created_at
      };
    });
  }

  const rows = auditStore.get(tenantId) ?? [];
  return [...rows].reverse().slice(offset, offset + limit);
}
