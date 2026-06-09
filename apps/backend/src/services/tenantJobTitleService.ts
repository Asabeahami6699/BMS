import {
  customJobTitleKeySchema,
  customRoleProductScopeSchema,
  isBuiltinRole,
  permissionSchema,
  roleSchema,
  validateCustomRoleDuties,
  type CustomRoleProductScope,
  type Permission,
  type TenantProductModule,
  type UserJobTitle
} from "@bms/shared";
import { z } from "zod";
import { getSupabaseAdminClient } from "../config/supabaseClient.js";

export type TenantJobTitleView = {
  roleKey: string;
  displayName: string;
  productScope: CustomRoleProductScope;
  effectiveDuties: Permission[];
  updatedAt?: string;
};

const memoryJobTitles = new Map<string, TenantJobTitleView>();

function memoryJobTitleKey(tenantId: string, roleKey: string): string {
  return `${tenantId}:${roleKey}`;
}

async function loadTenantJobTitleRow(
  tenantId: string,
  roleKey: string
): Promise<{
  displayName: string;
  productScope: CustomRoleProductScope;
  duties: Permission[];
  updatedAt?: string;
} | null> {
  const supabase = getSupabaseAdminClient();
  if (supabase) {
    const { data, error } = await supabase
      .from("tenant_roles")
      .select("display_name, product_scope, duties, created_at")
      .eq("tenant_id", tenantId)
      .eq("role_key", roleKey)
      .eq("role_kind", "job_title")
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to load job title: ${error.message}`);
    }
    if (!data) {
      return null;
    }

    const parsed = z.array(permissionSchema).safeParse(data.duties ?? []);
    if (!parsed.success) {
      throw new Error("Stored duties for job title are invalid");
    }

    return {
      displayName: data.display_name,
      productScope: (data.product_scope ?? "all") as CustomRoleProductScope,
      duties: parsed.data,
      updatedAt: data.created_at ?? undefined
    };
  }

  const stored = memoryJobTitles.get(memoryJobTitleKey(tenantId, roleKey));
  if (!stored) {
    return null;
  }
  return {
    displayName: stored.displayName,
    productScope: stored.productScope,
    duties: stored.effectiveDuties,
    updatedAt: stored.updatedAt
  };
}

export async function tenantJobTitleExists(tenantId: string, roleKey: string): Promise<boolean> {
  if (isBuiltinRole(roleKey)) {
    return false;
  }
  const row = await loadTenantJobTitleRow(tenantId, roleKey);
  return row != null;
}

export async function assertValidUserJobTitle(tenantId: string, role: UserJobTitle): Promise<void> {
  if (isBuiltinRole(role)) {
    if (role === "super_admin") {
      throw new Error("Cannot assign super_admin to tenant users");
    }
    return;
  }

  const keyParsed = customJobTitleKeySchema.safeParse(role);
  if (!keyParsed.success) {
    throw new Error("Invalid job title");
  }

  const exists = await tenantJobTitleExists(tenantId, role);
  if (!exists) {
    throw new Error("Selected job title was not found for this company");
  }
}

export async function loadTenantJobTitleDuties(
  tenantId: string,
  roleKey: string
): Promise<Permission[]> {
  const row = await loadTenantJobTitleRow(tenantId, roleKey);
  return row?.duties ?? [];
}

export async function listTenantJobTitles(tenantId: string): Promise<TenantJobTitleView[]> {
  const supabase = getSupabaseAdminClient();
  if (supabase) {
    const { data, error } = await supabase
      .from("tenant_roles")
      .select("role_key, display_name, product_scope, duties, created_at")
      .eq("tenant_id", tenantId)
      .eq("role_kind", "job_title")
      .order("display_name", { ascending: true });

    if (error) {
      throw new Error(`Failed to list job titles: ${error.message}`);
    }

    return (data ?? []).map((row) => {
      const parsed = z.array(permissionSchema).safeParse(row.duties ?? []);
      return {
        roleKey: row.role_key,
        displayName: row.display_name,
        productScope: (row.product_scope ?? "all") as CustomRoleProductScope,
        effectiveDuties: parsed.success ? parsed.data : [],
        updatedAt: row.created_at ?? undefined
      };
    });
  }

  return [...memoryJobTitles.values()].filter((item) =>
    memoryJobTitleKey(tenantId, item.roleKey).startsWith(`${tenantId}:`)
  );
}

const createJobTitleSchema = z.object({
  roleKey: customJobTitleKeySchema,
  displayName: z.string().min(1),
  productScope: customRoleProductScopeSchema.default("all"),
  duties: z.array(permissionSchema).min(1)
});

export async function createTenantJobTitle(
  tenantId: string,
  input: unknown,
  createdBy: string,
  subscribedModules: TenantProductModule[] | undefined
): Promise<TenantJobTitleView> {
  const parsed = createJobTitleSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error("Invalid job title payload");
  }

  if (roleSchema.safeParse(parsed.data.roleKey).success) {
    throw new Error("This key is reserved for a system job title");
  }

  const dutyValidation = validateCustomRoleDuties(
    parsed.data.duties,
    parsed.data.productScope,
    subscribedModules
  );
  if (dutyValidation.errors.length > 0) {
    throw new Error(dutyValidation.errors[0]);
  }

  const duties = [...new Set(parsed.data.duties)];
  const supabase = getSupabaseAdminClient();

  if (supabase) {
    const { data: existing } = await supabase
      .from("tenant_roles")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("role_key", parsed.data.roleKey)
      .maybeSingle();
    if (existing) {
      throw new Error("A role with this key already exists");
    }

    const { data, error } = await supabase
      .from("tenant_roles")
      .insert({
        tenant_id: tenantId,
        role_key: parsed.data.roleKey,
        display_name: parsed.data.displayName,
        product_scope: parsed.data.productScope,
        duties,
        role_kind: "job_title",
        created_by: createdBy
      })
      .select("role_key, display_name, product_scope, duties, created_at")
      .single();

    if (error || !data) {
      throw new Error(`Failed to create job title: ${error?.message ?? "no row returned"}`);
    }

    const dutiesParsed = z.array(permissionSchema).safeParse(data.duties ?? []);
    return {
      roleKey: data.role_key,
      displayName: data.display_name,
      productScope: (data.product_scope ?? "all") as CustomRoleProductScope,
      effectiveDuties: dutiesParsed.success ? dutiesParsed.data : duties,
      updatedAt: data.created_at ?? undefined
    };
  }

  if (memoryJobTitles.has(memoryJobTitleKey(tenantId, parsed.data.roleKey))) {
    throw new Error("A role with this key already exists");
  }

  const view: TenantJobTitleView = {
    roleKey: parsed.data.roleKey,
    displayName: parsed.data.displayName,
    productScope: parsed.data.productScope,
    effectiveDuties: duties,
    updatedAt: new Date().toISOString()
  };
  memoryJobTitles.set(memoryJobTitleKey(tenantId, parsed.data.roleKey), view);
  void createdBy;
  return view;
}

const updateJobTitleSchema = z.object({
  displayName: z.string().min(1).optional(),
  productScope: customRoleProductScopeSchema.optional(),
  duties: z.array(permissionSchema).min(1).optional()
});

export async function updateTenantJobTitle(
  tenantId: string,
  roleKey: string,
  input: unknown,
  subscribedModules: TenantProductModule[] | undefined
): Promise<TenantJobTitleView> {
  const keyParsed = customJobTitleKeySchema.safeParse(roleKey);
  if (!keyParsed.success) {
    throw new Error("Invalid job title key");
  }

  const existing = await loadTenantJobTitleRow(tenantId, roleKey);
  if (!existing) {
    throw new Error("Job title not found");
  }

  const parsed = updateJobTitleSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error("Invalid job title update payload");
  }

  const nextScope = parsed.data.productScope ?? existing.productScope;
  const nextDuties = parsed.data.duties ? [...new Set(parsed.data.duties)] : existing.duties;
  const nextName = parsed.data.displayName ?? existing.displayName;

  const dutyValidation = validateCustomRoleDuties(nextDuties, nextScope, subscribedModules);
  if (dutyValidation.errors.length > 0) {
    throw new Error(dutyValidation.errors[0]);
  }

  const supabase = getSupabaseAdminClient();
  if (supabase) {
    const { data, error } = await supabase
      .from("tenant_roles")
      .update({
        display_name: nextName,
        product_scope: nextScope,
        duties: nextDuties
      })
      .eq("tenant_id", tenantId)
      .eq("role_key", roleKey)
      .eq("role_kind", "job_title")
      .select("role_key, display_name, product_scope, duties, created_at")
      .single();

    if (error || !data) {
      throw new Error(`Failed to update job title: ${error?.message ?? "no row returned"}`);
    }

    const dutiesParsed = z.array(permissionSchema).safeParse(data.duties ?? []);
    return {
      roleKey: data.role_key,
      displayName: data.display_name,
      productScope: (data.product_scope ?? "all") as CustomRoleProductScope,
      effectiveDuties: dutiesParsed.success ? dutiesParsed.data : nextDuties,
      updatedAt: data.created_at ?? undefined
    };
  }

  const view: TenantJobTitleView = {
    roleKey,
    displayName: nextName,
    productScope: nextScope,
    effectiveDuties: nextDuties,
    updatedAt: new Date().toISOString()
  };
  memoryJobTitles.set(memoryJobTitleKey(tenantId, roleKey), view);
  return view;
}

export async function deleteTenantJobTitle(tenantId: string, roleKey: string): Promise<void> {
  const keyParsed = customJobTitleKeySchema.safeParse(roleKey);
  if (!keyParsed.success) {
    throw new Error("Invalid job title key");
  }

  const supabase = getSupabaseAdminClient();
  if (supabase) {
    const { count, error: countError } = await supabase
      .from("users")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("role", roleKey);
    if (countError) {
      throw new Error(`Failed to check job title usage: ${countError.message}`);
    }
    if ((count ?? 0) > 0) {
      throw new Error("Cannot delete a job title that is assigned to users");
    }

    const { error } = await supabase
      .from("tenant_roles")
      .delete()
      .eq("tenant_id", tenantId)
      .eq("role_key", roleKey)
      .eq("role_kind", "job_title");
    if (error) {
      throw new Error(`Failed to delete job title: ${error.message}`);
    }
    return;
  }

  memoryJobTitles.delete(memoryJobTitleKey(tenantId, roleKey));
}

export function parseProfileJobTitle(role: string): UserJobTitle | null {
  if (isBuiltinRole(role)) {
    return role;
  }
  if (customJobTitleKeySchema.safeParse(role).success) {
    return role;
  }
  return null;
}
