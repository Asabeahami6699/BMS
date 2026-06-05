import type { TenantProductModule } from "@bms/shared";
import { getSupabaseAdminClient } from "../config/supabaseClient.js";
import { env, getSuperAdminCredentials, hasSupabaseConfig } from "../config/env.js";
import { hashPassword } from "./password.js";
import {
  findUserByEmail,
  saveAuthUser,
  upsertTenantInStore,
  type StoredAuthUser,
  type StoredTenant
} from "./authStore.js";
import { setTenantModulesInStore } from "./tenantModuleService.js";

const SUPER_ADMIN_ID = "user-super-admin";
const DEMO_ADMIN_ID = "user-demo-admin";
const DEMO_MODULES: TenantProductModule[] = ["banking", "susu_management"];

type SeedUser = {
  id: string;
  email: string;
  password: string;
  role: StoredAuthUser["role"];
  tenantId: string;
  scopeType: StoredAuthUser["scopeType"];
  fullName: string;
};

async function ensureTenantDefaultBranch(
  supabase: NonNullable<ReturnType<typeof getSupabaseAdminClient>>,
  tenantId: string,
  code: string,
  name: string
): Promise<void> {
  const { data: existing, error: listError } = await supabase
    .from("branches")
    .select("id")
    .eq("tenant_id", tenantId)
    .limit(1);
  if (listError) {
    throw new Error(`Failed to check branches for ${tenantId}: ${listError.message}`);
  }
  if (existing && existing.length > 0) {
    return;
  }

  const row: Record<string, unknown> = {
    tenant_id: tenantId,
    code,
    name,
    status: "active"
  };
  let { error } = await supabase.from("branches").insert(row);
  if (error?.message.includes("status")) {
    delete row.status;
    ({ error } = await supabase.from("branches").insert(row));
  }
  if (error) {
    throw new Error(`Failed to seed default branch for ${tenantId}: ${error.message}`);
  }
}

async function ensureAuthUser(
  supabase: NonNullable<ReturnType<typeof getSupabaseAdminClient>>,
  seed: SeedUser,
  options: { resetPassword?: boolean } = {}
): Promise<void> {
  const email = seed.email.toLowerCase();
  const resetPassword = options.resetPassword ?? false;

  let authUserId: string | undefined;
  let created = false;

  const { data: listData, error: listError } = await supabase.auth.admin.listUsers({
    page: 1,
    perPage: 1000
  });
  if (listError) {
    throw new Error(`Failed to list auth users: ${listError.message}`);
  }

  const existingAuth = listData.users.find((u) => u.email?.toLowerCase() === email);
  if (existingAuth) {
    authUserId = existingAuth.id;
  } else {
    const { data: createdUser, error: createError } = await supabase.auth.admin.createUser({
      email: seed.email,
      password: seed.password,
      email_confirm: true,
      user_metadata: { full_name: seed.fullName }
    });
    if (createError || !createdUser.user) {
      throw new Error(`Failed to create auth user ${seed.email}: ${createError?.message ?? "unknown"}`);
    }
    authUserId = createdUser.user.id;
    created = true;
  }

  if (resetPassword || created) {
    await supabase.auth.admin.updateUserById(authUserId, {
      password: seed.password,
      email_confirm: true,
      user_metadata: { full_name: seed.fullName }
    });
  }

  const { data: profileByEmail } = await supabase
    .from("users")
    .select("id, auth_user_id, email")
    .ilike("email", seed.email)
    .maybeSingle();

  const { data: profileById } = profileByEmail
    ? { data: null }
    : await supabase.from("users").select("id, auth_user_id, email").eq("id", seed.id).maybeSingle();

  const existingProfile = profileByEmail ?? profileById;

  if (existingProfile) {
    const { error: updateError } = await supabase
      .from("users")
      .update({
        tenant_id: seed.tenantId,
        role: seed.role,
        scope_type: seed.scopeType,
        full_name: seed.fullName,
        email: seed.email,
        auth_user_id: authUserId
      })
      .eq("id", existingProfile.id);
    if (updateError) {
      throw new Error(`Failed to update profile ${seed.email}: ${updateError.message}`);
    }
    return;
  }

  const { error: profileError } = await supabase.from("users").insert({
    id: seed.id,
    tenant_id: seed.tenantId,
    role: seed.role,
    scope_type: seed.scopeType,
    branch_id: null,
    email: seed.email,
    full_name: seed.fullName,
    auth_user_id: authUserId,
    created_by: "system-bootstrap"
  });

  if (profileError) {
    throw new Error(`Failed to create profile ${seed.email}: ${profileError.message}`);
  }
}

function syncLocalUser(seed: SeedUser): void {
  saveAuthUser({
    id: seed.id,
    email: seed.email,
    passwordHash: hashPassword(seed.password),
    role: seed.role,
    tenantId: seed.role === "super_admin" ? null : seed.tenantId,
    scopeType: seed.scopeType,
    fullName: seed.fullName
  });
}

export async function bootstrapSupabaseSeed(options: { resetPassword?: boolean } = {}): Promise<void> {
  if (!hasSupabaseConfig()) {
    console.info("[bootstrap] Supabase not configured — using in-memory demo users only");
    seedLocalOnly();
    return;
  }

  const supabase = getSupabaseAdminClient();
  if (!supabase) {
    seedLocalOnly();
    return;
  }

  const superAdmin = getSuperAdminCredentials();

  const seedTenants: StoredTenant[] = [
    {
      id: "platform",
      name: "BMS Platform",
      subscriptionStatus: "active",
      subscribedModules: [],
      createdAt: new Date().toISOString()
    }
  ];

  if (env.BOOTSTRAP_DEMO_ADMIN) {
    seedTenants.push({
      id: "tenant-demo",
      name: "Demo Cooperative",
      subscriptionStatus: "active",
      accountNumberPrefix: "233000",
      subscribedModules: DEMO_MODULES,
      createdAt: new Date().toISOString()
    });
  }

  for (const tenant of seedTenants) {
    const { error } = await supabase.from("tenants").upsert(
      {
        id: tenant.id,
        name: tenant.name,
        subscription_status: tenant.subscriptionStatus,
        account_number_prefix: tenant.accountNumberPrefix ?? null
      },
      { onConflict: "id" }
    );
    if (error) {
      throw new Error(`Failed to upsert tenant ${tenant.id}: ${error.message}`);
    }
    upsertTenantInStore(tenant);
  }

  const seedUsers: SeedUser[] = [
    {
      id: SUPER_ADMIN_ID,
      email: superAdmin.email,
      password: superAdmin.password,
      role: "super_admin",
      tenantId: "platform",
      scopeType: "head_office",
      fullName: superAdmin.fullName
    }
  ];

  if (env.BOOTSTRAP_DEMO_ADMIN) {
    for (const module_key of DEMO_MODULES) {
      const { error: modError } = await supabase.from("tenant_modules").upsert(
        { tenant_id: "tenant-demo", module_key },
        { onConflict: "tenant_id,module_key" }
      );
      if (modError) {
        throw new Error(`Failed to seed demo modules: ${modError.message}`);
      }
    }
    setTenantModulesInStore("tenant-demo", DEMO_MODULES);
    await ensureTenantDefaultBranch(supabase, "tenant-demo", "MAIN", "Main Branch");

    seedUsers.push({
      id: DEMO_ADMIN_ID,
      email: "admin@demo.com",
      password: superAdmin.password,
      role: "admin",
      tenantId: "tenant-demo",
      scopeType: "head_office",
      fullName: "Demo Company Admin"
    });
  }

  for (const seed of seedUsers) {
    syncLocalUser(seed);
    await ensureAuthUser(supabase, seed, { resetPassword: options.resetPassword });
  }

  console.info(
    `[bootstrap] Platform super admin ready: ${superAdmin.email} (password from SUPER_ADMIN_PASSWORD in .env)`
  );
  if (env.BOOTSTRAP_DEMO_ADMIN) {
    console.info("[bootstrap] Demo company admin ready: admin@demo.com (same password as super admin)");
  }
}

function seedLocalOnly(): void {
  const superAdmin = getSuperAdminCredentials();
  syncLocalUser({
    id: SUPER_ADMIN_ID,
    email: superAdmin.email,
    password: superAdmin.password,
    role: "super_admin",
    tenantId: "platform",
    scopeType: "head_office",
    fullName: superAdmin.fullName
  });

  if (env.BOOTSTRAP_DEMO_ADMIN) {
    upsertTenantInStore({
      id: "tenant-demo",
      name: "Demo Cooperative",
      subscriptionStatus: "active",
      subscribedModules: DEMO_MODULES,
      createdAt: new Date().toISOString()
    });
    syncLocalUser({
      id: DEMO_ADMIN_ID,
      email: "admin@demo.com",
      password: superAdmin.password,
      role: "admin",
      tenantId: "tenant-demo",
      scopeType: "head_office",
      fullName: "Demo Company Admin"
    });
  }
}
