import { randomUUID } from "node:crypto";
import type { Role } from "@bms/shared";
import { getSupabaseAdminClient } from "../config/supabaseClient.js";
import { listUsersByTenant } from "./authStore.js";

export type AgentNotificationKind =
  | "registration_approved"
  | "registration_rejected"
  | "registration_pending"
  | "balance_disclosure_approved"
  | "balance_disclosure_rejected"
  | "balance_request_pending"
  | "withdrawal_request_approved"
  | "withdrawal_request_rejected"
  | "withdrawal_request_pending"
  | "withdrawal_momo_sent"
  | "float_requested"
  | "float_allocated"
  | "float_closed_pending_settlement"
  | "workspace_activity"
  | "collection_batch_pending"
  | "collection_batch_posted";

export type AgentNotification = {
  id: string;
  tenantId: string;
  userId: string;
  customerId?: string;
  kind: AgentNotificationKind;
  title: string;
  body: string;
  imageUrl?: string;
  readAt?: string;
  createdAt: string;
};

const memoryNotifications = new Map<string, AgentNotification[]>();

export async function createAgentNotification(input: {
  tenantId: string;
  userId: string;
  customerId?: string;
  kind: AgentNotificationKind;
  title: string;
  body: string;
  imageUrl?: string;
}): Promise<AgentNotification> {
  const record: AgentNotification = {
    id: randomUUID(),
    tenantId: input.tenantId,
    userId: input.userId,
    customerId: input.customerId,
    kind: input.kind,
    title: input.title,
    body: input.body,
    imageUrl: input.imageUrl,
    createdAt: new Date().toISOString()
  };

  const supabase = getSupabaseAdminClient();
  if (supabase) {
    const { error } = await supabase.from("agent_notifications").insert({
      id: record.id,
      tenant_id: input.tenantId,
      user_id: input.userId,
      customer_id: input.customerId ?? null,
      kind: input.kind,
      title: input.title,
      body: input.body,
      image_url: input.imageUrl ?? null
    });

    if (error) {
      throw new Error(`Failed to create notification: ${error.message}`);
    }

    return record;
  }

  const list = memoryNotifications.get(input.userId) ?? [];
  memoryNotifications.set(input.userId, [record, ...list]);
  return record;
}

async function listTenantUserIdsByRoles(tenantId: string, roles: Role[]): Promise<string[]> {
  const roleSet = new Set(roles);
  const supabase = getSupabaseAdminClient();
  if (supabase) {
    const { data, error } = await supabase
      .from("users")
      .select("id, role, status")
      .eq("tenant_id", tenantId);
    if (error) {
      throw new Error(`Failed to list users for notifications: ${error.message}`);
    }
    return (data ?? [])
      .filter((row) => roleSet.has(row.role as Role) && row.status !== "inactive")
      .map((row) => row.id);
  }

  return listUsersByTenant(tenantId)
    .filter((user) => roleSet.has(user.role as Role) && user.status !== "inactive")
    .map((user) => user.id);
}

/** Notify every active staff member with one of the given built-in roles. */
export async function notifyTenantStaff(input: {
  tenantId: string;
  roles: Role[];
  kind: AgentNotificationKind;
  title: string;
  body: string;
  customerId?: string;
}): Promise<void> {
  const userIds = await listTenantUserIdsByRoles(input.tenantId, input.roles);
  if (userIds.length === 0) {
    return;
  }

  const supabase = getSupabaseAdminClient();
  if (supabase) {
    const createdAt = new Date().toISOString();
    const rows = userIds.map((userId) => ({
      id: randomUUID(),
      tenant_id: input.tenantId,
      user_id: userId,
      customer_id: input.customerId ?? null,
      kind: input.kind,
      title: input.title,
      body: input.body,
      image_url: null,
      created_at: createdAt
    }));
    const { error } = await supabase.from("agent_notifications").insert(rows);
    if (error) {
      throw new Error(`Failed to create notifications: ${error.message}`);
    }
    return;
  }

  for (const userId of userIds) {
    const record: AgentNotification = {
      id: randomUUID(),
      tenantId: input.tenantId,
      userId,
      customerId: input.customerId,
      kind: input.kind,
      title: input.title,
      body: input.body,
      createdAt: new Date().toISOString()
    };
    const list = memoryNotifications.get(userId) ?? [];
    memoryNotifications.set(userId, [record, ...list]);
  }
}

export async function listAgentNotifications(
  tenantId: string,
  userId: string
): Promise<AgentNotification[]> {
  const supabase = getSupabaseAdminClient();
  if (supabase) {
    const { data, error } = await supabase
      .from("agent_notifications")
      .select("id, tenant_id, user_id, customer_id, kind, title, body, image_url, read_at, created_at")
      .eq("tenant_id", tenantId)
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) {
      throw new Error(`Failed to list notifications: ${error.message}`);
    }

    return (data ?? []).map((row) => ({
      id: row.id,
      tenantId: row.tenant_id,
      userId: row.user_id,
      customerId: row.customer_id ?? undefined,
      kind: row.kind as AgentNotificationKind,
      title: row.title,
      body: row.body,
      imageUrl: row.image_url ?? undefined,
      readAt: row.read_at ?? undefined,
      createdAt: row.created_at
    }));
  }

  return (memoryNotifications.get(userId) ?? []).filter((n) => n.tenantId === tenantId);
}

export async function markNotificationRead(
  tenantId: string,
  userId: string,
  notificationId: string
): Promise<void> {
  const supabase = getSupabaseAdminClient();
  if (supabase) {
    const { error } = await supabase
      .from("agent_notifications")
      .update({ read_at: new Date().toISOString() })
      .eq("tenant_id", tenantId)
      .eq("user_id", userId)
      .eq("id", notificationId);

    if (error) {
      throw new Error(`Failed to mark notification read: ${error.message}`);
    }
    return;
  }

  const list = memoryNotifications.get(userId) ?? [];
  for (const item of list) {
    if (item.id === notificationId) {
      item.readAt = new Date().toISOString();
    }
  }
}
