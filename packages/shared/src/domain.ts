import { z } from "zod";



export const customerStatusSchema = z.enum([
  "pending_activation",
  "active",
  "rejected",
  "suspended",
  "inactive",
  "dormant",
  "closed"
]);

export type CustomerStatus = z.infer<typeof customerStatusSchema>;

/** Statuses a tenant admin may set manually (not pending/rejected registration flow). */
export const adminManagedCustomerStatusSchema = z.enum([
  "active",
  "inactive",
  "dormant",
  "closed"
]);

export type AdminManagedCustomerStatus = z.infer<typeof adminManagedCustomerStatusSchema>;

export const updateCustomerStatusSchema = z.object({
  status: adminManagedCustomerStatusSchema,
  reason: z.string().max(500).optional()
});

export type UpdateCustomerStatusInput = z.infer<typeof updateCustomerStatusSchema>;

export const scheduleNextCardDailySusuSchema = z.object({
  /** New daily Susu amount (GHS) for the next card. Pass null to cancel a scheduled change. */
  dailyContributionAmount: z.number().positive().nullable()
});

export type ScheduleNextCardDailySusuInput = z.infer<typeof scheduleNextCardDailySusuSchema>;

/** Months without qualifying activity before auto-status applies. */
export const CUSTOMER_INACTIVE_AFTER_MONTHS = 12;
export const CUSTOMER_DORMANT_AFTER_MONTHS = 24;
/** Months before inactive/dormant threshold to send an SMS warning. */
export const CUSTOMER_LIFECYCLE_WARN_MONTHS_BEFORE = 1;



export const accountTypeSchema = z.enum(["susu", "savings", "group", "meba_daakye"]);

export const customerIdCardTypeSchema = z.enum([
  "ghana_card",
  "non_citizen_ghana_card",
  "ecowas_id",
  "voters_id",
  "nhis",
  "drivers_licence",
  "passport",
  "no_id_simplified_kyc"
]);

export type CustomerIdCardType = z.infer<typeof customerIdCardTypeSchema>;

export const customerKycTierSchema = z.enum(["full", "simplified"]);
export type CustomerKycTier = z.infer<typeof customerKycTierSchema>;

export const kycIntroducerSchema = z.object({
  fullName: z.string().trim().min(1, "Introducer full name is required"),
  phone: z.string().trim().min(1, "Introducer phone is required"),
  relationship: z.string().trim().min(1, "Introducer relationship is required"),
  ghanaCardNumber: z.string().trim().min(4, "Introducer Ghana Card number is required")
});

export type KycIntroducerDetails = z.infer<typeof kycIntroducerSchema>;

export const upgradeCustomerKycSchema = z.object({
  idCardType: z.enum([
    "ghana_card",
    "non_citizen_ghana_card",
    "ecowas_id",
    "voters_id",
    "nhis",
    "drivers_licence",
    "passport"
  ]),
  idCardNumber: z.string().trim().min(3, "Enter a valid ID number"),
  idCardPhotoUrl: z.string().max(4_500_000, "ID card photo is too large").optional()
});

export type UpgradeCustomerKycInput = z.infer<typeof upgradeCustomerKycSchema>;

export const CUSTOMER_ID_CARD_TYPE_OPTIONS: ReadonlyArray<{
  value: CustomerIdCardType;
  label: string;
  placeholder: string;
  isSimplifiedKyc?: boolean;
}> = [
  { value: "ghana_card", label: "Ghana Card", placeholder: "e.g. GHA-123456789-0" },
  {
    value: "non_citizen_ghana_card",
    label: "Non-Citizen Ghana Card",
    placeholder: "e.g. GHA-NC-123456789-0"
  },
  { value: "ecowas_id", label: "ECOWAS National ID", placeholder: "e.g. ECOWAS ID number" },
  { value: "voters_id", label: "Voter's ID", placeholder: "e.g. 1234567890" },
  { value: "nhis", label: "Health Insurance (NHIS)", placeholder: "e.g. 12345678" },
  { value: "drivers_licence", label: "Driver's Licence", placeholder: "e.g. DL-1234567" },
  { value: "passport", label: "Passport", placeholder: "e.g. G1234567" },
  {
    value: "no_id_simplified_kyc",
    label: "No National ID (Simplified KYC + Local Introducer)",
    placeholder: "",
    isSimplifiedKyc: true
  }
];

export function formatIdCardTypeLabel(type?: string | null): string {
  switch (type) {
    case "ghana_card":
      return "Ghana Card";
    case "non_citizen_ghana_card":
      return "Non-Citizen Ghana Card";
    case "ecowas_id":
      return "ECOWAS National ID";
    case "voters_id":
      return "Voter's ID";
    case "nhis":
      return "Health Insurance (NHIS)";
    case "drivers_licence":
      return "Driver's Licence";
    case "passport":
      return "Passport";
    case "no_id_simplified_kyc":
      return "Simplified KYC (No National ID)";
    default:
      return "Ghana Card / ID";
  }
}

export { SAVINGS_INITIAL_DEPOSIT_GHS } from "./savings.js";



export const transactionTypeSchema = z.enum([
  "daily_susu",
  "deposit",
  "withdrawal",
  "susu_reversal"
]);

/** Posted susu credits that still count toward collection totals. */
export function isActiveDailySusu(transaction: {
  type: string;
  reversedAt?: string | null;
}): boolean {
  return transaction.type === "daily_susu" && !transaction.reversedAt;
}

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
  /** ISO date YYYY-MM-DD */
  dateOfBirth: z.string().optional(),
  occupation: z.string().optional(),
  accountType: accountTypeSchema.optional(),
  idCardType: customerIdCardTypeSchema.optional(),
  idCardNumber: z.string().optional(),
  kycTier: customerKycTierSchema.optional(),
  nationality: z.string().optional(),
  kycIntroducer: kycIntroducerSchema.optional(),
  kycUpgradedAt: z.string().optional(),
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

  /** Scheduled daily Susu amount (GHS) that activates automatically on the next card/cycle. */
  pendingDailyContributionAmount: z.number().positive().nullable().optional(),
  pendingDailyContributionSetAt: z.string().nullable().optional(),

  lockedBalance: z.number().nonnegative().optional(),

  /** Passbook lien held while a bridge loan is open (separate from savings minimum). */
  loanCollateralLocked: z.number().nonnegative().optional(),

  /** Ledger balance (sum of credits − debits). Populated on list/detail when requested. */
  accountBalance: z.number().optional(),

  /** accountBalance minus lockedBalance, loan collateral, and loan reserve when bridge is on. */
  withdrawableBalance: z.number().optional(),

  /**
   * Amount reserved for the next unpaid loan installment(s) when Susu↔Loans bridge is active.
   * Not withdrawable until the loan is settled or the installment is paid.
   */
  loanReserveAmount: z.number().nonnegative().optional(),

  loanQualifiedAt: z.string().optional(),
  loanQualificationBadge: z.string().optional(),
  loanQualificationSuggestedMaxGhs: z.number().nonnegative().optional(),

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

  dateOfBirth: z.string().optional(),

  occupation: z.string().optional(),

  accountType: accountTypeSchema,

  idCardType: customerIdCardTypeSchema.optional(),

  idCardNumber: z.string().optional(),

  nationality: z.string().optional(),

  kycIntroducer: kycIntroducerSchema.optional(),

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
  houseNumber: z.string().optional(),
  nextOfKin: nextOfKinDetailsSchema.optional(),
  dailyContributionAmount: z.number().nonnegative().default(0),

  homeBranchId: z.string().optional(),

  assignedFieldAgentId: z.string().optional()

}).superRefine((data, ctx) => {
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

  assignedFieldAgentId: z.string().min(1).nullable(),

  /**
   * Route membership for the customer.
   * - omit: auto-sync (attach to the target agent's sole active route on the home branch, or clear)
   * - null: clear route membership
   * - uuid: set that route (must match home branch; agent should own it when assigning)
   */
  routeId: z.string().uuid().nullable().optional()

});



export const createTransactionInputSchema = z.object({

  customerId: z.string().min(1),

  type: transactionTypeSchema,

  amount: z.number().positive(),

  transactionBranchId: z.string().min(1),

  notes: z.string().optional(),

  bankProductId: z.string().uuid().optional(),

  workflowData: z.record(z.string(), z.unknown()).optional(),

  /** Non-aabanker partner deposit — queues for back-office bank execution. aabanker Susu/Savings credit immediately. */
  manualPartnerAccount: z.boolean().optional()

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

  /** Set on the reversal row. Points at the original susu credit. */
  reversesTransactionId: z.string().min(1).optional(),

  /** Set on the original susu credit after it is reversed. */
  reversedByTransactionId: z.string().min(1).optional(),

  reversalReason: z.string().optional(),

  reversedByUserId: z.string().optional(),

  reversedAt: z.string().optional(),

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

  /** Display label. Deposits show the poster only; field collections may also name the agent. */
  performedByName: z.string().optional(),

  transactionType: z.string().optional(),

  /** Transaction notes (e.g. Settled shortage). */
  notes: z.string().optional(),

  /** Human-readable reason shown on account statements (derived from notes when set). */
  reason: z.string().optional(),

  /** posted = original susu credit still active. reversed = a reversal debit exists. */
  reversalStatus: z.enum(["posted", "reversed"]).optional(),

  reversalReference: z.string().optional(),

  reversalReason: z.string().optional(),

  reversedByName: z.string().optional(),

  reversedAt: z.string().optional()

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
  /** Registered customer phone — for coordinator call-back before approve. Not agent-editable. */
  customerPhone: z.string().optional(),
  /** Customer account number — shown to teller on Pay now. */
  customerAccountNumber: z.string().optional(),
  fieldAgentName: z.string().optional(),
  /**
   * True when the requester is a field agent (Susu remote withdrawal).
   * Those cash requests are coordinator → teller Pay now — not Customer Service.
   */
  isFieldAgentRequest: z.boolean().optional(),
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
  /** Field agent confirmed cash was delivered to the customer. */
  agentDeliveredBy: z.string().optional(),
  agentDeliveredAt: z.string().optional(),

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

export const reverseSusuCollectionSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(3, "Enter a reversal reason (at least 3 characters)")
    .max(500)
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


