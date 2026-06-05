import { z } from "zod";

export const CUSTOMER_ACCOUNT_NUMBER_LENGTH = 12;

export const accountNumberPolicySchema = z.object({
  tenantId: z.string().min(1),
  prefix: z
    .string()
    .regex(/^\d+$/, "Prefix must contain digits only")
    .min(1, "Prefix is required")
    .max(
      CUSTOMER_ACCOUNT_NUMBER_LENGTH - 1,
      `Prefix must be shorter than ${CUSTOMER_ACCOUNT_NUMBER_LENGTH} digits`
    ),
  totalLength: z.literal(CUSTOMER_ACCOUNT_NUMBER_LENGTH)
});

export type AccountNumberPolicy = z.infer<typeof accountNumberPolicySchema>;

export function formatAccountNumberPreview(prefix: string): string {
  const normalized = prefix.replace(/\D/g, "");
  const suffixLen = Math.max(0, CUSTOMER_ACCOUNT_NUMBER_LENGTH - normalized.length);
  const sampleSuffix = "0".repeat(Math.max(0, suffixLen - 1)) + "1";
  return `${normalized}${sampleSuffix}`.slice(0, CUSTOMER_ACCOUNT_NUMBER_LENGTH);
}
