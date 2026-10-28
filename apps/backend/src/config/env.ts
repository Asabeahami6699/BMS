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
  /** When true, skip Supabase even if URL/keys are set (local dev without cloud). */
  SUPABASE_DISABLED: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  SUPER_ADMIN_EMAIL: z.string().email().default("super@bms.com"),
  SUPER_ADMIN_PASSWORD: z.string().min(8).default("ChangeMe123!"),
  SUPER_ADMIN_FULL_NAME: z.string().min(1).default("Platform Super Admin"),
  BOOTSTRAP_DEMO_ADMIN: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),
  OLLAMA_BASE_URL: z.string().url().default("http://127.0.0.1:11434"),
  OLLAMA_MODEL: z.string().min(1).default("llama3.2:3b"),
  ARKESEL_API_KEY: z.string().min(1).optional(),
  ARKESEL_SENDER_ID: z.string().min(1).max(11).optional(),
  ARKESEL_SMS_BASE_URL: z.string().url().default("https://sms.arkesel.com"),
  SMTP_HOST: z.string().min(1).optional(),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_USER: z.string().min(1).optional(),
  SMTP_PASS: z.string().min(1).optional(),
  SMTP_FROM: z.string().email().optional(),
  SMTP_SECURE: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true")
});

const parsed = envSchema.safeParse(process.env);

type Env = z.infer<typeof envSchema>;

const fallbackEnv: Env = {
  SUPABASE_DISABLED: false,
  SUPER_ADMIN_EMAIL: "super@bms.com",
  SUPER_ADMIN_PASSWORD: "ChangeMe123!",
  SUPER_ADMIN_FULL_NAME: "Platform Super Admin",
  BOOTSTRAP_DEMO_ADMIN: true,
  OLLAMA_BASE_URL: "http://127.0.0.1:11434",
  OLLAMA_MODEL: "llama3.2:3b",
  ARKESEL_SMS_BASE_URL: "https://sms.arkesel.com",
  SMTP_PORT: 587,
  SMTP_SECURE: false
};

export const env: Env = parsed.success ? parsed.data : fallbackEnv;

const IS_TEST = Boolean(process.env.VITEST) || process.env.NODE_ENV === "test";

let supabaseRuntimeDisabled = false;

/** Call when Supabase is configured but unreachable so the API uses in-memory stores. */
export function disableSupabaseRuntime(reason: string): void {
  if (supabaseRuntimeDisabled) {
    return;
  }
  supabaseRuntimeDisabled = true;
  console.warn(`[supabase] Unavailable — using in-memory storage for this process (${reason})`);
}

export function isSupabaseRuntimeDisabled(): boolean {
  return supabaseRuntimeDisabled;
}

export function hasSupabaseConfig(): boolean {
  return (
    !IS_TEST &&
    !supabaseRuntimeDisabled &&
    !env.SUPABASE_DISABLED &&
    Boolean(env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY)
  );
}

export function hasSupabaseAuthConfig(): boolean {
  return (
    !IS_TEST &&
    !supabaseRuntimeDisabled &&
    !env.SUPABASE_DISABLED &&
    Boolean(env.SUPABASE_URL && env.SUPABASE_ANON_KEY)
  );
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

export function getOllamaConfig() {
  return {
    baseUrl: (env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434").replace(/\/$/, ""),
    model: env.OLLAMA_MODEL ?? "llama3.2:3b"
  };
}

export function hasArkeselSmsConfig(): boolean {
  return Boolean(env.ARKESEL_API_KEY);
}

export function getArkeselSmsConfig() {
  return {
    apiKey: env.ARKESEL_API_KEY ?? "",
    senderId: env.ARKESEL_SENDER_ID ?? "",
    baseUrl: (env.ARKESEL_SMS_BASE_URL ?? "https://sms.arkesel.com").replace(/\/$/, "")
  };
}

export function hasSmtpConfig(): boolean {
  return Boolean(env.SMTP_HOST && env.SMTP_FROM);
}

export function getSmtpConfig() {
  return {
    host: env.SMTP_HOST ?? "",
    port: env.SMTP_PORT ?? 587,
    user: env.SMTP_USER ?? "",
    pass: env.SMTP_PASS ?? "",
    from: env.SMTP_FROM ?? "",
    secure: env.SMTP_SECURE ?? false
  };
}
