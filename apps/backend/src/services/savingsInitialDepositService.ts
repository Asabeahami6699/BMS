import { SAVINGS_INITIAL_DEPOSIT_GHS, type Customer } from "@bms/shared";
import { randomUUID } from "node:crypto";
import { getSupabaseAdminClient } from "../config/supabaseClient.js";
import { addLedgerEntry } from "./ledgerService.js";

const INITIAL_DEPOSIT_NOTES = "Savings initial deposit (non-withdrawable)";

export async function applySavingsInitialDepositOnApproval(
  tenantId: string,
  customer: Customer,
  recordedByUserId: string
): Promise<void> {
  if (customer.accountType !== "savings") {
    return;
  }

  const amount = SAVINGS_INITIAL_DEPOSIT_GHS;
  if ((customer.lockedBalance ?? 0) >= amount) {
    return;
  }

  const supabase = getSupabaseAdminClient();
  if (supabase) {
    const { error: lockError } = await supabase
      .from("customers")
      .update({ locked_balance: amount })
      .eq("tenant_id", tenantId)
      .eq("id", customer.id);

    if (lockError) {
      throw new Error(`Failed to set savings locked deposit: ${lockError.message}`);
    }

    const transactionId = randomUUID();
    const { error: rpcError } = await supabase.rpc("post_customer_transaction_atomic", {
      p_transaction_id: transactionId,
      p_tenant_id: tenantId,
      p_customer_id: customer.id,
      p_type: "deposit",
      p_amount: amount,
      p_transaction_branch_id: customer.homeBranchId,
      p_home_branch_id: customer.homeBranchId,
      p_recorded_by_user_id: recordedByUserId,
      p_field_agent_id: customer.assignedFieldAgentId,
      p_notes: INITIAL_DEPOSIT_NOTES
    });

    if (rpcError) {
      throw new Error(`Failed to post savings initial deposit: ${rpcError.message}`);
    }
    return;
  }

  customer.lockedBalance = amount;
  await addLedgerEntry({
    tenantId,
    customerId: customer.id,
    transactionId: randomUUID(),
    entryType: "credit",
    amount,
    transactionBranchId: customer.homeBranchId
  });
}
