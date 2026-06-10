import {
  createTenantAdminSchema,
  createTenantSchema,
  createTenantUserBaseSchema,
  withBranchAssignmentRefine,
  loginSchema,
  resetUserPasswordSchema,
  roleSchema,
  isBuiltinRole,
  scopeTypeSchema,
  updateTenantUserSchema,
  roleRequiresBranch,
  type Role,
  type ScopeType,
  type UserJobTitle
} from "@bms/shared";
import { z } from "zod";
import { getSupabaseJwtSecret } from "../config/env.js";
import { getPermissionsForRole } from "../config/permissions.js";
import { resolvePermissionsForTenantUser } from "./builtinRolePermissionService.js";
import { assertValidUserJobTitle, parseProfileJobTitle, tenantJobTitleExists } from "./tenantJobTitleService.js";
import { isSupabaseAuthNetworkError } from "../lib/networkError.js";
import {
  decodeSupabaseAccessTokenClaims,
  verifySupabaseAccessToken
} from "../lib/supabaseJwt.js";
import { listBranches } from "./branchService.js";
import { getSupabaseAdminClient, getSupabaseAuthClient } from "../config/supabaseClient.js";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { UserContext } from "../types/express.js";
import {
  createSession,
  deleteStoredAuthUser,
  findUserByEmail,
  findUserById,
  getTenantFromStore,
  listUsersByTenant,
  listTenantsFromStore,
  resolveSession,
  revokeSession,
  saveAuthUser,
  updateStoredAuthUser,
  upsertTenantInStore,
  type StoredAuthUser,
  type StoredTenant
} from "./authStore.js";
import { hashPassword, verifyPassword } from "./password.js";
import { loadTenantModules, saveTenantModules, toTenantRecord } from "./tenantModuleService.js";
import { loadTenantAddons, saveTenantAddons } from "./tenantAddonService.js";
import type { TenantProductModule } from "@bms/shared";
import type { TenantAddon } from "@bms/shared";
import { updateTenantModulesSchema, updateTenantAddonsSchema } from "@bms/shared";

export type LoginResult = {
  accessToken: string;
  user: UserContext & { email: string; fullName?: string };
};

async function enrichTenantContext(
  context: UserContext & { email?: string; fullName?: string }
): Promise<UserContext & { email?: string; fullName?: string }> {
  if (context.role === "super_admin" || !context.tenantId || context.tenantId === "platform") {
    return {
      ...context,
      permissions: isBuiltinRole(context.role)
        ? getPermissionsForRole(context.role)
        : [],
      tenantName: context.tenantId === "platform" ? "BMS Platform" : undefined,
      subscribedModules: [],
      subscribedAddons: [],
      reportsAnalytics: true
    };
  }

  const permissions = await resolvePermissionsForTenantUser(
    context.tenantId,
    context.role,
    context.userId
  );
  const modules = await loadTenantModules(context.tenantId);
  const addons = await loadTenantAddons(context.tenantId);
  const tenant = getTenantFromStore(context.tenantId);
  if (!tenant && getSupabaseAdminClient()) {
    const supabase = getSupabaseAdminClient();
    const { data: row } = await supabase!
      .from("tenants")
      .select("name, subscription_status")
      .eq("id", context.tenantId)
      .maybeSingle();
    if (row) {
      upsertTenantInStore({
        id: context.tenantId,
        name: row.name,
        subscriptionStatus: row.subscription_status === "inactive" ? "inactive" : "active",
        createdAt: new Date().toISOString()
      });
    }
  }
  const resolvedTenant = getTenantFromStore(context.tenantId);
  return {
    ...context,
    permissions,
    tenantName: resolvedTenant?.name,
    subscribedModules: modules,
    subscribedAddons: addons,
    reportsAnalytics: resolvedTenant?.subscriptionStatus !== "inactive"
  };
}

function toUserContext(user: StoredAuthUser): UserContext & { email: string; fullName?: string } {
  const tenantId = user.tenantId ?? "platform";
  const modules =
    user.tenantId && user.tenantId !== "platform"
      ? getTenantFromStore(user.tenantId)?.subscribedModules
      : undefined;
  const tenant = user.tenantId ? getTenantFromStore(user.tenantId) : undefined;
  return {
    userId: user.id,
    tenantId,
    role: user.role,
    scopeType: user.scopeType,
    branchId: user.branchId,
    permissions: isBuiltinRole(user.role) ? getPermissionsForRole(user.role) : [],
    email: user.email,
    fullName: user.fullName,
    subscribedModules: modules ?? (user.role === "super_admin" ? [] : undefined),
    subscribedAddons: user.tenantId ? getTenantFromStore(user.tenantId)?.subscribedAddons ?? [] : [],
    reportsAnalytics: user.role === "super_admin" ? true : tenant?.subscriptionStatus === "active",
    tenantName:
      user.role === "super_admin"
        ? "BMS Platform"
        : tenant?.name
  };
}

function assertTenantActive(tenantId: string | null): void {
  if (!tenantId) {
    return;
  }
  const tenant = getTenantFromStore(tenantId);
  if (tenant && tenant.subscriptionStatus === "inactive") {
    throw new Error("Company subscription is inactive. Contact platform support.");
  }
}

export async function loginWithCredentials(
  raw: unknown
): Promise<LoginResult> {
  const parsed = loginSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error("Invalid email or password");
  }

  const email = parsed.data.email.toLowerCase();
  const supabase = getSupabaseAdminClient();
  const authClient = getSupabaseAuthClient();

  if (supabase && authClient) {
    const { data: signInData, error: signInError } = await authClient.auth.signInWithPassword({
      email: parsed.data.email,
      password: parsed.data.password
    });
    if (signInError || !signInData.session) {
      const localUser = findUserByEmail(email);
      if (localUser && verifyPassword(parsed.data.password, localUser.passwordHash)) {
        assertTenantActive(localUser.tenantId);
        const accessToken = createSession(localUser.id);
        const userContext = await enrichTenantContext(toUserContext(localUser));
        return { accessToken, user: userContext as UserContext & { email: string; fullName?: string } };
      }
      throw new Error("Invalid email or password");
    }

    const authUserId = signInData.user.id;
    let profile = (
      await supabase
        .from("users")
        .select("id, tenant_id, role, scope_type, branch_id, email, full_name, status")
        .eq("auth_user_id", authUserId)
        .maybeSingle()
    ).data;

    if (!profile) {
      profile = (
        await supabase
          .from("users")
          .select("id, tenant_id, role, scope_type, branch_id, email, full_name, status")
          .ilike("email", email)
          .maybeSingle()
      ).data;

      if (profile) {
        await supabase.from("users").update({ auth_user_id: authUserId }).eq("id", profile.id);
      }
    }

    if (!profile) {
      throw new Error("User profile not found for this account");
    }

    if (profile.status === "inactive") {
      throw new Error("This account is inactive. Contact your administrator.");
    }

    const roleParsed = parseProfileJobTitle(profile.role);
    const scopeParsed = scopeTypeSchema.safeParse(profile.scope_type);
    if (!roleParsed || !scopeParsed.success) {
      throw new Error("User profile has invalid role or scope");
    }

    if (!roleSchema.safeParse(roleParsed).success && profile.tenant_id) {
      await assertValidUserJobTitle(profile.tenant_id, roleParsed);
    }

    if (profile.tenant_id) {
      const { data: tenant } = await supabase
        .from("tenants")
        .select("subscription_status")
        .eq("id", profile.tenant_id)
        .maybeSingle();
      if (tenant?.subscription_status === "inactive") {
        throw new Error("Company subscription is inactive. Contact platform support.");
      }
    }

    const userContext = await enrichTenantContext({
      userId: profile.id,
      tenantId: profile.tenant_id ?? "platform",
      role: roleParsed,
      scopeType: scopeParsed.data,
      branchId: profile.branch_id ?? undefined,
      permissions: getPermissionsForRole(
        roleSchema.safeParse(roleParsed).success ? (roleParsed as Role) : "admin"
      ),
      email: profile.email ?? parsed.data.email,
      fullName: profile.full_name ?? undefined
    });

    return {
      accessToken: signInData.session.access_token,
      user: userContext as UserContext & { email: string; fullName?: string }
    };
  }

  const user = findUserByEmail(email);
  if (!user || !verifyPassword(parsed.data.password, user.passwordHash)) {
    throw new Error("Invalid email or password");
  }

  if (user.status === "inactive") {
    throw new Error("This account is inactive. Contact your administrator.");
  }

  assertTenantActive(user.tenantId);
  const accessToken = createSession(user.id);
  const userContext = await enrichTenantContext(toUserContext(user));
  return { accessToken, user: userContext as UserContext & { email: string; fullName?: string } };
}

type UserProfileRow = {
  id: string;
  tenant_id: string | null;
  role: string;
  scope_type: string;
  branch_id: string | null;
  email: string | null;
  full_name: string | null;
  status: string;
};

let loggedAuthFallback = false;

async function userContextFromProfile(
  supabase: SupabaseClient,
  profile: UserProfileRow,
  emailFallback?: string
): Promise<(UserContext & { email?: string; fullName?: string }) | undefined> {
  const roleParsed = parseProfileJobTitle(profile.role);
  const scopeParsed = scopeTypeSchema.safeParse(profile.scope_type);
  if (!roleParsed || !scopeParsed.success) {
    return undefined;
  }

  if (!roleSchema.safeParse(roleParsed).success && profile.tenant_id) {
    const valid = await tenantJobTitleExists(profile.tenant_id, roleParsed);
    if (!valid) {
      return undefined;
    }
  }

  if (profile.status === "inactive") {
    return undefined;
  }

  if (profile.tenant_id) {
    const { data: tenant } = await supabase
      .from("tenants")
      .select("subscription_status")
      .eq("id", profile.tenant_id)
      .maybeSingle();
    if (tenant?.subscription_status === "inactive") {
      return undefined;
    }
  }

  return enrichTenantContext({
    userId: profile.id,
    tenantId: profile.tenant_id ?? "platform",
    role: roleParsed,
    scopeType: scopeParsed.data,
    branchId: profile.branch_id ?? undefined,
    permissions: [],
    email: profile.email ?? emailFallback,
    fullName: profile.full_name ?? undefined
  });
}

async function loadUserContextByAuthUserId(
  supabase: SupabaseClient,
  authUserId: string,
  emailFallback?: string
): Promise<(UserContext & { email?: string; fullName?: string }) | undefined> {
  const { data: profile } = await supabase
    .from("users")
    .select("id, tenant_id, role, scope_type, branch_id, email, full_name, status")
    .eq("auth_user_id", authUserId)
    .maybeSingle();

  if (!profile) {
    return undefined;
  }

  return userContextFromProfile(supabase, profile as UserProfileRow, emailFallback);
}

async function resolveAuthUserIdFromAccessToken(
  supabase: SupabaseClient,
  token: string
): Promise<{ authUserId: string; email?: string } | undefined> {
  try {
    const { data, error } = await supabase.auth.getUser(token);
    if (!error && data.user?.id) {
      return { authUserId: data.user.id, email: data.user.email };
    }
  } catch (error) {
    if (!isSupabaseAuthNetworkError(error)) {
      throw error;
    }
  }

  const jwtSecret = getSupabaseJwtSecret();
  const claims = jwtSecret
    ? verifySupabaseAccessToken(token, jwtSecret)
    : decodeSupabaseAccessTokenClaims(token);

  if (!claims) {
    return undefined;
  }

  if (!jwtSecret && !loggedAuthFallback) {
    loggedAuthFallback = true;
    console.warn(
      "[auth] Supabase Auth API unreachable — using JWT claims without signature verification. " +
        "Set SUPABASE_JWT_SECRET in apps/backend/.env (Supabase → Settings → API → JWT Secret) for secure offline verification."
    );
  }

  return { authUserId: claims.sub, email: claims.email };
}

export async function resolveUserFromAccessToken(
  token: string
): Promise<(UserContext & { email?: string; fullName?: string }) | undefined> {
  const supabase = getSupabaseAdminClient();
  if (supabase && !token.startsWith("sess_")) {
    const resolved = await resolveAuthUserIdFromAccessToken(supabase, token);
    if (!resolved) {
      return undefined;
    }

    return loadUserContextByAuthUserId(supabase, resolved.authUserId, resolved.email);
  }

  const stored = resolveSession(token);
  if (!stored) {
    return undefined;
  }
  assertTenantActive(stored.tenantId);
  return enrichTenantContext(toUserContext(stored));
}

export function logoutAccessToken(token: string): void {
  if (token.startsWith("sess_")) {
    revokeSession(token);
  }
}

export async function listPlatformTenants() {
  const supabase = getSupabaseAdminClient();
  if (!supabase) {
    return listTenantsFromStore().filter((t) => t.id !== "platform");
  }

  const { data: rows, error } = await supabase
    .from("tenants")
    .select("id, name, subscription_status, created_at")
    .neq("id", "platform")
    .order("name");

  if (error || !rows) {
    console.warn(`[tenants] Supabase list failed: ${error?.message ?? "unknown"}`);
    return listTenantsFromStore().filter((t) => t.id !== "platform");
  }

  const result = [];
  for (const row of rows) {
    const modules = await loadTenantModules(row.id);
    const addons = await loadTenantAddons(row.id);
    const tenant: StoredTenant = {
      id: row.id,
      name: row.name,
      subscriptionStatus: row.subscription_status === "inactive" ? "inactive" : "active",
      subscribedModules: modules,
      subscribedAddons: addons,
      createdAt: row.created_at ?? undefined
    };
    upsertTenantInStore(tenant);
    result.push(toTenantRecord(tenant));
  }

  for (const local of listTenantsFromStore()) {
    if (local.id === "platform") {
      continue;
    }
    if (!result.some((t) => t.id === local.id)) {
      result.push(local);
    }
  }

  return result.sort((a, b) => a.name.localeCompare(b.name));
}

export async function createPlatformTenant(raw: unknown): Promise<StoredTenant> {
  const parsed = createTenantSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error("Invalid tenant payload");
  }

  const supabase = getSupabaseAdminClient();
  const tenant: StoredTenant = {
    id: parsed.data.id,
    name: parsed.data.name,
    subscriptionStatus: parsed.data.subscriptionStatus,
    subscribedModules: parsed.data.subscribedModules as TenantProductModule[],
    subscribedAddons: (parsed.data.subscribedAddons ?? []) as TenantAddon[],
    createdAt: new Date().toISOString()
  };

  if (supabase) {
    const { error } = await supabase.from("tenants").insert({
      id: tenant.id,
      name: tenant.name,
      subscription_status: tenant.subscriptionStatus
    });
    if (error) {
      throw new Error(`Failed to create tenant: ${error.message}`);
    }
  } else if (getTenantFromStore(tenant.id)) {
    throw new Error("Tenant already exists");
  }

  const saved = upsertTenantInStore(tenant);
  await saveTenantModules(saved.id, parsed.data.subscribedModules as TenantProductModule[]);
  await saveTenantAddons(saved.id, (parsed.data.subscribedAddons ?? []) as TenantAddon[]);
  return toTenantRecord(getTenantFromStore(saved.id)!);
}

export async function updateTenantAddons(
  tenantId: string,
  raw: unknown
): Promise<ReturnType<typeof toTenantRecord>> {
  const parsed = updateTenantAddonsSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error("Invalid add-ons payload");
  }
  const existing = getTenantFromStore(tenantId);
  if (!existing) {
    throw new Error("Tenant not found");
  }
  await saveTenantAddons(tenantId, parsed.data.subscribedAddons);
  return toTenantRecord(getTenantFromStore(tenantId)!);
}

export async function updateTenantProductModules(
  tenantId: string,
  raw: unknown
): Promise<ReturnType<typeof toTenantRecord>> {
  const parsed = updateTenantModulesSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error("Invalid product modules payload");
  }
  const existing = getTenantFromStore(tenantId);
  if (!existing) {
    throw new Error("Tenant not found");
  }
  await saveTenantModules(tenantId, parsed.data.subscribedModules);
  return toTenantRecord(getTenantFromStore(tenantId)!);
}

export async function updateTenantSubscription(
  tenantId: string,
  subscriptionStatus: "active" | "inactive"
): Promise<StoredTenant> {
  const existing = getTenantFromStore(tenantId);
  if (!existing) {
    throw new Error("Tenant not found");
  }

  const supabase = getSupabaseAdminClient();
  if (supabase) {
    const { error } = await supabase
      .from("tenants")
      .update({ subscription_status: subscriptionStatus })
      .eq("id", tenantId);
    if (error) {
      throw new Error(`Failed to update subscription: ${error.message}`);
    }
  }

  return toTenantRecord(upsertTenantInStore({ ...existing, subscriptionStatus }));
}

export async function createTenantCompanyAdmin(
  tenantId: string,
  raw: unknown
): Promise<UserContext & { email: string; fullName?: string }> {
  const parsed = createTenantAdminSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error("Invalid company admin payload");
  }

  const tenant = getTenantFromStore(tenantId);
  if (!tenant) {
    throw new Error("Tenant not found");
  }

  return createAuthUser({
    email: parsed.data.email,
    password: parsed.data.password,
    role: "admin",
    scopeType: "head_office",
    tenantId,
    fullName: parsed.data.fullName
  });
}

const internalCreateUserSchema = withBranchAssignmentRefine(
  createTenantUserBaseSchema.extend({
    tenantId: z.string().min(1),
    createdBy: z.string().min(1)
  })
);

async function assertUserBranchAssignment(
  tenantId: string,
  role: UserJobTitle,
  scopeType: ScopeType,
  branchId?: string | null
): Promise<void> {
  if (!isBuiltinRole(role) || !roleRequiresBranch(role)) {
    return;
  }
  if (scopeType !== "branch") {
    throw new Error("Field agents must use branch scope");
  }
  const id = branchId?.trim();
  if (!id) {
    throw new Error("Branch is required for field agents");
  }
  const branches = await listBranches(tenantId);
  const match = branches.find((b) => b.id === id);
  if (!match) {
    throw new Error("Selected branch was not found for this company");
  }
  if (match.status === "inactive") {
    throw new Error("Selected branch is inactive. Choose an active branch.");
  }
}

export async function createAuthUser(input: {
  email: string;
  password: string;
  role: UserJobTitle;
  scopeType: z.infer<typeof scopeTypeSchema>;
  tenantId: string;
  branchId?: string;
  tellerType?: 1 | 2 | 3 | 4 | null;
  fullName?: string;
  createdBy?: string;
  userId?: string;
}): Promise<UserContext & { email: string; fullName?: string }> {
  const parsed = internalCreateUserSchema.safeParse({
    email: input.email,
    password: input.password,
    role: input.role,
    scopeType: input.scopeType,
    branchId: input.branchId,
    tellerType: input.tellerType ?? undefined,
    fullName: input.fullName,
    tenantId: input.tenantId,
    createdBy: input.createdBy ?? "system"
  });

  if (!parsed.success) {
    throw new Error("Invalid user payload");
  }

  if (parsed.data.role === "super_admin") {
    throw new Error("Cannot create super_admin through tenant APIs");
  }

  assertTenantActive(parsed.data.tenantId);
  await assertValidUserJobTitle(parsed.data.tenantId, parsed.data.role);
  await assertUserBranchAssignment(
    parsed.data.tenantId,
    parsed.data.role,
    parsed.data.scopeType,
    parsed.data.branchId
  );
  const email = parsed.data.email.toLowerCase();

  if (findUserByEmail(email)) {
    throw new Error("A user with this email already exists");
  }

  const userId = input.userId ?? `user_${crypto.randomUUID().slice(0, 8)}`;
  const supabase = getSupabaseAdminClient();

  if (supabase) {
    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email: parsed.data.email,
      password: parsed.data.password,
      email_confirm: true
    });
    if (authError || !authData.user) {
      throw new Error(`Failed to create auth user: ${authError?.message ?? "unknown"}`);
    }

    const tellerType =
      parsed.data.role === "teller" ? (parsed.data.tellerType ?? null) : null;
    const { error: profileError } = await supabase.from("users").insert({
      id: userId,
      tenant_id: parsed.data.tenantId,
      role: parsed.data.role,
      scope_type: parsed.data.scopeType,
      branch_id: parsed.data.branchId ?? null,
      teller_type: tellerType,
      email: parsed.data.email,
      full_name: parsed.data.fullName ?? null,
      auth_user_id: authData.user.id,
      created_by: parsed.data.createdBy,
      status: "active"
    });
    if (profileError) {
      throw new Error(`Failed to create user profile: ${profileError.message}`);
    }
  } else {
    saveAuthUser({
      id: userId,
      email: parsed.data.email,
      passwordHash: hashPassword(parsed.data.password),
      role: parsed.data.role,
      tenantId: parsed.data.tenantId,
      scopeType: parsed.data.scopeType,
      branchId: parsed.data.branchId,
      tellerType: parsed.data.role === "teller" ? (parsed.data.tellerType ?? undefined) : undefined,
      fullName: parsed.data.fullName,
      status: "active",
      createdBy: parsed.data.createdBy,
      createdAt: new Date().toISOString()
    });
  }

  const created = findUserById(userId);
  if (!created) {
    return {
      userId,
      tenantId: parsed.data.tenantId,
      role: parsed.data.role,
      scopeType: parsed.data.scopeType,
      branchId: parsed.data.branchId,
      permissions: await resolvePermissionsForTenantUser(
        parsed.data.tenantId,
        parsed.data.role,
        userId
      ),
      email: parsed.data.email,
      fullName: parsed.data.fullName
    };
  }

  return toUserContext(created);
}

export type TenantUserRecord = {
  userId: string;
  email: string;
  fullName?: string;
  role: string;
  scopeType: z.infer<typeof scopeTypeSchema>;
  branchId?: string;
  tellerType?: 1 | 2 | 3 | 4;
  tenantId: string;
  status: "active" | "inactive";
  createdBy: string;
  createdAt?: string;
};

export type FieldAgentOption = {
  userId: string;
  email: string;
  fullName?: string;
  branchId?: string;
  status: "active" | "inactive";
};

export async function listTenantFieldAgents(tenantId: string): Promise<FieldAgentOption[]> {
  const supabase = getSupabaseAdminClient();
  if (supabase) {
    const { data, error } = await supabase
      .from("users")
      .select("id, email, full_name, branch_id, status")
      .eq("tenant_id", tenantId)
      .eq("role", "field_agent")
      .order("full_name", { ascending: true });
    if (error) {
      throw new Error(`Failed to list field agents: ${error.message}`);
    }
    return (data ?? []).map((row) => ({
      userId: row.id,
      email: row.email ?? "",
      fullName: row.full_name ?? undefined,
      branchId: row.branch_id ?? undefined,
      status: row.status === "inactive" ? "inactive" : "active"
    }));
  }

  return listUsersByTenant(tenantId)
    .filter((user) => user.role === "field_agent")
    .map((user) => ({
      userId: user.id,
      email: user.email,
      fullName: user.fullName,
      branchId: user.branchId,
      status: (user.status ?? "active") as "active" | "inactive"
    }));
}

function mapStoredUser(user: StoredAuthUser, tenantId: string): TenantUserRecord {
  return {
    userId: user.id,
    email: user.email,
    fullName: user.fullName,
    role: user.role,
    scopeType: user.scopeType,
    branchId: user.branchId,
    tellerType: user.tellerType,
    tenantId,
    status: user.status ?? "active",
    createdBy: user.createdBy ?? "system",
    createdAt: user.createdAt
  };
}

export async function getTenantUser(tenantId: string, userId: string): Promise<TenantUserRecord | undefined> {
  const supabase = getSupabaseAdminClient();
  if (supabase) {
    const { data, error } = await supabase
      .from("users")
      .select("id, email, role, scope_type, branch_id, teller_type, tenant_id, created_by, full_name, status, created_at")
      .eq("tenant_id", tenantId)
      .eq("id", userId)
      .maybeSingle();
    if (error || !data) {
      return undefined;
    }
    const tellerType =
      data.teller_type != null ? (Number(data.teller_type) as 1 | 2 | 3 | 4) : undefined;
    return {
      userId: data.id,
      email: data.email ?? "",
      fullName: data.full_name ?? undefined,
      role: data.role,
      scopeType: data.scope_type as z.infer<typeof scopeTypeSchema>,
      branchId: data.branch_id ?? undefined,
      tellerType,
      tenantId: data.tenant_id,
      status: data.status === "inactive" ? "inactive" : "active",
      createdBy: data.created_by ?? "system",
      createdAt: data.created_at ?? undefined
    };
  }

  const user = findUserById(userId);
  if (!user || user.tenantId !== tenantId) {
    return undefined;
  }
  return mapStoredUser(user, tenantId);
}

export async function updateTenantUser(
  tenantId: string,
  userId: string,
  raw: unknown,
  actorUserId: string
): Promise<TenantUserRecord> {
  const parsed = updateTenantUserSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error("Invalid user update payload");
  }

  const existing = await getTenantUser(tenantId, userId);
  if (!existing) {
    throw new Error("User not found");
  }

  if (parsed.data.role === "super_admin") {
    throw new Error("Cannot assign super_admin to tenant users");
  }

  const nextRole = parsed.data.role ?? existing.role;
  const nextScope = parsed.data.scopeType ?? existing.scopeType;
  const nextBranch =
    parsed.data.branchId !== undefined ? parsed.data.branchId : (existing.branchId ?? null);
  const nextTellerType =
    nextRole === "teller"
      ? parsed.data.tellerType !== undefined
        ? parsed.data.tellerType
        : (existing.tellerType ?? null)
      : null;

  if (parsed.data.role !== undefined) {
    await assertValidUserJobTitle(tenantId, parsed.data.role);
  }

  if (nextRole === "teller" && nextTellerType == null) {
    throw new Error("Select teller type (Teller 1–4)");
  }

  await assertUserBranchAssignment(tenantId, nextRole, nextScope, nextBranch);

  const supabase = getSupabaseAdminClient();
  if (supabase) {
    const { data: profile } = await supabase
      .from("users")
      .select("auth_user_id, email")
      .eq("tenant_id", tenantId)
      .eq("id", userId)
      .maybeSingle();

    if (!profile) {
      throw new Error("User not found");
    }

    const payload: Record<string, unknown> = {};
    if (parsed.data.email !== undefined) {
      payload.email = parsed.data.email;
    }
    if (parsed.data.role !== undefined) {
      payload.role = parsed.data.role;
    }
    if (parsed.data.scopeType !== undefined) {
      payload.scope_type = parsed.data.scopeType;
    }
    if (parsed.data.branchId !== undefined) {
      payload.branch_id = parsed.data.branchId;
    }
    if (parsed.data.fullName !== undefined) {
      payload.full_name = parsed.data.fullName;
    }
    if (parsed.data.status !== undefined) {
      payload.status = parsed.data.status;
    }
    if (parsed.data.tellerType !== undefined || parsed.data.role !== undefined) {
      payload.teller_type = nextTellerType;
    }

    if (Object.keys(payload).length > 0) {
      const { error } = await supabase.from("users").update(payload).eq("tenant_id", tenantId).eq("id", userId);
      if (error) {
        throw new Error(`Failed to update user: ${error.message}`);
      }
    }

    if (parsed.data.email && profile.auth_user_id) {
      await supabase.auth.admin.updateUserById(profile.auth_user_id, { email: parsed.data.email });
    }
  } else {
    const stored = findUserById(userId);
    if (!stored || stored.tenantId !== tenantId) {
      throw new Error("User not found");
    }
    updateStoredAuthUser(userId, {
      email: parsed.data.email,
      role: parsed.data.role,
      scopeType: parsed.data.scopeType,
      branchId: parsed.data.branchId ?? undefined,
      tellerType: nextTellerType ?? undefined,
      fullName: parsed.data.fullName,
      status: parsed.data.status
    });
  }

  void actorUserId;
  const updated = await getTenantUser(tenantId, userId);
  if (!updated) {
    throw new Error("User not found after update");
  }
  return updated;
}

const changeOwnPasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8)
});

export async function changeOwnPassword(
  context: UserContext & { email?: string },
  raw: unknown
): Promise<void> {
  const parsed = changeOwnPasswordSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error("Invalid password payload");
  }

  const email = context.email?.trim().toLowerCase();
  const supabase = getSupabaseAdminClient();

  if (supabase && email) {
    const authClient = getSupabaseAuthClient();
    if (!authClient) {
      throw new Error("Auth service unavailable");
    }
    const { error: signInError } = await authClient.auth.signInWithPassword({
      email,
      password: parsed.data.currentPassword
    });
    if (signInError) {
      throw new Error("Current password is incorrect");
    }
  } else {
    const user = findUserById(context.userId);
    if (!user || !verifyPassword(parsed.data.currentPassword, user.passwordHash)) {
      throw new Error("Current password is incorrect");
    }
  }

  await resetTenantUserPassword(context.tenantId, context.userId, {
    password: parsed.data.newPassword
  });
}

export async function resetTenantUserPassword(
  tenantId: string,
  userId: string,
  raw: unknown
): Promise<void> {
  const parsed = resetUserPasswordSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error("Invalid password payload");
  }

  const existing = await getTenantUser(tenantId, userId);
  if (!existing) {
    throw new Error("User not found");
  }

  const supabase = getSupabaseAdminClient();
  if (supabase) {
    const { data: profile } = await supabase
      .from("users")
      .select("auth_user_id")
      .eq("tenant_id", tenantId)
      .eq("id", userId)
      .maybeSingle();

    if (!profile?.auth_user_id) {
      throw new Error("Auth account not found for this user");
    }

    const { error } = await supabase.auth.admin.updateUserById(profile.auth_user_id, {
      password: parsed.data.password
    });
    if (error) {
      throw new Error(`Failed to reset password: ${error.message}`);
    }
    return;
  }

  updateStoredAuthUser(userId, { passwordHash: hashPassword(parsed.data.password) });
}

export async function deleteTenantUser(
  tenantId: string,
  userId: string,
  actorUserId: string
): Promise<void> {
  if (userId === actorUserId) {
    throw new Error("You cannot delete your own account");
  }

  const existing = await getTenantUser(tenantId, userId);
  if (!existing) {
    throw new Error("User not found");
  }

  const supabase = getSupabaseAdminClient();
  if (supabase) {
    const { data: profile } = await supabase
      .from("users")
      .select("auth_user_id")
      .eq("tenant_id", tenantId)
      .eq("id", userId)
      .maybeSingle();

    if (!profile) {
      throw new Error("User not found");
    }

    const { error: profileError } = await supabase.from("users").delete().eq("tenant_id", tenantId).eq("id", userId);
    if (profileError) {
      throw new Error(`Failed to delete user: ${profileError.message}`);
    }

    if (profile.auth_user_id) {
      await supabase.auth.admin.deleteUser(profile.auth_user_id);
    }
    return;
  }

  deleteStoredAuthUser(userId);
}
