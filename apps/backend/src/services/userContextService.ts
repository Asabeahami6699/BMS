import { roleSchema, scopeTypeSchema, type Permission } from "@bms/shared";
import { z } from "zod";
import { resolvePermissionsForTenantUser } from "./builtinRolePermissionService.js";
import { getSupabaseAdminClient } from "../config/supabaseClient.js";
import { getTenantFromStore } from "./authStore.js";
import { loadTenantAddons } from "./tenantAddonService.js";
import { loadTenantModules } from "./tenantModuleService.js";

const headerFallbackSchema = z.object({
  userId: z.string().min(1).default("demo-user"),
  tenantId: z.string().min(1).default("tenant-demo"),
  role: roleSchema.default("admin"),
  scopeType: scopeTypeSchema.default("head_office"),
  branchId: z.string().optional()
});

export type ResolvedUserContext = {
  userId: string;
  tenantId: string;
  role: z.infer<typeof roleSchema>;
  scopeType: z.infer<typeof scopeTypeSchema>;
  branchId?: string;
  permissions: Permission[];
  subscribedModules?: import("@bms/shared").TenantProductModule[];
  subscribedAddons?: import("@bms/shared").TenantAddon[];
  reportsAnalytics?: boolean;
};

export async function resolveUserContextFromHeaders(headers: {
  userId?: string;
  tenantId?: string;
  role?: string;
  scopeType?: string;
  branchId?: string;
}): Promise<ResolvedUserContext> {
  const fallbackParsed = headerFallbackSchema.safeParse({
    userId: headers.userId,
    tenantId: headers.tenantId,
    role: headers.role,
    scopeType: headers.scopeType,
    branchId: headers.branchId
  });

  if (!fallbackParsed.success) {
    throw new Error("Invalid auth headers");
  }

  const fallback = fallbackParsed.data;
  const tenant = getTenantFromStore(fallback.tenantId);
  const modules = tenant?.subscribedModules ?? (await loadTenantModules(fallback.tenantId));
  const addons = tenant?.subscribedAddons ?? (await loadTenantAddons(fallback.tenantId));
  const supabase = getSupabaseAdminClient();
  const resolvePerms = (tenantId: string, role: z.infer<typeof roleSchema>) =>
    resolvePermissionsForTenantUser(tenantId, role);

  if (!supabase) {
    return {
      userId: fallback.userId,
      tenantId: fallback.tenantId,
      role: fallback.role,
      scopeType: fallback.scopeType,
      branchId: fallback.branchId,
      permissions: await resolvePerms(fallback.tenantId, fallback.role),
      subscribedModules: modules,
      subscribedAddons: addons,
      reportsAnalytics: tenant?.subscriptionStatus !== "inactive"
    };
  }

  const { data, error } = await supabase
    .from("users")
    .select("id, tenant_id, role, scope_type, branch_id")
    .eq("id", fallback.userId)
    .eq("tenant_id", fallback.tenantId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to resolve user context: ${error.message}`);
  }

  if (!data) {
    return {
      userId: fallback.userId,
      tenantId: fallback.tenantId,
      role: fallback.role,
      scopeType: fallback.scopeType,
      branchId: fallback.branchId,
      permissions: await resolvePerms(fallback.tenantId, fallback.role),
      subscribedModules: modules,
      subscribedAddons: addons,
      reportsAnalytics: tenant?.subscriptionStatus !== "inactive"
    };
  }

  const roleParsed = roleSchema.safeParse(data.role);
  const scopeParsed = scopeTypeSchema.safeParse(data.scope_type);

  if (!roleParsed.success || !scopeParsed.success) {
    throw new Error("User role/scope in database is invalid");
  }

  return {
    userId: data.id,
    tenantId: data.tenant_id,
    role: roleParsed.data,
    scopeType: scopeParsed.data,
    branchId: data.branch_id ?? undefined,
    permissions: await resolvePerms(data.tenant_id, roleParsed.data),
    subscribedModules: modules,
    subscribedAddons: addons,
    reportsAnalytics: tenant?.subscriptionStatus !== "inactive"
  };
}
