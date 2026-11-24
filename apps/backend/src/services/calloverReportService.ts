import { formatAccountAmount } from "@bms/shared";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { getSupabaseAdminClient } from "../config/supabaseClient.js";
import { notifyTenantStaff } from "./notificationService.js";

const calloverLineSchema = z.object({
  customerId: z.string().min(1),
  customerName: z.string().min(1),
  documentAmount: z.number().nonnegative(),
  appAmount: z.number().nonnegative(),
  reconciledAmount: z.number().nonnegative().optional(),
  varianceType: z.enum(["match", "shortage", "overage", "unresolved"]),
  notes: z.string().optional()
});

const submitCalloverSchema = z.object({
  reportDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  lines: z.array(calloverLineSchema).min(1),
  summary: z.object({
    totalDocument: z.number().nonnegative(),
    totalApp: z.number().nonnegative(),
    totalVariance: z.number(),
    unresolvedCount: z.number().int().nonnegative()
  }),
  agentNotes: z.string().optional()
});

export type CalloverReportLineInput = z.infer<typeof calloverLineSchema>;
export type SubmitCalloverInput = z.infer<typeof submitCalloverSchema>;

export type CalloverReportRecord = {
  id: string;
  tenantId: string;
  fieldAgentId: string;
  reportDate: string;
  lines: CalloverReportLineInput[];
  summary: {
    totalDocument: number;
    totalApp: number;
    totalVariance: number;
    unresolvedCount: number;
  };
  agentNotes?: string;
  status: "submitted" | "reviewed";
  createdAt?: string;
};

const memoryReports = new Map<string, CalloverReportRecord[]>();

function mapReportRow(row: Record<string, unknown>): CalloverReportRecord {
  const rawLines = Array.isArray(row.lines) ? row.lines : [];
  const lines = rawLines
    .map((line) => calloverLineSchema.safeParse(line))
    .filter((res): res is { success: true; data: CalloverReportLineInput } => res.success)
    .map((res) => res.data);
  const rawSummary = (row.summary ?? {}) as Record<string, unknown>;
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    fieldAgentId: String(row.field_agent_id),
    reportDate: String(row.report_date).slice(0, 10),
    lines,
    summary: {
      totalDocument: Number(rawSummary.totalDocument ?? 0),
      totalApp: Number(rawSummary.totalApp ?? 0),
      totalVariance: Number(rawSummary.totalVariance ?? 0),
      unresolvedCount: Number(rawSummary.unresolvedCount ?? 0)
    },
    agentNotes: row.agent_notes != null ? String(row.agent_notes) : undefined,
    status: row.status === "reviewed" ? "reviewed" : "submitted",
    createdAt: row.created_at != null ? String(row.created_at) : undefined
  };
}

export function extractReportedDifferences(
  report: CalloverReportRecord | null | undefined
): CalloverReportLineInput[] {
  if (!report) {
    return [];
  }
  return report.lines.filter((l) => l.varianceType !== "match");
}

export async function getCalloverReportById(
  tenantId: string,
  reportId: string
): Promise<CalloverReportRecord | null> {
  const supabase = getSupabaseAdminClient();
  if (supabase) {
    const { data, error } = await supabase
      .from("field_agent_callover_reports")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("id", reportId)
      .maybeSingle();
    if (error || !data) {
      return null;
    }
    return mapReportRow(data as Record<string, unknown>);
  }
  for (const list of memoryReports.values()) {
    const found = list.find((r) => r.tenantId === tenantId && r.id === reportId);
    if (found) {
      return found;
    }
  }
  return null;
}

export async function getLatestUnreviewedCalloverReport(
  tenantId: string,
  fieldAgentId: string,
  reportDate: string
): Promise<CalloverReportRecord | null> {
  const supabase = getSupabaseAdminClient();
  if (supabase) {
    const { data, error } = await supabase
      .from("field_agent_callover_reports")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("field_agent_id", fieldAgentId)
      .eq("report_date", reportDate)
      .eq("status", "submitted")
      .order("created_at", { ascending: false })
      .limit(5);
    if (error || !data || data.length === 0) {
      return null;
    }
    const mapped = data.map((row) => mapReportRow(row as Record<string, unknown>));
    return (
      mapped.find((r) => r.summary.unresolvedCount > 0 || extractReportedDifferences(r).length > 0) ??
      mapped[0] ??
      null
    );
  }
  const key = `${tenantId}:${fieldAgentId}`;
  const list = (memoryReports.get(key) ?? [])
    .filter((r) => r.reportDate === reportDate && r.status === "submitted")
    .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
  return (
    list.find((r) => r.summary.unresolvedCount > 0 || extractReportedDifferences(r).length > 0) ??
    list[0] ??
    null
  );
}

export async function markCalloverReportsReviewed(
  tenantId: string,
  fieldAgentId: string,
  reportDate: string,
  calloverReportId?: string
): Promise<void> {
  const supabase = getSupabaseAdminClient();
  if (supabase) {
    if (calloverReportId) {
      await supabase
        .from("field_agent_callover_reports")
        .update({ status: "reviewed" })
        .eq("id", calloverReportId);
    }
    await supabase
      .from("field_agent_callover_reports")
      .update({ status: "reviewed" })
      .eq("tenant_id", tenantId)
      .eq("field_agent_id", fieldAgentId)
      .eq("report_date", reportDate)
      .eq("status", "submitted");
    return;
  }
  const key = `${tenantId}:${fieldAgentId}`;
  const list = memoryReports.get(key) ?? [];
  for (const r of list) {
    if (r.reportDate === reportDate || (calloverReportId && r.id === calloverReportId)) {
      r.status = "reviewed";
    }
  }
}

export async function submitCalloverReport(
  tenantId: string,
  fieldAgentId: string,
  input: unknown,
  options?: { notifyOnDifferences?: boolean }
): Promise<{ id: string; status: string; hasDifferences: boolean }> {
  const payload = submitCalloverSchema.parse(input);
  const id = randomUUID();
  const reportDate = payload.reportDate ?? new Date().toISOString().slice(0, 10);
  const createdAt = new Date().toISOString();
  const diffLines = payload.lines.filter((l) => l.varianceType !== "match");
  const hasDifferences = payload.summary.unresolvedCount > 0 || diffLines.length > 0;

  const row = {
    id,
    tenant_id: tenantId,
    field_agent_id: fieldAgentId,
    report_date: reportDate,
    lines: payload.lines,
    summary: payload.summary,
    agent_notes: payload.agentNotes ?? null,
    status: "submitted"
  };

  const supabase = getSupabaseAdminClient();
  if (supabase) {
    const { error } = await supabase.from("field_agent_callover_reports").insert(row);
    if (error) {
      throw new Error(`Failed to submit call-over report: ${error.message}`);
    }
  } else {
    const key = `${tenantId}:${fieldAgentId}`;
    const existing = memoryReports.get(key) ?? [];
    memoryReports.set(key, [
      ...existing,
      {
        id,
        tenantId,
        fieldAgentId,
        reportDate,
        lines: payload.lines,
        summary: payload.summary,
        agentNotes: payload.agentNotes,
        status: "submitted",
        createdAt
      }
    ]);
  }

  if (options?.notifyOnDifferences && hasDifferences) {
    void notifyTenantStaff({
      tenantId,
      roles: ["admin", "coordinator"],
      kind: "collection_batch_pending",
      title: "Call-over difference reported — batch held",
      body: `Field agent reported ${diffLines.length} call-over difference${diffLines.length === 1 ? "" : "s"} (variance GHS ${formatAccountAmount(Math.abs(payload.summary.totalVariance))}) on ${reportDate}. Call-over was NOT auto-posted.`
    }).catch(() => {
      /* non-blocking */
    });
  }

  return { id, status: "submitted", hasDifferences };
}
