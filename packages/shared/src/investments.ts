import { z } from "zod";

export const investmentProductTypeSchema = z.enum([
  "fixed_deposit",
  "treasury_bill",
  "government_bond",
  "shares"
]);
export type InvestmentProductType = z.infer<typeof investmentProductTypeSchema>;

export const INVESTMENT_PRODUCT_TYPE_LABELS: Record<InvestmentProductType, string> = {
  fixed_deposit: "Fixed Deposit",
  treasury_bill: "Treasury Bill",
  government_bond: "Government Bond",
  shares: "Shares"
};

export const investmentStatusSchema = z.enum([
  "active",
  "matured",
  "closed",
  "redeemed",
  "cancelled"
]);
export type InvestmentStatus = z.infer<typeof investmentStatusSchema>;

export const investmentAutoRenewalSchema = z.enum([
  "none",
  "principal_only",
  "principal_and_interest"
]);
export type InvestmentAutoRenewal = z.infer<typeof investmentAutoRenewalSchema>;

export const investmentFormFieldTypeSchema = z.enum([
  "text",
  "number",
  "date",
  "dropdown",
  "checkbox",
  "radio",
  "file",
  "signature",
  "textarea",
  "phone",
  "email"
]);
export type InvestmentFormFieldType = z.infer<typeof investmentFormFieldTypeSchema>;

export const investmentFormFieldRequirementSchema = z.enum(["required", "optional", "hidden"]);
export type InvestmentFormFieldRequirement = z.infer<typeof investmentFormFieldRequirementSchema>;

export const investmentFormFieldSchema = z.object({
  id: z.string().min(1),
  key: z.string().min(1),
  label: z.string().min(1),
  type: investmentFormFieldTypeSchema,
  sectionId: z.string().min(1),
  requirement: investmentFormFieldRequirementSchema.default("optional"),
  sortOrder: z.number().int().nonnegative().default(0),
  placeholder: z.string().optional(),
  helpText: z.string().optional(),
  options: z.array(z.string()).optional(),
  defaultValue: z.union([z.string(), z.number(), z.boolean()]).optional(),
  isStandard: z.boolean().default(false)
});
export type InvestmentFormField = z.infer<typeof investmentFormFieldSchema>;

export const investmentFormSectionSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  description: z.string().optional(),
  sortOrder: z.number().int().nonnegative().default(0),
  isStandard: z.boolean().default(false),
  collapsible: z.boolean().default(true)
});
export type InvestmentFormSection = z.infer<typeof investmentFormSectionSchema>;

export const investmentFormConfigSchema = z.object({
  tenantId: z.string().min(1),
  sections: z.array(investmentFormSectionSchema),
  fields: z.array(investmentFormFieldSchema),
  updatedAt: z.string().optional(),
  updatedBy: z.string().optional()
});
export type InvestmentFormConfig = z.infer<typeof investmentFormConfigSchema>;

export const investmentBeneficiarySchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1),
  relationship: z.string().min(1),
  phone: z.string().optional(),
  altPhone: z.string().optional(),
  email: z.string().optional(),
  address: z.string().optional(),
  allocationPercent: z.number().min(0).max(100)
});
export type InvestmentBeneficiary = z.infer<typeof investmentBeneficiarySchema>;

export const investmentAttachmentKindSchema = z.enum([
  "passport_photo",
  "signature",
  "national_id",
  "utility_bill",
  "supporting"
]);
export type InvestmentAttachmentKind = z.infer<typeof investmentAttachmentKindSchema>;

export const investmentAttachmentSchema = z.object({
  id: z.string(),
  investmentId: z.string(),
  tenantId: z.string(),
  kind: investmentAttachmentKindSchema,
  fileName: z.string().min(1),
  mimeType: z.string().optional(),
  contentUrl: z.string().optional(),
  uploadedBy: z.string(),
  createdAt: z.string().optional()
});
export type InvestmentAttachment = z.infer<typeof investmentAttachmentSchema>;

export const investmentAuditEventSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  investmentId: z.string(),
  action: z.string(),
  actorUserId: z.string(),
  actorName: z.string().optional(),
  actorRole: z.string().optional(),
  changes: z.record(z.unknown()).optional(),
  createdAt: z.string()
});
export type InvestmentAuditEvent = z.infer<typeof investmentAuditEventSchema>;

export const investmentRateTierSchema = z.object({
  id: z.string().optional(),
  label: z.string().optional(),
  tenureDays: z.number().int().positive(),
  ratePercent: z.number().min(0).max(100),
  sortOrder: z.number().int().nonnegative().optional()
});
export type InvestmentRateTier = z.infer<typeof investmentRateTierSchema>;

export const investmentProductSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  productType: investmentProductTypeSchema,
  name: z.string().min(1),
  description: z.string().optional(),
  defaultRatePercent: z.number().min(0).max(100),
  defaultTenureDays: z.number().int().positive(),
  rateTiers: z.array(investmentRateTierSchema).default([]),
  minAmount: z.number().positive(),
  maxAmount: z.number().positive(),
  status: z.enum(["active", "inactive"]).default("active"),
  createdAt: z.string().optional()
});
export type InvestmentProduct = z.infer<typeof investmentProductSchema>;

export const investmentRecordSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  investmentNumber: z.string(),
  productId: z.string().optional(),
  productType: investmentProductTypeSchema,
  productName: z.string(),
  branchId: z.string(),
  branchName: z.string().optional(),
  officerUserId: z.string().optional(),
  officerName: z.string().optional(),
  customerId: z.string().optional(),
  customerName: z.string(),
  customerPhone: z.string().optional(),
  customerSnapshot: z.record(z.unknown()),
  customFields: z.record(z.unknown()).default({}),
  principalAmount: z.number().positive(),
  interestRatePercent: z.number().min(0).max(100),
  tenureDays: z.number().int().positive(),
  startDate: z.string(),
  maturityDate: z.string(),
  expectedInterest: z.number().nonnegative(),
  expectedMaturityValue: z.number().nonnegative(),
  autoRenewal: investmentAutoRenewalSchema.default("none"),
  status: investmentStatusSchema,
  parentInvestmentId: z.string().optional(),
  renewalCycle: z.number().int().positive().default(1),
  beneficiaries: z.array(investmentBeneficiarySchema).default([]),
  attachments: z.array(investmentAttachmentSchema).default([]),
  createdBy: z.string(),
  modifiedBy: z.string().optional(),
  approvedBy: z.string().optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
  approvedAt: z.string().optional()
});
export type InvestmentRecord = z.infer<typeof investmentRecordSchema>;

export const investmentSummarySchema = z.object({
  active: z.number().int().nonnegative(),
  matured: z.number().int().nonnegative(),
  redeemed: z.number().int().nonnegative(),
  autoRenewed: z.number().int().nonnegative(),
  totalPrincipal: z.number().nonnegative(),
  totalExpectedInterest: z.number().nonnegative(),
  byProductType: z.record(z.number().int().nonnegative()).default({}),
  byBranch: z.record(z.number().int().nonnegative()).default({})
});
export type InvestmentSummary = z.infer<typeof investmentSummarySchema>;

const investmentProductInputSchema = z.object({
  productType: investmentProductTypeSchema,
  name: z.string().min(1),
  description: z.string().optional(),
  defaultRatePercent: z.number().min(0).max(100),
  defaultTenureDays: z.number().int().positive(),
  rateTiers: z.array(investmentRateTierSchema).optional(),
  minAmount: z.number().positive(),
  maxAmount: z.number().positive(),
  status: z.enum(["active", "inactive"]).optional()
});

export const createInvestmentProductSchema = investmentProductInputSchema.refine(
  (d) => d.maxAmount >= d.minAmount,
  {
    message: "Maximum amount must be at least the minimum",
    path: ["maxAmount"]
  }
);

export const updateInvestmentProductSchema = investmentProductInputSchema.partial();

export function normalizeInvestmentProductInput<T extends {
  defaultRatePercent?: number;
  defaultTenureDays?: number;
  rateTiers?: InvestmentRateTier[];
}>(input: T): T {
  const tiers = [...(input.rateTiers ?? [])].sort(
    (a, b) => (a.sortOrder ?? a.tenureDays) - (b.sortOrder ?? b.tenureDays)
  );
  if (tiers.length === 0) {
    return input;
  }
  const first = tiers[0];
  return {
    ...input,
    rateTiers: tiers.map((tier, index) => ({ ...tier, sortOrder: tier.sortOrder ?? index })),
    defaultRatePercent: first.ratePercent,
    defaultTenureDays: first.tenureDays
  };
}

export const createInvestmentApplicationSchema = z.object({
  productId: z.string().optional(),
  productType: investmentProductTypeSchema,
  productName: z.string().min(1),
  branchId: z.string().min(1),
  officerUserId: z.string().optional(),
  customerId: z.string().optional(),
  customerName: z.string().min(1),
  customerPhone: z.string().optional(),
  customerSnapshot: z.record(z.unknown()),
  customFields: z.record(z.unknown()).optional(),
  principalAmount: z.number().positive(),
  interestRatePercent: z.number().min(0).max(100),
  tenureDays: z.number().int().positive(),
  startDate: z.string().min(1),
  autoRenewal: investmentAutoRenewalSchema.optional(),
  beneficiaries: z.array(investmentBeneficiarySchema).optional(),
  attachments: z
    .array(
      z.object({
        kind: investmentAttachmentKindSchema,
        fileName: z.string().min(1),
        mimeType: z.string().optional(),
        contentUrl: z.string().max(4_500_000).optional()
      })
    )
    .optional()
});

export const updateInvestmentApplicationSchema = createInvestmentApplicationSchema.partial();

export const investmentSearchSchema = z.object({
  q: z.string().optional(),
  productType: investmentProductTypeSchema.optional(),
  branchId: z.string().optional(),
  officerUserId: z.string().optional(),
  status: investmentStatusSchema.optional()
});

export const updateInvestmentFormConfigSchema = z.object({
  sections: z.array(investmentFormSectionSchema),
  fields: z.array(investmentFormFieldSchema)
});

export function computeInvestmentFigures(input: {
  principalAmount: number;
  interestRatePercent: number;
  tenureDays: number;
  startDate: string;
}): {
  maturityDate: string;
  expectedInterest: number;
  expectedMaturityValue: number;
} {
  const start = new Date(input.startDate);
  const maturity = new Date(start);
  maturity.setDate(maturity.getDate() + input.tenureDays);
  const expectedInterest = Number(
    ((input.principalAmount * input.interestRatePercent * input.tenureDays) / (365 * 100)).toFixed(2)
  );
  return {
    maturityDate: maturity.toISOString().slice(0, 10),
    expectedInterest,
    expectedMaturityValue: Number((input.principalAmount + expectedInterest).toFixed(2))
  };
}

const STANDARD_SECTIONS: InvestmentFormSection[] = [
  { id: "personal", title: "Personal Information", sortOrder: 0, isStandard: true, collapsible: true },
  { id: "contact", title: "Contact Information", sortOrder: 1, isStandard: true, collapsible: true },
  { id: "address", title: "Address Information", sortOrder: 2, isStandard: true, collapsible: true },
  { id: "identification", title: "Identification Information", sortOrder: 3, isStandard: true, collapsible: true },
  { id: "photo", title: "Customer Photo", sortOrder: 4, isStandard: true, collapsible: true },
  { id: "next_of_kin", title: "Next of Kin", sortOrder: 5, isStandard: true, collapsible: true },
  { id: "beneficiaries", title: "Beneficiary Information", sortOrder: 6, isStandard: true, collapsible: true },
  { id: "investment", title: "Investment Information", sortOrder: 7, isStandard: true, collapsible: true }
];

function field(
  sectionId: string,
  key: string,
  label: string,
  type: InvestmentFormFieldType,
  sortOrder: number,
  requirement: InvestmentFormFieldRequirement = "optional",
  options?: string[]
): InvestmentFormField {
  return {
    id: `std_${key}`,
    key,
    label,
    type,
    sectionId,
    requirement,
    sortOrder,
    isStandard: true,
    options
  };
}

export function buildDefaultInvestmentFormConfig(tenantId: string): InvestmentFormConfig {
  const fields: InvestmentFormField[] = [
    field("personal", "customerId", "Customer ID", "text", 0),
    field("personal", "firstName", "First Name", "text", 1, "required"),
    field("personal", "middleName", "Middle Name", "text", 2),
    field("personal", "lastName", "Last Name", "text", 3, "required"),
    field("personal", "gender", "Gender", "dropdown", 4, "optional", ["Male", "Female", "Other"]),
    field("personal", "dateOfBirth", "Date of Birth", "date", 5, "required"),
    field("personal", "nationality", "Nationality", "text", 6),
    field("personal", "occupation", "Occupation", "text", 7),
    field("contact", "mobileNumber", "Mobile Number", "phone", 0, "required"),
    field("contact", "altPhone", "Alternative Phone Number", "phone", 1),
    field("contact", "email", "Email Address", "email", 2),
    field("address", "region", "Region", "text", 0),
    field("address", "district", "District", "text", 1),
    field("address", "townCity", "Town/City", "text", 2),
    field("address", "residentialAddress", "Residential Address", "textarea", 3, "required"),
    field("address", "gpsAddress", "GPS Address", "text", 4),
    field("identification", "idType", "ID Type", "dropdown", 0, "required", [
      "Ghana Card",
      "Passport",
      "Voter ID",
      "Driver License"
    ]),
    field("identification", "idNumber", "ID Number", "text", 1, "required"),
    field("identification", "idIssueDate", "Issue Date", "date", 2),
    field("identification", "idExpiryDate", "Expiry Date", "date", 3),
    field("photo", "passportPhoto", "Passport Photo", "file", 0, "optional"),
    field("next_of_kin", "nokName", "Name", "text", 0, "required"),
    field("next_of_kin", "nokRelationship", "Relationship", "text", 1, "required"),
    field("next_of_kin", "nokPhone", "Phone Number", "phone", 2, "required"),
    field("next_of_kin", "nokAltPhone", "Alternative Phone Number", "phone", 3),
    field("next_of_kin", "nokEmail", "Email Address", "email", 4),
    field("next_of_kin", "nokAddress", "Residential Address", "textarea", 5),
    field("investment", "investmentNumber", "Investment Number", "text", 0, "hidden"),
    field("investment", "productType", "Product Type", "dropdown", 1, "hidden", [
      "Fixed Deposit",
      "Treasury Bill",
      "Government Bond",
      "Shares"
    ]),
    field("investment", "productName", "Product Name", "text", 2, "hidden"),
    field("investment", "branchId", "Branch", "text", 3, "hidden"),
    field("investment", "officerUserId", "Investment Officer/Agent", "text", 4, "hidden"),
    field("investment", "principalAmount", "Principal Amount", "number", 5, "hidden"),
    field("investment", "interestRatePercent", "Interest Rate / Yield (%)", "number", 6, "hidden"),
    field("investment", "tenureDays", "Tenure (days)", "number", 7, "hidden"),
    field("investment", "startDate", "Start Date", "date", 8, "hidden"),
    field("investment", "maturityDate", "Maturity Date", "date", 9, "hidden"),
    field("investment", "expectedInterest", "Expected Interest", "number", 10, "hidden"),
    field("investment", "expectedMaturityValue", "Expected Maturity Value", "number", 11, "hidden"),
    field("investment", "autoRenewal", "Auto Renewal", "dropdown", 12, "hidden", [
      "No Renewal",
      "Renew Principal Only",
      "Renew Principal + Interest"
    ])
  ];
  return { tenantId, sections: STANDARD_SECTIONS, fields };
}

export function formatInvestmentTenureLabel(tenureDays: number): string {
  if (tenureDays === 365) {
    return "1 year";
  }
  if (tenureDays === 1825) {
    return "5 years";
  }
  if (tenureDays >= 365 && tenureDays % 365 === 0) {
    const years = tenureDays / 365;
    return `${years} year${years === 1 ? "" : "s"}`;
  }
  return `${tenureDays} days`;
}

export function investmentProductRateOptions(
  product: Pick<InvestmentProduct, "defaultRatePercent" | "defaultTenureDays" | "rateTiers">
): Array<{ tenureDays: number; ratePercent: number; label: string }> {
  const tiers = [...(product.rateTiers ?? [])].sort(
    (a, b) => (a.sortOrder ?? a.tenureDays) - (b.sortOrder ?? b.tenureDays)
  );
  if (tiers.length > 0) {
    return tiers.map((tier) => ({
      tenureDays: tier.tenureDays,
      ratePercent: tier.ratePercent,
      label: tier.label ?? `${formatInvestmentTenureLabel(tier.tenureDays)} · ${tier.ratePercent}%`
    }));
  }
  return [
    {
      tenureDays: product.defaultTenureDays,
      ratePercent: product.defaultRatePercent,
      label: `${formatInvestmentTenureLabel(product.defaultTenureDays)} · ${product.defaultRatePercent}%`
    }
  ];
}

export const INVESTMENT_TENURE_PRESETS: Array<{ label: string; tenureDays: number }> = [
  { label: "30 days", tenureDays: 30 },
  { label: "90 days", tenureDays: 90 },
  { label: "1 year", tenureDays: 365 },
  { label: "5 years", tenureDays: 1825 }
];
