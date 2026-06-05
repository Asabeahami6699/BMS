import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import ws from "ws";
import { env, hasSupabaseAuthConfig, hasSupabaseConfig } from "./env.js";

let adminClient: SupabaseClient | null = null;
let authClient: SupabaseClient | null = null;

const clientOptions = {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  },
  realtime: {
    transport: ws as unknown as typeof WebSocket
  }
};

/** Service-role client for DB/admin operations. Never use for signInWithPassword. */
export function getSupabaseAdminClient(): SupabaseClient | null {
  if (!hasSupabaseConfig()) {
    return null;
  }

  if (!adminClient) {
    adminClient = createClient(env.SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!, clientOptions);
  }

  return adminClient;
}

/** Anon client for password sign-in only — keeps the admin client on service role. */
export function getSupabaseAuthClient(): SupabaseClient | null {
  if (!hasSupabaseAuthConfig()) {
    return null;
  }

  if (!authClient) {
    authClient = createClient(env.SUPABASE_URL!, env.SUPABASE_ANON_KEY!, clientOptions);
  }

  return authClient;
}
