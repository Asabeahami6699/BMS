import { z } from "zod";
import { normalizeTenantModule, tenantProductModuleSchema } from "./modules.js";
import { tenantAddonSchema } from "./addons.js";

const subscribedModulesField = z.preprocess(
  (val) => {
    if (!Array.isArray(val)) {
      return val;
    }
    return val.map((item) => normalizeTenantModule(String(item)) ?? item);
  },
  z.array(tenantProductModuleSchema).min(1, "Select at least one product module")
);

const subscribedAddonsField = z.preprocess(
  (val) => {
    if (!Array.isArray(val)) {
      return [];
    }
    return val.filter((item) => tenantAddonSchema.safeParse(item).success);
  },
  z.array(tenantAddonSchema).default([])
);

export const roleSchema = z.enum([
  "super_admin",
  "admin",
  "field_agent",
  "coordinator",
  "auditor",
  "accountant",
  "teller",
  "back_officer",
  "customer_service"
]);

export type Role = z.infer<typeof roleSchema>;

/** Tenant-defined job title keys stored in users.role (not platform built-ins). */
export const customJobTitleKeySchema = z
  .string()
  .min(3)
  .max(50)
  .regex(/^[a-z][a-z0-9_]*$/)
  .refine((key) => !roleSchema.safeParse(key).success, "Reserved system job title key");

export type CustomJobTitleKey = z.infer<typeof customJobTitleKeySchema>;

/** Primary job title on a user: built-in Role or tenant-defined key. */
export const userJobTitleSchema = z.union([roleSchema, customJobTitleKeySchema]);

export type UserJobTitle = z.infer<typeof userJobTitleSchema>;

export function isBuiltinRole(role: string): role is Role {
  return roleSchema.safeParse(role).success;
}

export const tenantRoleKindSchema = z.enum(["job_title", "extra_duties"]);
export type TenantRoleKind = z.infer<typeof tenantRoleKindSchema>;

export const scopeTypeSchema = z.enum(["head_office", "branch"]);
export type ScopeType = z.infer<typeof scopeTypeSchema>;

/** Roles that must be linked to a branch (scope branch + branchId). */
export const BRANCH_REQUIRED_ROLES: Role[] = ["field_agent"];

export function roleRequiresBranch(role: Role): boolean {
  return BRANCH_REQUIRED_ROLES.includes(role);
}

function assertBranchAssignment(
  data: { role: UserJobTitle; scopeType: ScopeType; branchId?: string | null },
  ctx: z.RefinementCtx
): void {
  if (!isBuiltinRole(data.role) || !roleRequiresBranch(data.role)) {
    return;
  }
  if (data.scopeType !== "branch") {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["scopeType"],
      message: "Field agents must use branch scope"
    });
  }
  const branchId = data.branchId?.trim();
  if (!branchId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["branchId"],
      message: "Branch is required for field agents"
    });
  }
}

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6)
});

export const createTenantAdminSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  fullName: z.string().min(1)
});

export const createTenantUserBaseSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  role: userJobTitleSchema,
  scopeType: scopeTypeSchema,
  branchId: z.string().optional(),
  fullName: z.string().min(1).optional()
});

export function withBranchAssignmentRefine<T extends z.ZodTypeAny>(schema: T) {
  return schema.superRefine((data, ctx) =>
    assertBranchAssignment(data as { role: Role; scopeType: ScopeType; branchId?: string | null }, ctx)
  );
}

export const createTenantUserSchema = withBranchAssignmentRefine(createTenantUserBaseSchema);

export const accountStatusSchema = z.enum(["active", "inactive"]);
export type AccountStatus = z.infer<typeof accountStatusSchema>;

export const updateTenantUserBaseSchema = z.object({
  email: z.string().email().optional(),
  role: userJobTitleSchema.optional(),
  scopeType: scopeTypeSchema.optional(),
  branchId: z.string().nullable().optional(),
  fullName: z.string().min(1).optional(),
  status: accountStatusSchema.optional()
});

export const updateTenantUserSchema = updateTenantUserBaseSchema.superRefine((data, ctx) => {
  if (data.role !== undefined) {
    const fallbackScope =
      isBuiltinRole(data.role) && roleRequiresBranch(data.role) ? "branch" : "head_office";
    assertBranchAssignment(
      {
        role: data.role,
        scopeType: data.scopeType ?? fallbackScope,
        branchId: data.branchId
      },
      ctx
    );
  } else if (data.scopeType === "branch" && !data.branchId?.trim()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["branchId"],
      message: "Branch is required when scope is branch"
    });
  }
});

export const resetUserPasswordSchema = z.object({
  password: z.string().min(8)
});

export const updateBranchSchema = z.object({
  code: z.string().min(1).optional(),
  name: z.string().min(1).optional(),
  status: accountStatusSchema.optional()
});

export const createTenantSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  subscriptionStatus: z.enum(["active", "inactive"]).default("active"),
  subscribedModules: subscribedModulesField,
  subscribedAddons: subscribedAddonsField
});

export const permissionSchema = z.enum([
  "platform.tenants.read",
  "platform.tenants.create",
  "platform.tenants.update",
  "roles.create",
  "roles.read",
  "roles.assign",
  "users.create",
  "users.read",
  "users.update",
  "users.delete",
  "branches.create",
  "branches.update",
  "branches.read",
  "branches.delete",
  "customers.create",
  "customers.read",
  "transactions.create.daily_susu",
  "transactions.create.deposit",
  "transactions.create.withdrawal",
  "transactions.read",
  "ledger.read",
  "reports.read",
  "payroll.read",
  "payroll.run",
  "commission_policy.update",
  "commission_policy.read",
  "audit.read",
  "branch_float.manage",
  "workspace.notifications",
  "loans.read",
  "loans.products.manage",
  "loans.applications.create",
  "loans.applications.approve",
  "loans.disburse",
  "loans.repayments.create",
  "treasury.read",
  "treasury.cash.move",
  "treasury.reconcile",
  "agency.withdrawals.approve",
  "agency.bank.execute",
  "agency.withdrawals.pay",
  "agency.deposits.record",
  "agency.accounts.create",
  "banking.products.read",
  "banking.products.manage"
]);

export type Permission = z.infer<typeof permissionSchema>;
