import { SAVINGS_INITIAL_DEPOSIT_GHS, type Customer } from "@bms/shared";
import { getSupabaseAdminClient } from "../config/supabaseClient.js";
import { getCustomerById } from "./customerService.js";

export type OpeningFeeDeduction = {
  feeRetained: number;
  creditAmount: number;
  feeRemaining: number;
  feeSettled: boolean;
};

export function computeOpeningFeeDeduction(
  customer: Customer,
  collectionAmount: number
): OpeningFeeDeduction | null {
  if (customer.accountType !== "savings" || customer.savingsOpeningFeeCollected) {
    return null;
  }

  const recovered = customer.savingsOpeningFeeRecovered ?? 0;
  const remaining = Math.max(0, SAVINGS_INITIAL_DEPOSIT_GHS - recovered);
  if (remaining <= 0) {
    return null;
  }

  const feeRetained = Math.min(collectionAmount, remaining);
  const creditAmount = Math.max(0, collectionAmount - feeRetained);
  const feeRemaining = remaining - feeRetained;

  return {
    feeRetained,
    creditAmount,
    feeRemaining,
    feeSettled: feeRemaining <= 0
  };
}

export async function recordOpeningFeeRecovery(
  tenantId: string,
  customerId: string,
  feeRetained: number,
  feeSettled: boolean
): Promise<void> {
  const customer = await getCustomerById(tenantId, customerId);
  if (!customer) {
    return;
  }

  const recovered = (customer.savingsOpeningFeeRecovered ?? 0) + feeRetained;
  const supabase = getSupabaseAdminClient();
  if (supabase) {
    const { error } = await supabase
      .from("customers")
      .update({
        savings_opening_fee_recovered: recovered,
        ...(feeSettled ? { savings_opening_fee_collected: true } : {})
      })
      .eq("tenant_id", tenantId)
      .eq("id", customerId);
    if (error) {
      throw new Error(`Failed to record opening fee recovery: ${error.message}`);
    }
    return;
  }

  customer.savingsOpeningFeeRecovered = recovered;
  if (feeSettled) {
    customer.savingsOpeningFeeCollected = true;
  }
}

export function openingFeeNote(deduction: OpeningFeeDeduction): string {
  return `Opening fee GHS ${deduction.feeRetained.toFixed(2)} retained from collection${
    deduction.feeRemaining > 0
      ? ` (GHS ${deduction.feeRemaining.toFixed(2)} still to recover from deposits)`
      : ""
  }`;
}
