import { z } from "zod";

export const TRANSACTION_PIN_LENGTH = 4;
export const TRANSACTION_STEP_UP_HEADER = "x-transaction-authorization";
export const TRANSACTION_STEP_UP_TTL_MS = 5 * 60 * 1000;
export const TRANSACTION_PIN_MAX_ATTEMPTS = 3;
/** @deprecated Time-based lockout replaced by admin reset after max failed attempts. */
export const TRANSACTION_PIN_LOCKOUT_MS = 15 * 60 * 1000;

export const TRANSACTION_PIN_INVALID_CODE = "TRANSACTION_PIN_INVALID";
export const TRANSACTION_PIN_BLOCKED_CODE = "TRANSACTION_PIN_BLOCKED";

export const TRANSACTION_PIN_ROLES = ["teller", "back_officer"] as const;
export type TransactionPinRole = (typeof TRANSACTION_PIN_ROLES)[number];

const weakPins = new Set([
  "0000",
  "1111",
  "2222",
  "3333",
  "4444",
  "5555",
  "6666",
  "7777",
  "8888",
  "9999",
  "1234",
  "4321",
  "1212",
  "2121",
  "0123",
  "9876"
]);

export function roleRequiresTransactionPin(role: string): boolean {
  return (TRANSACTION_PIN_ROLES as readonly string[]).includes(role);
}

export function validateTransactionPinFormat(pin: string): string | null {
  if (!/^\d{4}$/.test(pin)) {
    return "PIN must be exactly 4 digits";
  }
  if (weakPins.has(pin)) {
    return "Choose a stronger PIN — avoid sequences and repeated digits";
  }
  return null;
}

export const setTransactionPinSchema = z
  .object({
    pin: z.string().min(4).max(4),
    confirmPin: z.string().min(4).max(4)
  })
  .superRefine((data, ctx) => {
    const formatError = validateTransactionPinFormat(data.pin);
    if (formatError) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: formatError, path: ["pin"] });
    }
    if (data.pin !== data.confirmPin) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "PIN confirmation does not match",
        path: ["confirmPin"]
      });
    }
  });

export const verifyTransactionPinSchema = z.object({
  pin: z.string().regex(/^\d{4}$/, "PIN must be exactly 4 digits")
});

export const transactionPinStatusSchema = z.object({
  required: z.boolean(),
  configured: z.boolean(),
  resetRequired: z.boolean(),
  lockedUntil: z.string().nullable().optional(),
  /** True after too many failed PIN attempts — administrator must reset the PIN. */
  blockedRequiresAdminReset: z.boolean().optional()
});

export type TransactionPinStatus = z.infer<typeof transactionPinStatusSchema>;

export const transactionPinVerifyResultSchema = z.object({
  token: z.string().min(1),
  expiresAt: z.string().min(1)
});

export type TransactionPinVerifyResult = z.infer<typeof transactionPinVerifyResultSchema>;
