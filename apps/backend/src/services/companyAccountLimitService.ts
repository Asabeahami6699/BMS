import {
  bankProductAppliesToBranch,
  resolveCompanyAccountExecutionLimit,
  COMPANY_ACCOUNT_DEFAULT_EXECUTION_LIMIT
} from "@bms/shared";
import { getSupabaseAdminClient } from "../config/supabaseClient.js";
import { getBankProductById, listBankProducts } from "./bankProductService.js";

function todayDate(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function sumExecutedDepositsForCompanyAccount(
  tenantId: string,
  branchId: string,
  businessDate: string,
  executionBankProductId: string
): Promise<number> {
  const supabase = getSupabaseAdminClient();
  if (!supabase) {
    return 0;
  }
  const dayStart = `${businessDate}T00:00:00.000Z`;
  const dayEnd = `${businessDate}T23:59:59.999Z`;
  const { data } = await supabase
    .from("customer_transactions")
    .select("amount")
    .eq("tenant_id", tenantId)
    .eq("transaction_branch_id", branchId)
    .eq("type", "deposit")
    .eq("execution_status", "completed")
    .eq("execution_bank_product_id", executionBankProductId)
    .gte("bank_executed_at", dayStart)
    .lte("bank_executed_at", dayEnd);
  return (data ?? []).reduce((sum, row) => sum + Number(row.amount ?? 0), 0);
}

export type CompanyAccountHeadroom = {
  limit: number;
  executed: number;
  headroom: number;
  exceeds: boolean;
};

export async function getCompanyAccountHeadroom(
  tenantId: string,
  branchId: string,
  businessDate: string,
  executionBankProductId: string,
  additionalAmount = 0
): Promise<CompanyAccountHeadroom> {
  const product = await getBankProductById(tenantId, executionBankProductId);
  const limit = resolveCompanyAccountExecutionLimit(product?.executionLimitAmount);
  const executed = await sumExecutedDepositsForCompanyAccount(
    tenantId,
    branchId,
    businessDate,
    executionBankProductId
  );
  const headroom = Math.max(0, limit - executed);
  return {
    limit,
    executed,
    headroom,
    exceeds: executed + additionalAmount > limit
  };
}

/** Mirrors Ecobank agency cap: single deposit or cumulative daily execution over limit → accountant. */
export async function evaluateAgencyDepositExecutionStatus(
  tenantId: string,
  branchId: string,
  amount: number
): Promise<"pending_bank" | "pending_accountant"> {
  if (amount > COMPANY_ACCOUNT_DEFAULT_EXECUTION_LIMIT) {
    return "pending_accountant";
  }

  const products = await listBankProducts(tenantId, { activeOnly: true });
  const companyAccounts = products.filter(
    (p) => p.isCompanyBankAccount && bankProductAppliesToBranch(p, branchId)
  );

  if (companyAccounts.length === 0) {
    return "pending_bank";
  }

  const businessDate = todayDate();
  for (const account of companyAccounts) {
    const limit = resolveCompanyAccountExecutionLimit(account.executionLimitAmount);
    if (amount > limit) {
      return "pending_accountant";
    }
    const headroom = await getCompanyAccountHeadroom(
      tenantId,
      branchId,
      businessDate,
      account.id,
      amount
    );
    if (headroom.exceeds) {
      return "pending_accountant";
    }
  }

  return "pending_bank";
}

export async function assertCompanyAccountCanExecute(
  tenantId: string,
  branchId: string,
  businessDate: string,
  executionBankProductId: string,
  amount: number
): Promise<void> {
  const headroom = await getCompanyAccountHeadroom(
    tenantId,
    branchId,
    businessDate,
    executionBankProductId,
    amount
  );
  if (headroom.exceeds) {
    throw new Error(
      `Company account limit reached (GHS ${headroom.limit.toLocaleString()}). ` +
        `Executed today: GHS ${headroom.executed.toFixed(2)}. ` +
        `Arrange agent-to-agent transfer before more deposits, or ask the accountant to approve.`
    );
  }
  if (amount > headroom.limit) {
    throw new Error(
      `This deposit exceeds the company account single-day limit of GHS ${headroom.limit.toLocaleString()}.`
    );
  }
}
