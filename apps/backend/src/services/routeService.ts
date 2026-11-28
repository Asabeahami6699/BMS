import {
  createFieldRouteSchema,
  fieldRouteSchema,
  setRouteMembersSchema,
  updateFieldRouteSchema,
  type FieldRoute
} from "@bms/shared";
import { randomUUID } from "node:crypto";
import { getSupabaseAdminClient } from "../config/supabaseClient.js";
import { listBranches } from "./branchService.js";
import { fetchUserNameMap } from "./userNameResolver.js";

type RouteRow = {
  id: string;
  tenant_id: string;
  name: string;
  area: string;
  communities?: string[] | null;
  branch_id: string;
  assigned_field_agent_id: string | null;
  status: string;
  created_at: string;
};

type RouteMember = {
  id: string;
  fullName: string;
  phone: string;
  accountNumber?: string;
  status: string;
  assignedFieldAgentId?: string;
};

const routeStore = new Map<string, RouteRow[]>();

export function clearMemoryRoutes(tenantId?: string): void {
  if (tenantId) {
    routeStore.delete(tenantId);
  } else {
    routeStore.clear();
  }
}

function tenantRoutes(tenantId: string): RouteRow[] {
  return routeStore.get(tenantId) ?? [];
}

function setTenantRoutes(tenantId: string, rows: RouteRow[]): void {
  routeStore.set(tenantId, rows);
}

function normalizeCommunities(raw: unknown): string[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string") {
      continue;
    }
    const trimmed = item.trim();
    if (!trimmed) {
      continue;
    }
    const key = trimmed.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(trimmed);
  }
  return result;
}

function isMissingCommunitiesColumn(message: string): boolean {
  return /communities|does not exist|schema cache/i.test(message);
}

async function countMembers(tenantId: string, routeId: string): Promise<number> {
  const supabase = getSupabaseAdminClient();
  if (supabase) {
    const { count, error } = await supabase
      .from("customers")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("route_id", routeId);
    if (error) {
      throw new Error(`Failed to count route members: ${error.message}`);
    }
    return count ?? 0;
  }
  const { listCustomers } = await import("./customerService.js");
  const customers = await listCustomers(tenantId).catch(() => []);
  return customers.filter((c) => c.routeId === routeId).length;
}

async function enrichRoutes(tenantId: string, rows: RouteRow[]): Promise<FieldRoute[]> {
  const branches = await listBranches(tenantId);
  const branchMap = new Map(branches.map((b) => [b.id, b]));
  const agentIds = rows
    .map((r) => r.assigned_field_agent_id)
    .filter((id): id is string => Boolean(id));
  const nameMap = await fetchUserNameMap(tenantId, agentIds);

  const result: FieldRoute[] = [];
  for (const row of rows) {
    const branch = branchMap.get(row.branch_id);
    const memberCount = await countMembers(tenantId, row.id);
    result.push(
      fieldRouteSchema.parse({
        id: row.id,
        tenantId: row.tenant_id,
        name: row.name,
        area: row.area,
        communities: normalizeCommunities(row.communities),
        branchId: row.branch_id,
        assignedFieldAgentId: row.assigned_field_agent_id ?? undefined,
        status: row.status === "inactive" ? "inactive" : "active",
        memberCount,
        branchName: branch?.name,
        branchCode: branch?.code,
        assignedFieldAgentName: row.assigned_field_agent_id
          ? nameMap.get(row.assigned_field_agent_id)
          : undefined,
        createdAt: row.created_at
      })
    );
  }
  return result;
}

export async function listFieldRoutes(tenantId: string): Promise<FieldRoute[]> {
  const supabase = getSupabaseAdminClient();
  if (!supabase) {
    return enrichRoutes(tenantId, tenantRoutes(tenantId));
  }

  const { data, error } = await supabase
    .from("field_routes")
    .select("*")
    .eq("tenant_id", tenantId)
    .order("name", { ascending: true });

  if (error) {
    throw new Error(`Failed to list routes: ${error.message}`);
  }

  return enrichRoutes(tenantId, (data ?? []) as RouteRow[]);
}

export async function getFieldRoute(
  tenantId: string,
  routeId: string
): Promise<FieldRoute | undefined> {
  const routes = await listFieldRoutes(tenantId);
  return routes.find((r) => r.id === routeId);
}

export async function createFieldRoute(tenantId: string, input: unknown): Promise<FieldRoute> {
  const payload = createFieldRouteSchema.parse(input);
  const id = randomUUID();
  const createdAt = new Date().toISOString();
  const agentId = payload.assignedFieldAgentId?.trim() || null;
  const communities = normalizeCommunities(payload.communities);

  const row: RouteRow = {
    id,
    tenant_id: tenantId,
    name: payload.name.trim(),
    area: payload.area.trim(),
    communities,
    branch_id: payload.branchId,
    assigned_field_agent_id: agentId,
    status: payload.status,
    created_at: createdAt
  };

  const supabase = getSupabaseAdminClient();
  if (supabase) {
    let { error } = await supabase.from("field_routes").insert({
      id: row.id,
      tenant_id: row.tenant_id,
      name: row.name,
      area: row.area,
      communities: row.communities,
      branch_id: row.branch_id,
      assigned_field_agent_id: row.assigned_field_agent_id,
      status: row.status
    });
    if (error && isMissingCommunitiesColumn(error.message)) {
      const retry = await supabase.from("field_routes").insert({
        id: row.id,
        tenant_id: row.tenant_id,
        name: row.name,
        area: row.area,
        branch_id: row.branch_id,
        assigned_field_agent_id: row.assigned_field_agent_id,
        status: row.status
      });
      error = retry.error;
    }
    if (error) {
      throw new Error(`Failed to create route: ${error.message}`);
    }
  } else {
    setTenantRoutes(tenantId, [...tenantRoutes(tenantId), row]);
  }

  const enriched = await enrichRoutes(tenantId, [row]);
  return enriched[0]!;
}

async function syncRouteAgentToMembers(
  tenantId: string,
  route: { id: string; name: string; branchId: string },
  fieldAgentId: string | null,
  actorUserId?: string
): Promise<void> {
  if (!fieldAgentId) {
    return;
  }
  const supabase = getSupabaseAdminClient();
  const { recordCustomerAssignmentHistory } = await import("./routeManagementService.js");

  if (!supabase) {
    const { listCustomers, setCustomerAssignmentDirect } = await import("./customerService.js");
    const members = (await listCustomers(tenantId)).filter((c) => c.routeId === route.id);
    const history: Parameters<typeof recordCustomerAssignmentHistory>[0] = [];
    for (const member of members) {
      if ((member.assignedFieldAgentId ?? null) === fieldAgentId) {
        continue;
      }
      await setCustomerAssignmentDirect(tenantId, member.id, fieldAgentId, route.id);
      history.push({
        tenantId,
        customerId: member.id,
        branchId: member.homeBranchId,
        previousRouteId: route.id,
        previousRouteName: route.name,
        newRouteId: route.id,
        newRouteName: route.name,
        previousFieldAgentId: member.assignedFieldAgentId ?? null,
        newFieldAgentId: fieldAgentId,
        changedByUserId: actorUserId ?? "system",
        changeSource: "route_agent_sync",
        reason: `Route "${route.name}" mobilizer updated`
      });
    }
    await recordCustomerAssignmentHistory(history);
    return;
  }

  const { data: priorMembers } = await supabase
    .from("customers")
    .select("id, home_branch_id, assigned_field_agent_id")
    .eq("tenant_id", tenantId)
    .eq("route_id", route.id);

  const { error } = await supabase
    .from("customers")
    .update({ assigned_field_agent_id: fieldAgentId })
    .eq("tenant_id", tenantId)
    .eq("route_id", route.id);
  if (error) {
    throw new Error(`Failed to sync agent to route members: ${error.message}`);
  }

  const history = (priorMembers ?? [])
    .filter((m) => (m.assigned_field_agent_id ? String(m.assigned_field_agent_id) : null) !== fieldAgentId)
    .map((m) => ({
      tenantId,
      customerId: String(m.id),
      branchId: String(m.home_branch_id ?? route.branchId),
      previousRouteId: route.id,
      previousRouteName: route.name,
      newRouteId: route.id,
      newRouteName: route.name,
      previousFieldAgentId: m.assigned_field_agent_id ? String(m.assigned_field_agent_id) : null,
      newFieldAgentId: fieldAgentId,
      changedByUserId: actorUserId ?? "system",
      changeSource: "route_agent_sync" as const,
      reason: `Route "${route.name}" mobilizer updated`
    }));

  if (history.length > 0) {
    await recordCustomerAssignmentHistory(history).catch(() => undefined);
  }
}

export async function updateFieldRoute(
  tenantId: string,
  routeId: string,
  input: unknown,
  actorUserId?: string
): Promise<FieldRoute> {
  const payload = updateFieldRouteSchema.parse(input);
  const supabase = getSupabaseAdminClient();
  const rows = supabase ? null : tenantRoutes(tenantId);
  const existing = supabase
    ? (
        await supabase
          .from("field_routes")
          .select("*")
          .eq("tenant_id", tenantId)
          .eq("id", routeId)
          .maybeSingle()
      ).data
    : rows?.find((r) => r.id === routeId);

  if (!existing) {
    throw new Error("Route not found");
  }

  const patch: Record<string, unknown> = {};
  if (payload.name !== undefined) {
    patch.name = payload.name.trim();
  }
  if (payload.area !== undefined) {
    patch.area = payload.area.trim();
  }
  if (payload.communities !== undefined) {
    patch.communities = normalizeCommunities(payload.communities);
  }
  if (payload.branchId !== undefined) {
    patch.branch_id = payload.branchId;
  }
  if (payload.assignedFieldAgentId !== undefined) {
    patch.assigned_field_agent_id = payload.assignedFieldAgentId;
  }
  if (payload.status !== undefined) {
    patch.status = payload.status;
  }

  if (supabase) {
    let { error } = await supabase
      .from("field_routes")
      .update(patch)
      .eq("tenant_id", tenantId)
      .eq("id", routeId);
    if (error && patch.communities !== undefined && isMissingCommunitiesColumn(error.message)) {
      const { communities: _ignored, ...fallbackPatch } = patch;
      if (Object.keys(fallbackPatch).length > 0) {
        const retry = await supabase
          .from("field_routes")
          .update(fallbackPatch)
          .eq("tenant_id", tenantId)
          .eq("id", routeId);
        error = retry.error;
      } else {
        error = null;
      }
    }
    if (error) {
      throw new Error(`Failed to update route: ${error.message}`);
    }
  } else {
    const list = tenantRoutes(tenantId).map((r) =>
      r.id === routeId
        ? {
            ...r,
            name: (patch.name as string) ?? r.name,
            area: (patch.area as string) ?? r.area,
            communities:
              patch.communities !== undefined
                ? (patch.communities as string[])
                : (r.communities ?? []),
            branch_id: (patch.branch_id as string) ?? r.branch_id,
            assigned_field_agent_id:
              patch.assigned_field_agent_id !== undefined
                ? (patch.assigned_field_agent_id as string | null)
                : r.assigned_field_agent_id,
            status: (patch.status as string) ?? r.status
          }
        : r
    );
    setTenantRoutes(tenantId, list);
  }

  const { getTenantRouteSettings } = await import("./routeManagementService.js");
  const settings = await getTenantRouteSettings(tenantId);
  const shouldSyncByStrategy =
    payload.syncAgentToMembers !== undefined
      ? payload.syncAgentToMembers
      : settings.syncAgentOnRouteChange;

  const syncAgent =
    shouldSyncByStrategy &&
    payload.assignedFieldAgentId !== undefined &&
    payload.assignedFieldAgentId !== null;
  if (syncAgent) {
    await syncRouteAgentToMembers(
      tenantId,
      {
        id: routeId,
        name: (patch.name as string) ?? String((existing as Record<string, unknown>).name ?? "Route"),
        branchId:
          (patch.branch_id as string) ?? String((existing as Record<string, unknown>).branch_id ?? "")
      },
      payload.assignedFieldAgentId ?? null,
      actorUserId
    );
  }

  const updated = await getFieldRoute(tenantId, routeId);
  if (!updated) {
    throw new Error("Route not found after update");
  }
  return updated;
}

export async function deleteFieldRoute(
  tenantId: string,
  routeId: string,
  actorUserId?: string
): Promise<void> {
  const supabase = getSupabaseAdminClient();
  const route = await getFieldRoute(tenantId, routeId);
  const { recordCustomerAssignmentHistory } = await import("./routeManagementService.js");

  if (supabase) {
    const { data: affected } = await supabase
      .from("customers")
      .select("id, home_branch_id, assigned_field_agent_id")
      .eq("tenant_id", tenantId)
      .eq("route_id", routeId);

    await supabase
      .from("customers")
      .update({ route_id: null })
      .eq("tenant_id", tenantId)
      .eq("route_id", routeId);

    const { error } = await supabase
      .from("field_routes")
      .delete()
      .eq("tenant_id", tenantId)
      .eq("id", routeId);
    if (error) {
      throw new Error(`Failed to delete route: ${error.message}`);
    }

    if (affected && affected.length > 0) {
      await recordCustomerAssignmentHistory(
        affected.map((m) => ({
          tenantId,
          customerId: String(m.id),
          branchId: String(m.home_branch_id ?? route?.branchId ?? ""),
          previousRouteId: routeId,
          previousRouteName: route?.name ?? null,
          newRouteId: null,
          newRouteName: null,
          previousFieldAgentId: m.assigned_field_agent_id ? String(m.assigned_field_agent_id) : null,
          newFieldAgentId: m.assigned_field_agent_id ? String(m.assigned_field_agent_id) : null,
          changedByUserId: actorUserId ?? "system",
          changeSource: "route_deleted" as const,
          reason: `Route "${route?.name ?? routeId}" deleted`
        }))
      ).catch(() => undefined);
    }
    return;
  }

  const { listCustomers, setCustomerAssignmentDirect } = await import("./customerService.js");
  const affected = (await listCustomers(tenantId)).filter((c) => c.routeId === routeId);
  for (const member of affected) {
    await setCustomerAssignmentDirect(tenantId, member.id, member.assignedFieldAgentId ?? null, null);
  }
  setTenantRoutes(
    tenantId,
    tenantRoutes(tenantId).filter((r) => r.id !== routeId)
  );
  if (affected.length > 0) {
    await recordCustomerAssignmentHistory(
      affected.map((m) => ({
        tenantId,
        customerId: m.id,
        branchId: m.homeBranchId,
        previousRouteId: routeId,
        previousRouteName: route?.name ?? null,
        newRouteId: null,
        newRouteName: null,
        previousFieldAgentId: m.assignedFieldAgentId ?? null,
        newFieldAgentId: m.assignedFieldAgentId ?? null,
        changedByUserId: actorUserId ?? "system",
        changeSource: "route_deleted" as const,
        reason: `Route "${route?.name ?? routeId}" deleted`
      }))
    );
  }
}

export async function listRouteMembers(tenantId: string, routeId: string): Promise<RouteMember[]> {
  const supabase = getSupabaseAdminClient();
  if (!supabase) {
    const { listCustomers } = await import("./customerService.js");
    return (await listCustomers(tenantId))
      .filter((c) => c.routeId === routeId)
      .map((c) => ({
        id: c.id,
        fullName: c.fullName,
        phone: c.phone,
        accountNumber: c.accountNumber,
        status: c.status,
        assignedFieldAgentId: c.assignedFieldAgentId
      }));
  }

  const { data, error } = await supabase
    .from("customers")
    .select("id, full_name, phone, account_number, status, assigned_field_agent_id")
    .eq("tenant_id", tenantId)
    .eq("route_id", routeId)
    .order("full_name", { ascending: true });

  if (error) {
    throw new Error(`Failed to list route members: ${error.message}`);
  }

  return (data ?? []).map((row) => ({
    id: String(row.id),
    fullName: String(row.full_name),
    phone: String(row.phone),
    accountNumber: row.account_number ? String(row.account_number) : undefined,
    status: String(row.status),
    assignedFieldAgentId: row.assigned_field_agent_id
      ? String(row.assigned_field_agent_id)
      : undefined
  }));
}

export async function setRouteMembers(
  tenantId: string,
  routeId: string,
  input: unknown,
  actorUserId?: string
): Promise<{ memberCount: number }> {
  const payload = setRouteMembersSchema.parse(input);
  const route = await getFieldRoute(tenantId, routeId);
  if (!route) {
    throw new Error("Route not found");
  }

  const { getTenantRouteSettings, recordCustomerAssignmentHistory } = await import(
    "./routeManagementService.js"
  );
  const settings = await getTenantRouteSettings(tenantId);
  const syncAgent = settings.syncAgentOnRouteChange && Boolean(route.assignedFieldAgentId);
  const nextIdSet = new Set(payload.customerIds);
  const supabase = getSupabaseAdminClient();

  if (!supabase) {
    const { listCustomers, setCustomerAssignmentDirect } = await import("./customerService.js");
    const allCustomers = await listCustomers(tenantId);
    const history: Parameters<typeof recordCustomerAssignmentHistory>[0] = [];

    for (const c of allCustomers) {
      if (c.routeId === routeId && !nextIdSet.has(c.id)) {
        await setCustomerAssignmentDirect(tenantId, c.id, c.assignedFieldAgentId ?? null, null);
        history.push({
          tenantId,
          customerId: c.id,
          branchId: c.homeBranchId,
          previousRouteId: routeId,
          previousRouteName: route.name,
          newRouteId: null,
          newRouteName: null,
          previousFieldAgentId: c.assignedFieldAgentId ?? null,
          newFieldAgentId: c.assignedFieldAgentId ?? null,
          changedByUserId: actorUserId ?? "system",
          changeSource: "route_members",
          reason: payload.reason ?? `Removed from route "${route.name}"`
        });
      } else if (nextIdSet.has(c.id) && c.homeBranchId === route.branchId) {
        const nextAgentId = syncAgent
          ? (route.assignedFieldAgentId ?? null)
          : (c.assignedFieldAgentId ?? null);
        if ((c.routeId ?? null) !== routeId || (c.assignedFieldAgentId ?? null) !== nextAgentId) {
          await setCustomerAssignmentDirect(tenantId, c.id, nextAgentId, routeId);
          history.push({
            tenantId,
            customerId: c.id,
            branchId: c.homeBranchId,
            previousRouteId: c.routeId ?? null,
            newRouteId: routeId,
            newRouteName: route.name,
            previousFieldAgentId: c.assignedFieldAgentId ?? null,
            newFieldAgentId: nextAgentId,
            changedByUserId: actorUserId ?? "system",
            changeSource: "route_members",
            reason: payload.reason ?? `Added to route "${route.name}"`
          });
        }
      }
    }
    await recordCustomerAssignmentHistory(history);
    return { memberCount: payload.customerIds.length };
  }

  const { data: priorRows } = await supabase
    .from("customers")
    .select("id, home_branch_id, route_id, assigned_field_agent_id")
    .eq("tenant_id", tenantId)
    .eq("route_id", routeId);

  const { data: incomingRows } =
    payload.customerIds.length > 0
      ? await supabase
          .from("customers")
          .select("id, home_branch_id, route_id, assigned_field_agent_id")
          .eq("tenant_id", tenantId)
          .in("id", payload.customerIds)
          .eq("home_branch_id", route.branchId)
      : { data: [] as Record<string, unknown>[] };

  const { error: clearError } = await supabase
    .from("customers")
    .update({ route_id: null })
    .eq("tenant_id", tenantId)
    .eq("route_id", routeId);
  if (clearError) {
    throw new Error(`Failed to clear route members: ${clearError.message}`);
  }

  if (payload.customerIds.length > 0) {
    const update: Record<string, unknown> = { route_id: routeId };
    if (syncAgent && route.assignedFieldAgentId) {
      update.assigned_field_agent_id = route.assignedFieldAgentId;
    }

    const { error: assignError } = await supabase
      .from("customers")
      .update(update)
      .eq("tenant_id", tenantId)
      .in("id", payload.customerIds)
      .eq("home_branch_id", route.branchId);

    if (assignError) {
      throw new Error(`Failed to assign route members: ${assignError.message}`);
    }
  }

  const history: Parameters<typeof recordCustomerAssignmentHistory>[0] = [];
  for (const row of priorRows ?? []) {
    const id = String(row.id);
    if (!nextIdSet.has(id)) {
      const prevAgent = row.assigned_field_agent_id ? String(row.assigned_field_agent_id) : null;
      history.push({
        tenantId,
        customerId: id,
        branchId: String(row.home_branch_id ?? route.branchId),
        previousRouteId: routeId,
        previousRouteName: route.name,
        newRouteId: null,
        newRouteName: null,
        previousFieldAgentId: prevAgent,
        newFieldAgentId: prevAgent,
        changedByUserId: actorUserId ?? "system",
        changeSource: "route_members",
        reason: payload.reason ?? `Removed from route "${route.name}"`
      });
    }
  }
  for (const row of incomingRows ?? []) {
    const id = String(row.id);
    const prevRoute = row.route_id ? String(row.route_id) : null;
    const prevAgent = row.assigned_field_agent_id ? String(row.assigned_field_agent_id) : null;
    const nextAgent = syncAgent ? (route.assignedFieldAgentId ?? null) : prevAgent;
    if (prevRoute !== routeId || prevAgent !== nextAgent) {
      history.push({
        tenantId,
        customerId: id,
        branchId: String(row.home_branch_id ?? route.branchId),
        previousRouteId: prevRoute,
        newRouteId: routeId,
        newRouteName: route.name,
        previousFieldAgentId: prevAgent,
        newFieldAgentId: nextAgent,
        changedByUserId: actorUserId ?? "system",
        changeSource: "route_members",
        reason: payload.reason ?? `Added to route "${route.name}"`
      });
    }
  }
  if (history.length > 0) {
    await recordCustomerAssignmentHistory(history).catch(() => undefined);
  }

  return { memberCount: payload.customerIds.length };
}
