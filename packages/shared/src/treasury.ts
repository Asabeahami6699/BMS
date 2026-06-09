import { z } from "zod";

export const cashAccountKindSchema = z.enum([
  "vault",
  "teller_drawer",
  "bank",
  "expense",
  "commission"
]);

export type CashAccountKind = z.infer<typeof cashAccountKindSchema>;

export const cashMovementTypeSchema = z.enum([
  "vault_to_teller",
  "teller_to_vault",
  "vault_to_bank",
  "bank_to_vault",
  "expense",
  "commission"
]);

export type CashMovementType = z.infer<typeof cashMovementTypeSchema>;

export const cashAccountSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string(),
  branchId: z.string(),
  kind: cashAccountKindSchema,
  label: z.string(),
  currency: z.string().default("GHS"),
  balance: z.number(),
  tellerUserId: z.string().nullable().optional(),
  bankName: z.string().nullable().optional(),
  isActive: z.boolean().default(true),
  createdAt: z.string()
});

export type CashAccount = z.infer<typeof cashAccountSchema>;

export const cashMovementSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string(),
  branchId: z.string(),
  movementType: cashMovementTypeSchema,
  fromAccountId: z.string().uuid().nullable(),
  toAccountId: z.string().uuid().nullable(),
  amount: z.number().positive(),
  notes: z.string().nullable().optional(),
  recordedByUserId: z.string(),
  businessDate: z.string(),
  createdAt: z.string()
});

export type CashMovement = z.infer<typeof cashMovementSchema>;

export const trialBalanceLineSchema = z.object({
  accountId: z.string().uuid(),
  label: z.string(),
  kind: cashAccountKindSchema,
  debit: z.number(),
  credit: z.number(),
  balance: z.number()
});

export type TrialBalanceLine = z.infer<typeof trialBalanceLineSchema>;

export const treasuryBootstrapSchema = z.object({
  accounts: z.array(cashAccountSchema),
  recentMovements: z.array(cashMovementSchema),
  trialBalance: z.object({
    lines: z.array(trialBalanceLineSchema),
    totalDebit: z.number(),
    totalCredit: z.number(),
    isBalanced: z.boolean()
  }),
  branchCashPosition: z.object({
    vaultCash: z.number(),
    tellerCash: z.number(),
    bankCash: z.number(),
    totalCashPosition: z.number()
  })
});

export type TreasuryBootstrap = z.infer<typeof treasuryBootstrapSchema>;

export const createCashMovementSchema = z.object({
  branchId: z.string().min(1),
  movementType: cashMovementTypeSchema,
  fromAccountId: z.string().uuid().optional(),
  toAccountId: z.string().uuid().optional(),
  amount: z.number().positive(),
  notes: z.string().max(500).optional(),
  businessDate: z.string().optional()
});

export type CreateCashMovementInput = z.infer<typeof createCashMovementSchema>;
