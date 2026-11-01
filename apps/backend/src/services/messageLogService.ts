import { hasTenantAddon, type TenantAddon } from "@bms/shared";
import { getSupabaseAdminClient } from "../config/supabaseClient.js";

export type MessageLogItem = {
  id: string;
  channel: "sms" | "email";
  eventType: string;
  recipient: string;
  customerName?: string;
  status: "pending" | "sent" | "failed" | "logged";
  errorMessage?: string;
  preview: string;
  createdAt: string;
};

const LIMIT = 40;

function isMissingRelation(message: string): boolean {
  return /does not exist|schema cache|could not find the table/i.test(message);
}

function previewText(value: unknown): string {
  const flat = String(value ?? "").replace(/\s+/g, " ").trim();
  if (flat.length <= 140) {
    return flat;
  }
  return `${flat.slice(0, 137)}…`;
}

function asStatus(value: unknown): MessageLogItem["status"] {
  if (value === "sent" || value === "failed" || value === "pending" || value === "logged") {
    return value;
  }
  return "pending";
}

type RawRow = Record<string, unknown>;

async function readOutbox(
  channel: "sms" | "email",
  tenantId: string
): Promise<{ data: unknown[] | null; error: { message: string } | null }> {
  const supabase = getSupabaseAdminClient();
  if (!supabase) {
    return { data: null, error: { message: "database client is not configured" } };
  }
  if (channel === "sms") {
    const result = await supabase
      .from("sms_outbox")
      .select("id, customer_id, event_type, phone, message_body, status, error_message, created_at")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false })
      .limit(LIMIT);
    return { data: result.data, error: result.error };
  }
  const result = await supabase
    .from("email_outbox")
    .select("id, customer_id, event_type, to_email, subject, message_body, status, error_message, created_at")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false })
    .limit(LIMIT);
  return { data: result.data, error: result.error };
}

async function loadChannel(
  tenantId: string,
  channel: "sms" | "email"
): Promise<{ rows: RawRow[]; ready: boolean }> {
  if (!getSupabaseAdminClient()) {
    return { rows: [], ready: false };
  }
  const { data, error } = await readOutbox(channel, tenantId);
  if (error) {
    if (isMissingRelation(error.message) || /not configured/i.test(error.message)) {
      return { rows: [], ready: false };
    }
    throw new Error(`Failed to load ${channel} message log: ${error.message}`);
  }
  return { rows: (data ?? []) as RawRow[], ready: true };
}

async function customerNames(tenantId: string, ids: string[]): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  const supabase = getSupabaseAdminClient();
  if (!supabase || ids.length === 0) {
    return names;
  }
  const { data, error } = await supabase
    .from("customers")
    .select("id, full_name")
    .eq("tenant_id", tenantId)
    .in("id", ids);
  if (error || !data) {
    return names;
  }
  for (const row of data as RawRow[]) {
    const id = typeof row.id === "string" ? row.id : "";
    const name = typeof row.full_name === "string" ? row.full_name.trim() : "";
    if (id && name) {
      names.set(id, name);
    }
  }
  return names;
}

function toItem(channel: "sms" | "email", row: RawRow, names: Map<string, string>): MessageLogItem | null {
  const id = typeof row.id === "string" ? row.id : "";
  const createdAt = typeof row.created_at === "string" ? row.created_at : "";
  if (!id || !createdAt) {
    return null;
  }
  const customerId = typeof row.customer_id === "string" ? row.customer_id : "";
  const recipient =
    channel === "sms"
      ? String(row.phone ?? "").trim()
      : String(row.to_email ?? "").trim();
  const body = previewText(row.message_body);
  const subject = channel === "email" ? previewText(row.subject) : "";
  const errorMessage = typeof row.error_message === "string" ? row.error_message.trim() : "";
  return {
    id: `${channel}:${id}`,
    channel,
    eventType: typeof row.event_type === "string" ? row.event_type : "test",
    recipient: recipient || "—",
    customerName: customerId ? names.get(customerId) : undefined,
    status: asStatus(row.status),
    errorMessage: errorMessage || undefined,
    preview: subject && body ? `${subject} — ${body}` : body || subject,
    createdAt
  };
}

export async function listMessageLog(
  tenantId: string,
  addons: TenantAddon[] | undefined
): Promise<{ items: MessageLogItem[]; storageReady: boolean }> {
  const wantSms = hasTenantAddon(addons, "sms_notifications");
  const wantEmail = hasTenantAddon(addons, "email_notifications");
  if (!wantSms && !wantEmail) {
    return { items: [], storageReady: true };
  }

  const loaded = await Promise.all([
    wantSms ? loadChannel(tenantId, "sms") : Promise.resolve({ rows: [], ready: true }),
    wantEmail ? loadChannel(tenantId, "email") : Promise.resolve({ rows: [], ready: true })
  ]);
  const sms = loaded[0];
  const email = loaded[1];
  const customerIds = [
    ...new Set(
      [...sms.rows, ...email.rows]
        .map((row) => (typeof row.customer_id === "string" ? row.customer_id : ""))
        .filter(Boolean)
    )
  ];
  const names = await customerNames(tenantId, customerIds);
  const items = [
    ...sms.rows.map((row) => toItem("sms", row, names)),
    ...email.rows.map((row) => toItem("email", row, names))
  ]
    .filter((item): item is MessageLogItem => item != null)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 50);

  const requested = [wantSms ? sms.ready : true, wantEmail ? email.ready : true];
  return { items, storageReady: requested.some(Boolean) };
}
