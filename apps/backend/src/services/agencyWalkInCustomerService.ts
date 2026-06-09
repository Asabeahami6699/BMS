import { AGENCY_WALK_IN_CUSTOMER_NAME, customerSchema, type Customer } from "@bms/shared";
import { randomUUID } from "node:crypto";
import { getSupabaseAdminClient } from "../config/supabaseClient.js";
import { generateCustomerAccountNumber } from "./accountNumberPolicyService.js";

const WALK_IN_NAME = AGENCY_WALK_IN_CUSTOMER_NAME;

export async function ensureAgencyWalkInCustomer(
  tenantId: string,
  branchId: string
): Promise<Customer> {
  const supabase = getSupabaseAdminClient();
  if (supabase) {
    const { data: existing, error: findError } = await supabase
      .from("customers")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("home_branch_id", branchId)
      .eq("full_name", WALK_IN_NAME)
      .eq("status", "active")
      .limit(1)
      .maybeSingle();
    if (findError) {
      throw new Error(`Failed to resolve walk-in customer: ${findError.message}`);
    }
    if (existing) {
      return mapCustomerRow(existing as Record<string, unknown>);
    }

    const accountNumber = await generateCustomerAccountNumber(tenantId);
    const id = randomUUID();
    const { data: created, error: insertError } = await supabase
      .from("customers")
      .insert({
        id,
        tenant_id: tenantId,
        full_name: WALK_IN_NAME,
        phone: "0000000000",
        home_branch_id: branchId,
        account_number: accountNumber,
        account_type: "savings",
        status: "active",
        daily_contribution_amount: 0,
        created_by_field_agent_id: "agency-walk-in"
      })
      .select("*")
      .single();
    if (insertError) {
      throw new Error(`Failed to create walk-in customer: ${insertError.message}`);
    }
    return mapCustomerRow(created as Record<string, unknown>);
  }

  const { listCustomers } = await import("./customerService.js");
  const customers = await listCustomers(tenantId, { branchId, status: "active" });
  const found = customers.find((c) => c.fullName === WALK_IN_NAME);
  if (found) {
    return found;
  }
  throw new Error("Walk-in customer is not available in memory mode");
}

function mapCustomerRow(row: Record<string, unknown>): Customer {
  return customerSchema.parse({
    id: String(row.id),
    tenantId: String(row.tenant_id),
    fullName: String(row.full_name),
    phone: String(row.phone ?? ""),
    homeBranchId: String(row.home_branch_id),
    accountNumber: row.account_number != null ? String(row.account_number) : undefined,
    accountType: row.account_type ?? undefined,
    status: row.status,
    createdByFieldAgentId: String(row.created_by_field_agent_id ?? "agency-walk-in"),
    dailyContributionAmount: Number(row.daily_contribution_amount ?? 0)
  });
}
