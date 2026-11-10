import { getSupabaseAdminClient } from "../config/supabaseClient.js";
import { isMissingSupabaseResource } from "../lib/supabaseSchema.js";
import { isSusuLoanBridgeActive } from "./susuLoanBridgeService.js";

export type LoanInstallmentReserve = {
  loanId: string;
  installmentNumber: number;
  dueDate: string;
  amountReserved: number;
};

/**
 * Next unpaid installment remaining for each disbursed loan belonging to the customer.
 * Only applies when Susu↔Loans bridge is enabled (Susu + Loans subscribed).
 */
export async function listCustomerLoanInstallmentReserves(
  tenantId: string,
  customerId: string
): Promise<LoanInstallmentReserve[]> {
  if (!(await isSusuLoanBridgeActive(tenantId))) {
    return [];
  }

  const supabase = getSupabaseAdminClient();
  const loanIds: string[] = [];

  if (supabase) {
    const { data, error } = await supabase
      .from("loan_applications")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("customer_id", customerId)
      .eq("status", "disbursed");
    if (error) {
      if (isMissingSupabaseResource(error.message)) {
        return [];
      }
      throw new Error(`Failed to load loans for reserve: ${error.message}`);
    }
    for (const row of data ?? []) {
      loanIds.push(String(row.id));
    }
  } else {
    const { listLoanApplications } = await import("./loanService.js");
    const apps = await listLoanApplications(tenantId);
    for (const app of apps) {
      if (app.customerId === customerId && app.status === "disbursed") {
        loanIds.push(app.id);
      }
    }
  }

  const reserves: LoanInstallmentReserve[] = [];
  for (const loanId of loanIds) {
    const next = await getNextUnpaidInstallment(tenantId, loanId);
    if (next && next.amountReserved > 0) {
      reserves.push({ loanId, ...next });
    }
  }
  return reserves;
}

export async function getCustomerLoanInstallmentReserve(
  tenantId: string,
  customerId: string
): Promise<number> {
  const reserves = await listCustomerLoanInstallmentReserves(tenantId, customerId);
  return Math.round(reserves.reduce((sum, r) => sum + r.amountReserved, 0) * 100) / 100;
}

async function getNextUnpaidInstallment(
  tenantId: string,
  loanId: string
): Promise<{ installmentNumber: number; dueDate: string; amountReserved: number } | null> {
  const supabase = getSupabaseAdminClient();
  if (supabase) {
    const { data, error } = await supabase
      .from("loan_repayment_schedule")
      .select("installment_number, due_date, amount_due, amount_paid, status")
      .eq("tenant_id", tenantId)
      .eq("loan_id", loanId)
      .neq("status", "paid")
      .order("installment_number", { ascending: true })
      .limit(1);
    if (error) {
      if (isMissingSupabaseResource(error.message)) {
        return null;
      }
      throw new Error(`Failed to load loan schedule: ${error.message}`);
    }
    const row = data?.[0];
    if (!row) {
      return null;
    }
    const amountDue = Number(row.amount_due ?? 0);
    const amountPaid = Number(row.amount_paid ?? 0);
    const amountReserved = Math.max(0, Math.round((amountDue - amountPaid) * 100) / 100);
    if (amountReserved <= 0) {
      return null;
    }
    return {
      installmentNumber: Number(row.installment_number),
      dueDate: String(row.due_date),
      amountReserved
    };
  }

  const { getLoanDetail } = await import("./loanService.js");
  try {
    const detail = await getLoanDetail(tenantId, loanId);
    const next = [...detail.schedule]
      .filter((s) => s.status !== "paid")
      .sort((a, b) => a.installmentNumber - b.installmentNumber)[0];
    if (!next) {
      return null;
    }
    const amountReserved = Math.max(
      0,
      Math.round((next.amountDue - next.amountPaid) * 100) / 100
    );
    if (amountReserved <= 0) {
      return null;
    }
    return {
      installmentNumber: next.installmentNumber,
      dueDate: next.dueDate,
      amountReserved
    };
  } catch {
    return null;
  }
}
