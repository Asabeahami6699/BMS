#!/usr/bin/env node
/**
 * Decrypts and optionally restores an encrypted BMS database backup (.dump.gpg)
 * produced by `.github/workflows/db-backup.yml`.
 *
 * Usage (verify only — safe, does NOT touch any database):
 *   node scripts/restore-backup.mjs --file path/to/bms-backup.dump.gpg --passphrase "..."
 *
 * Usage (restore into a target staging/recovery Postgres database):
 *   node scripts/restore-backup.mjs \
 *     --file path/to/bms-backup.dump.gpg \
 *     --passphrase "..." \
 *     --target-url "postgresql://postgres:...@host:5432/postgres" \
 *     --confirm-restore
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--confirm-restore") {
      out.confirmRestore = true;
    } else if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (!next || next.startsWith("--")) {
        throw new Error(`Missing value for --${key}`);
      }
      out[key] = next;
      i += 1;
    }
  }
  return out;
}

function sha256File(filePath) {
  const hash = createHash("sha256");
  hash.update(fs.readFileSync(filePath));
  return hash.digest("hex");
}

function main() {
  const args = parseArgs(process.argv);
  const encFile = args.file;
  const passphrase = args.passphrase ?? process.env.BACKUP_ENCRYPTION_PASSPHRASE;
  const targetUrl = args["target-url"] ?? process.env.RESTORE_TARGET_DB_URL;

  if (!encFile || !fs.existsSync(encFile)) {
    console.error("Error: --file <path-to-.dump.gpg> is required and must exist.");
    process.exit(1);
  }
  if (!passphrase) {
    console.error("Error: Provide --passphrase or BACKUP_ENCRYPTION_PASSPHRASE env var.");
    process.exit(1);
  }

  const shaSidecar = `${encFile}.sha256`;
  const actualSha = sha256File(encFile);
  if (fs.existsSync(shaSidecar)) {
    const expectedSha = fs.readFileSync(shaSidecar, "utf8").trim().split(/\s+/)[0];
    if (expectedSha && expectedSha !== actualSha) {
      console.error(`SHA-256 mismatch! Expected ${expectedSha}, got ${actualSha}`);
      process.exit(1);
    }
    console.log(`SHA-256 verified: ${actualSha}`);
  } else {
    console.log(`SHA-256 computed: ${actualSha} (no .sha256 sidecar found)`);
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "bms-restore-"));
  const plainDump = path.join(tmpDir, "decrypted.dump");

  try {
    console.log("Decrypting archive with GPG...");
    execFileSync(
      "gpg",
      [
        "--batch",
        "--yes",
        "--decrypt",
        "--passphrase",
        passphrase,
        "--output",
        plainDump,
        encFile
      ],
      { stdio: "inherit" }
    );

    console.log("Inspecting pg_restore archive contents...");
    const listOutput = execFileSync("pg_restore", ["--list", plainDump], {
      encoding: "utf8"
    });
    const tableLines = listOutput
      .split(/\r?\n/)
      .filter((line) => line.includes(" TABLE DATA "));
    console.log(`Archive valid: ${tableLines.length} table data sections found.`);

    if (!targetUrl) {
      console.log("Verification complete (no --target-url supplied; database untouched).");
      return;
    }

    if (!args.confirmRestore) {
      console.error(
        "Refusing to restore without --confirm-restore flag. Always test against a staging/recovery database first."
      );
      process.exit(1);
    }

    console.log("Restoring into target PostgreSQL database...");
    execFileSync(
      "pg_restore",
      [
        "--clean",
        "--if-exists",
        "--no-owner",
        "--no-acl",
        "--exit-on-error",
        "--dbname",
        targetUrl,
        plainDump
      ],
      { stdio: "inherit" }
    );
    console.log("Restore completed cleanly.");
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

main();
