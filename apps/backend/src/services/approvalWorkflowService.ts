import {
  parseApprovalWorkflow,
  updateApprovalWorkflowSchema,
  type ApprovalWorkflow
} from "@bms/shared";
import { getSupabaseAdminClient } from "../config/supabaseClient.js";

const memoryWorkflows = new Map<string, ApprovalWorkflow>();

function isMissingColumn(message: string): boolean {
  return /approval_workflows|does not exist|schema cache|could not find the column/i.test(message);
}

export async function getApprovalWorkflow(tenantId: string): Promise<ApprovalWorkflow> {
  const cached = memoryWorkflows.get(tenantId);
  const supabase = getSupabaseAdminClient();
  if (!supabase) {
    return cached ?? parseApprovalWorkflow(null);
  }

  const { data, error } = await supabase
    .from("tenants")
    .select("approval_workflows")
    .eq("id", tenantId)
    .maybeSingle();
  if (error) {
    if (isMissingColumn(error.message)) {
      return cached ?? parseApprovalWorkflow(null);
    }
    throw new Error(`Failed to load approval workflows: ${error.message}`);
  }
  const workflow = parseApprovalWorkflow(data?.approval_workflows ?? null);
  memoryWorkflows.set(tenantId, workflow);
  return workflow;
}

export async function updateApprovalWorkflow(
  tenantId: string,
  input: unknown
): Promise<ApprovalWorkflow> {
  const parsed = updateApprovalWorkflowSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Invalid approval workflow");
  }
  const next = parseApprovalWorkflow(parsed.data);
  const supabase = getSupabaseAdminClient();
  if (!supabase) {
    memoryWorkflows.set(tenantId, next);
    return next;
  }

  const { error } = await supabase
    .from("tenants")
    .update({ approval_workflows: next })
    .eq("id", tenantId);
  if (error) {
    if (isMissingColumn(error.message)) {
      throw new Error(
        "Approval workflow storage is not ready. Apply migration 069_tenant_approval_workflows.sql in Supabase, then save again."
      );
    }
    throw new Error(`Failed to save approval workflows: ${error.message}`);
  }
  memoryWorkflows.set(tenantId, next);
  return next;
}
