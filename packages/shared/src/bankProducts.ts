import { z } from "zod";
import { amountFigureToWords } from "./amountInWords.js";



export const bankProductDirectionSchema = z.enum(["deposit", "withdrawal", "account_opening"]);



export type BankProductDirection = z.infer<typeof bankProductDirectionSchema>;



/** Create form — deposit, withdrawal, both, or account opening product. */

export const bankProductCreateDirectionSchema = z.enum([

  "deposit",

  "withdrawal",

  "both",

  "account_opening"

]);



export type BankProductCreateDirection = z.infer<typeof bankProductCreateDirectionSchema>;



export const bankProductWorkflowStageSchema = z.enum([

  "capture",

  "verification",

  "execution",

  "account_opening"

]);



export type BankProductWorkflowStage = z.infer<typeof bankProductWorkflowStageSchema>;



export const bankProductFieldTypeSchema = z.enum([

  "text",

  "number",

  "phone",

  "email",

  "date",

  "select",

  "textarea",

  "checkbox"

]);



export type BankProductFieldType = z.infer<typeof bankProductFieldTypeSchema>;



export const bankProductWorkflowFieldSchema = z.object({

  key: z

    .string()

    .min(1)

    .max(50)

    .regex(/^[a-z][a-z0-9_]*$/, "Field key must start with a letter"),

  label: z.string().trim().min(1).max(120),

  type: bankProductFieldTypeSchema,

  required: z.boolean().default(false),

  stages: z.array(bankProductWorkflowStageSchema).min(1),

  placeholder: z.string().max(200).optional(),

  helpText: z.string().max(300).optional(),

  options: z.array(z.string().min(1)).optional(),

  sortOrder: z.number().int().nonnegative().default(0),

  /** When set, this field is derived from another field (e.g. amount in words from amount figure). */
  autoFrom: z.string().optional(),

  /** Read-only fields are shown but not edited directly in the form. */
  readOnly: z.boolean().optional()

});



export type BankProductWorkflowField = z.infer<typeof bankProductWorkflowFieldSchema>;



export const workflowFieldsSchema = z.array(bankProductWorkflowFieldSchema).default([]);



export const workflowDataSchema = z.record(z.string(), z.unknown()).default({});



export type WorkflowData = z.infer<typeof workflowDataSchema>;



/** Ecobank-style agency settlement cap — cumulative executed deposits per company account per day. */
export const COMPANY_ACCOUNT_DEFAULT_EXECUTION_LIMIT = 1_000_000;

export function resolveCompanyAccountExecutionLimit(
  limit: number | null | undefined
): number {
  if (limit != null && Number.isFinite(limit) && limit >= 0) {
    return limit;
  }
  return COMPANY_ACCOUNT_DEFAULT_EXECUTION_LIMIT;
}

export const bankProductSchema = z.object({

  id: z.string().min(1),

  tenantId: z.string().min(1),

  branchId: z.string().min(1).nullable().optional(),

  branchName: z.string().optional(),

  name: z.string().min(1),

  code: z

    .string()

    .min(1)

    .max(64)

    .regex(/^[a-z0-9_]+$/, "Code must be lowercase letters, numbers, and underscores"),

  direction: bankProductDirectionSchema,

  bankLabel: z.string().min(1),

  isActive: z.boolean(),

  sortOrder: z.number().int().nonnegative(),

  workflowFields: workflowFieldsSchema,

  /** Company account used by back officer at the partner bank. */
  isCompanyBankAccount: z.boolean().default(false),

  /** Deposits above this amount require accountant approval before execution. */
  executionLimitAmount: z.number().nonnegative().nullable().optional(),

  createdAt: z.string().min(1),

  updatedAt: z.string().min(1)

});



export type TenantBankProduct = z.infer<typeof bankProductSchema>;



const bankProductFieldsSchema = z.object({

  name: z.string().trim().min(1, "Name is required").max(120),

  code: z.string().trim().max(64).optional(),

  bankLabel: z.string().trim().min(1, "Bank label is required").max(80),

  branchId: z.string().min(1).nullable().optional(),

  isActive: z.boolean().optional(),

  sortOrder: z.number().int().nonnegative().optional(),

  workflowFields: workflowFieldsSchema.optional(),

  isCompanyBankAccount: z.boolean().optional(),

  executionLimitAmount: z.number().nonnegative().nullable().optional()

});



export const createBankProductSchema = bankProductFieldsSchema.extend({

  direction: bankProductCreateDirectionSchema

});



export const updateBankProductSchema = bankProductFieldsSchema

  .extend({

    direction: bankProductDirectionSchema.optional()

  })

  .partial();



export type CreateBankProductInput = z.infer<typeof createBankProductSchema>;

export type UpdateBankProductInput = z.infer<typeof updateBankProductSchema>;



export const BANK_PRODUCT_DIRECTION_LABELS: Record<BankProductDirection, string> = {

  deposit: "Deposit",

  withdrawal: "Withdrawal",

  account_opening: "Account opening"

};



export const BANK_PRODUCT_CREATE_DIRECTION_LABELS: Record<BankProductCreateDirection, string> = {

  deposit: "Deposit only",

  withdrawal: "Withdrawal only",

  both: "Deposit & withdrawal (both)",

  account_opening: "Account opening"

};



export const BANK_PRODUCT_WORKFLOW_STAGE_LABELS: Record<BankProductWorkflowStage, string> = {

  capture: "Capture (teller / intake)",

  verification: "Verification (customer service)",

  execution: "Execution (back office)",

  account_opening: "Account opening (customer service)"

};



export const STANDARD_WITHDRAWAL_VERIFICATION_FIELDS: BankProductWorkflowField[] = [
  {
    key: "account_number",
    label: "Account number",
    type: "text",
    required: true,
    stages: ["verification"],
    sortOrder: 0
  },
  {
    key: "account_holder_name",
    label: "Account holder name",
    type: "text",
    required: true,
    stages: ["verification"],
    sortOrder: 1
  },
  {
    key: "amount",
    label: "Amount",
    type: "number",
    required: true,
    stages: ["verification"],
    sortOrder: 2
  },
  {
    key: "ghana_card_number",
    label: "Ghana Card number",
    type: "text",
    required: true,
    stages: ["verification"],
    sortOrder: 3
  },
  {
    key: "phone_number",
    label: "Phone number",
    type: "phone",
    required: true,
    stages: ["verification"],
    sortOrder: 4
  }
];



export const STANDARD_DEPOSIT_CAPTURE_FIELDS: BankProductWorkflowField[] = [
  {
    key: "branch",
    label: "Branch",
    type: "text",
    required: true,
    stages: ["capture"],
    readOnly: true,
    helpText: "Filled from the branch selected above",
    sortOrder: 0
  },
  {
    key: "account_number",
    label: "Account number",
    type: "text",
    required: true,
    stages: ["capture"],
    sortOrder: 1
  },
  {
    key: "account_holder_name",
    label: "Name of account holder",
    type: "text",
    required: true,
    stages: ["capture"],
    sortOrder: 2
  },
  {
    key: "depositor_name",
    label: "Depositor name",
    type: "text",
    required: true,
    stages: ["capture"],
    sortOrder: 3
  },
  {
    key: "depositor_number",
    label: "Depositor number",
    type: "phone",
    required: true,
    stages: ["capture"],
    placeholder: "10-digit mobile number",
    helpText: "Digits only — exactly 10 numbers",
    sortOrder: 4
  },
  {
    key: "ghana_card_number",
    label: "Ghana Card number",
    type: "text",
    required: true,
    stages: ["capture"],
    sortOrder: 5
  },
  {
    key: "amount_figure",
    label: "Amount in figure (GHS)",
    type: "number",
    required: true,
    stages: ["capture"],
    sortOrder: 6
  },
  {
    key: "amount_in_words",
    label: "Amount in words",
    type: "text",
    required: true,
    stages: ["capture"],
    readOnly: true,
    autoFrom: "amount_figure",
    sortOrder: 7
  }
];



export const STANDARD_DEPOSIT_EXECUTION_FIELDS: BankProductWorkflowField[] = [

  {

    key: "bank_reference",

    label: "Bank reference / txn ID",

    type: "text",

    required: true,

    stages: ["execution"],

    sortOrder: 0

  }

];



export const STANDARD_ACCOUNT_OPENING_FIELDS: BankProductWorkflowField[] = [

  {

    key: "ghana_card_number",

    label: "Ghana Card number",

    type: "text",

    required: true,

    stages: ["account_opening"],

    sortOrder: 0

  },

  {

    key: "platform_username",

    label: "Bank platform username",

    type: "text",

    required: false,

    stages: ["account_opening"],

    sortOrder: 1

  },

  {

    key: "opening_notes",

    label: "Account opening notes",

    type: "textarea",

    required: false,

    stages: ["account_opening"],

    sortOrder: 2

  }

];



export function defaultWorkflowFieldsForDirection(

  direction: BankProductDirection

): BankProductWorkflowField[] {

  if (direction === "withdrawal") {

    return [...STANDARD_WITHDRAWAL_VERIFICATION_FIELDS];

  }

  if (direction === "deposit") {

    return [...STANDARD_DEPOSIT_CAPTURE_FIELDS, ...STANDARD_DEPOSIT_EXECUTION_FIELDS];

  }

  if (direction === "account_opening") {

    return [...STANDARD_ACCOUNT_OPENING_FIELDS];

  }

  return [];

}



export function resolveProductWorkflowFields(

  product: Pick<TenantBankProduct, "direction" | "workflowFields">

): BankProductWorkflowField[] {

  if (product.workflowFields.length > 0) {

    return [...product.workflowFields].sort((a, b) => a.sortOrder - b.sortOrder);

  }

  return defaultWorkflowFieldsForDirection(product.direction);

}



export function workflowFieldsForStage(

  product: Pick<TenantBankProduct, "direction" | "workflowFields">,

  stage: BankProductWorkflowStage

): BankProductWorkflowField[] {

  return resolveProductWorkflowFields(product).filter((field) => field.stages.includes(stage));

}



export function applyWorkflowAutoFields(

  fields: BankProductWorkflowField[],

  data: WorkflowData

): WorkflowData {

  const next: WorkflowData = { ...data };

  for (const field of fields) {

    if (!field.autoFrom) {

      continue;

    }

    const source = next[field.autoFrom];

    if (field.autoFrom === "amount_figure" && field.key === "amount_in_words") {

      const amount = Number(source);

      if (Number.isFinite(amount) && amount > 0) {

        next[field.key] = amountFigureToWords(amount);

      }

    }

  }

  return next;

}



export function validateWorkflowFieldValues(

  fields: BankProductWorkflowField[],

  data: WorkflowData,

  stage: BankProductWorkflowStage

): { ok: true; data: WorkflowData } | { ok: false; errors: string[] } {

  const stageFields = fields.filter((field) => field.stages.includes(stage));

  const errors: string[] = [];

  const normalized: WorkflowData = applyWorkflowAutoFields(stageFields, data);



  for (const field of stageFields) {

    const raw = normalized[field.key];

    const empty =

      raw == null ||

      raw === "" ||

      (field.type === "checkbox" && raw !== true && raw !== "true");



    if (field.required && empty) {

      errors.push(`${field.label} is required`);

      continue;

    }

    if (empty) {

      continue;

    }



    if (field.type === "number" && Number.isNaN(Number(raw))) {

      errors.push(`${field.label} must be a number`);

    }

    if (field.type === "email" && typeof raw === "string" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw)) {

      errors.push(`${field.label} must be a valid email`);

    }

    if (field.key === "depositor_number" && typeof raw === "string") {

      const digits = raw.replace(/\D/g, "");

      if (!/^\d{10}$/.test(digits)) {

        errors.push(`${field.label} must be exactly 10 digits`);

      } else {

        normalized[field.key] = digits;

      }

    }

    if (field.type === "select" && field.options?.length) {

      if (!field.options.includes(String(raw))) {

        errors.push(`${field.label} must be one of the allowed options`);

      }

    }

    if (field.type === "checkbox") {

      normalized[field.key] = raw === true || raw === "true";

    }

  }



  if (errors.length > 0) {

    return { ok: false, errors };

  }

  return { ok: true, data: normalized };

}



export function resolveBankProductCreateDirections(

  direction: BankProductCreateDirection

): BankProductDirection[] {

  if (direction === "both") {

    return ["deposit", "withdrawal"];

  }

  return [direction];

}



export function normalizeBankProductCode(raw: string): string {

  return raw

    .trim()

    .toLowerCase()

    .replace(/[^a-z0-9]+/g, "_")

    .replace(/^_+|_+$/g, "")

    .slice(0, 64);

}



export function suggestBankProductCode(input: {

  bankLabel: string;

  name: string;

  direction: BankProductDirection;

  branchCode?: string;

}): string {

  const parts = [input.bankLabel, input.name, input.direction];

  if (input.branchCode) {

    parts.push(input.branchCode);

  }

  const base = normalizeBankProductCode(parts.join("_"));

  if (base.length >= 2) {

    return base;

  }

  return normalizeBankProductCode(`${input.direction}_${input.bankLabel || "product"}`);

}



export function bankProductDisplayLabel(

  product: Pick<TenantBankProduct, "name" | "bankLabel" | "branchName">

): string {

  const bank = `${product.bankLabel} — ${product.name}`;

  return product.branchName ? `${bank} (${product.branchName})` : bank;

}



export function bankProductScopeLabel(product: Pick<TenantBankProduct, "branchId" | "branchName">): string {

  if (product.branchId && product.branchName) {

    return product.branchName;

  }

  if (product.branchId) {

    return "Branch";

  }

  return "All branches";

}



export function bankProductAppliesToBranch(

  product: Pick<TenantBankProduct, "branchId">,

  branchId: string | undefined

): boolean {

  if (!branchId) {

    return true;

  }

  return product.branchId == null || product.branchId === branchId;

}


