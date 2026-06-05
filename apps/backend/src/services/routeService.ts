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

function tenantRoutes(tenantId: string): RouteRow[] {
  return routeStore.get(tenantId) ?? [];
}

function setTenantRoutes(tenantId: string, rows: RouteRow[]): void {
  routeStore.set(tenantId, rows);
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
  return 0;
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

export async function getFieldRoute(tenantId: string, routeId: string): Promise<FieldRoute | undefined> {
  const routes = await listFieldRoutes(tenantId);
  return routes.find((r) => r.id === routeId);
}

export async function createFieldRoute(tenantId: string, input: unknown): Promise<FieldRoute> {
  const payload = createFieldRouteSchema.parse(input);
  const id = randomUUID();
  const createdAt = new Date().toISOString();
  const agentId = payload.assignedFieldAgentId?.trim() || null;

  const row: RouteRow = {
    id,
    tenant_id: tenantId,
    name: payload.name.trim(),
    area: payload.area.trim(),
    branch_id: payload.branchId,
    assigned_field_agent_id: agentId,
    status: payload.status,
    created_at: createdAt
  };

  const supabase = getSupabaseAdminClient();
  if (supabase) {
    const { error } = await supabase.from("field_routes").insert({
      id: row.id,
      tenant_id: row.tenant_id,
      name: row.name,
      area: row.area,
      branch_id: row.branch_id,
      assigned_field_agent_id: row.assigned_field_agent_id,
      status: row.status
    });
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
  routeId: string,
  fieldAgentId: string | null
): Promise<void> {
  if (!fieldAgentId) {
    return;
  }
  const supabase = getSupabaseAdminClient();
  if (!supabase) {
    return;
  }
  const { error } = await supabase
    .from("customers")
    .update({ assigned_field_agent_id: fieldAgentId })
    .eq("tenant_id", tenantId)
    .eq("route_id", routeId);
  if (error) {
    throw new Error(`Failed to sync agent to route members: ${error.message}`);
  }
}

export async function updateFieldRoute(
  tenantId: string,
  routeId: string,
  input: unknown
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
    const { error } = await supabase
      .from("field_routes")
      .update(patch)
      .eq("tenant_id", tenantId)
      .eq("id", routeId);
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

  const syncAgent =
    payload.syncAgentToMembers !== false &&
    payload.assignedFieldAgentId !== undefined &&
    payload.assignedFieldAgentId !== null;
  if (syncAgent) {
    await syncRouteAgentToMembers(tenantId, routeId, payload.assignedFieldAgentId ?? null);
  }

  const updated = await getFieldRoute(tenantId, routeId);
  if (!updated) {
    throw new Error("Route not found after update");
  }
  return updated;
}

export async function deleteFieldRoute(tenantId: string, routeId: string): Promise<void> {
  const supabase = getSupabaseAdminClient();
  if (supabase) {
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
    return;
  }

  setTenantRoutes(
    tenantId,
    tenantRoutes(tenantId).filter((r) => r.id !== routeId)
  );
}

export async function listRouteMembers(tenantId: string, routeId: string): Promise<RouteMember[]> {
  const supabase = getSupabaseAdminClient();
  if (!supabase) {
    return [];
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
  input: unknown
): Promise<{ memberCount: number }> {
  const payload = setRouteMembersSchema.parse(input);
  const route = await getFieldRoute(tenantId, routeId);
  if (!route) {
    throw new Error("Route not found");
  }

  const supabase = getSupabaseAdminClient();
  if (!supabase) {
    return { memberCount: payload.customerIds.length };
  }

  const { error: clearError } = await supabase
    .from("customers")
    .update({ route_id: null })
    .eq("tenant_id", tenantId)
    .eq("route_id", routeId);
  if (clearError) {
    throw new Error(`Failed to clear route members: ${clearError.message}`);
  }

  if (payload.customerIds.length === 0) {
    return { memberCount: 0 };
  }

  const update: Record<string, unknown> = { route_id: routeId };
  if (route.assignedFieldAgentId) {
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

  return { memberCount: payload.customerIds.length };
}
