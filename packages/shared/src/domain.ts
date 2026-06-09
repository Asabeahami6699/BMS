import { z } from "zod";



export const customerStatusSchema = z.enum([

  "pending_activation",

  "active",

  "rejected",

  "suspended",

  "closed"

]);



export const accountTypeSchema = z.enum(["susu", "savings", "group", "meba_daakye"]);

export { SAVINGS_INITIAL_DEPOSIT_GHS } from "./savings.js";



export const transactionTypeSchema = z.enum(["daily_susu", "deposit", "withdrawal"]);

export const nextOfKinDetailsSchema = z.object({
  fullName: z.string().min(1),
  phone: z.string().min(1),
  location: z.string().min(1),
  houseNumber: z.string().optional()
});

export const customerSchema = z.object({
  id: z.string().min(1),
  tenantId: z.string().min(1),
  fullName: z.string().min(1),
  email: z.string().email().optional().or(z.literal("")),
  phone: z.string().min(1),
  location: z.string().optional(),
  houseNumber: z.string().optional(),
  accountType: accountTypeSchema.optional(),
  idCardNumber: z.string().optional(),
  photoUrl: z.string().optional(),
  idCardPhotoUrl: z.string().optional(),
  savingsOpeningFeeCollected: z.boolean().optional(),
  savingsOpeningFeeRecovered: z.number().nonnegative().optional(),
  nextOfKin: nextOfKinDetailsSchema.optional(),
  accountNumber: z.string().optional(),

  rejectionReason: z.string().optional(),

  homeBranchId: z.string().min(1),

  assignedFieldAgentId: z.string().min(1).optional(),

  createdByFieldAgentId: z.string().min(1),

  assignedFieldAgentName: z.string().optional(),

  createdByFieldAgentName: z.string().optional(),

  dailyContributionAmount: z.number().nonnegative(),

  lockedBalance: z.number().nonnegative().optional(),

  /** Ledger balance (sum of credits − debits). Populated on list/detail when requested. */
  accountBalance: z.number().optional(),

  /** accountBalance minus lockedBalance. Populated with accountBalance. */
  withdrawableBalance: z.number().optional(),

  routeId: z.string().uuid().optional(),

  status: customerStatusSchema

});



export const createCustomerInputSchema = z.object({

  fullName: z.string().min(1),

  phone: z.string().min(1),

  homeBranchId: z.string().min(1),

  assignedFieldAgentId: z.string().min(1),

  dailyContributionAmount: z.number().nonnegative()

});



export const customerRegistrationInputSchema = z.object({

  fullName: z.string().min(1),

  email: z
    .union([z.string().email(), z.literal("")])
    .optional()
    .transform((value) => (value === "" ? undefined : value)),

  phone: z.string().min(1),

  location: z.string().min(1),

  accountType: accountTypeSchema,

  idCardNumber: z.string().min(1),

  photoUrl: z
    .string()
    .max(4_500_000, "Photo data is too large")
    .optional(),
  idCardPhotoUrl: z
    .string()
    .max(4_500_000, "ID card photo is too large")
    .optional(),
  /** Savings only: agent collected GHS opening fee in cash at registration. */
  savingsOpeningFeeCollected: z.boolean().optional(),
  houseNumber: z.string().min(1),
  nextOfKin: nextOfKinDetailsSchema,
  dailyContributionAmount: z.number().nonnegative().default(0),

  homeBranchId: z.string().optional(),

  assignedFieldAgentId: z.string().optional()

}).superRefine((data, ctx) => {
  if (!data.idCardPhotoUrl?.trim()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "ID card photo is required",
      path: ["idCardPhotoUrl"]
    });
  }
  if (data.accountType === "savings" && data.savingsOpeningFeeCollected === undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Confirm whether you collected the opening fee or will deduct from first deposit",
      path: ["savingsOpeningFeeCollected"]
    });
  }
});



export const rejectCustomerSchema = z.object({

  reason: z.string().min(1).optional()

});



export const assignCustomerFieldAgentSchema = z.object({

  /** Set to a field agent user id, or null to unassign from any agent. */

  assignedFieldAgentId: z.string().min(1).nullable()

});



export const createTransactionInputSchema = z.object({

  customerId: z.string().min(1),

  type: transactionTypeSchema,

  amount: z.number().positive(),

  transactionBranchId: z.string().min(1),

  notes: z.string().optional(),

  bankProductId: z.string().uuid().optional(),

  workflowData: z.record(z.string(), z.unknown()).optional()

});



import { agencyExecutionStatusSchema } from "./agencyBanking.js";

export const transactionSchema = z.object({

  id: z.string().min(1),

  tenantId: z.string().min(1),

  customerId: z.string().min(1),

  type: transactionTypeSchema,

  amount: z.number().positive(),

  transactionBranchId: z.string().min(1),

  homeBranchId: z.string().min(1),

  recordedByUserId: z.string().min(1),

  fieldAgentId: z.string().min(1),

  createdAt: z.string().min(1),

  notes: z.string().optional(),

  executionStatus: agencyExecutionStatusSchema.optional().default("completed"),

  bankExecutedByUserId: z.string().optional(),

  bankExecutedAt: z.string().optional(),

  bankProductId: z.string().uuid().optional(),

  bankProductName: z.string().optional(),

  bankLabel: z.string().optional(),

  workflowData: z.record(z.string(), z.unknown()).optional()

});



export const ledgerEntrySchema = z.object({

  id: z.string().min(1),

  tenantId: z.string().min(1),

  customerId: z.string().min(1),

  transactionId: z.string().min(1),

  entryType: z.enum(["credit", "debit"]),

  amount: z.number().positive(),

  balanceAfter: z.number(),

  transactionBranchId: z.string().min(1),

  createdAt: z.string().min(1),

  /** User who posted the transaction (from customer_transactions.recorded_by_user_id). */
  recordedByName: z.string().optional(),

  /** Assigned field agent on the transaction when different from recorder. */
  fieldAgentName: z.string().optional(),

  /** Display label combining recorder and agent when they differ. */
  performedByName: z.string().optional(),

  transactionType: z.string().optional()

});



export const syncBatchItemSchema = z.discriminatedUnion("type", [

  z.object({

    type: z.literal("customer_registration"),

    clientId: z.string().min(1),

    payload: customerRegistrationInputSchema

  }),

  z.object({

    type: z.literal("daily_collection"),

    clientId: z.string().min(1),

    payload: createTransactionInputSchema.extend({

      type: z.literal("daily_susu").default("daily_susu")

    })

  })

]);



export const syncBatchSchema = z.object({

  items: z.array(syncBatchItemSchema).min(1).max(50)

});

export const balanceDisclosureStatusSchema = z.enum([
  "pending",
  "cs_approved",
  "bank_executed",
  "completed",
  "approved",
  "rejected",
  "expired"
]);

export const customerRequestTypeSchema = z.enum(["balance", "withdrawal"]);

export const withdrawalFulfillmentModeSchema = z.enum([
  "next_day_cash",
  "momo",
  "agent_next_day"
]);

export const balanceDisclosureSchema = z.object({
  id: z.string().min(1),
  tenantId: z.string().min(1),
  customerId: z.string().min(1),
  fieldAgentId: z.string().min(1),
  customerName: z.string().optional(),
  fieldAgentName: z.string().optional(),
  requestType: customerRequestTypeSchema.default("balance"),
  status: balanceDisclosureStatusSchema,
  balanceAmount: z.number().optional(),
  withdrawalAmount: z.number().optional(),
  fulfillmentMode: withdrawalFulfillmentModeSchema.optional(),
  requestedAt: z.string().min(1),
  approvedAt: z.string().optional(),
  expiresAt: z.string().optional(),
  requestReason: z.string().optional(),
  rejectedReason: z.string().optional(),
  momoNumber: z.string().optional(),
  momoAccountName: z.string().optional(),
  payoutReference: z.string().optional(),
  transactionProofImage: z.string().optional(),
  generatedReceiptImage: z.string().optional(),
  paidAt: z.string().optional(),
  csApprovedBy: z.string().optional(),
  csApprovedAt: z.string().optional(),
  bankExecutedBy: z.string().optional(),
  bankExecutedAt: z.string().optional(),
  tellerPaidBy: z.string().optional(),

  bankProductId: z.string().uuid().optional(),

  bankProductName: z.string().optional(),

  bankLabel: z.string().optional(),
  tellerPaidAt: z.string().optional(),

  workflowData: z.record(z.string(), z.unknown()).optional()
});

export const requestBalanceDisclosureSchema = z.object({
  reason: z.string().min(3, "Please enter a reason (at least 3 characters)")
});

export const requestCustomerApprovalSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("balance"),
    reason: z.string().min(3, "Please enter a reason (at least 3 characters)")
  }),
  z.object({
    type: z.literal("withdrawal"),
    reason: z.string().min(3, "Please enter a reason (at least 3 characters)"),
    amount: z.number().positive("Withdrawal amount must be greater than zero"),
    fulfillmentMode: withdrawalFulfillmentModeSchema.default("next_day_cash"),
    momoNumber: z.string().min(1).optional(),
    momoAccountName: z.string().min(1).optional()
  })
]);

export const approveCustomerRequestSchema = z.object({
  payoutReference: z.string().max(120).optional(),
  transactionProofImage: z
    .string()
    .max(4_500_000, "Transaction image is too large")
    .optional(),
  generatedReceiptImage: z
    .string()
    .max(4_500_000, "Receipt image is too large")
    .optional(),
  /** How long the agent may view balance after approval (balance requests only). */
  visibleHours: z
    .number()
    .min(0.25, "Minimum visibility is 15 minutes")
    .max(168, "Maximum visibility is 7 days")
    .optional(),
  bankProductId: z.string().uuid().optional(),
  workflowData: z.record(z.string(), z.unknown()).optional()
});

export const approveWithdrawalWorkflowSchema = approveCustomerRequestSchema;

export const rejectBalanceDisclosureSchema = z.object({
  reason: z.string().min(1).optional()
});



export type Customer = z.infer<typeof customerSchema>;

export type CreateCustomerInput = z.infer<typeof createCustomerInputSchema>;

export type CustomerRegistrationInput = z.infer<typeof customerRegistrationInputSchema>;
export type NextOfKinDetails = z.infer<typeof nextOfKinDetailsSchema>;
export type AccountType = z.infer<typeof accountTypeSchema>;

export type CreateTransactionInput = z.infer<typeof createTransactionInputSchema>;

export type Transaction = z.infer<typeof transactionSchema>;

export type LedgerEntry = z.infer<typeof ledgerEntrySchema>;

export type BalanceDisclosure = z.infer<typeof balanceDisclosureSchema>;
export type CustomerRequestType = z.infer<typeof customerRequestTypeSchema>;
export type WithdrawalFulfillmentMode = z.infer<typeof withdrawalFulfillmentModeSchema>;

export const fieldRouteStatusSchema = z.enum(["active", "inactive"]);

export const fieldRouteSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().min(1),
  name: z.string().min(1),
  area: z.string().min(1),
  branchId: z.string().uuid(),
  assignedFieldAgentId: z.string().min(1).optional(),
  status: fieldRouteStatusSchema,
  memberCount: z.number().int().nonnegative().optional(),
  branchName: z.string().optional(),
  branchCode: z.string().optional(),
  assignedFieldAgentName: z.string().optional(),
  createdAt: z.string().optional()
});

export const createFieldRouteSchema = z.object({
  name: z.string().min(1),
  area: z.string().min(1),
  branchId: z.string().uuid(),
  assignedFieldAgentId: z.string().min(1).optional().nullable(),
  status: fieldRouteStatusSchema.default("active")
});

export const updateFieldRouteSchema = z.object({
  name: z.string().min(1).optional(),
  area: z.string().min(1).optional(),
  branchId: z.string().uuid().optional(),
  assignedFieldAgentId: z.string().min(1).nullable().optional(),
  status: fieldRouteStatusSchema.optional(),
  syncAgentToMembers: z.boolean().optional()
});

export const setRouteMembersSchema = z.object({
  customerIds: z.array(z.string().uuid())
});

export type FieldRoute = z.infer<typeof fieldRouteSchema>;


