import type { MomoNetworkCode } from "../app/api";

export const MOMO_NETWORK_OPTIONS: Array<{
  code: MomoNetworkCode;
  label: string;
  displayName: string;
}> = [
  { code: "MTN", label: "MTN MoMo", displayName: "MTN" },
  { code: "VOD", label: "Telecel Cash", displayName: "Telecel" },
  { code: "ATL", label: "AT Money", displayName: "AT Money" }
];

export function sanitizeDigitsOnly(raw: string, maxLength = 12): string {
  return raw.replace(/\D/g, "").slice(0, maxLength);
}

export function detectGhanaMomoNetwork(raw: string): MomoNetworkCode | null {
  const digits = raw.replace(/\D/g, "");
  const normalized = digits.startsWith("233") && digits.length >= 6 ? `0${digits.slice(3)}` : digits;
  const prefix = normalized.slice(0, 3);
  if (["024", "025", "053", "054", "055", "059"].includes(prefix)) return "MTN";
  if (["020", "050"].includes(prefix)) return "VOD";
  if (["026", "027", "056", "057"].includes(prefix)) return "ATL";
  return null;
}

export function parseMomoNetworkLabel(raw?: string | null): MomoNetworkCode | null {
  if (!raw) return null;
  const upper = raw.trim().toUpperCase();
  if (upper === "MTN" || upper.includes("MTN")) return "MTN";
  if (upper === "VOD" || upper.includes("TELECEL") || upper.includes("VODAFONE")) return "VOD";
  if (upper === "ATL" || upper.includes("AIRTEL") || upper.includes("TIGO") || upper === "AT" || upper.includes("AT MONEY")) {
    return "ATL";
  }
  return null;
}

export function isCompleteGhanaMomoPhone(raw: string): boolean {
  const digits = raw.replace(/\D/g, "");
  return /^0[25]\d{8}$/.test(digits) || /^233[25]\d{8}$/.test(digits);
}

export function momoNetworkLabel(code: MomoNetworkCode): string {
  return MOMO_NETWORK_OPTIONS.find((item) => item.code === code)?.label ?? code;
}

export function namesRoughlyMatch(a: string, b: string): boolean {
  const tokensA = a
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 2);
  const tokensB = b
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 2);
  if (tokensA.length === 0 || tokensB.length === 0) return true;
  return tokensA.some((word) => tokensB.includes(word));
}
