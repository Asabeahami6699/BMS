import { createHmac, timingSafeEqual } from "node:crypto";

export type SupabaseJwtClaims = {
  sub: string;
  exp: number;
  email?: string;
};

function base64UrlDecode(segment: string): Buffer {
  const normalized = segment.replace(/-/g, "+").replace(/_/g, "/");
  const padding = normalized.length % 4 === 0 ? "" : "=".repeat(4 - (normalized.length % 4));
  return Buffer.from(normalized + padding, "base64");
}

export function decodeSupabaseAccessTokenClaims(token: string): SupabaseJwtClaims | null {
  const parts = token.split(".");
  if (parts.length !== 3) {
    return null;
  }

  try {
    const payload = JSON.parse(base64UrlDecode(parts[1]!).toString("utf8")) as {
      sub?: unknown;
      exp?: unknown;
      email?: unknown;
    };
    if (typeof payload.sub !== "string" || typeof payload.exp !== "number") {
      return null;
    }
    if (payload.exp * 1000 <= Date.now()) {
      return null;
    }
    return {
      sub: payload.sub,
      exp: payload.exp,
      email: typeof payload.email === "string" ? payload.email : undefined
    };
  } catch {
    return null;
  }
}

export function verifySupabaseAccessToken(token: string, jwtSecret: string): SupabaseJwtClaims | null {
  const parts = token.split(".");
  if (parts.length !== 3) {
    return null;
  }

  const [header, payload, signature] = parts;
  const signed = `${header}.${payload}`;
  const expected = createHmac("sha256", jwtSecret).update(signed).digest();
  let actual: Buffer;
  try {
    actual = base64UrlDecode(signature!);
  } catch {
    return null;
  }

  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    return null;
  }

  return decodeSupabaseAccessTokenClaims(token);
}
