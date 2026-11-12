import {
  evaluateLoanQualification,
  parseLoanQualificationSetup,
  type LoanQualificationResult,
  type LoanQualificationSetup
} from "@bms/shared";
import { getSupabaseAdminClient } from "../config/supabaseClient.js";
import { isMissingSupabaseResource } from "../lib/supabaseSchema.js";
import { listPlatformTenants } from "./authService.js";
import { getCustomerById, listCustomers } from "./customerService.js";
import { notifyCustomerLoanQualifiedSms } from "./customerSmsService.js";
import { computeCustomerBalance } from "./ledgerService.js";
import { isSusuLoanBridgeActive } from "./susuLoanBridgeService.js";

const memorySetup = new Map<string, LoanQualificationSetup>();

export async function getLoanQualificationSetup(
  tenantId: string
): Promise<LoanQualificationSetup> {
  const cached = memorySetup.get(tenantId);
  if (cached) {
    return cached;
  }
  const supabase = getSupabaseAdminClient();
  if (!supabase) {
    return parseLoanQualificationSetup({});
  }
  const { data, error } = await supabase
    .from("tenants")
    .select("loan_qualification_config")
    .eq("id", tenantId)
    .maybeSingle();
  if (error) {
    if (
      isMissingSupabaseResource(error.message) ||
      /loan_qualification_config/i.test(error.message)
    ) {
      return parseLoanQualificationSetup({});
    }
    throw new Error(`Failed to load loan qualification setup: ${error.message}`);
  }
  const setup = parseLoanQualificationSetup(
    (data as { loan_qualification_config?: unknown } | null)?.loan_qualification_config
  );
  memorySetup.set(tenantId, setup);
  return setup;
}

export async function updateLoanQualificationSetup(
  tenantId: string,
  input: unknown
): Promise<LoanQualificationSetup> {
  const setup = parseLoanQualificationSetup(input);
  memorySetup.set(tenantId, setup);
  const supabase = getSupabaseAdminClient();
  if (!supabase) {
    return setup;
  }
  const { error } = await supabase
    .from("tenants")
    .update({ loan_qualification_config: setup })
    .eq("id", tenantId);
  if (error) {
    if (/loan_qualification_config/i.test(error.message)) {
      throw new Error(
        "Loan qualification setup requires migration 083. Apply supabase migrations and retry."
      );
    }
    throw new Error(`Failed to save loan qualification setup: ${error.message}`);
  }
  return setup;
}

async function periodSusuStats(
  tenantId: string,
  customerId: string,
  periodMonths: number
): Promise<{ count: number; total: number }> {
  const supabase = getSupabaseAdminClient();
  if (!supabase) {
    return { count: 0, total: 0 };
  }
  const since = new Date();
  since.setMonth(since.getMonth() - periodMonths);
  const { data, error } = await supabase
    .from("customer_transactions")
    .select("amount")
    .eq("tenant_id", tenantId)
    .eq("customer_id", customerId)
    .eq("type", "daily_susu")
    .is("reversed_at", null)
    .gte("created_at", since.toISOString());
  if (error) {
    if (/reversed_at|column/i.test(error.message)) {
      const retry = await supabase
        .from("customer_transactions")
        .select("amount")
        .eq("tenant_id", tenantId)
        .eq("customer_id", customerId)
        .eq("type", "daily_susu")
        .gte("created_at", since.toISOString());
      if (retry.error) {
        return { count: 0, total: 0 };
      }
      const rows = retry.data ?? [];
      return {
        count: rows.length,
        total: Math.round(rows.reduce((sum, row) => sum + Number(row.amount ?? 0), 0) * 100) / 100
      };
    }
    return { count: 0, total: 0 };
  }
  const rows = data ?? [];
  return {
    count: rows.length,
    total: Math.round(rows.reduce((sum, row) => sum + Number(row.amount ?? 0), 0) * 100) / 100
  };
}

export async function evaluateCustomerLoanQualification(
  tenantId: string,
  customerId: string
): Promise<LoanQualificationResult> {
  const setup = await getLoanQualificationSetup(tenantId);
  const [accountBalance, susuStats] = await Promise.all([
    computeCustomerBalance(tenantId, customerId),
    periodSusuStats(tenantId, customerId, setup.periodMonths)
  ]);
  return evaluateLoanQualification({
    setup,
    accountBalance,
    collectionDays: susuStats.count,
    susuTotal: susuStats.total
  });
}

export async function applyLoanQualificationToCustomer(
  tenantId: string,
  customerId: string,
  options?: { sendSms?: boolean }
): Promise<LoanQualificationResult> {
  const result = await evaluateCustomerLoanQualification(tenantId, customerId);
  const supabase = getSupabaseAdminClient();
  const customer = await getCustomerById(tenantId, customerId);
  if (!customer) {
    return result;
  }

  const wasQualified = Boolean(customer.loanQualifiedAt && customer.loanQualificationBadge);
  const now = new Date().toISOString();

  if (supabase) {
    const patch: Record<string, unknown> = result.qualified
      ? {
          loan_qualified_at: customer.loanQualifiedAt ?? now,
          loan_qualification_badge: result.badgeLabel ?? "Loan ready"
        }
      : {
          loan_qualified_at: null,
          loan_qualification_badge: null
        };
    const { error } = await supabase
      .from("customers")
      .update(patch)
      .eq("tenant_id", tenantId)
      .eq("id", customerId);
    if (error && !/loan_qualified|loan_qualification/i.test(error.message)) {
      console.warn("[loans] qualification badge update failed:", error.message);
    }
  }

  const newlyQualified = result.qualified && !wasQualified;
  if (newlyQualified && options?.sendSms !== false) {
    const setup = await getLoanQualificationSetup(tenantId);
    if (setup.notifyOnQualifySms) {
      try {
        const sent = await notifyCustomerLoanQualifiedSms({
          tenantId,
          customerId,
          badgeLabel: result.badgeLabel ?? setup.badgeLabel,
          suggestedMaxLoanGhs: result.suggestedMaxLoanGhs,
          periodMonths: result.periodMonths
        });
        if (sent && supabase) {
          await supabase
            .from("customers")
            .update({ loan_qualification_notified_at: now })
            .eq("tenant_id", tenantId)
            .eq("id", customerId);
        }
      } catch (error) {
        console.warn(
          "[loans] qualification SMS skipped:",
          error instanceof Error ? error.message : error
        );
      }
    }
  }

  return result;
}

export async function processLoanQualificationScan(): Promise<{
  tenants: number;
  evaluated: number;
  qualified: number;
}> {
  let tenantsScanned = 0;
  let evaluated = 0;
  let qualified = 0;
  const tenants = await listPlatformTenants();
  for (const tenant of tenants) {
    if (!(await isSusuLoanBridgeActive(tenant.id))) {
      continue;
    }
    const setup = await getLoanQualificationSetup(tenant.id);
    if (!setup.enabled) {
      continue;
    }
    tenantsScanned += 1;
    let customers: Awaited<ReturnType<typeof listCustomers>> = [];
    try {
      customers = await listCustomers(tenant.id, { status: "active", light: true });
    } catch {
      continue;
    }
    for (const customer of customers) {
      evaluated += 1;
      try {
        const result = await applyLoanQualificationToCustomer(tenant.id, customer.id);
        if (result.qualified) {
          qualified += 1;
        }
      } catch {
        /* continue */
      }
    }
  }
  return { tenants: tenantsScanned, evaluated, qualified };
}

let qualificationJobStarted = false;

export function startLoanQualificationJob(): void {
  if (qualificationJobStarted) {
    return;
  }
  qualificationJobStarted = true;
  const run = () => {
    void processLoanQualificationScan()
      .then(({ tenants, evaluated, qualified }) => {
        if (evaluated > 0) {
          console.log(
            `[loans] qualification scan: tenants ${tenants}, evaluated ${evaluated}, qualified ${qualified}`
          );
        }
      })
      .catch((error) => {
        console.warn(
          "[loans] qualification job failed:",
          error instanceof Error ? error.message : error
        );
      });
  };
  setTimeout(run, 120_000);
  setInterval(run, 6 * 60 * 60 * 1000);
}
