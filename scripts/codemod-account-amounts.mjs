import fs from "node:fs";
import path from "node:path";

function walk(dir, out = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.name === "node_modules" || ent.name === "dist" || ent.name === ".git") continue;
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(ent.name)) out.push(p);
  }
  return out;
}

const roots = ["apps/frontend/src", "apps/backend/src"];
const files = roots.flatMap((r) => walk(r));
let changed = 0;

for (const file of files) {
  if (file.replace(/\\/g, "/").endsWith("money.ts")) continue;
  let src = fs.readFileSync(file, "utf8");
  const orig = src;

  src = src.replace(/`GHS \$\{([^}]+)\.toFixed\(2\)\}`/g, (m, expr) => {
    if (/Number\s*\(/.test(expr) || /formatAccountAmount/.test(expr)) return m;
    return "`GHS ${formatAccountAmount(" + expr.trim() + ")}`";
  });

  src = src.replace(/GHS \{([^}]+)\.toFixed\(2\)\}/g, (m, expr) => {
    if (/Number\s*\(/.test(expr) || /formatAccountAmount/.test(expr)) return m;
    return "GHS {formatAccountAmount(" + expr.trim() + ")}";
  });

  src = src.replace(/\{((?:[\w.?\[\]]|\([^)]*\))+)\.toFixed\(2\)\}/g, (m, expr) => {
    if (/formatAccountAmount|Number\s*\(/.test(expr)) return m;
    if (
      !/(amount|balance|fee|total|principal|interest|cash|float|salary|wage|pay|contribution|reserve|shortage|overage|variance|debit|credit|repay|due|paid|withdraw|deposit|ghs|money|cost|price|sum|value|expected)/i.test(
        expr
      )
    ) {
      return m;
    }
    return "{formatAccountAmount(" + expr.trim() + ")}";
  });

  if (src === orig) continue;

  if (
    src.includes("formatAccountAmount") &&
    !/import\s*\{[^}]*\bformatAccountAmount\b/.test(src)
  ) {
    if (/from\s+["']@bms\/shared["']/.test(src)) {
      let injected = false;
      src = src.replace(
        /import\s*\{([^}]*)\}\s*from\s*["']@bms\/shared["']/,
        (m, mid) => {
          if (mid.includes("formatAccountAmount")) return m;
          injected = true;
          const trimmed = mid.trim().replace(/,\s*$/, "");
          return `import { ${trimmed ? `${trimmed}, formatAccountAmount` : "formatAccountAmount"} } from "@bms/shared"`;
        }
      );
      if (!injected) {
        src = `import { formatAccountAmount } from "@bms/shared";\n${src}`;
      }
    } else {
      src = `import { formatAccountAmount } from "@bms/shared";\n${src}`;
    }
  }

  fs.writeFileSync(file, src);
  changed += 1;
  console.log("updated", file);
}

console.log("files changed", changed);
