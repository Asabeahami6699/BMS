import { bootstrapSupabaseSeed } from "../services/supabaseBootstrap.js";
import { getSuperAdminCredentials, hasSupabaseConfig } from "../config/env.js";

async function main() {
  if (!hasSupabaseConfig()) {
    console.error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in apps/backend/.env");
    process.exit(1);
  }

  await bootstrapSupabaseSeed({ resetPassword: true });
  const creds = getSuperAdminCredentials();
  console.log("\nPermanent platform super admin:");
  console.log(`  Email:    ${creds.email}`);
  console.log(`  Password: (value of SUPER_ADMIN_PASSWORD in .env)`);
  console.log("\nSign in at /login → platform dashboard at /platform/companies\n");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
