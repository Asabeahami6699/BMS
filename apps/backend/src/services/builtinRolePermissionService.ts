import {
  getPermissionsForRole,
  isBuiltinRole,
  isTenantEditableBuiltinRole,
  permissionSchema,
  resolveRolePermissions,
  type Permission,
  type Role,
  TENANT_EDITABLE_BUILTIN_ROLES,
  type TenantEditableBuiltinRole
} from "@bms/shared";
import { z } from "zod";
import { getSupabaseAdminClient } from "../config/supabaseClient.js";
import { loadTenantJobTitleDuties } from "./tenantJobTitleService.js";

export type BuiltinRolePermissionView = {
  role: TenantEditableBuiltinRole;
  defaultDuties: Permission[];
  effectiveDuties: Permission[];
  isCustomized: boolean;
  updatedAt?: string;
  updatedBy?: string;
};

const memoryOverrides = new Map<string, Permission[]>();

function memoryKey(tenantId: string, role: Role): string {
  return `${tenantId}:${role}`;
}

async function loadOverrideRow(
  tenantId: string,
  role: Role
): Promise<{ duties: Permission[]; updatedAt?: string; updatedBy?: string } | null> {
  const supabase = getSupabaseAdminClient();
  if (supabase) {
    const { data, error } = await supabase
      .from("tenant_builtin_role_overrides")
      .select("duties, updated_at, updated_by")
      .eq("tenant_id", tenantId)
      .eq("role", role)
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to load role permissions: ${error.message}`);
    }
    if (!data) {
      return null;
    }

    const parsed = z.array(permissionSchema).safeParse(data.duties ?? []);
    if (!parsed.success) {
      throw new Error("Stored duties for role are invalid");
    }

    return {
      duties: parsed.data,
      updatedAt: data.updated_at ?? undefined,
      updatedBy: data.updated_by ?? undefined
    };
  }

  const duties = memoryOverrides.get(memoryKey(tenantId, role));
  if (!duties) {
    return null;
  }
  return { duties };
}

async function loadCustomRoleDuties(tenantId: string, userId: string): Promise<Permission[]> {
  const supabase = getSupabaseAdminClient();
  if (!supabase) {
    return [];
  }

  const { data: assignments, error: assignError } = await supabase
    .from("user_role_assignments")
    .select("role_key")
    .eq("tenant_id", tenantId)
    .eq("user_id", userId);

  if (assignError) {
    throw new Error(`Failed to load custom role assignments: ${assignError.message}`);
  }

  const roleKeys = (assignments ?? []).map((row) => row.role_key).filter(Boolean);
  if (!roleKeys.length) {
    return [];
  }

  const { data: roles, error: rolesError } = await supabase
    .from("tenant_roles")
    .select("duties")
    .eq("tenant_id", tenantId)
    .eq("role_kind", "extra_duties")
    .in("role_key", roleKeys);

  if (rolesError) {
    throw new Error(`Failed to load custom role duties: ${rolesError.message}`);
  }

  const merged: Permission[] = [];
  for (const row of roles ?? []) {
    const parsed = z.array(permissionSchema).safeParse(row.duties ?? []);
    if (parsed.success) {
      merged.push(...parsed.data);
    }
  }
  return [...new Set(merged)];
}

export async function resolvePermissionsForTenantUser(
  tenantId: string,
  role: string,
  userId?: string
): Promise<Permission[]> {
  let base: Permission[];
  if (isBuiltinRole(role)) {
    const row = await loadOverrideRow(tenantId, role);
    base = resolveRolePermissions(role, row?.duties ?? null);
  } else {
    base = await loadTenantJobTitleDuties(tenantId, role);
  }

  if (!userId) {
    return base;
  }
  const custom = await loadCustomRoleDuties(tenantId, userId);
  if (!custom.length) {
    return base;
  }
  return [...new Set([...base, ...custom])];
}

export async function listBuiltinRolePermissions(
  tenantId: string
): Promise<BuiltinRolePermissionView[]> {
  const views: BuiltinRolePermissionView[] = [];

  for (const role of TENANT_EDITABLE_BUILTIN_ROLES) {
    const row = await loadOverrideRow(tenantId, role);
    const effectiveDuties = resolveRolePermissions(role, row?.duties ?? null);
    views.push({
      role,
      defaultDuties: getPermissionsForRole(role),
      effectiveDuties,
      isCustomized: row != null,
      updatedAt: row?.updatedAt,
      updatedBy: row?.updatedBy
    });
  }

  return views;
}

const saveSchema = z.object({
  duties: z.array(permissionSchema).min(0)
});

export async function saveBuiltinRolePermissions(
  tenantId: string,
  role: Role,
  input: unknown,
  updatedBy: string
): Promise<BuiltinRolePermissionView> {
  if (!isTenantEditableBuiltinRole(role)) {
    throw new Error("This job title cannot be customized");
  }

  const parsed = saveSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error("Invalid duties payload");
  }

  const duties = [...new Set(parsed.data.duties)];
  const supabase = getSupabaseAdminClient();
  let persisted = duties;
  let updatedAt: string | undefined;
  let updatedByOut: string | undefined = updatedBy;

  if (supabase) {
    const { data, error } = await supabase
      .from("tenant_builtin_role_overrides")
      .upsert(
        {
          tenant_id: tenantId,
          role,
          duties,
          updated_by: updatedBy,
          updated_at: new Date().toISOString()
        },
        { onConflict: "tenant_id,role" }
      )
      .select("duties, updated_at, updated_by")
      .single();

    if (error || !data) {
      throw new Error(`Failed to save role permissions: ${error?.message ?? "no row returned"}`);
    }

    const dutiesParsed = z.array(permissionSchema).safeParse(data.duties ?? []);
    if (!dutiesParsed.success) {
      throw new Error("Saved permissions could not be read back from the database");
    }
    persisted = [...new Set(dutiesParsed.data)];
    updatedAt = data.updated_at ?? undefined;
    updatedByOut = data.updated_by ?? updatedBy;
  } else {
    memoryOverrides.set(memoryKey(tenantId, role), duties);
  }

  return {
    role,
    defaultDuties: getPermissionsForRole(role),
    effectiveDuties: persisted,
    isCustomized: true,
    updatedAt,
    updatedBy: updatedByOut
  };
}

export async function resetBuiltinRolePermissions(
  tenantId: string,
  role: Role
): Promise<BuiltinRolePermissionView> {
  if (!isTenantEditableBuiltinRole(role)) {
    throw new Error("This job title cannot be customized");
  }

  const supabase = getSupabaseAdminClient();
  if (supabase) {
    const { error } = await supabase
      .from("tenant_builtin_role_overrides")
      .delete()
      .eq("tenant_id", tenantId)
      .eq("role", role);

    if (error) {
      throw new Error(`Failed to reset role permissions: ${error.message}`);
    }
  } else {
    memoryOverrides.delete(memoryKey(tenantId, role));
  }

  return {
    role,
    defaultDuties: getPermissionsForRole(role),
    effectiveDuties: getPermissionsForRole(role),
    isCustomized: false
  };
}
