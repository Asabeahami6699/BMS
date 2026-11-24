import { z } from "zod";
import { accountTypeSchema, type AccountType } from "./domain.js";
import { SAVINGS_INITIAL_DEPOSIT_GHS } from "./savings.js";

export const REGISTRATION_ACCOUNT_TYPES = ["susu", "savings", "group", "meba_daakye"] as const;

export const registrationFieldRequirementSchema = z.enum(["required", "optional", "hidden"]);
export type RegistrationFieldRequirement = z.infer<typeof registrationFieldRequirementSchema>;

const money = z.preprocess((value) => {
  const amount = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(amount)) {
    return value;
  }
  return Math.round(amount * 100) / 100;
}, z.number().min(0).max(1_000_000));

const registrationAccountFormSchema = z.object({
  id: accountTypeSchema,
  enabled: z.boolean(),
  label: z.string().trim().min(1, "Enter a form name").max(80),
  hint: z.string().trim().max(240),
  defaultDailyContributionGhs: money
});

export type RegistrationAccountForm = z.infer<typeof registrationAccountFormSchema>;

export const registrationFormFieldsSchema = z.object({
  email: registrationFieldRequirementSchema,
  houseNumber: registrationFieldRequirementSchema,
  dateOfBirth: registrationFieldRequirementSchema.default("required"),
  occupation: registrationFieldRequirementSchema.default("required"),
  idCardNumber: registrationFieldRequirementSchema,
  idCardPhoto: registrationFieldRequirementSchema,
  customerPhoto: registrationFieldRequirementSchema,
  nextOfKin: registrationFieldRequirementSchema,
  dailyContribution: registrationFieldRequirementSchema
});

export type RegistrationFormFields = z.infer<typeof registrationFormFieldsSchema>;

export const simplifiedKycPolicySchema = z.object({
  /** Allow registering foreigners / customers with no national ID via Tier 1 Simplified KYC + Local Introducer. */
  enabled: z.boolean().default(true),
  /** Maximum cumulative balance (GHS) allowed on a Simplified KYC account (0 = no cap). */
  maxBalanceGhs: money.default(5000),
  /** Allow field agents to submit withdrawal requests for Simplified KYC accounts (admin toggle). */
  allowFieldAgentWithdrawalRequest: z.boolean().default(false)
});

export type SimplifiedKycPolicy = z.infer<typeof simplifiedKycPolicySchema>;

export const DEFAULT_SIMPLIFIED_KYC_POLICY: SimplifiedKycPolicy = {
  enabled: true,
  maxBalanceGhs: 5000,
  allowFieldAgentWithdrawalRequest: false
};

export const savingsOpeningFeeHandlingSchema = z.enum(["both", "cash_now", "deduct_later"]);
export type SavingsOpeningFeeHandling = z.infer<typeof savingsOpeningFeeHandlingSchema>;

export const registrationFormSetupSchema = z
  .object({
    savingsOpeningFeeGhs: money,
    savingsOpeningFeeHandling: savingsOpeningFeeHandlingSchema.optional().default("both"),
    forms: z.array(registrationAccountFormSchema).length(4),
    fields: registrationFormFieldsSchema,
    simplifiedKyc: simplifiedKycPolicySchema.optional().default(DEFAULT_SIMPLIFIED_KYC_POLICY)
  })
  .superRefine((data, ctx) => {
    const ids = data.forms.map((form) => form.id);
    if (new Set(ids).size !== ids.length || !REGISTRATION_ACCOUNT_TYPES.every((id) => ids.includes(id))) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Include each account form once."
      });
    }
    if (!data.forms.some((form) => form.enabled)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Offer at least one account form."
      });
    }
  })
  .transform((data) => ({
    savingsOpeningFeeGhs: data.savingsOpeningFeeGhs,
    savingsOpeningFeeHandling: data.savingsOpeningFeeHandling ?? "both",
    forms: REGISTRATION_ACCOUNT_TYPES.map(
      (id) => data.forms.find((form) => form.id === id) as RegistrationAccountForm
    ),
    fields: data.fields,
    simplifiedKyc: data.simplifiedKyc ?? DEFAULT_SIMPLIFIED_KYC_POLICY
  }));

export type RegistrationFormSetup = z.infer<typeof registrationFormSetupSchema>;

const DEFAULT_FORM_COPY: Record<
  AccountType,
  { label: string; hint: string; defaultDailyContributionGhs: number }
> = {
  susu: {
    label: "Susu (daily collection)",
    hint: "Regular daily Susu contributions.",
    defaultDailyContributionGhs: 20
  },
  savings: {
    label: "Savings",
    hint: "Opening fee is credited on approval and stays locked.",
    defaultDailyContributionGhs: 0
  },
  group: {
    label: "Group",
    hint: "Group savings account.",
    defaultDailyContributionGhs: 20
  },
  meba_daakye: {
    label: "Meba Daakye",
    hint: "Meba Daakye product.",
    defaultDailyContributionGhs: 20
  }
};

const DEFAULT_FIELDS: RegistrationFormFields = {
  email: "optional",
  houseNumber: "required",
  dateOfBirth: "required",
  occupation: "required",
  idCardNumber: "required",
  idCardPhoto: "required",
  customerPhoto: "optional",
  nextOfKin: "required",
  dailyContribution: "optional"
};

export function defaultRegistrationFormSetup(
  openingFeeGhs: number = SAVINGS_INITIAL_DEPOSIT_GHS
): RegistrationFormSetup {
  return registrationFormSetupSchema.parse({
    savingsOpeningFeeGhs: openingFeeGhs,
    savingsOpeningFeeHandling: "both",
    forms: REGISTRATION_ACCOUNT_TYPES.map((id) => ({
      id,
      enabled: true,
      ...DEFAULT_FORM_COPY[id]
    })),
    fields: DEFAULT_FIELDS,
    simplifiedKyc: DEFAULT_SIMPLIFIED_KYC_POLICY
  });
}

/** Read a stored setup. Invalid or empty storage keeps the built-in defaults. */
export function parseRegistrationFormSetup(value: unknown, openingFeeGhs: number): RegistrationFormSetup {
  const defaults = defaultRegistrationFormSetup(openingFeeGhs);
  if (value == null) {
    return defaults;
  }
  const source =
    typeof value === "object"
      ? { ...(value as Record<string, unknown>), savingsOpeningFeeGhs: openingFeeGhs }
      : value;
  const parsed = registrationFormSetupSchema.safeParse(source);
  return parsed.success ? parsed.data : defaults;
}

export function readRegistrationFormSetup(value: unknown): RegistrationFormSetup {
  const parsed = registrationFormSetupSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Invalid form setup");
  }
  return parsed.data;
}

/** True when every form and field still matches the built-in registration forms. */
export function registrationFormsUseDefaults(setup: RegistrationFormSetup): boolean {
  const defaults = defaultRegistrationFormSetup();
  return (
    setup.savingsOpeningFeeHandling === defaults.savingsOpeningFeeHandling &&
    JSON.stringify(setup.forms) === JSON.stringify(defaults.forms) &&
    JSON.stringify(setup.fields) === JSON.stringify(defaults.fields) &&
    JSON.stringify(setup.simplifiedKyc) === JSON.stringify(defaults.simplifiedKyc)
  );
}

export type RegistrationDraft = {
  accountType: AccountType;
  email?: string;
  houseNumber?: string;
  dateOfBirth?: string;
  occupation?: string;
  idCardType?: string;
  idCardNumber?: string;
  nationality?: string;
  kycIntroducer?: {
    fullName?: string;
    phone?: string;
    relationship?: string;
    ghanaCardNumber?: string;
  };
  idCardPhotoUrl?: string;
  photoUrl?: string;
  nextOfKin?: {
    fullName?: string;
    phone?: string;
    location?: string;
    houseNumber?: string;
  };
  dailyContributionAmount?: number;
};

function filled(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

/** Why this draft cannot be submitted for the company's form setup. */
export function registrationFormIssue(draft: RegistrationDraft, setup: RegistrationFormSetup): string | null {
  const form = setup.forms.find((item) => item.id === draft.accountType);
  if (!form?.enabled) {
    return "That account form is turned off. Choose another account type.";
  }
  const fields = setup.fields;
  const isSimplifiedKyc = draft.idCardType === "no_id_simplified_kyc";
  if (isSimplifiedKyc && !setup.simplifiedKyc.enabled) {
    return "Simplified KYC (No National ID) registration is turned off by your company admin.";
  }
  if (fields.email === "required" && !filled(draft.email)) {
    return "Enter an email address.";
  }
  if (fields.email !== "hidden" && filled(draft.email) && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(filled(draft.email) ?? "")) {
    return "Enter a valid email address.";
  }
  if (fields.houseNumber === "required" && !filled(draft.houseNumber)) {
    return "Enter the house number.";
  }
  if (fields.dateOfBirth === "required" && !filled(draft.dateOfBirth)) {
    return "Enter the date of birth.";
  }
  if (fields.occupation === "required" && !filled(draft.occupation)) {
    return "Enter the occupation.";
  }
  if (isSimplifiedKyc) {
    if (!filled(draft.nationality)) {
      return "Enter the customer's nationality / country of origin for Simplified KYC.";
    }
    const intro = draft.kycIntroducer;
    if (
      !filled(intro?.fullName) ||
      !filled(intro?.phone) ||
      !filled(intro?.relationship) ||
      !filled(intro?.ghanaCardNumber)
    ) {
      return "Complete all local introducer details (name, phone, relationship, and Ghana Card number) for Simplified KYC.";
    }
    if (!draft.photoUrl?.trim()) {
      return "Customer face photo is required for Simplified KYC accounts.";
    }
  } else {
    if (fields.idCardNumber === "required" && !filled(draft.idCardNumber)) {
      return "Enter the ID card number.";
    }
    if (fields.idCardPhoto === "required" && !draft.idCardPhotoUrl?.trim()) {
      return "Take a photo of the customer's ID card.";
    }
    if (fields.customerPhoto === "required" && !draft.photoUrl?.trim()) {
      return "Take a photo of the customer.";
    }
  }
  const kin = draft.nextOfKin;
  const kinStarted = Boolean(
    filled(kin?.fullName) || filled(kin?.phone) || filled(kin?.location) || filled(kin?.houseNumber)
  );
  if (fields.nextOfKin === "required" || (fields.nextOfKin === "optional" && kinStarted)) {
    if (!filled(kin?.fullName) || !filled(kin?.phone) || !filled(kin?.location)) {
      return fields.nextOfKin === "required"
        ? "Enter the next of kin name, phone, and location."
        : "Complete the next of kin name, phone, and location, or leave them blank.";
    }
  }
  const daily = draft.dailyContributionAmount ?? 0;
  if (fields.dailyContribution === "required" && !(daily > 0)) {
    return "Enter a daily contribution greater than zero.";
  }
  return null;
}

/** Drop hidden answers so a turned-off field is not stored. */
export function registrationPayloadForSetup<T extends RegistrationDraft>(draft: T, setup: RegistrationFormSetup): T {
  const fields = setup.fields;
  const next: T = { ...draft };
  const isSimplifiedKyc = draft.idCardType === "no_id_simplified_kyc";
  if (fields.email === "hidden") {
    next.email = undefined;
  } else {
    next.email = filled(draft.email);
  }
  next.houseNumber = fields.houseNumber === "hidden" ? undefined : filled(draft.houseNumber);
  next.dateOfBirth = fields.dateOfBirth === "hidden" ? undefined : filled(draft.dateOfBirth);
  next.occupation = fields.occupation === "hidden" ? undefined : filled(draft.occupation);
  next.idCardType = fields.idCardNumber === "hidden" ? undefined : filled(draft.idCardType);
  if (isSimplifiedKyc) {
    next.idCardNumber = undefined;
    next.idCardPhotoUrl = undefined;
    next.nationality = filled(draft.nationality);
    const intro = draft.kycIntroducer;
    const iName = filled(intro?.fullName);
    const iPhone = filled(intro?.phone);
    const iRel = filled(intro?.relationship);
    const iCard = filled(intro?.ghanaCardNumber);
    next.kycIntroducer =
      iName && iPhone && iRel && iCard
        ? {
            fullName: iName,
            phone: iPhone,
            relationship: iRel,
            ghanaCardNumber: iCard
          }
        : undefined;
  } else {
    next.idCardNumber = fields.idCardNumber === "hidden" ? undefined : filled(draft.idCardNumber);
    next.nationality = filled(draft.nationality);
    next.kycIntroducer = undefined;
    if (fields.idCardPhoto === "hidden") {
      next.idCardPhotoUrl = undefined;
    }
    if (fields.customerPhoto === "hidden") {
      next.photoUrl = undefined;
    }
  }
  if (fields.nextOfKin === "hidden") {
    next.nextOfKin = undefined;
  } else if (draft.nextOfKin) {
    const fullName = filled(draft.nextOfKin.fullName);
    const phone = filled(draft.nextOfKin.phone);
    const location = filled(draft.nextOfKin.location);
    next.nextOfKin =
      fullName && phone && location
        ? {
            fullName,
            phone,
            location,
            houseNumber: filled(draft.nextOfKin.houseNumber)
          }
        : undefined;
  }
  next.dailyContributionAmount =
    fields.dailyContribution === "hidden" ? 0 : Math.max(0, draft.dailyContributionAmount ?? 0);
  return next;
}
