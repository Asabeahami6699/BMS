import { getSupabaseAdminClient } from "../config/supabaseClient.js";
import { listUsersByTenant } from "./authStore.js";
import { listCustomers } from "./customerService.js";
import { listTransactions } from "./transactionService.js";

export type DormantSusuCustomerAlert = {
  customerId: string;
  fullName: string;
  accountNumber?: string;
  phone: string;
  homeBranchId: string;
  fieldAgentId?: string;
  dailyContributionAmount: number;
  lastContributionAt: string | null;
  daysInactive: number;
};

export type ZeroCollectionAgentAlert = {
  agentId: string;
  fullName: string;
  email: string;
  branchId?: string;
  activeCustomerCount: number;
  expectedDailyTarget: number;
};

function todayDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function diffDays(olderIso: string, nowMs: number): number {
  const t = Date.parse(olderIso);
  if (Number.isNaN(t)) return 0;
  return Math.max(0, Math.floor((nowMs - t) / (24 * 60 * 60 * 1000)));
}

/**
 * Active Susu customers who have not had a posted contribution (daily_susu or deposit)
 * within the past `days` days (default 7).
 */
export async function listDormantSusuCustomers(
  tenantId: string,
  options: { days?: number; branchId?: string; agentId?: string } = {}
): Promise<DormantSusuCustomerAlert[]> {
  const days = Math.min(365, Math.max(1, Math.floor(options.days ?? 7)));
  const customers = await listCustomers(tenantId, {
    branchId: options.branchId,
    agentId: options.agentId
  });
  const activeSusu = customers.filter(
    (c) => c.status === "active" && (c.accountType ?? "susu") === "susu"
  );
  if (activeSusu.length === 0) {
    return [];
  }

  const latestByCustomer = new Map<string, string>();
  const createdByCustomer = new Map<string, string>();
  const supabase = getSupabaseAdminClient();
  if (supabase) {
    const customerIds = activeSusu.map((c) => c.id);
    const cutoffIso = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    const recentlyActive = new Set<string>();

    // Chunk customer IDs to stay well under PostgREST URL limits and avoid 1,000-row truncation.
    const CHUNK = 100;
    for (let i = 0; i < customerIds.length; i += CHUNK) {
      const slice = customerIds.slice(i, i + CHUNK);
      const [recentRes, custRes] = await Promise.all([
        supabase
          .from("customer_transactions")
          .select("customer_id, created_at")
          .eq("tenant_id", tenantId)
          .in("customer_id", slice)
          .in("type", ["daily_susu", "deposit"])
          .is("reversed_at", null)
          .gte("created_at", cutoffIso)
          .order("created_at", { ascending: false })
          .limit(5000),
        supabase
          .from("customers")
          .select("id, created_at")
          .eq("tenant_id", tenantId)
          .in("id", slice)
      ]);

      if (!recentRes.error && recentRes.data) {
        for (const row of recentRes.data) {
          const cid = String(row.customer_id);
          recentlyActive.add(cid);
          if (!latestByCustomer.has(cid) && row.created_at) {
            latestByCustomer.set(cid, String(row.created_at));
          }
        }
      }
      if (!custRes.error && custRes.data) {
        for (const row of custRes.data) {
          if (row.created_at) {
            createdByCustomer.set(String(row.id), String(row.created_at));
          }
        }
      }
    }

    // Fetch latest historical contribution only for customers who had no recent contribution.
    const candidateIds = customerIds.filter((id) => !recentlyActive.has(id));
    for (let i = 0; i < candidateIds.length; i += CHUNK) {
      const slice = candidateIds.slice(i, i + CHUNK);
      const { data: histData, error: histErr } = await supabase
        .from("customer_transactions")
        .select("customer_id, created_at")
        .eq("tenant_id", tenantId)
        .in("customer_id", slice)
        .in("type", ["daily_susu", "deposit"])
        .is("reversed_at", null)
        .lt("created_at", cutoffIso)
        .order("created_at", { ascending: false })
        .limit(5000);
      if (!histErr && histData) {
        for (const row of histData) {
          const cid = String(row.customer_id);
          if (!latestByCustomer.has(cid) && row.created_at) {
            latestByCustomer.set(cid, String(row.created_at));
          }
        }
      }
    }
  } else {
    const txs = await listTransactions(tenantId);
    for (const tx of txs) {
      if ((tx.type !== "daily_susu" && tx.type !== "deposit") || tx.reversedAt) continue;
      const prev = latestByCustomer.get(tx.customerId);
      if (!prev || tx.createdAt > prev) {
        latestByCustomer.set(tx.customerId, tx.createdAt);
      }
    }
  }

  const nowMs = Date.now();
  const alerts: DormantSusuCustomerAlert[] = [];

  for (const c of activeSusu) {
    const lastContrib = latestByCustomer.get(c.id) ?? null;
    const referenceIso = lastContrib ?? createdByCustomer.get(c.id) ?? null;
    if (!referenceIso) {
      continue;
    }
    const inactiveDays = diffDays(referenceIso, nowMs);
    if (inactiveDays >= days) {
      alerts.push({
        customerId: c.id,
        fullName: c.fullName,
        accountNumber: c.accountNumber,
        phone: c.phone,
        homeBranchId: c.homeBranchId,
        fieldAgentId: c.assignedFieldAgentId ?? c.createdByFieldAgentId,
        dailyContributionAmount: Number(c.dailyContributionAmount ?? 0),
        lastContributionAt: lastContrib,
        daysInactive: inactiveDays
      });
    }
  }

  alerts.sort((a, b) => b.daysInactive - a.daysInactive || a.fullName.localeCompare(b.fullName));
  return alerts;
}

/**
 * Active field agents who have at least 1 active assigned Susu customer
 * but have recorded GHS 0 collections today (neither in a draft/pending/posted batch nor direct transactions).
 */
export async function listZeroCollectionFieldAgentsToday(
  tenantId: string,
  options: { branchId?: string; businessDate?: string } = {}
): Promise<ZeroCollectionAgentAlert[]> {
  const businessDate = options.businessDate ?? todayDate();
  const customers = await listCustomers(tenantId, { branchId: options.branchId });
  const activeSusu = customers.filter(
    (c) => c.status === "active" && (c.accountType ?? "susu") === "susu"
  );

  const countByAgent = new Map<string, { count: number; target: number }>();
  for (const c of activeSusu) {
    const agentId = c.assignedFieldAgentId ?? c.createdByFieldAgentId;
    if (!agentId) continue;
    const cur = countByAgent.get(agentId) ?? { count: 0, target: 0 };
    cur.count += 1;
    cur.target = Math.round((cur.target + Number(c.dailyContributionAmount ?? 0)) * 100) / 100;
    countByAgent.set(agentId, cur);
  }

  if (countByAgent.size === 0) {
    return [];
  }

  const activeAgents: Array<{ id: string; fullName: string; email: string; branchId?: string }> = [];
  const agentsWithActivity = new Set<string>();

  const supabase = getSupabaseAdminClient();
  if (supabase) {
    let userQuery = supabase
      .from("users")
      .select("id, full_name, email, branch_id, status")
      .eq("tenant_id", tenantId)
      .eq("role", "field_agent");
    if (options.branchId) {
      userQuery = userQuery.eq("branch_id", options.branchId);
    }
    const { data: userRows } = await userQuery;
    for (const u of userRows ?? []) {
      if (u.status === "inactive") continue;
      activeAgents.push({
        id: String(u.id),
        fullName: String(u.full_name ?? u.email ?? "Field agent"),
        email: String(u.email ?? ""),
        branchId: u.branch_id ? String(u.branch_id) : undefined
      });
    }

    const { data: batches } = await supabase
      .from("field_agent_collection_batches")
      .select("field_agent_id, total_amount, line_count")
      .eq("tenant_id", tenantId)
      .eq("business_date", businessDate);
    for (const b of batches ?? []) {
      if (Number(b.total_amount ?? 0) > 0 || Number(b.line_count ?? 0) > 0) {
        agentsWithActivity.add(String(b.field_agent_id));
      }
    }

    const dayStart = `${businessDate}T00:00:00.000Z`;
    const dayEnd = `${businessDate}T23:59:59.999Z`;
    const { data: txRows } = await supabase
      .from("customer_transactions")
      .select("field_agent_id")
      .eq("tenant_id", tenantId)
      .eq("type", "daily_susu")
      .is("reversed_at", null)
      .gte("created_at", dayStart)
      .lte("created_at", dayEnd);
    for (const tx of txRows ?? []) {
      if (tx.field_agent_id) {
        agentsWithActivity.add(String(tx.field_agent_id));
      }
    }
  } else {
    for (const u of listUsersByTenant(tenantId)) {
      if (u.role !== "field_agent" || u.status === "inactive") continue;
      if (options.branchId && u.branchId !== options.branchId) continue;
      activeAgents.push({
        id: u.id,
        fullName: u.fullName ?? u.email,
        email: u.email,
        branchId: u.branchId
      });
    }
    const txs = await listTransactions(tenantId);
    for (const tx of txs) {
      if (
        tx.type === "daily_susu" &&
        !tx.reversedAt &&
        tx.fieldAgentId &&
        tx.createdAt.slice(0, 10) === businessDate
      ) {
        agentsWithActivity.add(tx.fieldAgentId);
      }
    }
  }

  const alerts: ZeroCollectionAgentAlert[] = [];
  for (const agent of activeAgents) {
    const stats = countByAgent.get(agent.id);
    if (!stats || stats.count <= 0) continue;
    if (agentsWithActivity.has(agent.id)) continue;
    alerts.push({
      agentId: agent.id,
      fullName: agent.fullName,
      email: agent.email,
      branchId: agent.branchId,
      activeCustomerCount: stats.count,
      expectedDailyTarget: stats.target
    });
  }

  alerts.sort((a, b) => b.activeCustomerCount - a.activeCustomerCount || a.fullName.localeCompare(b.fullName));
  return alerts;
}
