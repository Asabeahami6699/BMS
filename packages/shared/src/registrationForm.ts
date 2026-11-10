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

export const registrationFormSetupSchema = z
  .object({
    savingsOpeningFeeGhs: money,
    forms: z.array(registrationAccountFormSchema).length(4),
    fields: registrationFormFieldsSchema
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
    forms: REGISTRATION_ACCOUNT_TYPES.map(
      (id) => data.forms.find((form) => form.id === id) as RegistrationAccountForm
    ),
    fields: data.fields
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
    forms: REGISTRATION_ACCOUNT_TYPES.map((id) => ({
      id,
      enabled: true,
      ...DEFAULT_FORM_COPY[id]
    })),
    fields: DEFAULT_FIELDS
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
    JSON.stringify(setup.forms) === JSON.stringify(defaults.forms) &&
    JSON.stringify(setup.fields) === JSON.stringify(defaults.fields)
  );
}

export type RegistrationDraft = {
  accountType: AccountType;
  email?: string;
  houseNumber?: string;
  dateOfBirth?: string;
  occupation?: string;
  idCardNumber?: string;
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
  if (fields.idCardNumber === "required" && !filled(draft.idCardNumber)) {
    return "Enter the ID card number.";
  }
  if (fields.idCardPhoto === "required" && !draft.idCardPhotoUrl?.trim()) {
    return "Take a photo of the customer's ID card.";
  }
  if (fields.customerPhoto === "required" && !draft.photoUrl?.trim()) {
    return "Take a photo of the customer.";
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
  if (fields.email === "hidden") {
    next.email = undefined;
  } else {
    next.email = filled(draft.email);
  }
  next.houseNumber = fields.houseNumber === "hidden" ? undefined : filled(draft.houseNumber);
  next.dateOfBirth = fields.dateOfBirth === "hidden" ? undefined : filled(draft.dateOfBirth);
  next.occupation = fields.occupation === "hidden" ? undefined : filled(draft.occupation);
  next.idCardNumber = fields.idCardNumber === "hidden" ? undefined : filled(draft.idCardNumber);
  if (fields.idCardPhoto === "hidden") {
    next.idCardPhotoUrl = undefined;
  }
  if (fields.customerPhoto === "hidden") {
    next.photoUrl = undefined;
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
