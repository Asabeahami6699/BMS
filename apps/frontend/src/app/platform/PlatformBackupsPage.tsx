import { useEffect, useMemo, useState } from "react";
import { formatGhs } from "@bms/shared";
import { AdminDataTable, filterRowsBySearch } from "../../components/AdminDataTable";
import { useToast } from "../../components/Toast";
import { toUserFacingError } from "../../lib/networkError";
import type { PlatformTenantBackupSummary } from "../api";
import { usePageLoading } from "../hooks/usePageLoading";
import { usePlatformBackupsStore } from "../stores/platformBackupsStore";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

export function PlatformBackupsPage() {
  const { showToast } = useToast();
  const overview = usePlatformBackupsStore((s) => s.overview);
  const loading = usePlatformBackupsStore((s) => s.loading);
  const error = usePlatformBackupsStore((s) => s.error);
  const lastFetchedAt = usePlatformBackupsStore((s) => s.lastFetchedAt);
  const verifyingTenantId = usePlatformBackupsStore((s) => s.verifyingTenantId);
  const downloadingKey = usePlatformBackupsStore((s) => s.downloadingKey);
  const chainResultsByTenant = usePlatformBackupsStore((s) => s.chainResultsByTenant);
  const hydrate = usePlatformBackupsStore((s) => s.hydrate);
  const refresh = usePlatformBackupsStore((s) => s.refresh);
  const verifyChain = usePlatformBackupsStore((s) => s.verifyChain);
  const downloadTenantJson = usePlatformBackupsStore((s) => s.downloadTenantJson);
  const downloadTenantCsv = usePlatformBackupsStore((s) => s.downloadTenantCsv);
  const downloadAllJson = usePlatformBackupsStore((s) => s.downloadAllJson);

  const [search, setSearch] = useState("");
  const [includePhotos, setIncludePhotos] = useState(false);

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  usePageLoading(loading || downloadingKey !== null || verifyingTenantId !== null, "platform-backups");

  const rows = useMemo(() => {
    const list = overview?.tenants ?? [];
    return filterRowsBySearch(list, search, ["companyName", "subdomain", "tenantId"]);
  }, [overview, search]);

  async function handleVerifyChain(row: PlatformTenantBackupSummary) {
    try {
      const result = await verifyChain(row.tenantId);
      if (result.ok) {
        showToast(
          `${row.companyName}: Audit chain verified (${result.checkedCount.toLocaleString()} entries intact)`,
          "success"
        );
      } else {
        showToast(
          `${row.companyName}: Integrity alert at entry ${result.firstBrokenId ?? "unknown"} — ${result.firstBrokenReason ?? "hash mismatch"}`,
          "error"
        );
      }
    } catch (err) {
      showToast(toUserFacingError(err, "Failed to verify audit chain"), "error");
    }
  }

  async function handleDownloadJson(row: PlatformTenantBackupSummary) {
    try {
      const result = await downloadTenantJson(row.tenantId, { includePhotos });
      showToast(
        `Downloaded ${result.filename} (${formatBytes(result.sizeBytes)})${result.sha256 ? ` · SHA-256 ${result.sha256.slice(0, 10)}…` : ""}`,
        "success"
      );
    } catch (err) {
      showToast(toUserFacingError(err, "Failed to download snapshot"), "error");
    }
  }

  async function handleDownloadCsv(row: PlatformTenantBackupSummary) {
    try {
      const result = await downloadTenantCsv(row.tenantId);
      showToast(`Downloaded ${result.filename} (${formatBytes(result.sizeBytes)})`, "success");
    } catch (err) {
      showToast(toUserFacingError(err, "Failed to export balances CSV"), "error");
    }
  }

  async function handleDownloadAll() {
    try {
      const result = await downloadAllJson({ includePhotos });
      showToast(
        `Downloaded consolidated snapshot ${result.filename} (${formatBytes(result.sizeBytes)})`,
        "success"
      );
    } catch (err) {
      showToast(toUserFacingError(err, "Failed to download consolidated snapshot"), "error");
    }
  }

  const busy = downloadingKey !== null || verifyingTenantId !== null;

  return (
    <div className="agents-page">
      <header className="agents-page__header">
        <div>
          <h2>Backups &amp; Financial Snapshots</h2>
          <p className="muted">
            Download checksummed per-company financial snapshots, export accountant-ready balance
            sheets, verify immutable audit hash chains, and monitor your automated nightly encrypted
            GitHub database backups.
          </p>
        </div>
        <div className="agents-page__header-actions">
          <button
            type="button"
            className="button secondary"
            disabled={loading || busy}
            onClick={() => void refresh()}
          >
            {loading ? "Refreshing…" : "↻ Refresh"}
          </button>
          <button
            type="button"
            className="button"
            disabled={loading || busy || !overview || overview.tenants.length === 0}
            onClick={() => void handleDownloadAll()}
          >
            {downloadingKey === "json:all" ? "Preparing bundle…" : "Download all-tenants JSON"}
          </button>
        </div>
      </header>

      {error ? (
        <p className="customers-card-error" role="alert">
          {error}
        </p>
      ) : null}

      <div className="kpi-grid agents-page__kpis">
        <article className="kpi-card kpi-card--primary">
          <span className="kpi-label">Companies</span>
          <p className="kpi-value">{overview ? overview.totals.tenants : "—"}</p>
          <p className="kpi-meta muted">
            {overview ? `${overview.totals.activeTenants} active` : "Loading…"}
          </p>
        </article>
        <article className="kpi-card kpi-card--success">
          <span className="kpi-label">Customers</span>
          <p className="kpi-value">
            {overview ? overview.totals.activeCustomers.toLocaleString() : "—"}
          </p>
          <p className="kpi-meta muted">
            {overview ? `${overview.totals.totalCustomers.toLocaleString()} total records` : "—"}
          </p>
        </article>
        <article className="kpi-card kpi-card--warning">
          <span className="kpi-label">Ledger transactions</span>
          <p className="kpi-value">
            {overview ? overview.totals.totalTransactions.toLocaleString() : "—"}
          </p>
          <p className="kpi-meta muted">
            {overview ? `${overview.totals.totalAuditLogs.toLocaleString()} audit entries` : "—"}
          </p>
        </article>
        <article className="kpi-card">
          <span className="kpi-label">Total customer balances</span>
          <p className="kpi-value">
            {overview ? formatGhs(overview.totals.totalCustomerBalance) : "—"}
          </p>
          <p className="kpi-meta muted">
            {lastFetchedAt
              ? `Updated ${new Date(lastFetchedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
              : "Live ledger total"}
          </p>
        </article>
      </div>

      <section className="card agents-page__table-card">
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "0.75rem",
            marginBottom: "0.75rem"
          }}
        >
          <div>
            <h3 style={{ margin: 0 }}>Per-company snapshots &amp; audit verification</h3>
            <p className="muted" style={{ margin: "0.2rem 0 0", fontSize: "0.84rem" }}>
              Every JSON snapshot includes a tamper-evident SHA-256 checksum, strips password hashes,
              and logs the download to Audit logs.
            </p>
          </div>
          <label
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "0.45rem",
              fontSize: "0.86rem",
              cursor: "pointer"
            }}
          >
            <input
              type="checkbox"
              checked={includePhotos}
              onChange={(e) => setIncludePhotos(e.target.checked)}
            />
            <span>Include KYC photos in JSON (larger file)</span>
          </label>
        </div>

        <AdminDataTable
          columns={[
            {
              key: "company",
              label: "Company",
              render: (row) => (
                <div>
                  <strong>{row.companyName}</strong>
                  <small className="muted" style={{ display: "block" }}>
                    {row.subdomain ? `${row.subdomain}.aabanker.com` : row.tenantId.slice(0, 8)} ·{" "}
                    {row.subscriptionStatus}
                  </small>
                </div>
              )
            },
            {
              key: "customers",
              label: "Customers",
              render: (row) => (
                <div>
                  <strong>{row.activeCustomers.toLocaleString()}</strong>
                  <small className="muted" style={{ display: "block" }}>
                    {row.totalCustomers.toLocaleString()} total
                  </small>
                </div>
              )
            },
            {
              key: "transactions",
              label: "Transactions",
              render: (row) => (
                <div>
                  <strong>{row.totalTransactions.toLocaleString()}</strong>
                  <small className="muted" style={{ display: "block" }}>
                    Last: {formatDateTime(row.lastTransactionAt)}
                  </small>
                </div>
              )
            },
            {
              key: "balance",
              label: "Customer balances",
              render: (row) => <strong>{formatGhs(row.totalCustomerBalance)}</strong>
            },
            {
              key: "audit",
              label: "Audit chain",
              render: (row) => {
                const check = chainResultsByTenant[row.tenantId];
                if (check) {
                  return (
                    <div>
                      <span
                        className={`status-pill status-pill--${check.ok ? "active" : "failed"}`}
                      >
                        {check.ok ? `Verified (${check.checkedCount})` : "Integrity alert"}
                      </span>
                      <small className="muted" style={{ display: "block" }}>
                        {formatDateTime(check.checkedAt)}
                      </small>
                    </div>
                  );
                }
                return (
                  <div>
                    <span className="status-pill status-pill--pending">
                      {row.totalAuditLogs.toLocaleString()} entries
                    </span>
                    <small className="muted" style={{ display: "block" }}>
                      Last: {formatDateTime(row.lastAuditAt)}
                    </small>
                  </div>
                );
              }
            }
          ]}
          rows={rows}
          rowKey={(row) => row.tenantId}
          search={search}
          onSearchChange={setSearch}
          searchPlaceholder="Search company name or subdomain…"
          emptyMessage={loading ? "Loading backup overview…" : "No companies found."}
          actions={(row) => (
            <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap", justifyContent: "flex-end" }}>
              <button
                type="button"
                className="button secondary btn-sm"
                disabled={busy}
                onClick={() => void handleVerifyChain(row)}
              >
                {verifyingTenantId === row.tenantId ? "Verifying…" : "Verify chain"}
              </button>
              <button
                type="button"
                className="button secondary btn-sm"
                disabled={busy}
                onClick={() => void handleDownloadCsv(row)}
              >
                {downloadingKey === `csv:${row.tenantId}` ? "Exporting…" : "Balances CSV"}
              </button>
              <button
                type="button"
                className="button btn-sm"
                disabled={busy}
                onClick={() => void handleDownloadJson(row)}
              >
                {downloadingKey === `json:${row.tenantId}` ? "Building…" : "JSON snapshot"}
              </button>
            </div>
          )}
        />
      </section>

      <section className="card">
        <h3>Automated Nightly Encrypted GitHub Backup</h3>
        <p className="muted" style={{ marginTop: "0.25rem" }}>
          Workflow <code>.github/workflows/db-backup.yml</code> runs every night at{" "}
          <strong>23:30 UTC</strong> (plus manual <em>Run workflow</em> anytime) to capture a full
          PostgreSQL <code>public</code> + <code>auth</code> dump, encrypt it with{" "}
          <strong>GPG AES-256</strong>, generate a SHA-256 checksum, and store it for up to 90 days
          as an encrypted GitHub Actions Artifact (plus optional off-site Cloudflare R2 / S3 /
          Backblaze B2 daily, weekly, and monthly archival).
        </p>
        <ol style={{ margin: "0.75rem 0", paddingLeft: "1.25rem", lineHeight: 1.65 }}>
          <li>
            In GitHub repo <strong>Settings → Secrets and variables → Actions</strong>, add{" "}
            <code>SUPABASE_DB_BACKUP_URL</code> (your Supabase direct PostgreSQL URI — ideally using
            a dedicated read-only backup user) and <code>BACKUP_ENCRYPTION_PASSPHRASE</code> (at
            least 16 characters — store a copy in your password manager).
          </li>
          <li>
            <em>Optional 5–7 year cloud archival:</em> add <code>BACKUP_S3_BUCKET</code>,{" "}
            <code>BACKUP_S3_ACCESS_KEY_ID</code>, <code>BACKUP_S3_SECRET_ACCESS_KEY</code>, and{" "}
            <code>BACKUP_S3_ENDPOINT</code> (for Cloudflare R2 / Backblaze B2) to copy nightly,
            Sunday weekly, and 1st-of-month backups automatically off GitHub.
          </li>
          <li>
            Test restores monthly into a staging database with{" "}
            <code>
              node scripts/restore-backup.mjs --file bms-backup.dump.gpg --passphrase &quot;...&quot;
            </code>
            .
          </li>
        </ol>
      </section>
    </div>
  );
}
