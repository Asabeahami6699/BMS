import { cpSync, existsSync, rmSync } from "node:fs";

const src = "apps/frontend/dist";
const dest = "dist";

if (!existsSync(src)) {
  console.error(`Missing build output: ${src}`);
  process.exit(1);
}

if (existsSync(dest)) {
  rmSync(dest, { recursive: true, force: true });
}

cpSync(src, dest, { recursive: true });
console.log(`Synced ${src} -> ${dest}`);
