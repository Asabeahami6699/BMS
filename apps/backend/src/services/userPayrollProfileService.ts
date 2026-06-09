import {
  computeStaffPayrollPreview,
  currentPayrollPeriod,
  resolveEffectivePayroll,
  roleReceivesCommission,
  isBuiltinRole,
  staffPayrollSetupRowSchema,
  updateUserPayrollProfileSchema,
  type CommissionPolicy,
  type PayrollDeductions,
  type Role,
  type StaffPayrollSetupRow,
  type UserPayrollProfile
} from "@bms/shared";
import { getSupabaseAdminClient } from "../config/supabaseClient.js";
import { isMissingSupabaseResource } from "../lib/supabaseSchema.js";
import { listUsersByTenant } from "./authStore.js";
import { getCommissionPolicy } from "./commissionPolicyService.js";
import { loadRolePayrollDefaults } from "./rolePayrollDefaultService.js";
import { listTransactions } from "./transactionService.js";

type ProfileRow = {
  tenant_id: string;
  user_id: string;
  base_salary: number;
  commission_percent_override: number | null;
  monthly_bonus: number;
  ssnit_rate_percent?: number | null;
  ssnit_fixed_amount?: number;
  welfare_deduction?: number;
  loan_deduction?: number;
  custom_payroll?: boolean;
};

const profileStore = new Map<string, Map<string, ProfileRow>>();
let warnedMissingProfilesTable = false;

function warnMissingProfilesOnce(message: string): void {
  if (warnedMissingProfilesTable) {
    return;
  }
  warnedMissingProfilesTable = true;
  console.warn(`[payroll] ${message}`);
}

function tenantProfiles(tenantId: string): Map<string, ProfileRow> {
  let map = profileStore.get(tenantId);
  if (!map) {
    map = new Map();
    profileStore.set(tenantId, map);
  }
  return map;
}

function defaultCommissionPercent(role: Role, policy: CommissionPolicy): number {
  if (role === "field_agent") {
    return policy.fieldAgentCommissionPercent;
  }
  if (role === "coordinator") {
    return policy.coordinatorCommissionPercent;
  }
  return 0;
}

export function effectiveCommissionPercent(
  role: Role,
  policy: CommissionPolicy,
  profile: UserPayrollProfile | undefined
): number {
  if (profile?.commissionPercentOverride != null) {
    return profile.commissionPercentOverride;
  }
  return defaultCommissionPercent(role, policy);
}

export function profileDeductions(
  compensation?: Pick<
    PayrollDeductions,
    "ssnitRatePercent" | "ssnitFixedAmount" | "welfareDeduction" | "loanDeduction"
  >
): PayrollDeductions {
  return {
    ssnitRatePercent: compensation?.ssnitRatePercent ?? null,
    ssnitFixedAmount: compensation?.ssnitFixedAmount ?? 0,
    welfareDeduction: compensation?.welfareDeduction ?? 0,
    loanDeduction: compensation?.loanDeduction ?? 0
  };
}

type TenantUserRow = {
  userId: string;
  email: string;
  fullName?: string;
  role: string;
  status: "active" | "inactive";
};

async function listTenantUsers(tenantId: string): Promise<TenantUserRow[]> {
  const supabase = getSupabaseAdminClient();
  if (supabase) {
    const { data, error } = await supabase
      .from("users")
      .select("id, email, full_name, role, status")
      .eq("tenant_id", tenantId)
      .order("full_name", { ascending: true });
    if (error) {
      throw new Error(`Failed to list users: ${error.message}`);
    }
    return (data ?? []).map((row) => ({
      userId: String(row.id),
      email: String(row.email ?? ""),
      fullName: row.full_name ? String(row.full_name) : undefined,
      role: row.role as Role,
      status: row.status === "inactive" ? "inactive" : "active"
    }));
  }

  return listUsersByTenant(tenantId).map((user) => ({
    userId: user.id,
    email: user.email,
    fullName: user.fullName,
    role: user.role,
    status: (user.status ?? "active") as "active" | "inactive"
  }));
}

async function loadProfileRows(tenantId: string): Promise<Map<string, ProfileRow>> {
  const supabase = getSupabaseAdminClient();
  if (supabase) {
    const { data, error } = await supabase
      .from("user_payroll_profiles")
      .select("*")
      .eq("tenant_id", tenantId);
    if (error) {
      if (isMissingSupabaseResource(error.message)) {
        warnMissingProfilesOnce(
          "user_payroll_profiles not ready — using in-memory profiles. Apply migrations 027–029 in Supabase."
        );
        return tenantProfiles(tenantId);
      }
      throw new Error(`Failed to load payroll profiles: ${error.message}`);
    }
    const map = new Map<string, ProfileRow>();
    for (const row of data ?? []) {
      map.set(String(row.user_id), row as ProfileRow);
    }
    return map;
  }
  return tenantProfiles(tenantId);
}

function mapProfile(row: ProfileRow): UserPayrollProfile {
  return {
    tenantId: row.tenant_id,
    userId: row.user_id,
    baseSalary: Number(row.base_salary),
    commissionPercentOverride:
      row.commission_percent_override != null ? Number(row.commission_percent_override) : null,
    monthlyBonus: Number(row.monthly_bonus),
    ssnitRatePercent: row.ssnit_rate_percent != null ? Number(row.ssnit_rate_percent) : null,
    ssnitFixedAmount: Number(row.ssnit_fixed_amount ?? 0),
    welfareDeduction: Number(row.welfare_deduction ?? 0),
    loanDeduction: Number(row.loan_deduction ?? 0),
    customPayroll: Boolean(row.custom_payroll)
  };
}

export async function getUserPayrollProfile(
  tenantId: string,
  userId: string
): Promise<UserPayrollProfile | undefined> {
  const rows = await loadProfileRows(tenantId);
  const row = rows.get(userId);
  return row ? mapProfile(row) : undefined;
}

export async function upsertUserPayrollProfile(
  tenantId: string,
  userId: string,
  input: unknown
): Promise<UserPayrollProfile> {
  const payload = updateUserPayrollProfileSchema.parse(input ?? {});
  const existing = await getUserPayrollProfile(tenantId, userId);
  const row: ProfileRow = {
    tenant_id: tenantId,
    user_id: userId,
    base_salary: payload.baseSalary ?? existing?.baseSalary ?? 0,
    commission_percent_override:
      payload.commissionPercentOverride !== undefined
        ? payload.commissionPercentOverride
        : (existing?.commissionPercentOverride ?? null),
    monthly_bonus: payload.monthlyBonus ?? existing?.monthlyBonus ?? 0,
    ssnit_rate_percent:
      payload.ssnitRatePercent !== undefined
        ? payload.ssnitRatePercent
        : (existing?.ssnitRatePercent ?? null),
    ssnit_fixed_amount: payload.ssnitFixedAmount ?? existing?.ssnitFixedAmount ?? 0,
    welfare_deduction: payload.welfareDeduction ?? existing?.welfareDeduction ?? 0,
    loan_deduction: payload.loanDeduction ?? existing?.loanDeduction ?? 0,
    custom_payroll: payload.customPayroll ?? existing?.customPayroll ?? false
  };

  tenantProfiles(tenantId).set(userId, row);

  const supabase = getSupabaseAdminClient();
  if (supabase) {
    const fullPayload = {
      tenant_id: row.tenant_id,
      user_id: row.user_id,
      base_salary: row.base_salary,
      commission_percent_override: row.commission_percent_override,
      monthly_bonus: row.monthly_bonus,
      ssnit_rate_percent: row.ssnit_rate_percent,
      ssnit_fixed_amount: row.ssnit_fixed_amount,
      welfare_deduction: row.welfare_deduction,
      loan_deduction: row.loan_deduction,
      custom_payroll: row.custom_payroll,
      updated_at: new Date().toISOString()
    };
    const { error: fullError } = await supabase.from("user_payroll_profiles").upsert(fullPayload);
    if (fullError) {
      if (isMissingSupabaseResource(fullError.message)) {
        const { error: legacyError } = await supabase.from("user_payroll_profiles").upsert({
          tenant_id: row.tenant_id,
          user_id: row.user_id,
          base_salary: row.base_salary,
          commission_percent_override: row.commission_percent_override,
          monthly_bonus: row.monthly_bonus,
          updated_at: new Date().toISOString()
        });
        if (legacyError && !isMissingSupabaseResource(legacyError.message)) {
          throw new Error(`Failed to save payroll profile: ${legacyError.message}`);
        }
        warnMissingProfilesOnce(
          "Payroll profile saved in memory only. Apply migrations 028–029 for full deduction columns."
        );
      } else {
        throw new Error(`Failed to save payroll profile: ${fullError.message}`);
      }
    }
  }

  return mapProfile(row);
}

/** Sync every user's stored profile from their role template (keeps commission overrides). */
export async function applyRoleDefaultsToAllUsers(tenantId: string): Promise<number> {
  const roleDefaults = await loadRolePayrollDefaults(tenantId);
  const users = await listTenantUsers(tenantId);
  let count = 0;

  for (const user of users) {
    const role = user.role;
    if (!isBuiltinRole(role)) {
      continue;
    }
    const roleDefault = roleDefaults.get(role);
    if (!roleDefault) {
      continue;
    }
    const existing = await getUserPayrollProfile(tenantId, user.userId);
    await upsertUserPayrollProfile(tenantId, user.userId, {
      baseSalary: roleDefault.baseSalary,
      monthlyBonus: roleDefault.monthlyBonus,
      ssnitRatePercent: roleDefault.ssnitRatePercent,
      ssnitFixedAmount: roleDefault.ssnitFixedAmount,
      welfareDeduction: roleDefault.welfareDeduction,
      loanDeduction: existing?.loanDeduction ?? roleDefault.loanDeduction,
      commissionPercentOverride: existing?.commissionPercentOverride ?? null,
      customPayroll: false
    });
    count += 1;
  }

  return count;
}

async function collectionsForUserInPeriod(
  tenantId: string,
  userId: string,
  startIso: string,
  endIso: string
): Promise<number> {
  const transactions = await listTransactions(tenantId);
  return transactions
    .filter(
      (tx) =>
        tx.fieldAgentId === userId &&
        (tx.type === "daily_susu" || tx.type === "deposit") &&
        tx.createdAt >= startIso &&
        tx.createdAt <= endIso
    )
    .reduce((sum, tx) => sum + tx.amount, 0);
}

export async function listStaffPayrollSetup(
  tenantId: string,
  period = currentPayrollPeriod()
): Promise<StaffPayrollSetupRow[]> {
  const policy = getCommissionPolicy(tenantId);
  const users = await listTenantUsers(tenantId);
  const profiles = await loadProfileRows(tenantId);
  const roleDefaults = await loadRolePayrollDefaults(tenantId);

  const result: StaffPayrollSetupRow[] = [];

  for (const user of users) {
    const role = user.role;
    if (!isBuiltinRole(role)) {
      continue;
    }
    const profileRow = profiles.get(user.userId);
    const profile = profileRow ? mapProfile(profileRow) : undefined;
    const roleDefault =
      roleDefaults.get(role) ??
      roleDefaults.values().next().value;
    if (!roleDefault) {
      continue;
    }

    const effective = resolveEffectivePayroll(roleDefault, profile);
    const commissionsApply = roleReceivesCommission(role);
    const defaultPercent = defaultCommissionPercent(role, policy);
    const effectivePercent = effectiveCommissionPercent(role, policy, profile);
    const collections = commissionsApply
      ? await collectionsForUserInPeriod(tenantId, user.userId, period.startIso, period.endIso)
      : 0;

    const preview = computeStaffPayrollPreview({
      baseSalary: effective.baseSalary,
      monthlyBonus: effective.monthlyBonus,
      collections,
      commissionPercent: effectivePercent,
      commissionsApply,
      policyEnabled: policy.enabled,
      bonusRules: policy.bonusRules,
      deductions: profileDeductions(effective)
    });

    result.push(
      staffPayrollSetupRowSchema.parse({
        userId: user.userId,
        email: user.email,
        fullName: user.fullName,
        role: user.role,
        status: user.status,
        baseSalary: effective.baseSalary,
        commissionPercentOverride: profile?.commissionPercentOverride ?? null,
        monthlyBonus: effective.monthlyBonus,
        ssnitRatePercent: effective.ssnitRatePercent,
        ssnitFixedAmount: effective.ssnitFixedAmount,
        welfareDeduction: effective.welfareDeduction,
        loanDeduction: effective.loanDeduction,
        effectiveCommissionPercent: effectivePercent,
        commissionsApply,
        defaultCommissionPercent: defaultPercent,
        collectionsThisPeriod: collections,
        projectedCommission: preview.projectedCommission,
        projectedTierBonus: preview.projectedTierBonus,
        projectedGross: preview.projectedGross,
        projectedDeductions: preview.projectedDeductions,
        projectedNet: preview.projectedNet,
        usesRoleDefaults: effective.usesRoleDefaults,
        customPayroll: effective.customPayroll
      })
    );
  }

  return result;
}
