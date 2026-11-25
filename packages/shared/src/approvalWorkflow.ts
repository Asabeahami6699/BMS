import { z } from "zod";
import type { Role } from "./auth.js";
import type { SusuNavVisibilityRow } from "./permissionsCatalog.js";

/** Roles an admin can assign to an approval step. Field agents submit requests. */
export const APPROVAL_ASSIGNABLE_ROLES = [
  "admin",
  "coordinator",
  "customer_service",
  "accountant",
  "teller",
  "auditor",
  "back_officer"
] as const satisfies readonly Role[];

export type ApprovalAssignableRole = (typeof APPROVAL_ASSIGNABLE_ROLES)[number];

const assignableRoleSchema = z.enum(APPROVAL_ASSIGNABLE_ROLES);

export const WITHDRAWAL_VERIFICATION_MODES = [
  "optional",
  "cross_branch_only",
  "always"
] as const;

export type WithdrawalVerificationMode = (typeof WITHDRAWAL_VERIFICATION_MODES)[number];

const withdrawalVerificationModeSchema = z.enum(WITHDRAWAL_VERIFICATION_MODES);

export type ApprovalWorkflow = {
  registrationApproverRoles: ApprovalAssignableRole[];
  withdrawalApproverRoles: ApprovalAssignableRole[];
  /** When false, walk-in counter withdrawals are restricted to the customer's registered home branch. */
  allowCrossBranchWithdrawals: boolean;
  /**
   * Controls whether tellers must verify customer identity (photo / ID / details) before posting
   * walk-in withdrawals. Deposits never require verification; Tier 1 Simplified KYC withdrawals
   * always require verification regardless of this setting.
   */
  withdrawalVerificationMode: WithdrawalVerificationMode;
};

/** Matches today's behavior: coordinators open accounts; coordinators and customer service can approve withdrawals. */
export const DEFAULT_APPROVAL_WORKFLOW: ApprovalWorkflow = {
  registrationApproverRoles: ["admin", "coordinator"],
  withdrawalApproverRoles: ["admin", "coordinator", "customer_service"],
  allowCrossBranchWithdrawals: true,
  withdrawalVerificationMode: "optional"
};

function withAdmin(roles: readonly ApprovalAssignableRole[]): ApprovalAssignableRole[] {
  return [...new Set<ApprovalAssignableRole>(["admin", ...roles])];
}

function normalizeRoles(
  value: unknown,
  fallback: readonly ApprovalAssignableRole[]
): ApprovalAssignableRole[] {
  const parsed = z.array(assignableRoleSchema).safeParse(value);
  return withAdmin(parsed.success ? parsed.data : fallback);
}

function normalizeVerificationMode(value: unknown): WithdrawalVerificationMode {
  const parsed = withdrawalVerificationModeSchema.safeParse(value);
  return parsed.success ? parsed.data : DEFAULT_APPROVAL_WORKFLOW.withdrawalVerificationMode;
}

export function parseApprovalWorkflow(value: unknown): ApprovalWorkflow {
  if (!value || typeof value !== "object") {
    return {
      registrationApproverRoles: [...DEFAULT_APPROVAL_WORKFLOW.registrationApproverRoles],
      withdrawalApproverRoles: [...DEFAULT_APPROVAL_WORKFLOW.withdrawalApproverRoles],
      allowCrossBranchWithdrawals: DEFAULT_APPROVAL_WORKFLOW.allowCrossBranchWithdrawals,
      withdrawalVerificationMode: DEFAULT_APPROVAL_WORKFLOW.withdrawalVerificationMode
    };
  }
  const record = value as Record<string, unknown>;
  return {
    registrationApproverRoles: normalizeRoles(
      record.registrationApproverRoles,
      DEFAULT_APPROVAL_WORKFLOW.registrationApproverRoles
    ),
    withdrawalApproverRoles: normalizeRoles(
      record.withdrawalApproverRoles,
      DEFAULT_APPROVAL_WORKFLOW.withdrawalApproverRoles
    ),
    allowCrossBranchWithdrawals:
      typeof record.allowCrossBranchWithdrawals === "boolean"
        ? record.allowCrossBranchWithdrawals
        : DEFAULT_APPROVAL_WORKFLOW.allowCrossBranchWithdrawals,
    withdrawalVerificationMode: normalizeVerificationMode(record.withdrawalVerificationMode)
  };
}

export const updateApprovalWorkflowSchema = z.object({
  registrationApproverRoles: z.array(assignableRoleSchema).min(1),
  withdrawalApproverRoles: z.array(assignableRoleSchema).min(1),
  allowCrossBranchWithdrawals: z.boolean().optional(),
  withdrawalVerificationMode: withdrawalVerificationModeSchema.optional()
});

export type WithdrawalVerificationReason = "simplified_kyc" | "always" | "cross_branch";

export type WithdrawalVerificationRequirement = {
  required: boolean;
  reason: WithdrawalVerificationReason | null;
};

/**
 * Single source of truth for walk-in branch counter identity verification:
 * - Deposits & daily Susu collections NEVER require verification.
 * - Tier 1 Simplified KYC withdrawals ALWAYS require verification regardless of tenant policy.
 * - Full KYC withdrawals follow the tenant's `withdrawalVerificationMode`.
 */
export function evaluateWalkInWithdrawalVerification(params: {
  type: string;
  mode: WithdrawalVerificationMode;
  isCrossBranch: boolean;
  kycTier?: string | null;
}): WithdrawalVerificationRequirement {
  if (params.type !== "withdrawal") {
    return { required: false, reason: null };
  }
  if (params.kycTier === "simplified") {
    return { required: true, reason: "simplified_kyc" };
  }
  if (params.mode === "always") {
    return { required: true, reason: "always" };
  }
  if (params.mode === "cross_branch_only" && params.isCrossBranch) {
    return { required: true, reason: "cross_branch" };
  }
  return { required: false, reason: null };
}

export function withdrawalVerificationRequirementMessage(
  reason: WithdrawalVerificationReason | null
): string {
  switch (reason) {
    case "simplified_kyc":
      return "Tier 1 Simplified KYC accounts must be verified before withdrawal. Open Verify to check the customer's photo and introducer details.";
    case "cross_branch":
      return "Inter-branch withdrawals require customer verification before paying cash. Open Verify to check the customer's photo and ID.";
    case "always":
      return "Company policy requires customer verification before walk-in withdrawals. Open Verify to check the customer's photo and ID.";
    default:
      return "Verify the customer's photo, ID, and account details before paying cash.";
  }
}

export type ApprovalKind = "registration" | "withdrawal";

export function roleMayApprove(workflow: ApprovalWorkflow, kind: ApprovalKind, role: string): boolean {
  const list =
    kind === "registration" ? workflow.registrationApproverRoles : workflow.withdrawalApproverRoles;
  return (list as readonly string[]).includes(role);
}

function uniqueNavRoles(roles: readonly Role[]): Role[] {
  const next: Role[] = [];
  for (const role of roles) {
    if (!next.includes(role)) {
      next.push(role);
    }
  }
  return next;
}

/** Let the chosen approvers open the queues they are responsible for. */
export function applyApprovalWorkflowToSusuNav(
  rows: SusuNavVisibilityRow[],
  workflow: ApprovalWorkflow
): SusuNavVisibilityRow[] {
  const registration = new Set<Role>(workflow.registrationApproverRoles);
  const withdrawal = new Set<Role>(workflow.withdrawalApproverRoles);
  const either = new Set<Role>([...registration, ...withdrawal]);

  return rows.map((row) => {
    if (row.navPath === "susu/pending-approvals") {
      return {
        ...row,
        roles: uniqueNavRoles([...row.roles, ...either])
      };
    }
    if (row.navPath === "susu/onboarding") {
      return {
        ...row,
        roles: uniqueNavRoles([...row.roles, ...registration])
      };
    }
    if (row.navPath === "susu/withdrawals") {
      const kept = row.roles.filter((role) => role === "admin" || withdrawal.has(role));
      return {
        ...row,
        roles: uniqueNavRoles([...kept, ...withdrawal])
      };
    }
    return row;
  });
}
