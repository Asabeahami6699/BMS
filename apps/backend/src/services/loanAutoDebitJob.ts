import { formatAccountAmount } from "@bms/shared";
import { getSupabaseAdminClient } from "../config/supabaseClient.js";
import { isMissingSupabaseResource } from "../lib/supabaseSchema.js";
import { listPlatformTenants } from "./authService.js";
import { notifyTenantStaff } from "./notificationService.js";
import { isSusuLoanBridgeActive } from "./susuLoanBridgeService.js";

const INTERVAL_MS = 60 * 60 * 1000; // hourly
const SYSTEM_USER_ID = "system:loan-auto-debit";

let started = false;

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * When Susu↔Loans bridge is on, debit Susu/savings for installments due today (or overdue).
 */
export async function processDueLoanAutoDebits(): Promise<{
  attempted: number;
  paid: number;
  failed: number;
}> {
  let attempted = 0;
  let paid = 0;
  let failed = 0;

  const tenants = await listPlatformTenants();
  const { recordLoanRepayment, listLoanApplications } = await import("./loanService.js");
  const today = todayIsoDate();

  for (const tenant of tenants) {
    if (!(await isSusuLoanBridgeActive(tenant.id))) {
      continue;
    }

    let disbursed: Array<{ id: string; customerId: string; customerName?: string; branchId: string }> =
      [];
    try {
      const apps = await listLoanApplications(tenant.id);
      disbursed = apps
        .filter((a) => a.status === "disbursed")
        .map((a) => ({
          id: a.id,
          customerId: a.customerId,
          customerName: a.customerName,
          branchId: a.branchId
        }));
    } catch (error) {
      console.warn(
        `[loans] auto-debit list failed for ${tenant.id}:`,
        error instanceof Error ? error.message : error
      );
      continue;
    }

    const supabase = getSupabaseAdminClient();

    for (const loan of disbursed) {
      let dueAmount = 0;
      let dueDate: string | undefined;

      if (supabase) {
        const { data, error } = await supabase
          .from("loan_repayment_schedule")
          .select("installment_number, due_date, amount_due, amount_paid, status")
          .eq("tenant_id", tenant.id)
          .eq("loan_id", loan.id)
          .neq("status", "paid")
          .lte("due_date", today)
          .order("installment_number", { ascending: true });
        if (error) {
          if (!isMissingSupabaseResource(error.message)) {
            console.warn(`[loans] auto-debit schedule failed: ${error.message}`);
          }
          continue;
        }
        for (const row of data ?? []) {
          dueAmount += Math.max(0, Number(row.amount_due ?? 0) - Number(row.amount_paid ?? 0));
          if (!dueDate) {
            dueDate = String(row.due_date);
          }
        }
        dueAmount = Math.round(dueAmount * 100) / 100;
      } else {
        try {
          const { getLoanDetail } = await import("./loanService.js");
          const detail = await getLoanDetail(tenant.id, loan.id);
          const dueRows = detail.schedule.filter(
            (s) => s.status !== "paid" && s.dueDate <= today
          );
          dueAmount =
            Math.round(
              dueRows.reduce((sum, s) => sum + Math.max(0, s.amountDue - s.amountPaid), 0) * 100
            ) / 100;
          dueDate = dueRows[0]?.dueDate;
        } catch {
          continue;
        }
      }

      if (dueAmount <= 0) {
        continue;
      }

      attempted += 1;
      try {
        await recordLoanRepayment(
          {
            tenantId: tenant.id,
            userId: SYSTEM_USER_ID,
            role: "admin",
            branchId: loan.branchId
          },
          loan.id,
          {
            amount: dueAmount,
            branchId: loan.branchId,
            paymentSource: "susu_account",
            notes: `Auto debit for installment due ${dueDate ?? today}`
          }
        );
        paid += 1;
        const successBody = `${loan.customerName ?? "Borrower"}: GHS ${formatAccountAmount(dueAmount)} deducted for due installment${dueDate ? ` (${dueDate})` : ""}.`;
        await notifyTenantStaff({
          tenantId: tenant.id,
          roles: ["admin", "coordinator", "accountant"],
          kind: "loan_auto_repayment",
          title: "Loan auto-repaid from Susu",
          body: successBody,
          customerId: loan.customerId
        }).catch(() => {
          /* non-blocking */
        });
        try {
          const { getCustomerById } = await import("./customerService.js");
          const { createAgentNotification } = await import("./notificationService.js");
          const customer = await getCustomerById(tenant.id, loan.customerId);
          if (customer?.assignedFieldAgentId) {
            await createAgentNotification({
              tenantId: tenant.id,
              userId: customer.assignedFieldAgentId,
              customerId: loan.customerId,
              kind: "loan_auto_repayment",
              title: "Loan auto-repaid from Susu",
              body: successBody
            });
          }
        } catch {
          /* non-blocking */
        }
      } catch (error) {
        failed += 1;
        const message = error instanceof Error ? error.message : "Auto debit failed";
        const failBody = `${loan.customerName ?? "Borrower"}: could not debit GHS ${formatAccountAmount(dueAmount)} from Susu — ${message}`;
        await notifyTenantStaff({
          tenantId: tenant.id,
          roles: ["admin", "coordinator", "accountant"],
          kind: "loan_auto_repayment_failed",
          title: "Loan auto-repayment failed",
          body: failBody,
          customerId: loan.customerId
        }).catch(() => {
          /* non-blocking */
        });
        try {
          const { getCustomerById } = await import("./customerService.js");
          const { createAgentNotification } = await import("./notificationService.js");
          const customer = await getCustomerById(tenant.id, loan.customerId);
          if (customer?.assignedFieldAgentId) {
            await createAgentNotification({
              tenantId: tenant.id,
              userId: customer.assignedFieldAgentId,
              customerId: loan.customerId,
              kind: "loan_auto_repayment_failed",
              title: "Loan auto-repayment failed",
              body: failBody
            });
          }
        } catch {
          /* non-blocking */
        }
      }
    }
  }

  return { attempted, paid, failed };
}

export function startLoanAutoDebitJob(): void {
  if (started) {
    return;
  }
  started = true;

  const run = () => {
    void processDueLoanAutoDebits()
      .then(({ attempted, paid, failed }) => {
        if (attempted > 0) {
          console.log(
            `[loans] auto-debit: attempted ${attempted}, paid ${paid}, failed ${failed}`
          );
        }
      })
      .catch((error) => {
        console.warn(
          "[loans] auto-debit job failed:",
          error instanceof Error ? error.message : error
        );
      });
  };

  setTimeout(run, 90_000);
  setInterval(run, INTERVAL_MS);
}
