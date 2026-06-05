/**
 * Apply a single migration file when DATABASE_URL is set in apps/backend/.env
 * Example: node scripts/apply-migration-sql.mjs supabase/migrations/021_savings_locked_initial_deposit.sql
 */
import { readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import pg from "pg";

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, "../apps/backend/.env");
const migrationArg = process.argv[2];

if (!migrationArg) {
  console.error("Usage: node scripts/apply-migration-sql.mjs <path-to.sql>");
  process.exit(1);
}

const migrationPath = resolve(__dirname, "..", migrationArg);
if (!existsSync(migrationPath)) {
  console.error(`File not found: ${migrationPath}`);
  process.exit(1);
}

const env = Object.fromEntries(
  readFileSync(envPath, "utf8")
    .split("\n")
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    })
);

const databaseUrl = env.DATABASE_URL;
if (!databaseUrl) {
  console.error(
    "DATABASE_URL is not set in apps/backend/.env.\n" +
      "Add it from Supabase → Project Settings → Database → Connection string (URI), then re-run."
  );
  process.exit(1);
}

const sql = readFileSync(migrationPath, "utf8");
const client = new pg.Client({ connectionString: databaseUrl, ssl: { rejectUnauthorized: false } });

try {
  await client.connect();
  await client.query(sql);
  console.log(`Applied: ${migrationArg}`);
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
} finally {
  await client.end();
}
