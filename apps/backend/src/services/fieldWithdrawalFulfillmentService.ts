import { getSupabaseAdminClient } from "../config/supabaseClient.js";
import { findUserById, listUsersByTenant } from "./authStore.js";
import { DISCLOSURE_WITHDRAWAL_NOTE_TAG } from "./transactionService.js";
import { userDisplayName } from "./userNameResolver.js";

export type FieldWithdrawalFulfillmentLine = {
  customerId: string;
  customerName?: string;
  disclosureId?: string;
  transactionId?: string;
  amount: number;
  fulfilledAt: string;
  status: string;
};

export type FieldWithdrawalFulfillmentRow = {
  fieldAgentId: string;
  fieldAgentName: string;
  branchId?: string;
  businessDate: string;
  totalRequested: number;
  totalApproved: number;
  totalFulfilled: number;
  customerCount: number;
  lines: FieldWithdrawalFulfillmentLine[];
};

type RoleContext = {
  role: string;
  scopeType: "head_office" | "branch";
  branchId?: string;
  filterBranchId?: string;
};

const FULFILLED_STATUSES = new Set([
  "approved",
  "cs_approved",
  "bank_executed",
  "completed"
]);

function parseDate(dateStr: string): { start: string; end: string } {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    throw new Error("Invalid date — use YYYY-MM-DD");
  }
  return {
    start: `${dateStr}T00:00:00.000Z`,
    end: `${dateStr}T23:59:59.999Z`
  };
}

async function agentBranchId(
  tenantId: string,
  agentId: string,
  cache: Map<string, string | undefined>
): Promise<string | undefined> {
  if (cache.has(agentId)) {
    return cache.get(agentId);
  }
  const supabase = getSupabaseAdminClient();
  let branchId: string | undefined;
  if (supabase) {
    const { data } = await supabase
      .from("users")
      .select("branch_id")
      .eq("tenant_id", tenantId)
      .eq("id", agentId)
      .maybeSingle();
    branchId = data?.branch_id != null ? String(data.branch_id) : undefined;
  } else {
    branchId = listUsersByTenant(tenantId).find((u) => u.id === agentId)?.branchId;
  }
  cache.set(agentId, branchId);
  return branchId;
}

function agentDisplayName(
  tenantId: string,
  agentId: string,
  cache: Map<string, string>
): string {
  if (cache.has(agentId)) {
    return cache.get(agentId)!;
  }
  const user = findUserById(agentId);
  const name = userDisplayName(user?.fullName, user?.email, agentId);
  cache.set(agentId, name);
  return name;
}

export async function listFieldWithdrawalFulfillment(
  tenantId: string,
  context: RoleContext,
  options?: { businessDate?: string; fieldAgentId?: string; branchId?: string }
): Promise<FieldWithdrawalFulfillmentRow[]> {
  const businessDate = options?.businessDate?.trim() || new Date().toISOString().slice(0, 10);
  const { start, end } = parseDate(businessDate);
  const supabase = getSupabaseAdminClient();
  const nameCache = new Map<string, string>();
  const branchCache = new Map<string, string | undefined>();

  type DisclosureRow = {
    id: string;
    customer_id: string;
    field_agent_id: string;
    status: string;
    withdrawal_amount: number | null;
    requested_at: string;
    approved_at: string | null;
    paid_at: string | null;
  };

  let disclosures: DisclosureRow[] = [];

  if (supabase) {
    let query = supabase
      .from("customer_balance_disclosures")
      .select(
        "id, customer_id, field_agent_id, status, withdrawal_amount, requested_at, approved_at, paid_at"
      )
      .eq("tenant_id", tenantId)
      .eq("request_type", "withdrawal")
      .gte("requested_at", start)
      .lte("requested_at", end);

    if (options?.fieldAgentId) {
      query = query.eq("field_agent_id", options.fieldAgentId);
    }

    const { data, error } = await query;
    if (error) {
      throw new Error(`Failed to load withdrawal disclosures: ${error.message}`);
    }
    disclosures = (data ?? []) as DisclosureRow[];
  }

  const customerNameCache = new Map<string, string>();
  async function customerName(customerId: string): Promise<string> {
    if (customerNameCache.has(customerId)) {
      return customerNameCache.get(customerId)!;
    }
    let name = customerId;
    if (supabase) {
      const { data } = await supabase
        .from("customers")
        .select("full_name")
        .eq("tenant_id", tenantId)
        .eq("id", customerId)
        .maybeSingle();
      if (data?.full_name) {
        name = String(data.full_name);
      }
    }
    customerNameCache.set(customerId, name);
    return name;
  }

  const byAgent = new Map<string, FieldWithdrawalFulfillmentRow>();

  for (const row of disclosures) {
    const agentId = String(row.field_agent_id);
    const agentBranch = await agentBranchId(tenantId, agentId, branchCache);

    if (context.scopeType === "branch" && context.branchId && agentBranch !== context.branchId) {
      continue;
    }
    const filterBranch = options?.branchId ?? context.filterBranchId;
    if (filterBranch && agentBranch !== filterBranch) {
      continue;
    }

    const existing = byAgent.get(agentId) ?? {
      fieldAgentId: agentId,
      fieldAgentName: agentDisplayName(tenantId, agentId, nameCache),
      branchId: agentBranch,
      businessDate,
      totalRequested: 0,
      totalApproved: 0,
      totalFulfilled: 0,
      customerCount: 0,
      lines: []
    };

    const amount = Number(row.withdrawal_amount ?? 0);
    existing.totalRequested += amount;
    if (FULFILLED_STATUSES.has(String(row.status))) {
      existing.totalApproved += amount;
    }

    const line: FieldWithdrawalFulfillmentLine = {
      customerId: String(row.customer_id),
      disclosureId: String(row.id),
      amount,
      fulfilledAt: String(row.paid_at ?? row.approved_at ?? row.requested_at),
      status: String(row.status)
    };
    line.customerName = await customerName(line.customerId);
    existing.lines.push(line);

    byAgent.set(agentId, existing);
  }

  if (supabase) {
    const { data: txRows, error: txError } = await supabase
      .from("customer_transactions")
      .select("id, customer_id, field_agent_id, amount, created_at, notes")
      .eq("tenant_id", tenantId)
      .eq("type", "withdrawal")
      .gte("created_at", start)
      .lte("created_at", end)
      .like("notes", `%${DISCLOSURE_WITHDRAWAL_NOTE_TAG}%`);

    if (txError) {
      throw new Error(`Failed to load fulfilled withdrawals: ${txError.message}`);
    }

    for (const tx of txRows ?? []) {
      const agentId = String(tx.field_agent_id);
      const agentBranch = await agentBranchId(tenantId, agentId, branchCache);

      if (context.scopeType === "branch" && context.branchId && agentBranch !== context.branchId) {
        continue;
      }
      const filterBranch = options?.branchId ?? context.filterBranchId;
      if (filterBranch && agentBranch !== filterBranch) {
        continue;
      }

      const existing = byAgent.get(agentId) ?? {
        fieldAgentId: agentId,
        fieldAgentName: agentDisplayName(tenantId, agentId, nameCache),
        branchId: agentBranch,
        businessDate,
        totalRequested: 0,
        totalApproved: 0,
        totalFulfilled: 0,
        customerCount: 0,
        lines: []
      };

      const amount = Number(tx.amount ?? 0);
      existing.totalFulfilled += amount;

      const disclosureTag = String(tx.notes ?? "").match(/disclosure:([a-f0-9-]+)/i);
      const disclosureId = disclosureTag?.[1];
      const line = existing.lines.find((l) => l.disclosureId === disclosureId);
      if (line) {
        line.transactionId = String(tx.id);
        line.fulfilledAt = String(tx.created_at);
        line.status = "fulfilled";
      } else {
        existing.lines.push({
          customerId: String(tx.customer_id),
          customerName: await customerName(String(tx.customer_id)),
          disclosureId,
          transactionId: String(tx.id),
          amount,
          fulfilledAt: String(tx.created_at),
          status: "fulfilled"
        });
      }

      byAgent.set(agentId, existing);
    }
  }

  const results = [...byAgent.values()].map((row) => ({
    ...row,
    customerCount: new Set(row.lines.map((l) => l.customerId)).size,
    lines: row.lines.sort((a, b) => b.fulfilledAt.localeCompare(a.fulfilledAt))
  }));

  return results.sort((a, b) => b.totalFulfilled - a.totalFulfilled || a.fieldAgentName.localeCompare(b.fieldAgentName));
}
