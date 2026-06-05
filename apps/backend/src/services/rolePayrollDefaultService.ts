import {
  rolePayrollDefaultSchema,
  seedRolePayrollDefault,
  TENANT_PAYROLL_ROLES,
  updateRolePayrollDefaultSchema,
  type Role,
  type RolePayrollDefault,
  type TenantPayrollRole
} from "@bms/shared";
import { getSupabaseAdminClient } from "../config/supabaseClient.js";
import { isMissingSupabaseResource } from "../lib/supabaseSchema.js";

type DefaultRow = {
  tenant_id: string;
  role: string;
  base_salary: number;
  monthly_bonus: number;
  ssnit_rate_percent: number | null;
  ssnit_fixed_amount: number;
  welfare_deduction: number;
  loan_deduction: number;
};

const defaultStore = new Map<string, Map<string, DefaultRow>>();
let warnedMissingRoleDefaultsTable = false;

function tenantDefaults(tenantId: string): Map<string, DefaultRow> {
  let map = defaultStore.get(tenantId);
  if (!map) {
    map = new Map();
    defaultStore.set(tenantId, map);
  }
  return map;
}

function mapRow(row: DefaultRow): RolePayrollDefault {
  return rolePayrollDefaultSchema.parse({
    tenantId: row.tenant_id,
    role: row.role,
    baseSalary: Number(row.base_salary),
    monthlyBonus: Number(row.monthly_bonus),
    ssnitRatePercent: row.ssnit_rate_percent != null ? Number(row.ssnit_rate_percent) : null,
    ssnitFixedAmount: Number(row.ssnit_fixed_amount),
    welfareDeduction: Number(row.welfare_deduction),
    loanDeduction: Number(row.loan_deduction)
  });
}

function warnMissingTableOnce(): void {
  if (warnedMissingRoleDefaultsTable) {
    return;
  }
  warnedMissingRoleDefaultsTable = true;
  console.warn(
    "[payroll] role_payroll_defaults table not found — using in-memory templates. Apply migration 029_role_payroll_defaults.sql in Supabase."
  );
}

export async function loadRolePayrollDefaults(tenantId: string): Promise<Map<Role, RolePayrollDefault>> {
  const supabase = getSupabaseAdminClient();
  const map = new Map<Role, RolePayrollDefault>();

  if (supabase) {
    const { data, error } = await supabase
      .from("role_payroll_defaults")
      .select("*")
      .eq("tenant_id", tenantId);
    if (error) {
      if (isMissingSupabaseResource(error.message)) {
        warnMissingTableOnce();
        for (const [, row] of tenantDefaults(tenantId)) {
          const parsed = mapRow(row);
          map.set(parsed.role, parsed);
        }
      } else {
        throw new Error(`Failed to load role payroll defaults: ${error.message}`);
      }
    } else {
      for (const row of data ?? []) {
        const parsed = mapRow(row as DefaultRow);
        map.set(parsed.role, parsed);
      }
    }
  } else {
    for (const [, row] of tenantDefaults(tenantId)) {
      const parsed = mapRow(row);
      map.set(parsed.role, parsed);
    }
  }

  for (const role of TENANT_PAYROLL_ROLES) {
    if (!map.has(role)) {
      const seeded = seedRolePayrollDefault(tenantId, role);
      map.set(role, seeded);
    }
  }

  return map;
}

export async function listRolePayrollDefaults(tenantId: string): Promise<RolePayrollDefault[]> {
  const map = await loadRolePayrollDefaults(tenantId);
  return TENANT_PAYROLL_ROLES.map((role) => map.get(role) ?? seedRolePayrollDefault(tenantId, role));
}

export async function getRolePayrollDefault(
  tenantId: string,
  role: Role
): Promise<RolePayrollDefault> {
  const map = await loadRolePayrollDefaults(tenantId);
  return map.get(role) ?? seedRolePayrollDefault(tenantId, role);
}

export async function upsertRolePayrollDefault(
  tenantId: string,
  role: TenantPayrollRole,
  input: unknown
): Promise<RolePayrollDefault> {
  const payload = updateRolePayrollDefaultSchema.parse(input ?? {});
  const existing = await getRolePayrollDefault(tenantId, role);
  const row: DefaultRow = {
    tenant_id: tenantId,
    role,
    base_salary: payload.baseSalary ?? existing.baseSalary,
    monthly_bonus: payload.monthlyBonus ?? existing.monthlyBonus,
    ssnit_rate_percent:
      payload.ssnitRatePercent !== undefined
        ? payload.ssnitRatePercent
        : (existing.ssnitRatePercent ?? null),
    ssnit_fixed_amount: payload.ssnitFixedAmount ?? existing.ssnitFixedAmount,
    welfare_deduction: payload.welfareDeduction ?? existing.welfareDeduction,
    loan_deduction: payload.loanDeduction ?? existing.loanDeduction
  };

  tenantDefaults(tenantId).set(role, row);

  const supabase = getSupabaseAdminClient();
  if (supabase) {
    const { error } = await supabase.from("role_payroll_defaults").upsert({
      tenant_id: row.tenant_id,
      role: row.role,
      base_salary: row.base_salary,
      monthly_bonus: row.monthly_bonus,
      ssnit_rate_percent: row.ssnit_rate_percent,
      ssnit_fixed_amount: row.ssnit_fixed_amount,
      welfare_deduction: row.welfare_deduction,
      loan_deduction: row.loan_deduction,
      updated_at: new Date().toISOString()
    });
    if (error) {
      if (isMissingSupabaseResource(error.message)) {
        warnMissingTableOnce();
      } else {
        throw new Error(`Failed to save role payroll default: ${error.message}`);
      }
    }
  }

  return mapRow(row);
}

export async function applyRoleDefaultToStaffWithRole(
  tenantId: string,
  role: Role
): Promise<number> {
  const roleDefault = await getRolePayrollDefault(tenantId, role);
  const { listUsersByTenant } = await import("./authStore.js");
  const { getUserPayrollProfile, upsertUserPayrollProfile } = await import(
    "./userPayrollProfileService.js"
  );
  const supabase = getSupabaseAdminClient();
  let users: Array<{ userId: string; role: Role }> = [];

  if (supabase) {
    const { data } = await supabase
      .from("users")
      .select("id, role")
      .eq("tenant_id", tenantId)
      .eq("role", role);
    users = (data ?? []).map((row) => ({ userId: String(row.id), role: row.role as Role }));
  } else {
    users = listUsersByTenant(tenantId)
      .filter((u) => u.role === role)
      .map((u) => ({ userId: u.id, role: u.role }));
  }

  for (const user of users) {
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
  }

  return users.length;
}

export async function saveRolePayrollDefaultAndApply(
  tenantId: string,
  role: TenantPayrollRole,
  input: unknown
): Promise<RolePayrollDefault> {
  const saved = await upsertRolePayrollDefault(tenantId, role, input);
  await applyRoleDefaultToStaffWithRole(tenantId, role);
  return saved;
}
