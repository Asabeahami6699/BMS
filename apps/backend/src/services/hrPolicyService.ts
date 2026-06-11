import {
  BUILTIN_ROLE_LABELS,
  hrPoliciesSchema,
  roleSchema,
  updateHrPoliciesSchema,
  type HrPolicies,
  type Role
} from "@bms/shared";
import { getSupabaseAdminClient } from "../config/supabaseClient.js";
import { listTenantJobTitles } from "./tenantJobTitleService.js";

const DEFAULT_LATE_TIME = "09:00:00";
const DEFAULT_LEAVE_DAYS = 21;

const memoryPolicies = new Map<string, HrPolicies>();

const TENANT_STAFF_ROLES = roleSchema.options.filter((r) => r !== "super_admin");

function normalizeTime(value: string): string {
  const parts = value.split(":");
  if (parts.length === 2) {
    return `${parts[0]}:${parts[1]}:00`;
  }
  return value.length >= 8 ? value.slice(0, 8) : DEFAULT_LATE_TIME;
}

function toInputTime(value: string): string {
  return normalizeTime(value).slice(0, 5);
}

function roleLabel(roleKey: string, customNames: Map<string, string>): string {
  if (roleSchema.safeParse(roleKey).success) {
    return BUILTIN_ROLE_LABELS[roleKey as Role];
  }
  return customNames.get(roleKey) ?? roleKey.replace(/_/g, " ");
}

export async function getHrPolicies(tenantId: string): Promise<HrPolicies> {
  const supabase = getSupabaseAdminClient();
  const jobTitles = await listTenantJobTitles(tenantId);
  const customNames = new Map(jobTitles.map((j) => [j.roleKey, j.displayName]));
  const roleKeys = [...TENANT_STAFF_ROLES, ...jobTitles.map((j) => j.roleKey)];

  let lateCheckInTime = DEFAULT_LATE_TIME;
  let defaultAnnualLeaveDays = DEFAULT_LEAVE_DAYS;
  const entitlementMap = new Map<string, number>();

  if (supabase) {
    const { data: policyRow } = await supabase
      .from("hr_policies")
      .select("*")
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (policyRow) {
      lateCheckInTime = normalizeTime(String(policyRow.late_check_in_time ?? DEFAULT_LATE_TIME));
      defaultAnnualLeaveDays = Number(policyRow.default_annual_leave_days ?? DEFAULT_LEAVE_DAYS);
    }

    const { data: entitlements } = await supabase
      .from("hr_role_leave_entitlements")
      .select("*")
      .eq("tenant_id", tenantId);
    for (const row of entitlements ?? []) {
      entitlementMap.set(String(row.role_key), Number(row.annual_leave_days));
    }
  } else {
    const cached = memoryPolicies.get(tenantId);
    if (cached) {
      return cached;
    }
  }

  const roleLeaveEntitlements = roleKeys.map((roleKey) => ({
    roleKey,
    roleLabel: roleLabel(roleKey, customNames),
    annualLeaveDays: entitlementMap.get(roleKey) ?? defaultAnnualLeaveDays
  }));

  return hrPoliciesSchema.parse({
    lateCheckInTime: toInputTime(lateCheckInTime),
    defaultAnnualLeaveDays,
    roleLeaveEntitlements
  });
}

export async function updateHrPolicies(
  tenantId: string,
  updatedBy: string,
  raw: unknown
): Promise<HrPolicies> {
  const payload = updateHrPoliciesSchema.parse(raw ?? {});
  const lateTime = normalizeTime(payload.lateCheckInTime);
  const defaultDays = payload.defaultAnnualLeaveDays ?? DEFAULT_LEAVE_DAYS;
  const supabase = getSupabaseAdminClient();

  if (supabase) {
    const { error: policyError } = await supabase.from("hr_policies").upsert(
      {
        tenant_id: tenantId,
        late_check_in_time: lateTime,
        default_annual_leave_days: defaultDays,
        updated_by: updatedBy,
        updated_at: new Date().toISOString()
      },
      { onConflict: "tenant_id" }
    );
    if (policyError) {
      throw new Error(`Failed to save HR policies: ${policyError.message}`);
    }

    if (payload.roleLeaveEntitlements.length > 0) {
      const rows = payload.roleLeaveEntitlements.map((row) => ({
        tenant_id: tenantId,
        role_key: row.roleKey,
        annual_leave_days: row.annualLeaveDays,
        updated_at: new Date().toISOString()
      }));
      const { error: entError } = await supabase
        .from("hr_role_leave_entitlements")
        .upsert(rows, { onConflict: "tenant_id,role_key" });
      if (entError) {
        throw new Error(`Failed to save leave entitlements: ${entError.message}`);
      }
    }
  }

  const policies = await getHrPolicies(tenantId);
  memoryPolicies.set(tenantId, policies);
  return policies;
}

export async function getLateCheckInTime(tenantId: string): Promise<string> {
  const policies = await getHrPolicies(tenantId);
  return normalizeTime(policies.lateCheckInTime);
}

export async function getAnnualLeaveEntitlement(tenantId: string, userRole: string): Promise<number> {
  const policies = await getHrPolicies(tenantId);
  const match = policies.roleLeaveEntitlements.find((row) => row.roleKey === userRole);
  return match?.annualLeaveDays ?? policies.defaultAnnualLeaveDays;
}

export function isLateCheckIn(checkInTime: string, lateThreshold: string): boolean {
  return normalizeTime(checkInTime) > normalizeTime(lateThreshold);
}
