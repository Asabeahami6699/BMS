import { randomUUID } from "node:crypto";
import { z } from "zod";
import { getSupabaseAdminClient } from "../config/supabaseClient.js";

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
  lines: z.array(calloverLineSchema).min(1),
  summary: z.object({
    totalDocument: z.number().nonnegative(),
    totalApp: z.number().nonnegative(),
    totalVariance: z.number(),
    unresolvedCount: z.number().int().nonnegative()
  }),
  agentNotes: z.string().optional()
});

export type SubmitCalloverInput = z.infer<typeof submitCalloverSchema>;

const memoryReports = new Map<string, Array<Record<string, unknown>>>();

export async function submitCalloverReport(
  tenantId: string,
  fieldAgentId: string,
  input: unknown
): Promise<{ id: string; status: string }> {
  const payload = submitCalloverSchema.parse(input);
  const id = randomUUID();
  const row = {
    id,
    tenant_id: tenantId,
    field_agent_id: fieldAgentId,
    report_date: new Date().toISOString().slice(0, 10),
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
    memoryReports.set(key, [...existing, { ...row, created_at: new Date().toISOString() }]);
  }

  return { id, status: "submitted" };
}
