import type { LoanApplication, LoanGroup, LoanGroupMember, LoanProduct } from "@bms/shared";
import {
  addLoanGroupMemberSchema,
  createLoanGroupSchema,
  loanGroupMemberSchema,
  loanGroupSchema,
  updateLoanGroupSchema
} from "@bms/shared";
import { getSupabaseAdminClient } from "../config/supabaseClient.js";
import { isMissingSupabaseResource } from "../lib/supabaseSchema.js";
import { listBranches, resolveBranchId } from "./branchService.js";
import { getCustomerById } from "./customerService.js";

type ActorContext = {
  tenantId: string;
  userId: string;
  role: string;
  branchId?: string;
};

type MemoryStore = {
  groups: LoanGroup[];
  members: LoanGroupMember[];
};

const memory = new Map<string, MemoryStore>();

function ensureMemory(tenantId: string): MemoryStore {
  let store = memory.get(tenantId);
  if (!store) {
    store = { groups: [], members: [] };
    memory.set(tenantId, store);
  }
  return store;
}

function rowToMember(row: Record<string, unknown>): LoanGroupMember {
  return loanGroupMemberSchema.parse({
    id: String(row.id),
    tenantId: String(row.tenant_id),
    groupId: String(row.group_id),
    customerId: String(row.customer_id),
    role: row.role ?? "member",
    status: row.status === "inactive" ? "inactive" : "active",
    joinedAt: String(row.joined_at)
  });
}

function rowToGroup(row: Record<string, unknown>): LoanGroup {
  return loanGroupSchema.parse({
    id: String(row.id),
    tenantId: String(row.tenant_id),
    name: String(row.name),
    branchId: String(row.branch_id),
    description: row.description != null ? String(row.description) : undefined,
    meetingDay: row.meeting_day != null ? String(row.meeting_day) : undefined,
    minMembers: Number(row.min_members ?? 5),
    maxMembers: Number(row.max_members ?? 15),
    assignedFieldAgentId:
      row.assigned_field_agent_id != null ? String(row.assigned_field_agent_id) : undefined,
    status: row.status === "inactive" ? "inactive" : "active",
    createdAt: row.created_at != null ? String(row.created_at) : undefined
  });
}

async function enrichGroups(tenantId: string, groups: LoanGroup[]): Promise<LoanGroup[]> {
  const branches = await listBranches(tenantId).catch(() => []);
  const branchMap = new Map(branches.map((b) => [b.id, b.name]));
  const mem = ensureMemory(tenantId);

  const supabase = getSupabaseAdminClient();
  const countMap = new Map<string, { active: number; total: number }>();
  if (supabase && groups.length > 0) {
    const { data, error } = await supabase
      .from("loan_group_members")
      .select("group_id, status")
      .eq("tenant_id", tenantId);
    if (!error && data) {
      for (const row of data as { group_id: string; status: string }[]) {
        const entry = countMap.get(row.group_id) ?? { active: 0, total: 0 };
        entry.total += 1;
        if (row.status === "active") {
          entry.active += 1;
        }
        countMap.set(row.group_id, entry);
      }
    }
  }

  const enriched: LoanGroup[] = [];
  for (const group of groups) {
    const fromDb = countMap.get(group.id);
    const members = mem.members.filter((m) => m.groupId === group.id);
    enriched.push({
      ...group,
      branchName: branchMap.get(group.branchId),
      activeMemberCount: fromDb?.active ?? members.filter((m) => m.status === "active").length,
      memberCount: fromDb?.total ?? members.length
    });
  }
  return enriched;
}

async function enrichMembers(tenantId: string, members: LoanGroupMember[]): Promise<LoanGroupMember[]> {
  const enriched: LoanGroupMember[] = [];
  for (const member of members) {
    const customer = await getCustomerById(tenantId, member.customerId);
    enriched.push({
      ...member,
      customerName: customer?.fullName,
      customerPhone: customer?.phone
    });
  }
  return enriched;
}

async function loadMembersForGroup(tenantId: string, groupId: string): Promise<LoanGroupMember[]> {
  const supabase = getSupabaseAdminClient();
  let members: LoanGroupMember[] = [];
  if (supabase) {
    const { data, error } = await supabase
      .from("loan_group_members")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("group_id", groupId)
      .order("joined_at", { ascending: true });
    if (error) {
      if (isMissingSupabaseResource(error.message)) {
        members = ensureMemory(tenantId).members.filter((m) => m.groupId === groupId);
      } else {
        throw new Error(`Failed to list group members: ${error.message}`);
      }
    } else {
      members = (data ?? []).map((row) => rowToMember(row as Record<string, unknown>));
      const mem = ensureMemory(tenantId);
      mem.members = [
        ...mem.members.filter((m) => m.groupId !== groupId),
        ...members
      ];
    }
  } else {
    members = ensureMemory(tenantId).members.filter((m) => m.groupId === groupId);
  }
  return enrichMembers(tenantId, members);
}

export async function listLoanGroups(tenantId: string): Promise<LoanGroup[]> {
  const supabase = getSupabaseAdminClient();
  let groups: LoanGroup[] = [];
  if (supabase) {
    const { data, error } = await supabase
      .from("loan_groups")
      .select("*")
      .eq("tenant_id", tenantId)
      .order("name", { ascending: true });
    if (error) {
      if (isMissingSupabaseResource(error.message)) {
        groups = ensureMemory(tenantId).groups;
      } else {
        throw new Error(`Failed to list loan groups: ${error.message}`);
      }
    } else {
      groups = (data ?? []).map((row) => rowToGroup(row as Record<string, unknown>));
      const mem = ensureMemory(tenantId);
      for (const g of groups) {
        const idx = mem.groups.findIndex((x) => x.id === g.id);
        if (idx >= 0) {
          mem.groups[idx] = g;
        } else {
          mem.groups.push(g);
        }
      }
    }
  } else {
    groups = ensureMemory(tenantId).groups;
  }
  return enrichGroups(tenantId, groups);
}

export async function getLoanGroupById(tenantId: string, groupId: string): Promise<LoanGroup | undefined> {
  const groups = await listLoanGroups(tenantId);
  const group = groups.find((g) => g.id === groupId);
  if (!group) {
    return undefined;
  }
  const members = await loadMembersForGroup(tenantId, groupId);
  return {
    ...group,
    members,
    activeMemberCount: members.filter((m) => m.status === "active").length,
    memberCount: members.length
  };
}

export async function createLoanGroup(context: ActorContext, input: unknown): Promise<LoanGroup> {
  const payload = createLoanGroupSchema.parse(input);
  const branchId = await resolveBranchId(context.tenantId, payload.branchId);
  if (!branchId) {
    throw new Error("Invalid branch");
  }

  const group: LoanGroup = loanGroupSchema.parse({
    id: crypto.randomUUID(),
    tenantId: context.tenantId,
    name: payload.name.trim(),
    branchId,
    description: payload.description?.trim() || undefined,
    meetingDay: payload.meetingDay?.trim() || undefined,
    minMembers: payload.minMembers ?? 5,
    maxMembers: payload.maxMembers ?? 15,
    assignedFieldAgentId: payload.assignedFieldAgentId,
    status: "active",
    createdAt: new Date().toISOString()
  });

  const supabase = getSupabaseAdminClient();
  if (supabase) {
    const { data, error } = await supabase
      .from("loan_groups")
      .insert({
        id: group.id,
        tenant_id: context.tenantId,
        name: group.name,
        branch_id: group.branchId,
        description: group.description ?? null,
        meeting_day: group.meetingDay ?? null,
        min_members: group.minMembers,
        max_members: group.maxMembers,
        assigned_field_agent_id: group.assignedFieldAgentId ?? null,
        status: group.status,
        created_by: context.userId
      })
      .select("*")
      .single();
    if (error) {
      if (isMissingSupabaseResource(error.message)) {
        ensureMemory(context.tenantId).groups.push(group);
        return group;
      }
      throw new Error(`Failed to create loan group: ${error.message}`);
    }
    const saved = rowToGroup(data as Record<string, unknown>);
    ensureMemory(context.tenantId).groups.push(saved);
    return saved;
  }

  ensureMemory(context.tenantId).groups.push(group);
  return group;
}

export async function updateLoanGroup(
  tenantId: string,
  groupId: string,
  input: unknown
): Promise<LoanGroup> {
  const payload = updateLoanGroupSchema.parse(input);
  const existing = await getLoanGroupById(tenantId, groupId);
  if (!existing) {
    throw new Error("Loan group not found");
  }

  let branchId = existing.branchId;
  if (payload.branchId) {
    const resolved = await resolveBranchId(tenantId, payload.branchId);
    if (!resolved) {
      throw new Error("Invalid branch");
    }
    branchId = resolved;
  }

  const updated: LoanGroup = {
    ...existing,
    ...payload,
    name: payload.name?.trim() ?? existing.name,
    branchId,
    description: payload.description !== undefined ? payload.description?.trim() || undefined : existing.description,
    meetingDay: payload.meetingDay !== undefined ? payload.meetingDay?.trim() || undefined : existing.meetingDay,
    minMembers: payload.minMembers ?? existing.minMembers,
    maxMembers: payload.maxMembers ?? existing.maxMembers,
    assignedFieldAgentId:
      payload.assignedFieldAgentId !== undefined
        ? payload.assignedFieldAgentId
        : existing.assignedFieldAgentId,
    status: payload.status ?? existing.status
  };

  if (updated.maxMembers < updated.minMembers) {
    throw new Error("Maximum members must be at least the minimum");
  }

  const activeCount = existing.members?.filter((m) => m.status === "active").length ?? existing.activeMemberCount ?? 0;
  if (updated.maxMembers < activeCount) {
    throw new Error(`Group already has ${activeCount} active members — raise the maximum first`);
  }

  const supabase = getSupabaseAdminClient();
  if (supabase) {
    const { data, error } = await supabase
      .from("loan_groups")
      .update({
        name: updated.name,
        branch_id: updated.branchId,
        description: updated.description ?? null,
        meeting_day: updated.meetingDay ?? null,
        min_members: updated.minMembers,
        max_members: updated.maxMembers,
        assigned_field_agent_id: updated.assignedFieldAgentId ?? null,
        status: updated.status,
        updated_at: new Date().toISOString()
      })
      .eq("tenant_id", tenantId)
      .eq("id", groupId)
      .select("*")
      .single();
    if (error) {
      if (isMissingSupabaseResource(error.message)) {
        const mem = ensureMemory(tenantId);
        mem.groups = mem.groups.map((g) => (g.id === groupId ? updated : g));
        return updated;
      }
      throw new Error(`Failed to update loan group: ${error.message}`);
    }
    const saved = rowToGroup(data as Record<string, unknown>);
    const mem = ensureMemory(tenantId);
    mem.groups = mem.groups.map((g) => (g.id === groupId ? saved : g));
    return { ...saved, members: existing.members };
  }

  const mem = ensureMemory(tenantId);
  mem.groups = mem.groups.map((g) => (g.id === groupId ? updated : g));
  return updated;
}

export async function addLoanGroupMember(
  context: ActorContext,
  groupId: string,
  input: unknown
): Promise<LoanGroupMember> {
  const payload = addLoanGroupMemberSchema.parse(input);
  const group = await getLoanGroupById(context.tenantId, groupId);
  if (!group || group.status !== "active") {
    throw new Error("Active loan group not found");
  }

  const customer = await getCustomerById(context.tenantId, payload.customerId);
  if (!customer || customer.status !== "active") {
    throw new Error("Customer not found or not active");
  }

  const activeMembers = (group.members ?? []).filter((m) => m.status === "active");
  if (activeMembers.length >= group.maxMembers) {
    throw new Error(`Group is full (${group.maxMembers} members maximum)`);
  }

  const duplicate = (group.members ?? []).find(
    (m) => m.customerId === payload.customerId && m.status === "active"
  );
  if (duplicate) {
    throw new Error("Customer is already an active member of this group");
  }

  const inactive = (group.members ?? []).find(
    (m) => m.customerId === payload.customerId && m.status === "inactive"
  );

  if (inactive) {
    const reactivated: LoanGroupMember = { ...inactive, status: "active", role: payload.role };
    const supabase = getSupabaseAdminClient();
    if (supabase) {
      const { data, error } = await supabase
        .from("loan_group_members")
        .update({ status: "active", role: payload.role })
        .eq("tenant_id", context.tenantId)
        .eq("id", inactive.id)
        .select("*")
        .single();
      if (error && !isMissingSupabaseResource(error.message)) {
        throw new Error(`Failed to reactivate member: ${error.message}`);
      }
      if (!error && data) {
        const saved = rowToMember(data as Record<string, unknown>);
        const mem = ensureMemory(context.tenantId);
        mem.members = mem.members.map((m) => (m.id === saved.id ? saved : m));
        return { ...saved, customerName: customer.fullName, customerPhone: customer.phone };
      }
    }
    const mem = ensureMemory(context.tenantId);
    mem.members = mem.members.map((m) => (m.id === inactive.id ? reactivated : m));
    return { ...reactivated, customerName: customer.fullName, customerPhone: customer.phone };
  }

  const member: LoanGroupMember = loanGroupMemberSchema.parse({
    id: crypto.randomUUID(),
    tenantId: context.tenantId,
    groupId,
    customerId: payload.customerId,
    role: payload.role,
    status: "active",
    joinedAt: new Date().toISOString(),
    customerName: customer.fullName,
    customerPhone: customer.phone
  });

  const supabase = getSupabaseAdminClient();
  if (supabase) {
    const { data, error } = await supabase
      .from("loan_group_members")
      .insert({
        id: member.id,
        tenant_id: context.tenantId,
        group_id: groupId,
        customer_id: member.customerId,
        role: member.role,
        status: member.status
      })
      .select("*")
      .single();
    if (error) {
      if (isMissingSupabaseResource(error.message)) {
        ensureMemory(context.tenantId).members.push(member);
        return member;
      }
      throw new Error(`Failed to add group member: ${error.message}`);
    }
    const saved = rowToMember(data as Record<string, unknown>);
    ensureMemory(context.tenantId).members.push(saved);
    return { ...saved, customerName: customer.fullName, customerPhone: customer.phone };
  }

  ensureMemory(context.tenantId).members.push(member);
  return member;
}

export async function removeLoanGroupMember(
  context: ActorContext,
  groupId: string,
  memberId: string
): Promise<void> {
  const group = await getLoanGroupById(context.tenantId, groupId);
  if (!group) {
    throw new Error("Loan group not found");
  }
  const member = (group.members ?? []).find((m) => m.id === memberId);
  if (!member || member.status !== "active") {
    throw new Error("Active group member not found");
  }

  const supabase = getSupabaseAdminClient();
  if (supabase) {
    const { error } = await supabase
      .from("loan_group_members")
      .update({ status: "inactive" })
      .eq("tenant_id", context.tenantId)
      .eq("id", memberId);
    if (error && !isMissingSupabaseResource(error.message)) {
      throw new Error(`Failed to remove group member: ${error.message}`);
    }
  }

  const mem = ensureMemory(context.tenantId);
  mem.members = mem.members.map((m) =>
    m.id === memberId ? { ...m, status: "inactive" as const } : m
  );
}

export async function validateGroupForLoanApplication(
  tenantId: string,
  groupId: string,
  customerId: string,
  product: LoanProduct,
  applications: LoanApplication[]
): Promise<LoanGroup> {
  if (product.loanType !== "group_solidarity") {
    throw new Error("Selected product is not a group solidarity loan");
  }

  const group = await getLoanGroupById(tenantId, groupId);
  if (!group || group.status !== "active") {
    throw new Error("Active loan group not found");
  }

  const activeMembers = (group.members ?? []).filter((m) => m.status === "active");
  const isMember = activeMembers.some((m) => m.customerId === customerId);
  if (!isMember) {
    throw new Error("Borrower must be an active member of the selected group");
  }

  const minRequired = Math.max(group.minMembers, product.minGroupMembers ?? 0);
  if (activeMembers.length < minRequired) {
    throw new Error(
      `Group needs at least ${minRequired} active members before a solidarity loan can be applied for`
    );
  }

  if (product.maxGroupMembers != null && activeMembers.length > product.maxGroupMembers) {
    throw new Error(
      `Group has ${activeMembers.length} members — product allows at most ${product.maxGroupMembers}`
    );
  }

  const blocking = applications.filter(
    (a) =>
      a.groupId === groupId &&
      a.customerId === customerId &&
      (a.status === "pending_approval" || a.status === "approved" || a.status === "disbursed")
  );
  if (blocking.length > 0) {
    throw new Error("This member already has an open loan application or active loan in this group");
  }

  return group;
}

export async function getLoanGroupNameMap(tenantId: string): Promise<Map<string, string>> {
  const groups = await listLoanGroups(tenantId);
  return new Map(groups.map((g) => [g.id, g.name]));
}
