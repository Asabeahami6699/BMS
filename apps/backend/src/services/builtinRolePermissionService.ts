import {
  getPermissionsForRole,
  isBuiltinRole,
  isTenantCustomizableBuiltinRole,
  PERMISSION_CATALOG,
  PERMISSION_GROUP_PRODUCT,
  permissionSchema,
  resolveRolePermissions,
  sanitizeFieldAgentDuties,
  type Permission,
  type Role,
  TENANT_EDITABLE_BUILTIN_ROLES,
  type TenantCustomizableBuiltinRole,
  type TenantProductModule
} from "@bms/shared";
import { z } from "zod";
import { getSupabaseAdminClient } from "../config/supabaseClient.js";
import { loadTenantJobTitleDuties } from "./tenantJobTitleService.js";

const CUSTOMIZABLE_BUILTIN_ROLES: readonly TenantCustomizableBuiltinRole[] = [
  ...TENANT_EDITABLE_BUILTIN_ROLES,
  "field_agent"
];

export type BuiltinRolePermissionView = {
  role: TenantCustomizableBuiltinRole;
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
  // Heal customized builtin overrides with newly added default duties (e.g. income.read)
  // whenever the user authenticates — otherwise Susu income / cycle fees stay hidden.
  try {
    const { loadTenantModules } = await import("./tenantModuleService.js");
    const modules = await loadTenantModules(tenantId);
    if (modules.length > 0) {
      await syncBuiltinRolePermissionsForModules(tenantId, modules);
    }
  } catch {
    /* permission resolve must not fail login */
  }

  const [base, custom] = await Promise.all([
    isBuiltinRole(role)
      ? loadOverrideRow(tenantId, role).then((row) => resolveRolePermissions(role, row?.duties ?? null))
      : loadTenantJobTitleDuties(tenantId, role),
    userId ? loadCustomRoleDuties(tenantId, userId) : Promise.resolve([] as Permission[])
  ]);

  if (!custom.length) {
    return base;
  }
  return [...new Set([...base, ...custom])];
}

function permissionsForProductModule(module: TenantProductModule): Permission[] {
  return PERMISSION_CATALOG.filter((entry) => PERMISSION_GROUP_PRODUCT[entry.group] === module).map(
    (entry) => entry.id
  );
}

/** When a product is subscribed, merge its default duties into customized builtin roles. */
export async function syncBuiltinRolePermissionsForModules(
  tenantId: string,
  modules: TenantProductModule[]
): Promise<void> {
  const modulePermissions = new Set<Permission>();
  for (const module of modules) {
    for (const permission of permissionsForProductModule(module)) {
      modulePermissions.add(permission);
    }
  }
  if (modulePermissions.size === 0) {
    return;
  }

  const overrides = await loadBuiltinRoleOverrides(tenantId);
  await syncLoadedRoleOverrides(tenantId, modules, overrides);
}

/** Role rows, extra duties, and custom job-title duties, loaded together. */
export async function loadTenantPermissionInputs(
  tenantId: string,
  role: string,
  userId?: string
): Promise<TenantPermissionInputs> {
  const [overrides, custom, jobDuties] = await Promise.all([
    loadBuiltinRoleOverrides(tenantId),
    userId ? loadCustomRoleDuties(tenantId, userId) : Promise.resolve([] as Permission[]),
    isBuiltinRole(role) ? Promise.resolve(null) : loadTenantJobTitleDuties(tenantId, role)
  ]);
  return { overrides, custom, jobDuties };
}

export async function permissionsForLoadedInputs(
  tenantId: string,
  role: string,
  modules: TenantProductModule[],
  inputs: TenantPermissionInputs
): Promise<Permission[]> {
  await syncLoadedRoleOverrides(tenantId, modules, inputs.overrides);
  const base = isBuiltinRole(role)
    ? resolveRolePermissions(role, inputs.overrides.get(role)?.duties ?? null)
    : (inputs.jobDuties ?? []);
  if (!inputs.custom.length) {
    return base;
  }
  return [...new Set([...base, ...inputs.custom])];
}

type TenantPermissionInputs = {
  overrides: Map<Role, { duties: Permission[] }>;
  custom: Permission[];
  jobDuties: Permission[] | null;
};

async function syncLoadedRoleOverrides(
  tenantId: string,
  modules: TenantProductModule[],
  overrides: Map<Role, { duties: Permission[] }>
): Promise<void> {
  const eligiblePermissions = new Set<Permission>();
  for (const module of modules) {
    for (const permission of permissionsForProductModule(module)) {
      eligiblePermissions.add(permission);
    }
  }
  // Core duties (e.g. income.read) are not product-scoped, so module sync alone
  // never backfilled them into saved role overrides — Susu income stayed hidden.
  if (modules.length > 0) {
    for (const entry of PERMISSION_CATALOG) {
      if (PERMISSION_GROUP_PRODUCT[entry.group] === "core") {
        eligiblePermissions.add(entry.id);
      }
    }
  }
  if (eligiblePermissions.size === 0) {
    return;
  }

  const writes: Array<Promise<unknown>> = [];
  for (const role of TENANT_EDITABLE_BUILTIN_ROLES) {
    const row = overrides.get(role);
    if (!row) {
      continue;
    }
    const defaults = getPermissionsForRole(role);
    const toAdd = [...eligiblePermissions].filter(
      (permission) => defaults.includes(permission) && !row.duties.includes(permission)
    );
    if (toAdd.length === 0) {
      continue;
    }
    row.duties = [...row.duties, ...toAdd];
    writes.push(
      saveBuiltinRolePermissions(tenantId, role, { duties: row.duties }, "system-module-sync")
    );
  }
  if (writes.length > 0) {
    await Promise.all(writes);
  }
}

async function loadBuiltinRoleOverrides(
  tenantId: string
): Promise<Map<Role, { duties: Permission[] }>> {
  const supabase = getSupabaseAdminClient();
  const overrides = new Map<Role, { duties: Permission[] }>();
  if (!supabase) {
    await Promise.all(
      CUSTOMIZABLE_BUILTIN_ROLES.map(async (role) => {
        const row = await loadOverrideRow(tenantId, role);
        if (row) {
          overrides.set(role, row);
        }
      })
    );
    return overrides;
  }

  const { data, error } = await supabase
    .from("tenant_builtin_role_overrides")
    .select("role, duties")
    .eq("tenant_id", tenantId)
    .in("role", [...CUSTOMIZABLE_BUILTIN_ROLES]);

  if (error) {
    throw new Error(`Failed to load role permissions: ${error.message}`);
  }

  for (const row of data ?? []) {
    if (!isTenantCustomizableBuiltinRole(row.role as Role)) {
      continue;
    }
    const parsed = z.array(permissionSchema).safeParse(row.duties ?? []);
    if (!parsed.success) {
      throw new Error("Stored duties for role are invalid");
    }
    overrides.set(row.role as Role, { duties: parsed.data });
  }
  return overrides;
}

export async function listBuiltinRolePermissions(
  tenantId: string
): Promise<BuiltinRolePermissionView[]> {
  const views: BuiltinRolePermissionView[] = [];

  for (const role of CUSTOMIZABLE_BUILTIN_ROLES) {
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
  if (!isTenantCustomizableBuiltinRole(role)) {
    throw new Error("This job title cannot be customized");
  }

  const parsed = saveSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error("Invalid duties payload");
  }

  const duties =
    role === "field_agent"
      ? sanitizeFieldAgentDuties(parsed.data.duties)
      : [...new Set(parsed.data.duties)];
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
      if (error?.message?.includes("tenant_builtin_role_overrides_role_check")) {
        throw new Error(
          "Database migration 107_field_agent_role_controls.sql must be applied before saving field agent controls."
        );
      }
      throw new Error(`Failed to save role permissions: ${error?.message ?? "no row returned"}`);
    }

    const dutiesParsed = z.array(permissionSchema).safeParse(data.duties ?? []);
    if (!dutiesParsed.success) {
      throw new Error("Saved permissions could not be read back from the database");
    }
    persisted =
      role === "field_agent"
        ? sanitizeFieldAgentDuties(dutiesParsed.data)
        : [...new Set(dutiesParsed.data)];
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
  if (!isTenantCustomizableBuiltinRole(role)) {
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
