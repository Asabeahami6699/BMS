import { getSupabaseAdminClient } from "../config/supabaseClient.js";
import { getCommissionPolicy } from "./commissionPolicyService.js";
import { listCustomers } from "./customerService.js";
import { computeStaffPayrollPreview, type Role } from "@bms/shared";
import { getMyPayslips } from "./payrollService.js";
import { resolveEffectivePayroll } from "@bms/shared";
import { getRolePayrollDefault } from "./rolePayrollDefaultService.js";
import {
  effectiveCommissionPercent,
  getUserPayrollProfile,
  profileDeductions
} from "./userPayrollProfileService.js";
import { listTransactions } from "./transactionService.js";

type AgentContext = {
  userId: string;
  tenantId: string;
  role: string;
  email?: string;
  fullName?: string;
  branchId?: string;
  tenantName?: string;
};

export type FieldAgentTodayCollection = {
  customerId: string;
  amount: number;
  createdAt: string;
  entryCount?: number;
};

export type FieldAgentTodayCollections = {
  customerIds: string[];
  totalAmount: number;
  items: FieldAgentTodayCollection[];
  batchStatus?: "draft" | "pending_approval" | "posted" | "rejected";
  batchId?: string;
};

export type FieldAgentDashboard = {
  profile: {
    userId: string;
    fullName: string;
    email: string;
    branchId?: string;
    tenantName?: string;
    role: string;
  };
  period: {
    id: string;
    label: string;
  };
  accountsCreatedThisMonth: number;
  totalCollectedThisMonth: number;
  todayCollections: FieldAgentTodayCollections;
  commission: {
    enabled: boolean;
    percent: number;
    basis: string;
    projectedAmount: number;
  };
  payroll: {
    periodId: string;
    projectedNetPay: number;
    grossPay: number;
    lines: Array<{ key: string; label: string; amount: number }>;
    fromPayslip: boolean;
  };
  performance: {
    activeCustomers: number;
    collectedToday: number;
    pendingToday: number;
    collectionRateToday: number;
    monthCollectionTarget: number;
    monthProgressPercent: number;
  };
};

function periodMeta(date = new Date()): { id: string; label: string; startIso: string; endIso: string } {
  const year = date.getFullYear();
  const month = date.getMonth();
  const start = new Date(year, month, 1);
  const end = new Date(year, month + 1, 0, 23, 59, 59, 999);
  const monthName = start.toLocaleString("en-US", { month: "long" });
  return {
    id: `${year}-${String(month + 1).padStart(2, "0")}`,
    label: `${monthName} ${year}`,
    startIso: start.toISOString(),
    endIso: end.toISOString()
  };
}

function todayStartIso(date = new Date()): string {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).toISOString();
}

function isToday(iso: string, now = new Date()): boolean {
  const d = new Date(iso);
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
}

function isInRange(iso: string, startIso: string, endIso: string): boolean {
  const t = new Date(iso).getTime();
  return t >= new Date(startIso).getTime() && t <= new Date(endIso).getTime();
}

export async function getFieldAgentTodayCollections(
  context: AgentContext
): Promise<FieldAgentTodayCollections> {
  const { getAgentTodayCollections } = await import("./collectionBatchService.js");
  const fromBatch = await getAgentTodayCollections(context);
  if (fromBatch.batchId || fromBatch.batchStatus || fromBatch.items.length > 0) {
    return fromBatch;
  }

  const transactions = await listTransactions(context.tenantId);
  const items = transactions
    .filter(
      (tx) =>
        tx.fieldAgentId === context.userId &&
        tx.type === "daily_susu" &&
        isToday(tx.createdAt)
    )
    .map((tx) => ({
      customerId: tx.customerId,
      amount: tx.amount,
      createdAt: tx.createdAt
    }));

  const grouped = new Map<
    string,
    { amount: number; createdAt: string; entryCount: number }
  >();
  for (const item of items) {
    const existing = grouped.get(item.customerId);
    if (!existing) {
      grouped.set(item.customerId, {
        amount: item.amount,
        createdAt: item.createdAt,
        entryCount: 1
      });
      continue;
    }
    existing.amount += item.amount;
    existing.entryCount += 1;
    if (item.createdAt > existing.createdAt) {
      existing.createdAt = item.createdAt;
    }
  }

  const merged: FieldAgentTodayCollection[] = [...grouped.entries()].map(([customerId, row]) => ({
    customerId,
    amount: row.amount,
    createdAt: row.createdAt,
    entryCount: row.entryCount
  }));

  return {
    customerIds: merged.map((i) => i.customerId),
    totalAmount: merged.reduce((sum, i) => sum + i.amount, 0),
    items: merged.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  };
}

async function resolveProfile(context: AgentContext): Promise<FieldAgentDashboard["profile"]> {
  let fullName = context.fullName;
  let email = context.email ?? "";
  let tenantName = context.tenantName;
  const supabase = getSupabaseAdminClient();
  if (supabase) {
    const { data } = await supabase
      .from("users")
      .select("email, full_name")
      .eq("id", context.userId)
      .maybeSingle();
    if (data) {
      email = String(data.email ?? email);
      fullName = data.full_name ? String(data.full_name) : fullName;
    }
    const { data: tenant } = await supabase
      .from("tenants")
      .select("name")
      .eq("id", context.tenantId)
      .maybeSingle();
    if (tenant?.name) {
      tenantName = String(tenant.name);
    }
  }
  return {
    userId: context.userId,
    fullName: fullName ?? email.split("@")[0] ?? "Field agent",
    email,
    branchId: context.branchId,
    tenantName,
    role: context.role
  };
}

export async function getFieldAgentDashboard(context: AgentContext): Promise<FieldAgentDashboard> {
  const period = periodMeta();
  const policy = getCommissionPolicy(context.tenantId);
  const profile = await resolveProfile(context);
  const payrollProfile = await getUserPayrollProfile(context.tenantId, context.userId);
  const roleDefault = await getRolePayrollDefault(context.tenantId, context.role as Role);
  const effectiveComp = resolveEffectivePayroll(roleDefault, payrollProfile);
  const percent = effectiveCommissionPercent(context.role as Role, policy, payrollProfile);

  const customers = await listCustomers(context.tenantId, { agentId: context.userId });
  const activeCustomers = customers.filter((c) => c.status === "active");

  let accountsCreatedThisMonth = 0;
  const supabase = getSupabaseAdminClient();
  if (supabase) {
    const { count, error } = await supabase
      .from("customers")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", context.tenantId)
      .eq("created_by_field_agent_id", context.userId)
      .gte("created_at", period.startIso)
      .lte("created_at", period.endIso);
    if (!error && count != null) {
      accountsCreatedThisMonth = count;
    }
  } else {
    accountsCreatedThisMonth = customers.filter(
      (c) => c.createdByFieldAgentId === context.userId
    ).length;
  }

  const transactions = await listTransactions(context.tenantId);
  const agentMonthTx = transactions.filter(
    (tx) =>
      tx.fieldAgentId === context.userId &&
      tx.type === "daily_susu" &&
      isInRange(tx.createdAt, period.startIso, period.endIso)
  );
  const totalCollectedThisMonth = agentMonthTx.reduce((sum, tx) => sum + tx.amount, 0);
  const preview = computeStaffPayrollPreview({
    baseSalary: effectiveComp.baseSalary,
    monthlyBonus: effectiveComp.monthlyBonus,
    collections: totalCollectedThisMonth,
    commissionPercent: percent,
    commissionsApply: true,
    policyEnabled: policy.enabled,
    bonusRules: policy.bonusRules,
    deductions: profileDeductions(effectiveComp)
  });
  const projectedCommission = preview.projectedCommission;
  const projectedTierBonus = preview.projectedTierBonus;
  const projectedGross = preview.projectedGross;
  const projectedNet = preview.projectedNet;

  const todayCollections = await getFieldAgentTodayCollections(context);
  const collectedToday = todayCollections.customerIds.length;
  const pendingToday = Math.max(activeCustomers.length - collectedToday, 0);
  const collectionRateToday =
    activeCustomers.length > 0 ? Math.round((collectedToday / activeCustomers.length) * 100) : 0;

  const monthCollectionTarget = activeCustomers.reduce(
    (sum, c) => sum + Number(c.dailyContributionAmount ?? 0),
    0
  );
  const monthProgressPercent =
    monthCollectionTarget > 0
      ? Math.min(100, Math.round((totalCollectedThisMonth / monthCollectionTarget) * 100))
      : 0;

  const payslips = await getMyPayslips(context.tenantId, context.userId);
  const periodPayslip = payslips.find((p) => p.periodId === period.id);
  const payrollLines = periodPayslip
    ? [...periodPayslip.lines, ...periodPayslip.deductionLines.map((d) => ({ ...d, amount: -d.amount }))]
    : [
        ...(effectiveComp.baseSalary > 0
          ? [{ key: "basic_salary", label: "Basic salary", amount: effectiveComp.baseSalary }]
          : []),
        {
          key: "collection_base",
          label: "Collections (month to date)",
          amount: totalCollectedThisMonth
        },
        {
          key: "commission",
          label: `Projected commission (${percent}%)`,
          amount: projectedCommission
        },
        ...(projectedTierBonus > 0
          ? [{ key: "tier_bonus", label: "Performance bonus (tiers)", amount: projectedTierBonus }]
          : []),
        ...(effectiveComp.monthlyBonus > 0
          ? [{ key: "monthly_bonus", label: "Monthly bonus", amount: effectiveComp.monthlyBonus }]
          : []),
        ...preview.deductionLines.map((d) => ({ ...d, amount: -d.amount }))
      ];
  const grossPay = periodPayslip?.grossPay ?? projectedGross;
  const projectedNetPay = periodPayslip?.netPay ?? projectedNet;

  return {
    profile,
    period: { id: period.id, label: period.label },
    accountsCreatedThisMonth,
    totalCollectedThisMonth,
    todayCollections,
    commission: {
      enabled: policy.enabled,
      percent,
      basis: policy.basis,
      projectedAmount: projectedCommission
    },
    payroll: {
      periodId: period.id,
      projectedNetPay,
      grossPay,
      lines: payrollLines.map((l) => ({ key: l.key, label: l.label, amount: l.amount })),
      fromPayslip: Boolean(periodPayslip)
    },
    performance: {
      activeCustomers: activeCustomers.length,
      collectedToday,
      pendingToday,
      collectionRateToday,
      monthCollectionTarget,
      monthProgressPercent
    }
  };
}
