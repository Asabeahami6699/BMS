import { config } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const backendRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
config({ path: resolve(backendRoot, ".env") });

const envSchema = z.object({
  SUPABASE_URL: z.string().url().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),
  SUPABASE_ANON_KEY: z.string().min(1).optional(),
  /** Project JWT secret (Settings → API) — enables offline token verification when Auth API is unreachable */
  SUPABASE_JWT_SECRET: z.string().min(1).optional(),
  SUPER_ADMIN_EMAIL: z.string().email().default("super@bms.com"),
  SUPER_ADMIN_PASSWORD: z.string().min(8).default("ChangeMe123!"),
  SUPER_ADMIN_FULL_NAME: z.string().min(1).default("Platform Super Admin"),
  BOOTSTRAP_DEMO_ADMIN: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true")
});

const parsed = envSchema.safeParse(process.env);

export const env = parsed.success
  ? parsed.data
  : {
      SUPER_ADMIN_EMAIL: "super@bms.com",
      SUPER_ADMIN_PASSWORD: "ChangeMe123!",
      SUPER_ADMIN_FULL_NAME: "Platform Super Admin",
      BOOTSTRAP_DEMO_ADMIN: true
    };

export function hasSupabaseConfig(): boolean {
  return Boolean(env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY);
}

export function hasSupabaseAuthConfig(): boolean {
  return Boolean(env.SUPABASE_URL && env.SUPABASE_ANON_KEY);
}

export function getSupabaseJwtSecret(): string | undefined {
  return env.SUPABASE_JWT_SECRET;
}

export function getSuperAdminCredentials() {
  return {
    email: env.SUPER_ADMIN_EMAIL ?? "super@bms.com",
    password: env.SUPER_ADMIN_PASSWORD ?? "ChangeMe123!",
    fullName: env.SUPER_ADMIN_FULL_NAME ?? "Platform Super Admin"
  };
}
