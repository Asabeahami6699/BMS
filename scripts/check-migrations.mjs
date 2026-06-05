import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, "../apps/backend/.env");
const env = Object.fromEntries(
  readFileSync(envPath, "utf8")
    .split("\n")
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    })
);

const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const checks = [
  { name: "017 table", table: "customer_balance_disclosures", col: "id" },
  { name: "018 request_reason", table: "customer_balance_disclosures", col: "request_reason" },
  { name: "019 request_type", table: "customer_balance_disclosures", col: "request_type" },
  { name: "020 momo_number", table: "customer_balance_disclosures", col: "momo_number" },
  { name: "020 image_url", table: "agent_notifications", col: "image_url" },
  { name: "021 locked_balance", table: "customers", col: "locked_balance" },
  { name: "022 id_card_photo_url", table: "customers", col: "id_card_photo_url" },
];

for (const c of checks) {
  const { error } = await supabase.from(c.table).select(c.col).limit(1);
  const ok = !error;
  console.log(`${ok ? "OK" : "MISSING"}: ${c.name}${error ? ` — ${error.message}` : ""}`);
}
