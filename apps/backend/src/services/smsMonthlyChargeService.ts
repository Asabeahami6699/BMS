import { formatAccountAmount } from "@bms/shared";
import { randomUUID } from "node:crypto";
import { getSupabaseAdminClient } from "../config/supabaseClient.js";
import { getCustomerWithdrawableBalance, listCustomers } from "./customerService.js";
import { addLedgerEntry, computeCustomerBalance } from "./ledgerService.js";

export const SMS_MONTHLY_CHARGE_NOTE_TAG = "sms_charge:";
const SYSTEM_USER_ID = "system:sms-monthly-charge";

export function smsChargePeriodKey(date = new Date()): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

export function smsChargeIdempotencyTag(periodKey: string): string {
  return `${SMS_MONTHLY_CHARGE_NOTE_TAG}${periodKey}`;
}

export function smsChargeNotes(periodKey: string, amount: number): string {
  return `SMS monthly charge · ${periodKey} · GHS ${formatAccountAmount(amount)} · ${smsChargeIdempotencyTag(periodKey)}`;
}

/**
 * Debit one customer for the SMS monthly charge (idempotent per calendar month).
 * Returns skipped reason when already posted or insufficient balance.
 */
export async function postCustomerSmsMonthlyCharge(params: {
  tenantId: string;
  customerId: string;
  homeBranchId: string;
  fieldAgentId?: string;
  amount: number;
  periodKey?: string;
}): Promise<{ transactionId?: string; skipped?: string }> {
  const amount = Math.round(params.amount * 100) / 100;
  if (!(amount > 0) || amount > 5) {
    return { skipped: "invalid_amount" };
  }

  const periodKey = params.periodKey ?? smsChargePeriodKey();
  const idempotencyTag = smsChargeIdempotencyTag(periodKey);
  const notes = smsChargeNotes(periodKey, amount);
  const supabase = getSupabaseAdminClient();

  if (supabase) {
    const { data: existing, error: existingError } = await supabase
      .from("customer_transactions")
      .select("id")
      .eq("tenant_id", params.tenantId)
      .eq("customer_id", params.customerId)
      .eq("type", "withdrawal")
      .like("notes", `%${idempotencyTag}%`)
      .limit(1)
      .maybeSingle();

    if (existingError) {
      throw new Error(`Failed to check prior SMS charge: ${existingError.message}`);
    }
    if (existing?.id) {
      return { transactionId: String(existing.id), skipped: "already_charged" };
    }

    const withdrawable = await getCustomerWithdrawableBalance(params.tenantId, params.customerId);
    if (withdrawable + 1e-9 < amount) {
      return { skipped: "insufficient_balance" };
    }

    const balanceBefore = await computeCustomerBalance(params.tenantId, params.customerId);
    const transactionId = randomUUID();
    const { error: rpcError } = await supabase.rpc("post_customer_transaction_atomic", {
      p_transaction_id: transactionId,
      p_tenant_id: params.tenantId,
      p_customer_id: params.customerId,
      p_type: "withdrawal",
      p_amount: amount,
      p_transaction_branch_id: params.homeBranchId,
      p_home_branch_id: params.homeBranchId,
      p_recorded_by_user_id: SYSTEM_USER_ID,
      p_field_agent_id: params.fieldAgentId ?? SYSTEM_USER_ID,
      p_notes: notes
    });

    if (rpcError) {
      if (/insufficient/i.test(rpcError.message)) {
        return { skipped: "insufficient_balance" };
      }
      throw new Error(`Failed to post SMS monthly charge: ${rpcError.message}`);
    }

    const balanceAfter = await computeCustomerBalance(params.tenantId, params.customerId);
    const expected = Math.round((balanceBefore - amount) * 100) / 100;
    if (Math.abs(balanceAfter - expected) > 0.01) {
      throw new Error(
        `SMS charge debit did not update ledger (expected GHS ${formatAccountAmount(expected)}, actual GHS ${formatAccountAmount(balanceAfter)})`
      );
    }

    return { transactionId };
  }

  const withdrawable = await getCustomerWithdrawableBalance(params.tenantId, params.customerId);
  if (withdrawable + 1e-9 < amount) {
    return { skipped: "insufficient_balance" };
  }

  const transactionId = randomUUID();
  await addLedgerEntry({
    tenantId: params.tenantId,
    customerId: params.customerId,
    transactionId,
    entryType: "debit",
    amount,
    transactionBranchId: params.homeBranchId
  });

  return { transactionId };
}

export async function chargeTenantCustomersSmsMonthly(params: {
  tenantId: string;
  amount: number;
  periodKey?: string;
}): Promise<{ charged: number; skipped: number; failed: number }> {
  const customers = await listCustomers(params.tenantId, { light: true });
  const active = customers.filter((c) => c.status === "active");
  let charged = 0;
  let skipped = 0;
  let failed = 0;

  for (const customer of active) {
    try {
      const result = await postCustomerSmsMonthlyCharge({
        tenantId: params.tenantId,
        customerId: customer.id,
        homeBranchId: customer.homeBranchId,
        fieldAgentId: customer.assignedFieldAgentId,
        amount: params.amount,
        periodKey: params.periodKey
      });
      if (result.skipped) {
        skipped += 1;
      } else {
        charged += 1;
      }
    } catch (error) {
      failed += 1;
      console.warn(
        `[sms] monthly charge failed for customer ${customer.id}:`,
        error instanceof Error ? error.message : error
      );
    }
  }

  return { charged, skipped, failed };
}
