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
  if (upper === "MTN") return "MTN";
  if (upper === "VOD" || upper === "VODAFONE" || upper === "TELECEL") return "VOD";
  if (upper === "ATL" || upper === "AIRTELTIGO" || upper === "AT") return "ATL";
  return null;
}

function getCached(key: string): MomoLookupResult | null {
  const hit = lookupCache.get(key);
  if (!hit) return null;
  if (hit.expiresAt <= Date.now()) {
    lookupCache.delete(key);
    return null;
  }
  return hit.result;
}

function setCached(key: string, result: MomoLookupResult): void {
  if (lookupCache.size >= MAX_CACHE_ENTRIES) {
    const oldest = lookupCache.keys().next().value;
    if (oldest) {
      lookupCache.delete(oldest);
    }
  }
  lookupCache.set(key, { result, expiresAt: Date.now() + CACHE_TTL_MS });
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
  const cached = getCached(cacheKey);
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
      setCached(cacheKey, result);
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
