import { getSupabaseAdminClient } from "../config/supabaseClient.js";
import { listBranches } from "./branchService.js";
import { listUsersByTenant } from "./authStore.js";

export type CoordinatorOption = {
  userId: string;
  email: string;
  fullName?: string;
  scopeType: "head_office" | "branch";
  branchId?: string;
  status: "active" | "inactive";
};

export type CoordinatorRosterRow = CoordinatorOption & {
  displayName: string;
  branchLabel: string;
  pendingRegistrations: number;
  pendingRequests: number;
  approvalsProcessed: number;
  rejectionsProcessed: number;
  activeCustomersInScope: number;
  fieldAgentsInBranch: number;
};

function branchLabel(branchId: string | undefined, branches: { id: string; name: string; code: string }[]): string {
  if (!branchId) {
    return "Head office";
  }
  const match = branches.find((b) => b.id === branchId);
  return match ? `${match.name} (${match.code})` : branchId;
}

function inCoordinatorScope(
  coordinator: CoordinatorOption,
  homeBranchId: string | undefined
): boolean {
  if (coordinator.scopeType === "head_office" || !coordinator.branchId) {
    return true;
  }
  return homeBranchId === coordinator.branchId;
}

async function listCoordinators(tenantId: string): Promise<CoordinatorOption[]> {
  const supabase = getSupabaseAdminClient();
  if (supabase) {
    const { data, error } = await supabase
      .from("users")
      .select("id, email, full_name, scope_type, branch_id, status")
      .eq("tenant_id", tenantId)
      .eq("role", "coordinator")
      .order("full_name", { ascending: true });
    if (error) {
      throw new Error(`Failed to list coordinators: ${error.message}`);
    }
    return (data ?? []).map((row) => ({
      userId: row.id,
      email: row.email ?? "",
      fullName: row.full_name ?? undefined,
      scopeType: row.scope_type === "branch" ? "branch" : "head_office",
      branchId: row.branch_id ?? undefined,
      status: row.status === "inactive" ? "inactive" : "active"
    }));
  }

  return listUsersByTenant(tenantId)
    .filter((user) => user.role === "coordinator")
    .map((user) => ({
      userId: user.id,
      email: user.email,
      fullName: user.fullName,
      scopeType: user.scopeType,
      branchId: user.branchId,
      status: (user.status ?? "active") as "active" | "inactive"
    }));
}

export async function listCoordinatorRoster(tenantId: string): Promise<CoordinatorRosterRow[]> {
  const [coordinators, branches, customers, agents] = await Promise.all([
    listCoordinators(tenantId),
    listBranches(tenantId).catch(() => []),
    loadCustomersForRoster(tenantId),
    loadFieldAgentBranchMap(tenantId)
  ]);

  const pendingDisclosures = await loadPendingDisclosures(tenantId);
  const processedCounts = await loadProcessedDisclosureCounts(tenantId);

  const branchRows = branches.map((b) => ({ id: b.id, name: b.name, code: b.code }));

  const rows = coordinators.map((coord) => {
    const pendingRegistrations = customers.filter(
      (c) => c.status === "pending_activation" && inCoordinatorScope(coord, c.homeBranchId)
    ).length;

    const pendingRequests = pendingDisclosures.filter((d) =>
      inCoordinatorScope(coord, d.homeBranchId)
    ).length;

    const activeCustomersInScope = customers.filter(
      (c) => c.status === "active" && inCoordinatorScope(coord, c.homeBranchId)
    ).length;

    const fieldAgentsInBranch =
      coord.scopeType === "head_office"
        ? agents.filter((a) => a.status === "active").length
        : agents.filter((a) => a.status === "active" && a.branchId === coord.branchId).length;

    const counts = processedCounts.get(coord.userId) ?? { approved: 0, rejected: 0 };

    return {
      ...coord,
      displayName: coord.fullName?.trim() || coord.email || coord.userId,
      branchLabel: branchLabel(coord.branchId, branchRows),
      pendingRegistrations,
      pendingRequests,
      approvalsProcessed: counts.approved,
      rejectionsProcessed: counts.rejected,
      activeCustomersInScope,
      fieldAgentsInBranch
    };
  });

  return rows.sort((a, b) => {
    if (a.status !== b.status) {
      return a.status === "active" ? -1 : 1;
    }
    const aWorkload = a.pendingRegistrations + a.pendingRequests;
    const bWorkload = b.pendingRegistrations + b.pendingRequests;
    if (aWorkload !== bWorkload) {
      return bWorkload - aWorkload;
    }
    return a.displayName.localeCompare(b.displayName);
  });
}

type CustomerRosterSlice = { id: string; status: string; homeBranchId: string };
type PendingDisclosureSlice = { customerId: string; homeBranchId: string };
type AgentBranchSlice = { userId: string; branchId?: string; status: "active" | "inactive" };

async function loadCustomersForRoster(tenantId: string): Promise<CustomerRosterSlice[]> {
  const supabase = getSupabaseAdminClient();
  if (!supabase) {
    return [];
  }
  const { data, error } = await supabase
    .from("customers")
    .select("id, status, home_branch_id")
    .eq("tenant_id", tenantId);
  if (error) {
    throw new Error(`Failed to load customers for coordinator roster: ${error.message}`);
  }
  return (data ?? []).map((row) => ({
    id: String(row.id),
    status: String(row.status),
    homeBranchId: String(row.home_branch_id)
  }));
}

async function loadFieldAgentBranchMap(tenantId: string): Promise<AgentBranchSlice[]> {
  const supabase = getSupabaseAdminClient();
  if (!supabase) {
    return [];
  }
  const { data, error } = await supabase
    .from("users")
    .select("id, branch_id, status")
    .eq("tenant_id", tenantId)
    .eq("role", "field_agent");
  if (error) {
    throw new Error(`Failed to load agents for coordinator roster: ${error.message}`);
  }
  return (data ?? []).map((row) => ({
    userId: String(row.id),
    branchId: row.branch_id ? String(row.branch_id) : undefined,
    status: row.status === "inactive" ? "inactive" : "active"
  }));
}

async function loadPendingDisclosures(tenantId: string): Promise<PendingDisclosureSlice[]> {
  const supabase = getSupabaseAdminClient();
  if (!supabase) {
    return [];
  }
  const { data: disclosures, error } = await supabase
    .from("customer_balance_disclosures")
    .select("customer_id")
    .eq("tenant_id", tenantId)
    .eq("status", "pending");
  if (error) {
    throw new Error(`Failed to load pending requests: ${error.message}`);
  }
  if (!disclosures?.length) {
    return [];
  }

  const customerIds = [...new Set(disclosures.map((d) => String(d.customer_id)))];
  const { data: customers, error: custError } = await supabase
    .from("customers")
    .select("id, home_branch_id")
    .eq("tenant_id", tenantId)
    .in("id", customerIds);
  if (custError) {
    throw new Error(`Failed to load customers for pending requests: ${custError.message}`);
  }

  const homeByCustomer = new Map(
    (customers ?? []).map((c) => [String(c.id), String(c.home_branch_id)])
  );

  return disclosures.map((d) => ({
    customerId: String(d.customer_id),
    homeBranchId: homeByCustomer.get(String(d.customer_id)) ?? ""
  }));
}

async function loadProcessedDisclosureCounts(
  tenantId: string
): Promise<Map<string, { approved: number; rejected: number }>> {
  const result = new Map<string, { approved: number; rejected: number }>();
  const supabase = getSupabaseAdminClient();
  if (!supabase) {
    return result;
  }

  const { data, error } = await supabase
    .from("customer_balance_disclosures")
    .select("approved_by, status")
    .eq("tenant_id", tenantId)
    .in("status", ["approved", "rejected"])
    .not("approved_by", "is", null);

  if (error) {
    throw new Error(`Failed to load coordinator activity: ${error.message}`);
  }

  for (const row of data ?? []) {
    const userId = String(row.approved_by);
    const entry = result.get(userId) ?? { approved: 0, rejected: 0 };
    if (row.status === "approved") {
      entry.approved += 1;
    } else if (row.status === "rejected") {
      entry.rejected += 1;
    }
    result.set(userId, entry);
  }

  return result;
}
