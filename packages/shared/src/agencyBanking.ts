import { z } from "zod";

/** Kept local to avoid circular import with domain.ts (which imports agencyExecutionStatusSchema). */
const agencyWithdrawalFulfillmentModeSchema = z.enum([
  "next_day_cash",
  "momo",
  "agent_next_day"
]);

/** Agency banking execution pipeline (SaaS ledger truth). */
export const agencyExecutionStatusSchema = z.enum([
  "pending_bank",
  "pending_accountant",
  "bank_executed",
  "completed",
  "failed"
]);

export type AgencyExecutionStatus = z.infer<typeof agencyExecutionStatusSchema>;

/** Withdrawal request workflow (Customer Service → Teller for cash; MoMo via CS/coordinator). */
export const agencyWithdrawalStatusSchema = z.enum([
  "pending",
  "cs_approved",
  "bank_executed",
  "completed",
  "approved",
  "rejected",
  "expired"
]);

export type AgencyWithdrawalStatus = z.infer<typeof agencyWithdrawalStatusSchema>;

export const initiateAgencyWithdrawalSchema = z
  .object({
    customerId: z.string().uuid().optional(),
    branchId: z.string().uuid().optional(),
    manualPartnerAccount: z.boolean().optional(),
    amount: z.number().positive("Withdrawal amount must be greater than zero"),
    reason: z.string().min(3, "Enter a reason (at least 3 characters)"),
    fulfillmentMode: agencyWithdrawalFulfillmentModeSchema.default("next_day_cash"),
    bankProductId: z.string().uuid().optional(),
    workflowData: z.record(z.string(), z.unknown()).optional()
  })
  .superRefine((data, ctx) => {
    if (data.manualPartnerAccount) {
      if (!data.branchId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Branch is required for non-BMS partner withdrawals",
          path: ["branchId"]
        });
      }
      if (!data.bankProductId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Bank product is required for non-BMS partner withdrawals",
          path: ["bankProductId"]
        });
      }
      return;
    }
    if (!data.customerId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Customer is required",
        path: ["customerId"]
      });
    }
  });

export type InitiateAgencyWithdrawalInput = z.infer<typeof initiateAgencyWithdrawalSchema>;

export const AGENCY_WALK_IN_CUSTOMER_NAME = "Agency banking (walk-in)";

/** Prefer account-holder name from workflow over the shared walk-in customer record. */
export function resolveAgencyDepositCustomerName(input: {
  customerFullName?: string | null;
  workflow?: Record<string, unknown> | null;
  fallback?: string;
}): string {
  const holder =
    typeof input.workflow?.account_holder_name === "string"
      ? input.workflow.account_holder_name.trim()
      : "";
  if (holder) {
    return holder;
  }
  const fullName = input.customerFullName?.trim();
  if (fullName && fullName !== AGENCY_WALK_IN_CUSTOMER_NAME) {
    return fullName;
  }
  return input.fallback ?? "Walk-in customer";
}

/** Depositor name from workflow (person who brought the cash). */
export function resolveAgencyDepositDepositorName(
  workflow?: Record<string, unknown> | null
): string | undefined {
  const name =
    typeof workflow?.depositor_name === "string" ? workflow.depositor_name.trim() : "";
  return name || undefined;
}

export function isManualPartnerWithdrawal(disclosure: {
  workflowData?: Record<string, unknown>;
  customerName?: string;
}): boolean {
  if (disclosure.workflowData?.manual_partner_account === true) {
    return true;
  }
  return disclosure.customerName === AGENCY_WALK_IN_CUSTOMER_NAME;
}

export const AGENCY_ROLE_LABELS = {
  teller: "Teller (cash operator)",
  back_officer: "Back Officer (bank execution)",
  customer_service: "Customer Service (withdrawal intake & verification)"
} as const;

export const agencyQueueCountsSchema = z.object({
  depositsPendingBank: z.number().int().nonnegative(),
  withdrawalsPendingCs: z.number().int().nonnegative(),
  withdrawalsPendingBank: z.number().int().nonnegative(),
  withdrawalsPendingTeller: z.number().int().nonnegative()
});

export type AgencyQueueCounts = z.infer<typeof agencyQueueCountsSchema>;

export const agencyBootstrapSchema = z.object({
  queue: agencyQueueCountsSchema,
  depositsPendingBank: z.array(
    z.object({
      id: z.string(),
      customerId: z.string(),
      customerName: z.string().optional(),
      amount: z.number(),
      transactionBranchId: z.string(),
      recordedByUserId: z.string(),
      createdAt: z.string(),
      notes: z.string().optional(),
      bankProductId: z.string().optional(),
      bankProductName: z.string().optional(),
      bankLabel: z.string().optional()
    })
  ),
  withdrawalsPendingCs: z.array(z.object({ id: z.string() }).passthrough()),
  withdrawalsPendingBank: z.array(z.object({ id: z.string() }).passthrough()),
  withdrawalsPendingTeller: z.array(z.object({ id: z.string() }).passthrough())
});

export type AgencyBootstrap = z.infer<typeof agencyBootstrapSchema>;

export function isAgencyWithdrawalAwaitingCs(status: string): boolean {
  return status === "pending";
}

/** Legacy in-flight rows only; new cash withdrawals skip back-office debit. */
export function isAgencyWithdrawalAwaitingBank(status: string): boolean {
  return false;
}

export function isAgencyWithdrawalAwaitingTeller(status: string): boolean {
  return status === "cs_approved" || status === "bank_executed";
}

export function isAgencyWithdrawalComplete(status: string): boolean {
  return status === "completed" || status === "approved";
}
