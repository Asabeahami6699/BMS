/** Ghana Card format: GHA-123456789-0 (9 digits + check digit). */
export const GHANA_CARD_PATTERN = /^GHA-\d{9}-\d$/;

export function formatGhanaCardInput(raw: string): string {
  const digits = raw.replace(/\D/g, "").slice(0, 10);
  if (digits.length === 0) {
    return "";
  }
  if (digits.length <= 9) {
    return `GHA-${digits}`;
  }
  return `GHA-${digits.slice(0, 9)}-${digits.slice(9)}`;
}

export function normalizeGhanaCardNumber(raw: string): string | null {
  const trimmed = raw.trim().toUpperCase();
  if (!trimmed) {
    return null;
  }
  const formatted = formatGhanaCardInput(trimmed);
  if (!GHANA_CARD_PATTERN.test(formatted)) {
    return null;
  }
  return formatted;
}

export function isValidGhanaCardNumber(raw: string): boolean {
  return normalizeGhanaCardNumber(raw) != null;
}
