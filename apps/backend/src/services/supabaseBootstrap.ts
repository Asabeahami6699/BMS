import { getSupabaseAdminClient } from "../config/supabaseClient.js";
import { disableSupabaseRuntime, getSuperAdminCredentials, hasSupabaseConfig } from "../config/env.js";
import { resetSupabaseClients } from "../config/supabaseClient.js";
import { isSupabaseConnectivityError } from "../lib/networkError.js";
import { hashPassword } from "./password.js";
import {
  saveAuthUser,
  upsertTenantInStore,
  type StoredAuthUser,
  type StoredTenant
} from "./authStore.js";

const SUPER_ADMIN_ID = "user-super-admin";

type SeedUser = {
  id: string;
  email: string;
  password: string;
  role: StoredAuthUser["role"];
  tenantId: string;
  scopeType: StoredAuthUser["scopeType"];
  fullName: string;
};

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
    console.info("[bootstrap] Supabase not configured — using in-memory super admin only");
    seedLocalOnly();
    return;
  }

  const supabase = getSupabaseAdminClient();
  if (!supabase) {
    seedLocalOnly();
    return;
  }

  const superAdmin = getSuperAdminCredentials();
  if (process.env.NODE_ENV === "production" && superAdmin.password === "ChangeMe123!") {
    console.warn(
      "[security] SUPER_ADMIN_PASSWORD is still set to the default value in production. " +
        "Set a strong unique SUPER_ADMIN_PASSWORD environment variable immediately."
    );
  }

  try {
    await bootstrapSupabaseSeedRemote(supabase, superAdmin, options);
  } catch (error) {
    if (!isSupabaseConnectivityError(error)) {
      throw error;
    }
    disableSupabaseRuntime(error instanceof Error ? error.message : "connection failed");
    resetSupabaseClients();
    seedLocalOnly();
    logBootstrapReady(superAdmin);
  }
}

async function bootstrapSupabaseSeedRemote(
  supabase: NonNullable<ReturnType<typeof getSupabaseAdminClient>>,
  superAdmin: ReturnType<typeof getSuperAdminCredentials>,
  options: { resetPassword?: boolean }
): Promise<void> {
  const seedTenants: StoredTenant[] = [
    {
      id: "platform",
      name: "aabanker Platform",
      subscriptionStatus: "active",
      subscribedModules: [],
      createdAt: new Date().toISOString()
    }
  ];

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

  for (const seed of seedUsers) {
    syncLocalUser(seed);
    await ensureAuthUser(supabase, seed, { resetPassword: options.resetPassword });
  }

  logBootstrapReady(superAdmin);
}

function logBootstrapReady(superAdmin: ReturnType<typeof getSuperAdminCredentials>): void {
  console.info(
    `[bootstrap] Platform super admin ready: ${superAdmin.email} (password from SUPER_ADMIN_PASSWORD in .env)`
  );
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

  upsertTenantInStore({
    id: "platform",
    name: "aabanker Platform",
    subscriptionStatus: "active",
    subscribedModules: [],
    createdAt: new Date().toISOString()
  });
}
