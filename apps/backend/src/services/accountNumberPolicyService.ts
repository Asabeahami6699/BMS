import {
  CUSTOMER_ACCOUNT_NUMBER_LENGTH,
  accountNumberPolicySchema,
  type AccountNumberPolicy
} from "@bms/shared";
import { getSupabaseAdminClient } from "../config/supabaseClient.js";
import { getTenantFromStore, upsertTenantInStore } from "./authStore.js";

const DEFAULT_PREFIX = "000000";

const memoryPrefix = new Map<string, string>();

export { CUSTOMER_ACCOUNT_NUMBER_LENGTH };

function normalizePrefix(raw: string | null | undefined): string {
  const digits = String(raw ?? "")
    .replace(/\D/g, "")
    .slice(0, CUSTOMER_ACCOUNT_NUMBER_LENGTH - 1);
  return digits.length > 0 ? digits : DEFAULT_PREFIX;
}

export async function getAccountNumberPolicy(tenantId: string): Promise<AccountNumberPolicy> {
  const supabase = getSupabaseAdminClient();
  if (supabase) {
    const { data, error } = await supabase
      .from("tenants")
      .select("account_number_prefix")
      .eq("id", tenantId)
      .maybeSingle();
    if (error) {
      throw new Error(`Failed to load account number policy: ${error.message}`);
    }
    const prefix = normalizePrefix(data?.account_number_prefix);
    return accountNumberPolicySchema.parse({
      tenantId,
      prefix,
      totalLength: CUSTOMER_ACCOUNT_NUMBER_LENGTH
    });
  }

  const fromMemory =
    memoryPrefix.get(tenantId) ??
    getTenantFromStore(tenantId)?.accountNumberPrefix ??
    DEFAULT_PREFIX;

  return accountNumberPolicySchema.parse({
    tenantId,
    prefix: normalizePrefix(fromMemory),
    totalLength: CUSTOMER_ACCOUNT_NUMBER_LENGTH
  });
}

export async function upsertAccountNumberPolicy(
  tenantId: string,
  input: unknown
): Promise<AccountNumberPolicy> {
  const parsed = accountNumberPolicySchema.safeParse({
    ...(typeof input === "object" && input !== null ? input : {}),
    tenantId,
    totalLength: CUSTOMER_ACCOUNT_NUMBER_LENGTH
  });
  if (!parsed.success) {
    throw new Error(parsed.error.errors[0]?.message ?? "Invalid account number policy");
  }

  const prefix = parsed.data.prefix;
  const supabase = getSupabaseAdminClient();
  if (supabase) {
    const { error } = await supabase
      .from("tenants")
      .update({ account_number_prefix: prefix })
      .eq("id", tenantId);
    if (error) {
      throw new Error(`Failed to save account number prefix: ${error.message}`);
    }
  }

  memoryPrefix.set(tenantId, prefix);
  const tenant = getTenantFromStore(tenantId);
  if (tenant) {
    upsertTenantInStore({ ...tenant, accountNumberPrefix: prefix });
  }

  return parsed.data;
}

function randomNumericSuffix(length: number): string {
  let out = "";
  for (let i = 0; i < length; i++) {
    out += Math.floor(Math.random() * 10).toString();
  }
  return out;
}

async function isAccountNumberTaken(tenantId: string, accountNumber: string): Promise<boolean> {
  const supabase = getSupabaseAdminClient();
  if (!supabase) {
    return false;
  }
  const { data, error } = await supabase
    .from("customers")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("account_number", accountNumber)
    .limit(1)
    .maybeSingle();
  if (error) {
    throw new Error(`Failed to verify account number: ${error.message}`);
  }
  return Boolean(data?.id);
}

export async function generateCustomerAccountNumber(tenantId: string): Promise<string> {
  const policy = await getAccountNumberPolicy(tenantId);
  const suffixLength = CUSTOMER_ACCOUNT_NUMBER_LENGTH - policy.prefix.length;
  if (suffixLength < 1) {
    throw new Error("Account number prefix is too long. Shorten it in Settings.");
  }

  for (let attempt = 0; attempt < 25; attempt++) {
    const candidate = `${policy.prefix}${randomNumericSuffix(suffixLength)}`;
    if (candidate.length !== CUSTOMER_ACCOUNT_NUMBER_LENGTH) {
      continue;
    }
    if (!(await isAccountNumberTaken(tenantId, candidate))) {
      return candidate;
    }
  }

  throw new Error("Could not generate a unique account number. Try again.");
}
