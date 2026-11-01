import {
  parseRegistrationFormSetup,
  readRegistrationFormSetup,
  registrationFormsUseDefaults,
  type RegistrationFormSetup
} from "@bms/shared";
import { getSupabaseAdminClient } from "../config/supabaseClient.js";
import { cacheSavingsOpeningFee, getSavingsOpeningFeeGhs } from "./tenantProfileService.js";

const memory = new Map<string, RegistrationFormSetup>();

function missingConfigColumn(message: string): boolean {
  return /registration_form_config|does not exist|schema cache|could not find the column/i.test(message);
}

export async function getRegistrationFormSetup(tenantId: string): Promise<RegistrationFormSetup> {
  const fee = await getSavingsOpeningFeeGhs(tenantId);
  const supabase = getSupabaseAdminClient();
  if (!supabase) {
    const cached = memory.get(tenantId);
    return cached
      ? { ...cached, savingsOpeningFeeGhs: fee }
      : parseRegistrationFormSetup(null, fee);
  }

  const { data, error } = await supabase
    .from("tenants")
    .select("registration_form_config")
    .eq("id", tenantId)
    .maybeSingle();
  if (error) {
    if (missingConfigColumn(error.message)) {
      return parseRegistrationFormSetup(null, fee);
    }
    throw new Error(`Failed to load form setup: ${error.message}`);
  }
  const setup = parseRegistrationFormSetup(data?.registration_form_config ?? null, fee);
  memory.set(tenantId, setup);
  return setup;
}

export async function updateRegistrationFormSetup(
  tenantId: string,
  input: unknown
): Promise<RegistrationFormSetup> {
  const next = readRegistrationFormSetup(input);
  const supabase = getSupabaseAdminClient();
  if (!supabase) {
    memory.set(tenantId, next);
    cacheSavingsOpeningFee(tenantId, next.savingsOpeningFeeGhs);
    return next;
  }

  const payload: Record<string, unknown> = {
    savings_opening_fee_ghs: next.savingsOpeningFeeGhs,
    registration_form_config: registrationFormsUseDefaults(next)
      ? null
      : { forms: next.forms, fields: next.fields }
  };
  let { error } = await supabase.from("tenants").update(payload).eq("id", tenantId);
  if (error && /savings_opening_fee_ghs/i.test(error.message)) {
    if (next.savingsOpeningFeeGhs !== 20) {
      throw new Error(
        "Savings opening amount storage is not ready. Apply migration 072_savings_opening_fee.sql in Supabase, then save again."
      );
    }
    delete payload.savings_opening_fee_ghs;
    const retry = await supabase.from("tenants").update(payload).eq("id", tenantId);
    error = retry.error;
  }
  if (error && missingConfigColumn(error.message)) {
    if (!registrationFormsUseDefaults(next)) {
      throw new Error(
        "Form setup storage is not ready. Apply migration 073_registration_form_setup.sql in Supabase, then save again."
      );
    }
    delete payload.registration_form_config;
    if (Object.keys(payload).length > 0) {
      const retry = await supabase.from("tenants").update(payload).eq("id", tenantId);
      error = retry.error;
    } else {
      error = null;
    }
  }
  if (error) {
    throw new Error(`Failed to save form setup: ${error.message}`);
  }

  memory.set(tenantId, next);
  cacheSavingsOpeningFee(tenantId, next.savingsOpeningFeeGhs);
  return next;
}
