import {
  buildDeductionLines,
  computeStaffPayrollPreview,
  currentPayrollPeriod,
  payslipSchema,
  roleReceivesCommission,
  runPayrollInputSchema,
  sumDeductionLines,
  type Payslip,
  type PayslipLine,
  type Role,
  type RunPayrollInput,
  type UserPayrollProfile
} from "@bms/shared";
import { getSupabaseAdminClient } from "../config/supabaseClient.js";
import { isMissingSupabaseResource } from "../lib/supabaseSchema.js";
import { getCommissionPolicy } from "./commissionPolicyService.js";
import {
  effectiveCommissionPercent,
  getUserPayrollProfile,
  listStaffPayrollSetup,
  profileDeductions
} from "./userPayrollProfileService.js";

const payslipStore = new Map<string, Payslip[]>();
let warnedMissingPayslipsTable = false;

function warnMissingPayslipsOnce(): void {
  if (warnedMissingPayslipsTable) {
    return;
  }
  warnedMissingPayslipsTable = true;
  console.warn(
    "[payroll] payslips table not found — using in-memory store. Apply migration 028_payroll_deductions_and_payslips.sql in Supabase."
  );
}

type PayslipBuildInput = {
  tenantId: string;
  userId: string;
  role: Role;
  periodId: string;
  baseSalary: number;
  collections: number;
  commissionAmount: number;
  tierBonus: number;
  monthlyBonus: number;
  effectivePercent: number;
  deductions: UserPayrollProfile | undefined;
};

function buildPayslip(input: PayslipBuildInput): Payslip {
  const lines: PayslipLine[] = [{ key: "basic_salary", label: "Basic salary", amount: input.baseSalary }];

  if (roleReceivesCommission(input.role)) {
    lines.push(
      { key: "collection_base", label: "Collections (period)", amount: input.collections },
      {
        key: "commission",
        label: `Susu commission (${input.effectivePercent}%)`,
        amount: input.commissionAmount
      }
    );
  }

  if (input.tierBonus > 0) {
    lines.push({ key: "tier_bonus", label: "Performance bonus (tiers)", amount: input.tierBonus });
  }

  if (input.monthlyBonus > 0) {
    lines.push({ key: "monthly_bonus", label: "Monthly bonus", amount: input.monthlyBonus });
  }

  const grossPay = input.baseSalary + input.commissionAmount + input.tierBonus + input.monthlyBonus;
  const deductionLines = buildDeductionLines(
    input.baseSalary,
    profileDeductions(
      input.deductions ?? {
        ssnitRatePercent: null,
        ssnitFixedAmount: 0,
        welfareDeduction: 0,
        loanDeduction: 0
      }
    )
  );
  const totalDeductions = sumDeductionLines(deductionLines);
  const netPay = Math.max(0, grossPay - totalDeductions);

  return payslipSchema.parse({
    id: `pay-${input.userId}-${input.periodId}`,
    tenantId: input.tenantId,
    userId: input.userId,
    role: input.role,
    periodId: input.periodId,
    lines,
    deductionLines,
    grossPay,
    totalDeductions,
    netPay,
    runAt: new Date().toISOString()
  });
}

function mapDbPayslip(row: Record<string, unknown>): Payslip {
  return payslipSchema.parse({
    id: String(row.id),
    tenantId: String(row.tenant_id),
    userId: String(row.user_id),
    role: row.role,
    periodId: String(row.period_id),
    lines: row.lines ?? [],
    deductionLines: row.deduction_lines ?? [],
    grossPay: Number(row.gross_pay),
    totalDeductions: Number(row.total_deductions ?? 0),
    netPay: Number(row.net_pay),
    runAt: row.run_at ? String(row.run_at) : undefined
  });
}

async function persistPayslips(tenantId: string, payslips: Payslip[]): Promise<void> {
  payslipStore.set(tenantId, payslips);
  const supabase = getSupabaseAdminClient();
  if (!supabase) {
    return;
  }

  const rows = payslips.map((p) => ({
    id: p.id,
    tenant_id: p.tenantId,
    user_id: p.userId,
    role: p.role,
    period_id: p.periodId,
    lines: p.lines,
    deduction_lines: p.deductionLines,
    gross_pay: p.grossPay,
    total_deductions: p.totalDeductions,
    net_pay: p.netPay,
    run_at: p.runAt ?? new Date().toISOString()
  }));

  const { error } = await supabase.from("payslips").upsert(rows, { onConflict: "id" });
  if (error) {
    if (isMissingSupabaseResource(error.message)) {
      warnMissingPayslipsOnce();
      return;
    }
    throw new Error(`Failed to save payslips: ${error.message}`);
  }
}

async function loadPayslipsFromDb(tenantId: string, filter?: { userId?: string; periodId?: string }): Promise<Payslip[]> {
  const supabase = getSupabaseAdminClient();
  if (!supabase) {
    const all = payslipStore.get(tenantId) ?? [];
    return all.filter((p) => {
      if (filter?.userId && p.userId !== filter.userId) return false;
      if (filter?.periodId && p.periodId !== filter.periodId) return false;
      return true;
    });
  }

  let query = supabase.from("payslips").select("*").eq("tenant_id", tenantId).order("run_at", { ascending: false });
  if (filter?.userId) {
    query = query.eq("user_id", filter.userId);
  }
  if (filter?.periodId) {
    query = query.eq("period_id", filter.periodId);
  }

  const { data, error } = await query;
  if (error) {
    if (isMissingSupabaseResource(error.message)) {
      warnMissingPayslipsOnce();
      const all = payslipStore.get(tenantId) ?? [];
      return all.filter((p) => {
        if (filter?.userId && p.userId !== filter.userId) return false;
        if (filter?.periodId && p.periodId !== filter.periodId) return false;
        return true;
      });
    }
    throw new Error(`Failed to load payslips: ${error.message}`);
  }

  const payslips = (data ?? []).map((row) => mapDbPayslip(row as Record<string, unknown>));
  if (!filter?.userId) {
    payslipStore.set(tenantId, payslips);
  }
  return payslips;
}

export async function runPayrollForTenant(
  tenantId: string,
  period = currentPayrollPeriod()
): Promise<Payslip[]> {
  const rows = await listStaffPayrollSetup(tenantId, period);
  const payslips = await Promise.all(
    rows.map(async (row) => {
      const profile = await getUserPayrollProfile(tenantId, row.userId);
      return buildPayslip({
        tenantId,
        userId: row.userId,
        role: row.role,
        periodId: period.id,
        baseSalary: row.baseSalary,
        collections: row.collectionsThisPeriod,
        commissionAmount: row.projectedCommission,
        tierBonus: row.projectedTierBonus,
        monthlyBonus: row.monthlyBonus,
        effectivePercent: row.effectiveCommissionPercent,
        deductions: profile
      });
    })
  );
  await persistPayslips(tenantId, payslips);
  return payslips;
}

export async function runPayroll(input: unknown): Promise<Payslip[]> {
  const parsed: RunPayrollInput = runPayrollInputSchema.parse(input);
  const policy = getCommissionPolicy(parsed.tenantId);
  const periodId = parsed.period.id;

  if (parsed.collections.length === 0) {
    return runPayrollForTenant(parsed.tenantId, {
      id: periodId,
      label: periodId,
      startDate: parsed.period.startDate,
      endDate: parsed.period.endDate,
      startIso: new Date(parsed.period.startDate).toISOString(),
      endIso: new Date(parsed.period.endDate).toISOString()
    });
  }

  const payslips: Payslip[] = [];

  for (const collection of parsed.collections) {
    const profile = await getUserPayrollProfile(parsed.tenantId, collection.userId);
    const baseSalary = parsed.baseSalaryByUser[collection.userId] ?? profile?.baseSalary ?? 0;
    const monthlyBonus = parsed.bonusByUser[collection.userId] ?? profile?.monthlyBonus ?? 0;
    const effectivePercent = effectiveCommissionPercent(collection.role, policy, profile);
    const preview = computeStaffPayrollPreview({
      baseSalary,
      monthlyBonus,
      collections: collection.amount,
      commissionPercent: effectivePercent,
      commissionsApply: roleReceivesCommission(collection.role),
      policyEnabled: policy.enabled,
      bonusRules: policy.bonusRules,
      deductions: profileDeductions(profile)
    });

    payslips.push(
      buildPayslip({
        tenantId: parsed.tenantId,
        userId: collection.userId,
        role: collection.role,
        periodId,
        baseSalary,
        collections: collection.amount,
        commissionAmount: preview.projectedCommission,
        tierBonus: preview.projectedTierBonus,
        monthlyBonus,
        effectivePercent,
        deductions: profile
      })
    );
  }

  await persistPayslips(parsed.tenantId, payslips);
  return payslips;
}

export async function getMyPayslips(tenantId: string, userId: string): Promise<Payslip[]> {
  return loadPayslipsFromDb(tenantId, { userId });
}

export async function listTenantPayslips(
  tenantId: string,
  periodId?: string
): Promise<Payslip[]> {
  return loadPayslipsFromDb(tenantId, periodId ? { periodId } : undefined);
}

export async function getPayslipById(tenantId: string, payslipId: string): Promise<Payslip | undefined> {
  const all = await loadPayslipsFromDb(tenantId);
  return all.find((payslip) => payslip.id === payslipId);
}

export function seedDemoPayslip(tenantId: string, userId: string, role: Role, periodId = "2026-06"): Payslip {
  const deductionLines = buildDeductionLines(1200, {
    ssnitRatePercent: 5.5,
    ssnitFixedAmount: 0,
    welfareDeduction: 25,
    loanDeduction: 0
  });
  const totalDeductions = sumDeductionLines(deductionLines);
  const grossPay = role === "field_agent" ? 1310 : 1275;
  const payslip = payslipSchema.parse({
    id: `pay-${userId}-${periodId}`,
    tenantId,
    userId,
    role,
    periodId,
    lines: [
      { key: "basic_salary", label: "Basic salary", amount: 1200 },
      { key: "commission", label: "Susu commission", amount: role === "field_agent" ? 110 : 0 },
      { key: "monthly_bonus", label: "Monthly bonus", amount: role === "coordinator" ? 75 : 0 }
    ],
    deductionLines,
    grossPay,
    totalDeductions,
    netPay: Math.max(0, grossPay - totalDeductions),
    runAt: new Date().toISOString()
  });
  const existing = payslipStore.get(tenantId) ?? [];
  const withoutDup = existing.filter((p) => p.id !== payslip.id);
  payslipStore.set(tenantId, [...withoutDup, payslip]);
  return payslip;
}
