import { z } from "zod";
import { workflowDataSchema } from "./bankProducts.js";

export const partnerBankAccountStatusSchema = z.enum(["active", "inactive", "closed"]);

export type PartnerBankAccountStatus = z.infer<typeof partnerBankAccountStatusSchema>;

export const partnerBankAccountSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().min(1),
  customerId: z.string().min(1),
  customerName: z.string().optional(),
  bankProductId: z.string().uuid().nullable().optional(),
  bankProductName: z.string().optional(),
  bankLabel: z.string().min(1),
  accountNumber: z.string().min(1),
  accountName: z.string().min(1),
  branchId: z.string().nullable().optional(),
  branchName: z.string().optional(),
  externalReference: z.string().optional(),
  workflowData: workflowDataSchema.default({}),
  status: partnerBankAccountStatusSchema,
  createdByUserId: z.string().min(1),
  createdByName: z.string().optional(),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1)
});

export type PartnerBankAccount = z.infer<typeof partnerBankAccountSchema>;

export const createPartnerBankAccountSchema = z.object({
  customerId: z.string().min(1),
  bankProductId: z.string().uuid(),
  accountNumber: z.string().trim().min(1).max(64),
  accountName: z.string().trim().min(1).max(120),
  branchId: z.string().min(1).optional(),
  externalReference: z.string().trim().max(120).optional(),
  workflowData: workflowDataSchema.optional()
});

export type CreatePartnerBankAccountInput = z.infer<typeof createPartnerBankAccountSchema>;
