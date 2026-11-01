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

export type ApprovalWorkflow = {
  registrationApproverRoles: ApprovalAssignableRole[];
  withdrawalApproverRoles: ApprovalAssignableRole[];
};

/** Matches today's behavior: coordinators open accounts; coordinators and customer service can approve withdrawals. */
export const DEFAULT_APPROVAL_WORKFLOW: ApprovalWorkflow = {
  registrationApproverRoles: ["admin", "coordinator"],
  withdrawalApproverRoles: ["admin", "coordinator", "customer_service"]
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

export function parseApprovalWorkflow(value: unknown): ApprovalWorkflow {
  if (!value || typeof value !== "object") {
    return {
      registrationApproverRoles: [...DEFAULT_APPROVAL_WORKFLOW.registrationApproverRoles],
      withdrawalApproverRoles: [...DEFAULT_APPROVAL_WORKFLOW.withdrawalApproverRoles]
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
    )
  };
}

export const updateApprovalWorkflowSchema = z.object({
  registrationApproverRoles: z.array(assignableRoleSchema).min(1),
  withdrawalApproverRoles: z.array(assignableRoleSchema).min(1)
});

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
