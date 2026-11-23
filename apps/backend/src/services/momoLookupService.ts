import { getPaystackSecretKey, hasPaystackConfig } from "../config/env.js";

export type MomoNetworkCode = "MTN" | "VOD" | "ATL";

export type MomoLookupResult = {
  configured: boolean;
  verified: boolean;
  phone: string;
  network: MomoNetworkCode;
  networkLabel: string;
  accountName: string | null;
  message?: string;
};

export type GhanaBankOption = {
  code: string;
  name: string;
  slug?: string;
};

export type BankAccountLookupResult = {
  configured: boolean;
  verified: boolean;
  kind: "bank" | "momo";
  accountNumber: string;
  bankCode: string | null;
  bankName: string;
  accountName: string | null;
  message?: string;
};

const NETWORK_LABELS: Record<MomoNetworkCode, string> = {
  MTN: "MTN MoMo",
  VOD: "Telecel Cash",
  ATL: "AT Money"
};

const MTN_PREFIXES = new Set(["024", "025", "053", "054", "055", "059"]);
const VOD_PREFIXES = new Set(["020", "050"]);
const ATL_PREFIXES = new Set(["026", "027", "056", "057"]);

const CACHE_TTL_MS = 10 * 60_000;
const MAX_CACHE_ENTRIES = 1000;
const lookupCache = new Map<string, { result: MomoLookupResult; expiresAt: number }>();
const bankLookupCache = new Map<string, { result: BankAccountLookupResult; expiresAt: number }>();

const BANK_LIST_TTL_MS = 6 * 60 * 60_000;
let bankListCache: { banks: GhanaBankOption[]; expiresAt: number } | null = null;

/** Common short labels used in agency banking mapped to search terms in Paystack's Ghana bank directory. */
const GHANA_BANK_ALIASES: Record<string, string[]> = {
  gcb: ["gcb bank", "ghana commercial"],
  ecobank: ["ecobank"],
  fidelity: ["fidelity bank"],
  absa: ["absa", "barclays"],
  stanbic: ["stanbic"],
  zenith: ["zenith"],
  calbank: ["cal bank", "calbank"],
  cal: ["cal bank", "calbank"],
  uba: ["united bank for africa", "uba"],
  access: ["access bank"],
  adb: ["agricultural development bank", "adb"],
  cbg: ["consolidated bank ghana", "cbg"],
  nib: ["national investment bank", "nib"],
  republic: ["republic bank"],
  prudential: ["prudential bank"],
  omnibsic: ["omnibsic", "omni bsic"],
  gtbank: ["guaranty trust", "gtbank", "gt bank"],
  gt: ["guaranty trust", "gtbank"],
  firstatlantic: ["first atlantic"],
  sg: ["societe generale"],
  societegenerale: ["societe generale"],
  scb: ["standard chartered"],
  standardchartered: ["standard chartered"],
  fnb: ["first national bank"],
  boa: ["bank of africa"],
  umb: ["universal merchant bank", "umb"],
  fbn: ["firstbank", "fbn"]
};

export function normalizeGhanaMomoPhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  if (/^233[25]\d{8}$/.test(digits)) {
    return `0${digits.slice(3)}`;
  }
  if (/^0[25]\d{8}$/.test(digits)) {
    return digits;
  }
  if (/^[25]\d{8}$/.test(digits)) {
    return `0${digits}`;
  }
  return null;
}

export function detectGhanaMomoNetwork(normalizedPhone: string): MomoNetworkCode | null {
  const prefix = normalizedPhone.slice(0, 3);
  if (MTN_PREFIXES.has(prefix)) return "MTN";
  if (VOD_PREFIXES.has(prefix)) return "VOD";
  if (ATL_PREFIXES.has(prefix)) return "ATL";
  return null;
}

export function parseMomoNetworkCode(raw?: string): MomoNetworkCode | null {
  if (!raw) return null;
  const upper = raw.trim().toUpperCase();
  if (upper === "MTN" || upper.includes("MTN")) return "MTN";
  if (upper === "VOD" || upper.includes("VODAFONE") || upper.includes("TELECEL")) return "VOD";
  if (
    upper === "ATL" ||
    upper.includes("AIRTEL") ||
    upper.includes("TIGO") ||
    upper === "AT" ||
    upper.includes("AT MONEY")
  ) {
    return "ATL";
  }
  return null;
}

function getCachedMomo(key: string): MomoLookupResult | null {
  const hit = lookupCache.get(key);
  if (!hit) return null;
  if (hit.expiresAt <= Date.now()) {
    lookupCache.delete(key);
    return null;
  }
  return hit.result;
}

function setCachedMomo(key: string, result: MomoLookupResult): void {
  if (lookupCache.size >= MAX_CACHE_ENTRIES) {
    const oldest = lookupCache.keys().next().value;
    if (oldest) {
      lookupCache.delete(oldest);
    }
  }
  lookupCache.set(key, { result, expiresAt: Date.now() + CACHE_TTL_MS });
}

function getCachedBank(key: string): BankAccountLookupResult | null {
  const hit = bankLookupCache.get(key);
  if (!hit) return null;
  if (hit.expiresAt <= Date.now()) {
    bankLookupCache.delete(key);
    return null;
  }
  return hit.result;
}

function setCachedBank(key: string, result: BankAccountLookupResult): void {
  if (bankLookupCache.size >= MAX_CACHE_ENTRIES) {
    const oldest = bankLookupCache.keys().next().value;
    if (oldest) {
      bankLookupCache.delete(oldest);
    }
  }
  bankLookupCache.set(key, { result, expiresAt: Date.now() + CACHE_TTL_MS });
}

function normalizeLabelForMatch(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function compactLabelForMatch(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

export async function listPaystackGhanaBanks(): Promise<{
  configured: boolean;
  banks: GhanaBankOption[];
}> {
  if (!hasPaystackConfig()) {
    return { configured: false, banks: [] };
  }

  if (bankListCache && bankListCache.expiresAt > Date.now()) {
    return { configured: true, banks: bankListCache.banks };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);

  try {
    const url = new URL("https://api.paystack.co/bank");
    url.searchParams.set("country", "ghana");
    url.searchParams.set("perPage", "100");

    const response = await fetch(url.toString(), {
      method: "GET",
      headers: {
        Authorization: `Bearer ${getPaystackSecretKey()}`,
        Accept: "application/json"
      },
      signal: controller.signal
    });

    const payload = (await response.json().catch(() => ({}))) as {
      status?: boolean;
      data?: Array<{
        code?: string;
        name?: string;
        slug?: string;
        active?: boolean;
        type?: string;
      }>;
    };

    if (!response.ok || !payload.status || !Array.isArray(payload.data)) {
      return { configured: true, banks: bankListCache?.banks ?? [] };
    }

    const seen = new Set<string>();
    const banks: GhanaBankOption[] = [];
    for (const item of payload.data) {
      if (item.active === false) continue;
      const code = typeof item.code === "string" ? item.code.trim() : "";
      const name = typeof item.name === "string" ? item.name.trim() : "";
      if (!code || !name || seen.has(code)) continue;
      seen.add(code);
      banks.push({
        code,
        name,
        slug: typeof item.slug === "string" ? item.slug : undefined
      });
    }

    banks.sort((a, b) => a.name.localeCompare(b.name));
    bankListCache = { banks, expiresAt: Date.now() + BANK_LIST_TTL_MS };
    return { configured: true, banks };
  } catch {
    return { configured: true, banks: bankListCache?.banks ?? [] };
  } finally {
    clearTimeout(timeout);
  }
}

export function matchGhanaBankByName(
  bankName: string,
  banks: GhanaBankOption[]
): GhanaBankOption | null {
  const norm = normalizeLabelForMatch(bankName);
  const compact = compactLabelForMatch(bankName);
  if (!norm || !compact) return null;

  // 1. Exact code or exact normalized name match
  for (const bank of banks) {
    if (bank.code.toLowerCase() === bankName.trim().toLowerCase()) {
      return bank;
    }
    if (normalizeLabelForMatch(bank.name) === norm) {
      return bank;
    }
  }

  // 2. Alias match (e.g. "GCB", "CalBank", "ADB", "UBA")
  const aliasTerms = GHANA_BANK_ALIASES[compact] ?? GHANA_BANK_ALIASES[norm.split(" ")[0] ?? ""];
  if (aliasTerms) {
    for (const term of aliasTerms) {
      const hit = banks.find((b) => normalizeLabelForMatch(b.name).includes(term));
      if (hit) return hit;
    }
  }

  // 3. Substring match on normalized name (ignore generic word "bank")
  const stripped = norm.replace(/\bbank\b/g, "").replace(/\blimited\b/g, "").replace(/\bltd\b/g, "").trim();
  if (stripped.length >= 2) {
    const startsHit = banks.find((b) => normalizeLabelForMatch(b.name).startsWith(stripped));
    if (startsHit) return startsHit;
    const containsHit = banks.find((b) => normalizeLabelForMatch(b.name).includes(stripped));
    if (containsHit) return containsHit;
  }

  return null;
}

export async function resolveGhanaMomoAccountName(input: {
  phone: string;
  network?: string;
}): Promise<MomoLookupResult> {
  const normalizedPhone = normalizeGhanaMomoPhone(input.phone);
  if (!normalizedPhone) {
    throw new Error("Enter a valid 10-digit Ghana mobile money number (e.g. 0244123456)");
  }

  const network = parseMomoNetworkCode(input.network) ?? detectGhanaMomoNetwork(normalizedPhone);
  if (!network) {
    throw new Error("Select the mobile money network (MTN, Telecel, or AT Money)");
  }
  const networkLabel = NETWORK_LABELS[network];

  if (!hasPaystackConfig()) {
    return {
      configured: false,
      verified: false,
      phone: normalizedPhone,
      network,
      networkLabel,
      accountName: null,
      message: "Automatic MoMo name lookup is not configured yet. Enter the account name manually."
    };
  }

  const cacheKey = `${network}:${normalizedPhone}`;
  const cached = getCachedMomo(cacheKey);
  if (cached) {
    return cached;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);

  try {
    const url = new URL("https://api.paystack.co/bank/resolve");
    url.searchParams.set("account_number", normalizedPhone);
    url.searchParams.set("bank_code", network);

    const response = await fetch(url.toString(), {
      method: "GET",
      headers: {
        Authorization: `Bearer ${getPaystackSecretKey()}`,
        Accept: "application/json"
      },
      signal: controller.signal
    });

    const payload = (await response.json().catch(() => ({}))) as {
      status?: boolean;
      message?: string;
      data?: {
        account_name?: string;
        account_number?: string;
      };
    };

    const resolvedName =
      payload.status && typeof payload.data?.account_name === "string"
        ? payload.data.account_name.trim()
        : "";

    if (response.ok && resolvedName) {
      const result: MomoLookupResult = {
        configured: true,
        verified: true,
        phone: normalizedPhone,
        network,
        networkLabel,
        accountName: resolvedName
      };
      setCachedMomo(cacheKey, result);
      return result;
    }

    return {
      configured: true,
      verified: false,
      phone: normalizedPhone,
      network,
      networkLabel,
      accountName: null,
      message:
        payload.message && payload.message.trim().length > 0
          ? `${payload.message.trim()}. Check the network or enter the account name manually.`
          : "Could not auto-verify this MoMo number. Check the network or enter the name manually."
    };
  } catch (error) {
    const isAbort = error instanceof Error && error.name === "AbortError";
    return {
      configured: true,
      verified: false,
      phone: normalizedPhone,
      network,
      networkLabel,
      accountName: null,
      message: isAbort
        ? "MoMo lookup timed out. You can try again or enter the account name manually."
        : "MoMo lookup is temporarily unavailable. Enter the account name manually."
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function resolveGhanaBankAccountName(input: {
  accountNumber: string;
  bankCode?: string;
  bankName?: string;
}): Promise<BankAccountLookupResult> {
  // Check if this is actually a Ghana MoMo network lookup
  const momoCode =
    parseMomoNetworkCode(input.bankCode) ?? parseMomoNetworkCode(input.bankName);
  if (momoCode) {
    const momo = await resolveGhanaMomoAccountName({
      phone: input.accountNumber,
      network: momoCode
    });
    return {
      configured: momo.configured,
      verified: momo.verified,
      kind: "momo",
      accountNumber: momo.phone,
      bankCode: momo.network,
      bankName: momo.networkLabel,
      accountName: momo.accountName,
      message: momo.message
    };
  }

  const cleanAccount = input.accountNumber.replace(/\D/g, "");
  if (cleanAccount.length < 6 || cleanAccount.length > 20) {
    throw new Error("Enter a valid bank account number (6 to 20 digits)");
  }

  if (!hasPaystackConfig()) {
    return {
      configured: false,
      verified: false,
      kind: "bank",
      accountNumber: cleanAccount,
      bankCode: input.bankCode?.trim() || null,
      bankName: input.bankName?.trim() || "Partner bank",
      accountName: null,
      message: "Automatic bank account name lookup is not configured yet. Enter the name manually."
    };
  }

  let resolvedBankCode = input.bankCode?.trim() || "";
  let resolvedBankName = input.bankName?.trim() || "";

  if (!resolvedBankCode) {
    if (!resolvedBankName) {
      throw new Error("Select a bank before verifying the account number");
    }
    const { banks } = await listPaystackGhanaBanks();
    const matched = matchGhanaBankByName(resolvedBankName, banks);
    if (!matched) {
      return {
        configured: true,
        verified: false,
        kind: "bank",
        accountNumber: cleanAccount,
        bankCode: null,
        bankName: resolvedBankName,
        accountName: null,
        message: `Could not match "${resolvedBankName}" to a Paystack Ghana bank. Pick the bank from the dropdown or enter the name manually.`
      };
    }
    resolvedBankCode = matched.code;
    resolvedBankName = matched.name;
  } else if (!resolvedBankName) {
    const { banks } = await listPaystackGhanaBanks();
    const byCode = banks.find((b) => b.code === resolvedBankCode);
    resolvedBankName = byCode?.name ?? resolvedBankCode;
  }

  const cacheKey = `${resolvedBankCode}:${cleanAccount}`;
  const cached = getCachedBank(cacheKey);
  if (cached) {
    return cached;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);

  try {
    const url = new URL("https://api.paystack.co/bank/resolve");
    url.searchParams.set("account_number", cleanAccount);
    url.searchParams.set("bank_code", resolvedBankCode);

    const response = await fetch(url.toString(), {
      method: "GET",
      headers: {
        Authorization: `Bearer ${getPaystackSecretKey()}`,
        Accept: "application/json"
      },
      signal: controller.signal
    });

    const payload = (await response.json().catch(() => ({}))) as {
      status?: boolean;
      message?: string;
      data?: {
        account_name?: string;
        account_number?: string;
      };
    };

    const resolvedName =
      payload.status && typeof payload.data?.account_name === "string"
        ? payload.data.account_name.trim()
        : "";

    if (response.ok && resolvedName) {
      const result: BankAccountLookupResult = {
        configured: true,
        verified: true,
        kind: "bank",
        accountNumber: cleanAccount,
        bankCode: resolvedBankCode,
        bankName: resolvedBankName,
        accountName: resolvedName
      };
      setCachedBank(cacheKey, result);
      return result;
    }

    return {
      configured: true,
      verified: false,
      kind: "bank",
      accountNumber: cleanAccount,
      bankCode: resolvedBankCode,
      bankName: resolvedBankName,
      accountName: null,
      message:
        payload.message && payload.message.trim().length > 0
          ? `${payload.message.trim()}. Verify the account number and bank, or enter the name manually.`
          : "Could not verify this bank account number. Double-check the bank or enter the name manually."
    };
  } catch (error) {
    const isAbort = error instanceof Error && error.name === "AbortError";
    return {
      configured: true,
      verified: false,
      kind: "bank",
      accountNumber: cleanAccount,
      bankCode: resolvedBankCode,
      bankName: resolvedBankName,
      accountName: null,
      message: isAbort
        ? "Bank lookup timed out. Try again or enter the account holder name manually."
        : "Bank account lookup is temporarily unavailable. Enter the account holder name manually."
    };
  } finally {
    clearTimeout(timeout);
  }
}
