import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decodeSupabaseAccessTokenClaims, verifySupabaseAccessToken } from "./supabaseJwt.js";

function signTestJwt(payload: Record<string, unknown>, secret: string): string {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signed = `${header}.${body}`;
  const signature = createHmac("sha256", secret).update(signed).digest("base64url");
  return `${signed}.${signature}`;
}

describe("supabaseJwt", () => {
  it("verifies a valid HS256 token", () => {
    const secret = "test-jwt-secret";
    const token = signTestJwt(
      { sub: "auth-user-1", exp: Math.floor(Date.now() / 1000) + 3600 },
      secret
    );
    expect(verifySupabaseAccessToken(token, secret)?.sub).toBe("auth-user-1");
  });

  it("rejects expired tokens", () => {
    const secret = "test-jwt-secret";
    const token = signTestJwt({ sub: "auth-user-1", exp: 1 }, secret);
    expect(verifySupabaseAccessToken(token, secret)).toBeNull();
    expect(decodeSupabaseAccessTokenClaims(token)).toBeNull();
  });

  it("rejects tampered signatures and alg=none tokens", () => {
    const secret = "test-jwt-secret";
    const valid = signTestJwt(
      { sub: "auth-user-1", exp: Math.floor(Date.now() / 1000) + 3600 },
      secret
    );
    expect(verifySupabaseAccessToken(valid, "wrong-secret")).toBeNull();

    const noneHeader = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
    const body = Buffer.from(
      JSON.stringify({ sub: "auth-user-1", exp: Math.floor(Date.now() / 1000) + 3600 })
    ).toString("base64url");
    expect(verifySupabaseAccessToken(`${noneHeader}.${body}.`, secret)).toBeNull();
  });
});
