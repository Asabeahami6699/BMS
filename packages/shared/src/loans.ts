import { z } from "zod";
import { nextOfKinDetailsSchema } from "./domain.js";

export const loanRepaymentFrequencySchema = z.enum(["weekly", "monthly"]);
export type LoanRepaymentFrequency = z.infer<typeof loanRepaymentFrequencySchema>;

export const loanTypeSchema = z.enum(["individual", "group_solidarity"]);
export type LoanType = z.infer<typeof loanTypeSchema>;

export const loanGroupMemberRoleSchema = z.enum(["chair", "secretary", "treasurer", "member"]);
export type LoanGroupMemberRole = z.infer<typeof loanGroupMemberRoleSchema>;

export const loanGroupStatusSchema = z.enum(["active", "inactive"]);
export type LoanGroupStatus = z.infer<typeof loanGroupStatusSchema>;

export const loanGroupMemberSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  groupId: z.string(),
  customerId: z.string(),
  customerName: z.string().optional(),
  customerPhone: z.string().optional(),
  role: loanGroupMemberRoleSchema,
  status: z.enum(["active", "inactive"]),
  joinedAt: z.string()
});
export type LoanGroupMember = z.infer<typeof loanGroupMemberSchema>;

export const loanGroupSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  name: z.string().min(1),
  branchId: z.string(),
  branchName: z.string().optional(),
  description: z.string().optional(),
  meetingDay: z.string().optional(),
  minMembers: z.number().int().min(2).default(5),
  maxMembers: z.number().int().min(2).default(15),
  assignedFieldAgentId: z.string().optional(),
  status: loanGroupStatusSchema.default("active"),
  memberCount: z.number().int().nonnegative().optional(),
  activeMemberCount: z.number().int().nonnegative().optional(),
  members: z.array(loanGroupMemberSchema).optional(),
  createdAt: z.string().optional()
});
export type LoanGroup = z.infer<typeof loanGroupSchema>;

const loanGroupInputSchema = z.object({
  name: z.string().min(1),
  branchId: z.string().min(1),
  description: z.string().optional(),
  meetingDay: z.string().optional(),
  minMembers: z.number().int().min(2).default(5),
  maxMembers: z.number().int().min(2).default(15),
  assignedFieldAgentId: z.string().optional()
});

export const createLoanGroupSchema = loanGroupInputSchema.refine((d) => d.maxMembers >= d.minMembers, {
  message: "Maximum members must be at least the minimum",
  path: ["maxMembers"]
});

export const updateLoanGroupSchema = loanGroupInputSchema.partial().extend({
  status: loanGroupStatusSchema.optional()
});

export const addLoanGroupMemberSchema = z.object({
  customerId: z.string().min(1),
  role: loanGroupMemberRoleSchema.default("member")
});

export const loanProductStatusSchema = z.enum(["active", "inactive"]);
export type LoanProductStatus = z.infer<typeof loanProductStatusSchema>;

export const loanProductSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  name: z.string().min(1),
  description: z.string().optional(),
  interestRatePercent: z.number().min(0).max(100),
  termMonths: z.number().int().min(1).max(360),
  repaymentFrequency: loanRepaymentFrequencySchema.default("monthly"),
  minAmount: z.number().positive(),
  maxAmount: z.number().positive(),
  loanType: loanTypeSchema.default("individual"),
  minGroupMembers: z.number().int().min(2).optional(),
  maxGroupMembers: z.number().int().min(2).optional(),
  status: loanProductStatusSchema.default("active"),
  createdAt: z.string().optional()
});

export type LoanProduct = z.infer<typeof loanProductSchema>;

const loanProductInputSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  interestRatePercent: z.number().min(0).max(100),
  termMonths: z.number().int().min(1).max(360),
  repaymentFrequency: loanRepaymentFrequencySchema.optional(),
  minAmount: z.number().positive(),
  maxAmount: z.number().positive(),
  loanType: loanTypeSchema.optional(),
  minGroupMembers: z.number().int().min(2).optional(),
  maxGroupMembers: z.number().int().min(2).optional(),
  status: loanProductStatusSchema.optional()
});

export const createLoanProductSchema = loanProductInputSchema
  .refine((d) => d.maxAmount >= d.minAmount, {
    message: "Maximum amount must be at least the minimum",
    path: ["maxAmount"]
  })
  .refine(
    (d) => {
      if (d.loanType === "group_solidarity" && d.minGroupMembers != null && d.maxGroupMembers != null) {
        return d.maxGroupMembers >= d.minGroupMembers;
      }
      return true;
    },
    { message: "Maximum group members must be at least the minimum", path: ["maxGroupMembers"] }
  );

export const updateLoanProductSchema = loanProductInputSchema.partial().refine(
  (d) => {
    if (d.minAmount != null && d.maxAmount != null) {
      return d.maxAmount >= d.minAmount;
    }
    return true;
  },
  {
    message: "Maximum amount must be at least the minimum",
    path: ["maxAmount"]
  }
);

export const loanBorrowerRegistrationSchema = z.object({
  fullName: z.string().min(1),
  email: z
    .union([z.string().email(), z.literal("")])
    .optional()
    .transform((value) => (value === "" ? undefined : value)),
  phone: z.string().min(1),
  location: z.string().min(1),
  houseNumber: z.string().min(1),
  idCardNumber: z.string().min(1),
  photoUrl: z.string().max(4_500_000).optional(),
  idCardPhotoUrl: z.string().max(4_500_000).optional(),
  nextOfKin: nextOfKinDetailsSchema,
  homeBranchId: z.string().min(1),
  assignedFieldAgentId: z.string().optional()
});

export type LoanBorrowerRegistration = z.infer<typeof loanBorrowerRegistrationSchema>;

export const loanPurposeSchema = z.enum([
  "working_capital",
  "business_expansion",
  "education",
  "medical",
  "home_improvement",
  "debt_consolidation",
  "equipment",
  "personal",
  "other"
]);
export type LoanPurpose = z.infer<typeof loanPurposeSchema>;

export const loanIncomeSourceSchema = z.enum([
  "salary",
  "business",
  "trading",
  "farming",
  "pension",
  "remittance",
  "other"
]);
export type LoanIncomeSource = z.infer<typeof loanIncomeSourceSchema>;

export const loanGuarantorSchema = z.object({
  fullName: z.string().min(1),
  phone: z.string().min(1),
  relationship: z.string().min(1),
  occupation: z.string().min(1),
  employerOrBusiness: z.string().optional(),
  monthlyIncome: z.number().positive().optional(),
  location: z.string().min(1),
  idCardNumber: z.string().optional()
});
export type LoanGuarantor = z.infer<typeof loanGuarantorSchema>;

export const loanQualificationSchema = z
  .object({
    loanPurpose: loanPurposeSchema,
    loanPurposeOther: z.string().optional(),
    sourceOfIncome: loanIncomeSourceSchema,
    sourceOfIncomeOther: z.string().optional(),
    occupation: z.string().min(1),
    employerOrBusiness: z.string().optional(),
    monthlyIncome: z.number().positive(),
    monthlyExpenses: z.number().nonnegative().optional(),
    existingLoanBalance: z.number().nonnegative().optional(),
    yearsAtCurrentJob: z.number().nonnegative().optional(),
    guarantor: loanGuarantorSchema
  })
  .superRefine((data, ctx) => {
    if (data.loanPurpose === "other" && !data.loanPurposeOther?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Describe the loan purpose",
        path: ["loanPurposeOther"]
      });
    }
    if (data.sourceOfIncome === "other" && !data.sourceOfIncomeOther?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Describe the income source",
        path: ["sourceOfIncomeOther"]
      });
    }
  });

export type LoanQualification = z.infer<typeof loanQualificationSchema>;

export const loanApplicationStatusSchema = z.enum([
  "pending_approval",
  "approved",
  "rejected",
  "disbursed",
  "closed"
]);

export type LoanApplicationStatus = z.infer<typeof loanApplicationStatusSchema>;

export const loanScheduleStatusSchema = z.enum(["pending", "paid", "partial", "overdue"]);
export type LoanScheduleStatus = z.infer<typeof loanScheduleStatusSchema>;

export const loanScheduleInstallmentSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  loanId: z.string(),
  installmentNumber: z.number().int().positive(),
  dueDate: z.string(),
  amountDue: z.number().positive(),
  amountPaid: z.number().nonnegative(),
  status: loanScheduleStatusSchema,
  paidAt: z.string().optional()
});

export type LoanScheduleInstallment = z.infer<typeof loanScheduleInstallmentSchema>;

export const loanApplicationSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  customerId: z.string(),
  customerName: z.string().optional(),
  productId: z.string(),
  productName: z.string().optional(),
  loanType: loanTypeSchema.default("individual"),
  groupId: z.string().optional(),
  groupName: z.string().optional(),
  branchId: z.string(),
  principalAmount: z.number().positive(),
  interestRatePercent: z.number().min(0),
  termMonths: z.number().int().positive(),
  repaymentFrequency: loanRepaymentFrequencySchema,
  installmentAmount: z.number().nonnegative().optional(),
  totalInterest: z.number().nonnegative().default(0),
  totalRepayable: z.number().nonnegative().default(0),
  installmentsTotal: z.number().int().nonnegative().optional(),
  installmentsPaid: z.number().int().nonnegative().default(0),
  nextDueDate: z.string().optional(),
  status: loanApplicationStatusSchema,
  outstandingPrincipal: z.number().nonnegative(),
  totalRepaid: z.number().nonnegative(),
  applicationNotes: z.string().optional(),
  loanPurpose: loanPurposeSchema.optional(),
  loanPurposeOther: z.string().optional(),
  sourceOfIncome: loanIncomeSourceSchema.optional(),
  sourceOfIncomeOther: z.string().optional(),
  occupation: z.string().optional(),
  employerOrBusiness: z.string().optional(),
  monthlyIncome: z.number().nonnegative().optional(),
  monthlyExpenses: z.number().nonnegative().optional(),
  existingLoanBalance: z.number().nonnegative().optional(),
  yearsAtCurrentJob: z.number().nonnegative().optional(),
  guarantor: loanGuarantorSchema.optional(),
  rejectionReason: z.string().optional(),
  appliedAt: z.string(),
  approvedAt: z.string().optional(),
  approvedBy: z.string().optional(),
  disbursedAt: z.string().optional(),
  disbursedBy: z.string().optional(),
  closedAt: z.string().optional(),
  createdBy: z.string()
});

export type LoanApplication = z.infer<typeof loanApplicationSchema>;

export const createLoanApplicationSchema = z
  .object({
    customerId: z.string().min(1).optional(),
    newCustomer: loanBorrowerRegistrationSchema.optional(),
    productId: z.string().min(1),
    branchId: z.string().min(1),
    principalAmount: z.number().positive(),
    applicationNotes: z.string().optional(),
    loanPurpose: loanPurposeSchema,
    loanPurposeOther: z.string().optional(),
    sourceOfIncome: loanIncomeSourceSchema,
    sourceOfIncomeOther: z.string().optional(),
    occupation: z.string().min(1),
    employerOrBusiness: z.string().optional(),
    monthlyIncome: z.number().positive(),
    monthlyExpenses: z.number().nonnegative().optional(),
    existingLoanBalance: z.number().nonnegative().optional(),
    yearsAtCurrentJob: z.number().nonnegative().optional(),
    guarantor: loanGuarantorSchema,
    photoUrl: z.string().max(4_500_000).optional(),
    idCardPhotoUrl: z.string().max(4_500_000).optional(),
    groupId: z.string().min(1).optional()
  })
  .superRefine((data, ctx) => {
    const hasExisting = Boolean(data.customerId);
    const hasNew = Boolean(data.newCustomer);
    if (hasExisting === hasNew) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Select an existing customer or register a new borrower",
        path: ["customerId"]
      });
    }
    if (data.newCustomer && (!data.newCustomer.photoUrl || !data.newCustomer.idCardPhotoUrl)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Passport photo and ID card photo are required",
        path: ["newCustomer", "photoUrl"]
      });
    }
    if (data.loanPurpose === "other" && !data.loanPurposeOther?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Describe the loan purpose",
        path: ["loanPurposeOther"]
      });
    }
    if (data.sourceOfIncome === "other" && !data.sourceOfIncomeOther?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Describe the income source",
        path: ["sourceOfIncomeOther"]
      });
    }
  });

export const rejectLoanApplicationSchema = z.object({
  rejectionReason: z.string().min(1)
});

export const recordLoanRepaymentSchema = z.object({
  amount: z.number().positive(),
  branchId: z.string().min(1),
  notes: z.string().optional(),
  settleAll: z.boolean().optional()
});

export const loanRepaymentSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  loanId: z.string(),
  amount: z.number().positive(),
  branchId: z.string(),
  installmentNumber: z.number().int().positive().optional(),
  notes: z.string().optional(),
  recordedBy: z.string(),
  createdAt: z.string()
});

export type LoanRepayment = z.infer<typeof loanRepaymentSchema>;
