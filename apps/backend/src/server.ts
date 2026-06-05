import { createApp } from "./app.js";
import { getSuperAdminCredentials, hasSupabaseConfig } from "./config/env.js";
import { bootstrapSupabaseSeed } from "./services/supabaseBootstrap.js";

const port = Number(process.env.PORT ?? 4000);

async function main() {
  try {
    await bootstrapSupabaseSeed();
  } catch (error) {
    console.error("[bootstrap] Failed:", error instanceof Error ? error.message : error);
    if (hasSupabaseConfig()) {
      console.error("[bootstrap] Super admin login may not work until bootstrap succeeds.");
    }
  }

  const app = createApp();
  const superAdmin = getSuperAdminCredentials();

  const server = app.listen(port, () => {
    console.log(`API running on http://localhost:${port}`);
    console.log(
      hasSupabaseConfig()
        ? "[storage] Supabase connected — tenants persist to database"
        : "[storage] Supabase not configured — tenants stored in memory only"
    );
    console.log(`[auth] Super admin: ${superAdmin.email}`);
  });

  server.on("error", (error: NodeJS.ErrnoException) => {
    if (error.code === "EADDRINUSE") {
      console.error(
        `[server] Port ${port} is already in use. Stop the other API process (or close the duplicate terminal running npm run dev) and try again.`
      );
      process.exit(1);
    }
    throw error;
  });
}

void main();
