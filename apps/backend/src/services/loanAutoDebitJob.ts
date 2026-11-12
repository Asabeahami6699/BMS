import { formatAccountAmount, type LoanApplication } from "@bms/shared";
import { randomUUID } from "node:crypto";
import { getSupabaseAdminClient } from "../config/supabaseClient.js";
import { isMissingSupabaseResource } from "../lib/supabaseSchema.js";
import { listPlatformTenants } from "./authService.js";
import { getCustomerById } from "./customerService.js";
import { notifyTenantStaff, createAgentNotification } from "./notificationService.js";
import { isSusuLoanBridgeActive } from "./susuLoanBridgeService.js";
import { deliverLoanRecoveryCustomerSms } from "./customerSmsService.js";

const INTERVAL_MS = 60 * 60 * 1000; // hourly
const SYSTEM_USER_ID = "system:loan-auto-debit";

let started = false;

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function daysBetweenIso(a: string, b: string): number {
  const ms = Date.parse(b.slice(0, 10)) - Date.parse(a.slice(0, 10));
  if (!Number.isFinite(ms)) {
    return 0;
  }
  return Math.floor(ms / (24 * 60 * 60 * 1000));
}

async function recordAutoDebitEvent(input: {
  tenantId: string;
  loanId: string;
  customerId: string;
  eventType: "attempt" | "paid" | "failed" | "retry" | "sms" | "agent_task" | "par_escalated";
  amount: number;
  message?: string;
}): Promise<void> {
  const supabase = getSupabaseAdminClient();
  if (!supabase) {
    return;
  }
  const { error } = await supabase.from("loan_auto_debit_events").insert({
    id: randomUUID(),
    tenant_id: input.tenantId,
    loan_id: input.loanId,
    customer_id: input.customerId,
    event_type: input.eventType,
    amount: input.amount,
    message: input.message ?? null
  });
  if (error && !isMissingSupabaseResource(error.message) && !/loan_auto_debit_events/i.test(error.message)) {
    console.warn(`[loans] auto-debit event log failed: ${error.message}`);
  }
}

async function patchLoanRecovery(
  tenantId: string,
  loanId: string,
  patch: Partial<
    Pick<
      LoanApplication,
      | "autoDebitFailCount"
      | "autoDebitLastFailedAt"
      | "autoDebitRecoveryStage"
      | "parEscalatedAt"
    >
  >
): Promise<void> {
  const supabase = getSupabaseAdminClient();
  if (!supabase) {
    return;
  }
  const { error } = await supabase
    .from("loan_applications")
    .update({
      auto_debit_fail_count: patch.autoDebitFailCount ?? 0,
      auto_debit_last_failed_at: patch.autoDebitLastFailedAt ?? null,
      auto_debit_recovery_stage: patch.autoDebitRecoveryStage ?? null,
      par_escalated_at: patch.parEscalatedAt ?? null,
      updated_at: new Date().toISOString()
    })
    .eq("tenant_id", tenantId)
    .eq("id", loanId);
  if (error && !/auto_debit_|par_escalated/i.test(error.message)) {
    console.warn(`[loans] recovery patch failed: ${error.message}`);
  }
}

/**
 * Missed auto-debit recovery ladder:
 * retry next day → SMS → agent task → escalate PAR
 */
async function advanceRecoveryLadder(input: {
  tenantId: string;
  loan: {
    id: string;
    customerId: string;
    customerName?: string;
    autoDebitFailCount?: number;
    autoDebitLastFailedAt?: string;
    autoDebitRecoveryStage?: LoanApplication["autoDebitRecoveryStage"];
    parEscalatedAt?: string;
  };
  dueAmount: number;
  failMessage: string;
}): Promise<void> {
  const today = todayIsoDate();
  const prevCount = input.loan.autoDebitFailCount ?? 0;
  const lastFailed = input.loan.autoDebitLastFailedAt?.slice(0, 10);
  const stage = input.loan.autoDebitRecoveryStage;

  // First failure of a new miss cycle → schedule next-day retry.
  if (!stage || stage === undefined) {
    await patchLoanRecovery(input.tenantId, input.loan.id, {
      autoDebitFailCount: prevCount + 1,
      autoDebitLastFailedAt: new Date().toISOString(),
      autoDebitRecoveryStage: "retry_pending"
    });
    await recordAutoDebitEvent({
      tenantId: input.tenantId,
      loanId: input.loan.id,
      customerId: input.loan.customerId,
      eventType: "failed",
      amount: input.dueAmount,
      message: `${input.failMessage} · retry scheduled next day`
    });
    return;
  }

  // Wait until at least the next calendar day before advancing.
  if (lastFailed && daysBetweenIso(lastFailed, today) < 1) {
    await recordAutoDebitEvent({
      tenantId: input.tenantId,
      loanId: input.loan.id,
      customerId: input.loan.customerId,
      eventType: "failed",
      amount: input.dueAmount,
      message: `${input.failMessage} · waiting for next-day ladder step`
    });
    return;
  }

  if (stage === "retry_pending") {
    // Retry already attempted and failed again → SMS customer.
    await patchLoanRecovery(input.tenantId, input.loan.id, {
      autoDebitFailCount: prevCount + 1,
      autoDebitLastFailedAt: new Date().toISOString(),
      autoDebitRecoveryStage: "sms_sent"
    });
    await recordAutoDebitEvent({
      tenantId: input.tenantId,
      loanId: input.loan.id,
      customerId: input.loan.customerId,
      eventType: "retry",
      amount: input.dueAmount,
      message: input.failMessage
    });
    try {
      await deliverLoanRecoveryCustomerSms({
        tenantId: input.tenantId,
        customerId: input.loan.customerId,
        amount: input.dueAmount,
        customerName: input.loan.customerName
      });
      await recordAutoDebitEvent({
        tenantId: input.tenantId,
        loanId: input.loan.id,
        customerId: input.loan.customerId,
        eventType: "sms",
        amount: input.dueAmount,
        message: "Recovery SMS sent after missed auto-debit retry"
      });
    } catch (error) {
      console.warn(
        "[loans] recovery SMS skipped:",
        error instanceof Error ? error.message : error
      );
    }
    return;
  }

  if (stage === "sms_sent") {
    await patchLoanRecovery(input.tenantId, input.loan.id, {
      autoDebitFailCount: prevCount + 1,
      autoDebitLastFailedAt: new Date().toISOString(),
      autoDebitRecoveryStage: "agent_task"
    });
    await recordAutoDebitEvent({
      tenantId: input.tenantId,
      loanId: input.loan.id,
      customerId: input.loan.customerId,
      eventType: "agent_task",
      amount: input.dueAmount,
      message: input.failMessage
    });
    const body = `${input.loan.customerName ?? "Borrower"}: collect GHS ${formatAccountAmount(input.dueAmount)} — Susu auto-debit still unpaid after SMS.`;
    try {
      const customer = await getCustomerById(input.tenantId, input.loan.customerId);
      if (customer?.assignedFieldAgentId) {
        await createAgentNotification({
          tenantId: input.tenantId,
          userId: customer.assignedFieldAgentId,
          customerId: input.loan.customerId,
          kind: "loan_auto_repayment_failed",
          title: "Agent task: collect loan installment",
          body
        });
      }
      await notifyTenantStaff({
        tenantId: input.tenantId,
        roles: ["admin", "coordinator", "accountant"],
        kind: "loan_auto_repayment_failed",
        title: "Agent task: missed Susu auto-debit",
        body,
        customerId: input.loan.customerId
      });
    } catch {
      /* non-blocking */
    }
    return;
  }

  if (stage === "agent_task") {
    const now = new Date().toISOString();
    await patchLoanRecovery(input.tenantId, input.loan.id, {
      autoDebitFailCount: prevCount + 1,
      autoDebitLastFailedAt: now,
      autoDebitRecoveryStage: "par_escalated",
      parEscalatedAt: now
    });
    await recordAutoDebitEvent({
      tenantId: input.tenantId,
      loanId: input.loan.id,
      customerId: input.loan.customerId,
      eventType: "par_escalated",
      amount: input.dueAmount,
      message: input.failMessage
    });
    const body = `${input.loan.customerName ?? "Borrower"}: PAR escalation — GHS ${formatAccountAmount(input.dueAmount)} still unpaid after retry, SMS, and agent task.`;
    await notifyTenantStaff({
      tenantId: input.tenantId,
      roles: ["admin", "coordinator", "accountant"],
      kind: "loan_auto_repayment_failed",
      title: "PAR escalated: missed Susu auto-debit",
      body,
      customerId: input.loan.customerId
    }).catch(() => undefined);
    return;
  }

  // Already PAR-escalated — keep logging failures.
  await patchLoanRecovery(input.tenantId, input.loan.id, {
    autoDebitFailCount: prevCount + 1,
    autoDebitLastFailedAt: new Date().toISOString(),
    autoDebitRecoveryStage: "par_escalated",
    parEscalatedAt: input.loan.parEscalatedAt ?? new Date().toISOString()
  });
  await recordAutoDebitEvent({
    tenantId: input.tenantId,
    loanId: input.loan.id,
    customerId: input.loan.customerId,
    eventType: "failed",
    amount: input.dueAmount,
    message: `${input.failMessage} · already PAR escalated`
  });
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

    let disbursed: LoanApplication[] = [];
    try {
      const apps = await listLoanApplications(tenant.id);
      disbursed = apps.filter((a) => a.status === "disbursed");
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

      // If recovery is waiting for next-day retry and we already failed today, skip re-attempt spam.
      if (
        loan.autoDebitRecoveryStage === "retry_pending" &&
        loan.autoDebitLastFailedAt &&
        daysBetweenIso(loan.autoDebitLastFailedAt.slice(0, 10), today) < 1
      ) {
        continue;
      }

      attempted += 1;
      await recordAutoDebitEvent({
        tenantId: tenant.id,
        loanId: loan.id,
        customerId: loan.customerId,
        eventType: "attempt",
        amount: dueAmount,
        message: `Auto debit for installment due ${dueDate ?? today}`
      });

      try {
        await recordLoanRepayment(
          {
            tenantId: tenant.id,
            userId: SYSTEM_USER_ID,
            role: "admin",
            scopeType: "head_office",
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
        await patchLoanRecovery(tenant.id, loan.id, {
          autoDebitFailCount: 0,
          autoDebitLastFailedAt: undefined,
          autoDebitRecoveryStage: undefined,
          parEscalatedAt: undefined
        });
        await recordAutoDebitEvent({
          tenantId: tenant.id,
          loanId: loan.id,
          customerId: loan.customerId,
          eventType: "paid",
          amount: dueAmount
        });
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
        await advanceRecoveryLadder({
          tenantId: tenant.id,
          loan,
          dueAmount,
          failMessage: failBody
        });
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
