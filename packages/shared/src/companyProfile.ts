import { z } from "zod";

const hexColor = z.string().regex(/^#[0-9A-Fa-f]{6}$/, "Choose a brand color");

/** 0 keeps the app’s current size. Each step adds 2px on the root font. */
export const FONT_SIZE_STEP_MAX = 3;
export const FONT_SIZE_STEP_PX = 2;
export const fontSizeStepSchema = z.number().int().min(0).max(FONT_SIZE_STEP_MAX);

function emptyToNull(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

export const companyProfileSchema = z.object({
  tenantId: z.string().min(1),
  name: z.string().min(1).max(120),
  phone: z.string().max(30).optional(),
  email: z.string().email().max(120).optional(),
  address: z.string().max(300).optional(),
  taxId: z.string().max(40).optional(),
  logoUrl: z.string().max(900_000).optional(),
  brandColor: hexColor.optional(),
  fontSizeStep: fontSizeStepSchema.default(0)
});

export type CompanyProfile = z.infer<typeof companyProfileSchema>;

export const updateCompanyProfileSchema = z.object({
  name: z.string().trim().min(1, "Enter the company name").max(120),
  phone: z.preprocess(emptyToNull, z.string().max(30).nullable().optional()),
  email: z.preprocess(emptyToNull, z.string().email("Enter a valid email").max(120).nullable().optional()),
  address: z.preprocess(emptyToNull, z.string().max(300).nullable().optional()),
  taxId: z.preprocess(emptyToNull, z.string().max(40).nullable().optional()),
  logoUrl: z.string().max(900_000).nullable().optional(),
  brandColor: z.preprocess(emptyToNull, hexColor.nullable().optional()),
  fontSizeStep: fontSizeStepSchema.optional()
});

export type UpdateCompanyProfileInput = z.infer<typeof updateCompanyProfileSchema>;

export function assertCompanyLogo(logoUrl: string | null | undefined): void {
  if (!logoUrl) {
    return;
  }
  if (!/^data:image\/(jpeg|png|webp);base64,/i.test(logoUrl)) {
    throw new Error("Logo must be a JPEG, PNG, or WebP image.");
  }
  if (logoUrl.length > 900_000) {
    throw new Error("Logo is too large. Use a smaller image.");
  }
}
