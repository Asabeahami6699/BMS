import {
  buildSusuNavVisibilityConfig,
  NAV_MATRIX_ASSIGNABLE_ROLES,
  permissionSchema,
  roleSchema,
  SUSU_NAV_VISIBILITY,
  toSusuNavVisibilityRows,
  validateSusuNavVisibilityItems,
  type Permission,
  type Role,
  type SusuNavVisibilityConfigItem,
  type SusuNavVisibilityRow
} from "@bms/shared";
import { z } from "zod";
import { getSupabaseAdminClient } from "../config/supabaseClient.js";

const memoryOverrides = new Map<string, Map<string, { roles: Role[]; anyPermissions: Permission[] }>>();

function tenantMapKey(tenantId: string): Map<string, { roles: Role[]; anyPermissions: Permission[] }> {
  let map = memoryOverrides.get(tenantId);
  if (!map) {
    map = new Map();
    memoryOverrides.set(tenantId, map);
  }
  return map;
}

async function loadOverrideMap(
  tenantId: string
): Promise<Record<string, { roles: Role[]; anyPermissions: Permission[] }>> {
  const supabase = getSupabaseAdminClient();
  const result: Record<string, { roles: Role[]; anyPermissions: Permission[] }> = {};

  if (supabase) {
    const { data, error } = await supabase
      .from("tenant_susu_nav_overrides")
      .select("nav_path, roles, any_permissions")
      .eq("tenant_id", tenantId);

    if (error) {
      throw new Error(`Failed to load Susu nav config: ${error.message}`);
    }

    for (const row of data ?? []) {
      const rolesParsed = z.array(roleSchema).safeParse(row.roles ?? []);
      const permsParsed = z.array(permissionSchema).safeParse(row.any_permissions ?? []);
      if (!rolesParsed.success || !permsParsed.success) {
        continue;
      }
      result[String(row.nav_path)] = {
        roles: rolesParsed.data.filter((r) => NAV_MATRIX_ASSIGNABLE_ROLES.includes(r)),
        anyPermissions: permsParsed.data
      };
    }
    return result;
  }

  const map = memoryOverrides.get(tenantId);
  if (!map) {
    return result;
  }
  for (const [navPath, value] of map.entries()) {
    result[navPath] = value;
  }
  return result;
}

export async function listSusuNavVisibilityConfig(
  tenantId: string
): Promise<SusuNavVisibilityConfigItem[]> {
  const overrides = await loadOverrideMap(tenantId);
  return buildSusuNavVisibilityConfig(overrides);
}

export async function resolveEffectiveSusuNavVisibility(
  tenantId: string
): Promise<SusuNavVisibilityRow[]> {
  const config = await listSusuNavVisibilityConfig(tenantId);
  return toSusuNavVisibilityRows(config);
}

const saveItemSchema = z.object({
  navPath: z.string().min(1),
  roles: z.array(roleSchema),
  anyPermissions: z.array(permissionSchema)
});

const saveAllSchema = z.object({
  items: z.array(saveItemSchema)
});

export async function saveSusuNavVisibility(
  tenantId: string,
  input: unknown,
  updatedBy: string
): Promise<SusuNavVisibilityConfigItem[]> {
  const parsed = saveAllSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error("Invalid Susu nav visibility payload");
  }

  const known = new Set(SUSU_NAV_VISIBILITY.map((r) => r.navPath));
  const items = parsed.data.items.filter((item) => known.has(item.navPath));
  const validation = validateSusuNavVisibilityItems(items);
  if (validation.errors.length > 0) {
    throw new Error(validation.errors[0]);
  }

  function arraysEqual<T extends string>(a: T[], b: T[]): boolean {
    if (a.length !== b.length) {
      return false;
    }
    const sortedA = [...a].sort();
    const sortedB = [...b].sort();
    return sortedA.every((val, idx) => val === sortedB[idx]);
  }

  const customized = items.filter((item) => {
    const def = SUSU_NAV_VISIBILITY.find((r) => r.navPath === item.navPath);
    if (!def) {
      return false;
    }
    return (
      !arraysEqual(def.roles, item.roles) ||
      !arraysEqual(def.anyPermissions, item.anyPermissions)
    );
  });

  const supabase = getSupabaseAdminClient();
  if (supabase) {
    const { error: deleteError } = await supabase
      .from("tenant_susu_nav_overrides")
      .delete()
      .eq("tenant_id", tenantId);

    if (deleteError) {
      throw new Error(`Failed to reset Susu nav config: ${deleteError.message}`);
    }

    if (customized.length > 0) {
      const { error: insertError } = await supabase.from("tenant_susu_nav_overrides").insert(
        customized.map((item) => ({
          tenant_id: tenantId,
          nav_path: item.navPath,
          roles: item.roles.filter((r) => NAV_MATRIX_ASSIGNABLE_ROLES.includes(r)),
          any_permissions: item.anyPermissions,
          updated_by: updatedBy,
          updated_at: new Date().toISOString()
        }))
      );

      if (insertError) {
        throw new Error(`Failed to save Susu nav config: ${insertError.message}`);
      }
    }
  } else {
    const map = tenantMapKey(tenantId);
    map.clear();
    for (const item of customized) {
      map.set(item.navPath, {
        roles: item.roles.filter((r) => NAV_MATRIX_ASSIGNABLE_ROLES.includes(r)),
        anyPermissions: item.anyPermissions
      });
    }
  }

  return listSusuNavVisibilityConfig(tenantId);
}

export async function resetSusuNavVisibility(tenantId: string): Promise<SusuNavVisibilityConfigItem[]> {
  const supabase = getSupabaseAdminClient();
  if (supabase) {
    const { error } = await supabase
      .from("tenant_susu_nav_overrides")
      .delete()
      .eq("tenant_id", tenantId);

    if (error) {
      throw new Error(`Failed to reset Susu nav config: ${error.message}`);
    }
  } else {
    memoryOverrides.delete(tenantId);
  }

  return listSusuNavVisibilityConfig(tenantId);
}
