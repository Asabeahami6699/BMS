import { useEffect, useMemo, useState, type ChangeEvent } from "react";
import { formatGhs } from "@bms/shared";
import { AdminDataTable, filterRowsBySearch } from "../../components/AdminDataTable";
import { useToast } from "../../components/Toast";
import { toUserFacingError } from "../../lib/networkError";
import type {
  PlatformMigrationCommittedCustomer,
  PlatformMigrationPreviewRow
} from "../api";
import { usePageLoading } from "../hooks/usePageLoading";
import { usePlatformAdminStore } from "../stores/platformAdminStore";
import { usePlatformMigrationStore } from "../stores/platformMigrationStore";

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function triggerCsvDownload(filename: string, csvContent: string): void {
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function PlatformMigrationPage() {
  const { showToast } = useToast();

  const tenants = usePlatformAdminStore((s) => s.tenants);
  const tenantsLoading = usePlatformAdminStore((s) => s.loading);
  const hydrateTenants = usePlatformAdminStore((s) => s.hydrate);

  const selectedTenantId = usePlatformMigrationStore((s) => s.selectedTenantId);
  const contextByTenant = usePlatformMigrationStore((s) => s.contextByTenant);
  const loadingContext = usePlatformMigrationStore((s) => s.loadingContext);
  const previewing = usePlatformMigrationStore((s) => s.previewing);
  const committing = usePlatformMigrationStore((s) => s.committing);
  const error = usePlatformMigrationStore((s) => s.error);
  const preview = usePlatformMigrationStore((s) => s.preview);
  const commitResult = usePlatformMigrationStore((s) => s.commitResult);
  const setSelectedTenantId = usePlatformMigrationStore((s) => s.setSelectedTenantId);
  const refreshContext = usePlatformMigrationStore((s) => s.refreshContext);
  const runPreview = usePlatformMigrationStore((s) => s.runPreview);
  const runCommit = usePlatformMigrationStore((s) => s.runCommit);
  const clearResults = usePlatformMigrationStore((s) => s.clearResults);

  const [cutoverDate, setCutoverDate] = useState(todayIsoDate);
  const [defaultBranchCode, setDefaultBranchCode] = useState("");
  const [defaultKycTier, setDefaultKycTier] = useState<"simplified" | "full">("simplified");
  const [skipDuplicatePhones, setSkipDuplicatePhones] = useState(true);
  const [csvText, setCsvText] = useState("");
  const [uploadedFilename, setUploadedFilename] = useState("");
  const [rowStatusFilter, setRowStatusFilter] = useState<
    "all" | "ready" | "error" | "duplicate_skipped"
  >("all");
  const [rowSearch, setRowSearch] = useState("");
  const [committedSearch, setCommittedSearch] = useState("");
  const [confirmTotalInput, setConfirmTotalInput] = useState("");
  const [confirmChecked, setConfirmChecked] = useState(false);

  useEffect(() => {
    hydrateTenants();
  }, [hydrateTenants]);

  // Auto-select first company if none selected yet
  useEffect(() => {
    if (!selectedTenantId && tenants.length > 0) {
      setSelectedTenantId(tenants[0]!.id);
    }
  }, [selectedTenantId, tenants, setSelectedTenantId]);

  const context = selectedTenantId ? contextByTenant[selectedTenantId] : undefined;

  // Reset default branch when switching companies
  useEffect(() => {
    if (context?.branches.length === 1) {
      setDefaultBranchCode(context.branches[0]!.code);
    } else {
      setDefaultBranchCode("");
    }
  }, [selectedTenantId, context?.branches.length]);

  usePageLoading(
    tenantsLoading || loadingContext || previewing || committing,
    "platform-migrations"
  );

  const filteredPreviewRows = useMemo(() => {
    const base = preview?.rows ?? [];
    const byStatus =
      rowStatusFilter === "all" ? base : base.filter((r) => r.status === rowStatusFilter);
    return filterRowsBySearch(byStatus, rowSearch, [
      "fullName",
      "phone",
      "branchCode",
      "legacyAccountNumber",
      "assignedAgentLabel"
    ]);
  }, [preview, rowStatusFilter, rowSearch]);

  const filteredCommittedRows = useMemo(() => {
    const base = commitResult?.customers ?? [];
    return filterRowsBySearch(base, committedSearch, [
      "fullName",
      "phone",
      "accountNumber",
      "legacyAccountNumber",
      "branchCode"
    ]);
  }, [commitResult, committedSearch]);

  async function handleFileUpload(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      setCsvText(text);
      setUploadedFilename(file.name);
      clearResults();
      setConfirmTotalInput("");
      setConfirmChecked(false);
      showToast(`Loaded ${file.name}. Click "Validate & Preview" to run a dry-run check.`, "info");
    } catch (err) {
      showToast(toUserFacingError(err, "Failed to read CSV file"), "error");
    }
  }

  function handleDownloadTemplate() {
    if (!context) return;
    triggerCsvDownload(context.templateFilename, context.templateCsv);
    showToast(`Downloaded ${context.templateFilename}`, "success");
  }

  function handleLoadSampleIntoEditor() {
    if (!context) return;
    setCsvText(context.templateCsv);
    setUploadedFilename(context.templateFilename);
    clearResults();
    setConfirmTotalInput("");
    setConfirmChecked(false);
  }

  async function handleValidatePreview() {
    if (!selectedTenantId) {
      showToast("Select a company first.", "error");
      return;
    }
    if (!csvText.trim()) {
      showToast("Upload or paste a CSV file first.", "error");
      return;
    }
    setConfirmTotalInput("");
    setConfirmChecked(false);
    try {
      const result = await runPreview(selectedTenantId, {
        csvText,
        cutoverDate,
        defaultBranchCode: defaultBranchCode || undefined,
        defaultKycTier,
        skipDuplicatePhones
      });
      if (result.errorCount > 0) {
        setRowStatusFilter("error");
        showToast(
          `Dry-run found ${result.errorCount} row error(s). Fix them before committing.`,
          "error"
        );
      } else {
        setRowStatusFilter("all");
        showToast(
          `Dry-run passed: ${result.readyCount} customer(s) ready · Total ${formatGhs(result.totalOpeningBalance)}`,
          "success"
        );
      }
    } catch (err) {
      showToast(toUserFacingError(err, "Validation failed"), "error");
    }
  }

  const parsedConfirmTotal = useMemo(() => {
    const cleaned = confirmTotalInput.replace(/ghs/gi, "").replace(/,/g, "").trim();
    if (!cleaned) return null;
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : null;
  }, [confirmTotalInput]);

  const totalMatchesControl =
    preview !== null &&
    parsedConfirmTotal !== null &&
    Math.abs(parsedConfirmTotal - preview.totalOpeningBalance) <= 0.01;

  async function handleCommitMigration() {
    if (!selectedTenantId || !preview || !preview.canCommit) return;
    if (!totalMatchesControl || !confirmChecked) {
      showToast(
        "Enter the exact Total Opening Balance control figure and tick the confirmation box first.",
        "error"
      );
      return;
    }
    try {
      const result = await runCommit(selectedTenantId, {
        csvText,
        cutoverDate,
        defaultBranchCode: defaultBranchCode || undefined,
        defaultKycTier,
        skipDuplicatePhones,
        expectedTotalBalance: parsedConfirmTotal ?? undefined
      });
      showToast(
        `Migrated ${result.importedCount} customers (${formatGhs(result.totalOpeningBalance)}) cleanly with 0 SMS sent.`,
        "success"
      );
    } catch (err) {
      showToast(toUserFacingError(err, "Migration commit failed"), "error");
    }
  }

  return (
    <div className="agents-page">
      <header className="agents-page__header">
        <div>
          <h2>Tenant Data Migration &amp; Opening Balances</h2>
          <p className="muted">
            Onboard existing Susu &amp; microfinance companies from paper books or Excel cleanly —
            dry-run control totals first, post zero-fee Balance Brought Forward (BBF), keep cutover
            EOD vault cash untouched, and suppress customer SMS alerts.
          </p>
        </div>
        <div className="agents-page__actions">
          {selectedTenantId ? (
            <button
              type="button"
              className="btn-secondary"
              disabled={loadingContext || previewing || committing}
              onClick={() => void refreshContext(selectedTenantId)}
            >
              Refresh company info
            </button>
          ) : null}
          <button
            type="button"
            className="btn-primary"
            disabled={!context}
            onClick={handleDownloadTemplate}
          >
            Download CSV template
          </button>
        </div>
      </header>

      {error ? (
        <div className="alert-banner alert-banner--error" role="alert">
          {error}
        </div>
      ) : null}

      {/* Step 1: Select Company & Cutover Options */}
      <section className="card" style={{ marginBottom: 16 }}>
        <h3 style={{ marginTop: 0 }}>Step 1 · Select Company &amp; Cutover Rules</h3>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))",
            gap: 12
          }}
        >
          <label className="field">
            <span>Target company</span>
            <select
              value={selectedTenantId}
              onChange={(e) => {
                setSelectedTenantId(e.target.value);
                setCsvText("");
                setUploadedFilename("");
                setConfirmTotalInput("");
                setConfirmChecked(false);
              }}
              disabled={committing}
            >
              <option value="">Select company…</option>
              {tenants.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} ({t.subdomain || t.id})
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span>Cutover date</span>
            <input
              type="date"
              value={cutoverDate}
              onChange={(e) => {
                setCutoverDate(e.target.value);
                clearResults();
              }}
              disabled={committing}
            />
          </label>

          <label className="field">
            <span>Default branch (if blank in CSV)</span>
            <select
              value={defaultBranchCode}
              onChange={(e) => {
                setDefaultBranchCode(e.target.value);
                clearResults();
              }}
              disabled={!context || committing}
            >
              <option value="">Require branch_code per row</option>
              {(context?.branches ?? []).map((b) => (
                <option key={b.id} value={b.code}>
                  {b.code} — {b.name}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span>Default KYC tier (when blank)</span>
            <select
              value={defaultKycTier}
              onChange={(e) => {
                setDefaultKycTier(e.target.value as "simplified" | "full");
                clearResults();
              }}
              disabled={committing}
            >
              <option value="simplified">Tier 1 · Simplified KYC (recommended for Day 1)</option>
              <option value="full">Full KYC (if ID cards are captured)</option>
            </select>
          </label>
        </div>

        <label
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            marginTop: 12,
            cursor: "pointer"
          }}
        >
          <input
            type="checkbox"
            checked={skipDuplicatePhones}
            onChange={(e) => {
              setSkipDuplicatePhones(e.target.checked);
              clearResults();
            }}
            disabled={committing}
          />
          <span>
            Skip duplicate phone numbers automatically (safe re-uploads if a phone already exists)
          </span>
        </label>

        {context ? (
          <div
            style={{
              marginTop: 14,
              padding: 12,
              borderRadius: 8,
              background: "var(--surface-subtle, #f8fafc)",
              border: "1px solid var(--border-subtle, #e2e8f0)",
              display: "grid",
              gap: 8
            }}
          >
            <div style={{ display: "flex", flexWrap: "wrap", gap: 16, fontSize: 13 }}>
              <span>
                <strong>Company:</strong> {context.tenant.name}
              </span>
              <span>
                <strong>Existing customers:</strong> {context.existingCustomerCount.toLocaleString()}
              </span>
              <span>
                <strong>Branches ({context.branches.length}):</strong>{" "}
                {context.branches.length > 0
                  ? context.branches.map((b) => `${b.code} (${b.name})`).join(", ")
                  : "None — create a branch first"}
              </span>
            </div>
            <div style={{ fontSize: 13 }}>
              <strong>Active staff / agents ({context.staff.length}):</strong>{" "}
              {context.staff.length > 0
                ? context.staff
                    .slice(0, 10)
                    .map((s) => `${s.fullName} [${s.role}: ${s.email}]`)
                    .join(" · ") +
                  (context.staff.length > 10 ? ` · +${context.staff.length - 10} more` : "")
                : "None yet (customers will assign to migration admin until reassigned)"}
            </div>
          </div>
        ) : null}
      </section>

      {/* Step 2: Upload or Paste CSV */}
      <section className="card" style={{ marginBottom: 16 }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            flexWrap: "wrap",
            gap: 8,
            marginBottom: 10
          }}
        >
          <h3 style={{ margin: 0 }}>Step 2 · Upload or Paste Customer CSV</h3>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <label className="btn-secondary" style={{ cursor: "pointer" }}>
              Choose .csv file
              <input
                type="file"
                accept=".csv,text/csv"
                onChange={(e) => void handleFileUpload(e)}
                style={{ display: "none" }}
                disabled={!context || committing}
              />
            </label>
            <button
              type="button"
              className="btn-secondary"
              disabled={!context || committing}
              onClick={handleLoadSampleIntoEditor}
            >
              Insert sample rows
            </button>
          </div>
        </div>

        <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
          Supported columns: <code>full_name</code>, <code>phone</code>, <code>branch_code</code>,{" "}
          <code>assigned_agent</code>, <code>account_type</code> (<code>susu</code> or{" "}
          <code>savings</code>), <code>daily_contribution</code>, <code>opening_balance</code>,{" "}
          <code>locked_balance</code>, <code>kyc_tier</code>, <code>legacy_account_number</code>,{" "}
          <code>id_card_number</code>, <code>location</code>, <code>occupation</code>,{" "}
          <code>next_of_kin_name</code>, <code>next_of_kin_phone</code>. Up to 2,500 rows per file.
        </p>

        {uploadedFilename ? (
          <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>
            File loaded: <strong>{uploadedFilename}</strong>
          </div>
        ) : null}

        <textarea
          rows={7}
          value={csvText}
          onChange={(e) => {
            setCsvText(e.target.value);
            clearResults();
            setConfirmTotalInput("");
            setConfirmChecked(false);
          }}
          placeholder="Paste CSV text here or use 'Choose .csv file' above..."
          style={{
            width: "100%",
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
            fontSize: 12,
            padding: 10,
            borderRadius: 8,
            border: "1px solid var(--border-subtle, #cbd5e1)"
          }}
          disabled={!context || committing}
        />

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 12 }}>
          {csvText ? (
            <button
              type="button"
              className="btn-secondary"
              disabled={previewing || committing}
              onClick={() => {
                setCsvText("");
                setUploadedFilename("");
                clearResults();
                setConfirmTotalInput("");
                setConfirmChecked(false);
              }}
            >
              Clear
            </button>
          ) : null}
          <button
            type="button"
            className="btn-primary"
            disabled={!context || !csvText.trim() || previewing || committing}
            onClick={() => void handleValidatePreview()}
          >
            {previewing ? "Validating CSV…" : "Validate & Preview (Dry-Run)"}
          </button>
        </div>
      </section>

      {/* Step 3: Reconciliation Control Totals & Row Inspection */}
      {preview && !commitResult ? (
        <section className="card" style={{ marginBottom: 16 }}>
          <h3 style={{ marginTop: 0 }}>
            Step 3 · Dry-Run Reconciliation &amp; Sign-Off Control Totals
          </h3>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(175px, 1fr))",
              gap: 12,
              marginBottom: 16
            }}
          >
            <div className="kpi-card">
              <div className="kpi-card__label">Ready to Import</div>
              <div className="kpi-card__value">{preview.readyCount.toLocaleString()}</div>
              <div className="muted" style={{ fontSize: 12 }}>
                {preview.susuCount} Susu · {preview.savingsCount} Savings
              </div>
            </div>
            <div className="kpi-card">
              <div className="kpi-card__label">Total Opening Balance</div>
              <div className="kpi-card__value">{formatGhs(preview.totalOpeningBalance)}</div>
              <div className="muted" style={{ fontSize: 12 }}>
                Susu {formatGhs(preview.susuOpeningBalance)} · Savings{" "}
                {formatGhs(preview.savingsOpeningBalance)}
              </div>
            </div>
            <div className="kpi-card">
              <div className="kpi-card__label">Locked Savings Min.</div>
              <div className="kpi-card__value">{formatGhs(preview.totalLockedBalance)}</div>
              <div className="muted" style={{ fontSize: 12 }}>
                {preview.simplifiedKycCount} Simplified · {preview.fullKycCount} Full KYC
              </div>
            </div>
            <div className="kpi-card">
              <div className="kpi-card__label">Errors / Duplicates</div>
              <div
                className="kpi-card__value"
                style={{
                  color: preview.errorCount > 0 ? "var(--danger, #dc2626)" : "inherit"
                }}
              >
                {preview.errorCount} err · {preview.duplicateSkippedCount} skip
              </div>
              <div className="muted" style={{ fontSize: 12 }}>
                CSV SHA-256: {preview.csvSha256.slice(0, 10)}…
              </div>
            </div>
          </div>

          {preview.branchTotals.length > 0 ? (
            <div style={{ marginBottom: 18 }}>
              <h4 style={{ margin: "0 0 8px 0" }}>
                Branch-by-Branch Control Totals (match against signed paper book)
              </h4>
              <div style={{ overflowX: "auto" }}>
                <table className="data-table" style={{ width: "100%" }}>
                  <thead>
                    <tr>
                      <th>Branch</th>
                      <th>Customers</th>
                      <th>Susu</th>
                      <th>Savings</th>
                      <th>Opening Balance</th>
                      <th>Locked Savings</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.branchTotals.map((bt) => (
                      <tr key={bt.branchId}>
                        <td>
                          <strong>{bt.branchCode}</strong> · {bt.branchName}
                        </td>
                        <td>{bt.customerCount.toLocaleString()}</td>
                        <td>{bt.susuCount.toLocaleString()}</td>
                        <td>{bt.savingsCount.toLocaleString()}</td>
                        <td>
                          <strong>{formatGhs(bt.totalOpeningBalance)}</strong>
                        </td>
                        <td>{formatGhs(bt.totalLockedBalance)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}

          <AdminDataTable<PlatformMigrationPreviewRow>
            rows={filteredPreviewRows}
            rowKey={(r) => `${r.rowNumber}-${r.phone}`}
            search={rowSearch}
            onSearchChange={setRowSearch}
            searchPlaceholder="Search preview rows by name, phone, branch, or card ref…"
            emptyMessage="No rows match this filter."
            toolbar={
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {(
                  [
                    ["all", `All (${preview.totalRows})`],
                    ["ready", `Ready (${preview.readyCount})`],
                    ["error", `Errors (${preview.errorCount})`],
                    ["duplicate_skipped", `Duplicates (${preview.duplicateSkippedCount})`]
                  ] as const
                ).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    className={rowStatusFilter === key ? "btn-primary" : "btn-secondary"}
                    onClick={() => setRowStatusFilter(key)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            }
            columns={[
              {
                key: "row",
                label: "Row",
                render: (r) => `#${r.rowNumber}`
              },
              {
                key: "status",
                label: "Status",
                render: (r) => {
                  const badgeClass =
                    r.status === "ready"
                      ? "status-badge status-badge--active"
                      : r.status === "duplicate_skipped"
                        ? "status-badge status-badge--warning"
                        : "status-badge status-badge--danger";
                  const label =
                    r.status === "ready"
                      ? "Ready"
                      : r.status === "duplicate_skipped"
                        ? "Duplicate (skip)"
                        : "Error";
                  return <span className={badgeClass}>{label}</span>;
                }
              },
              {
                key: "customer",
                label: "Customer",
                render: (r) => (
                  <div>
                    <strong>{r.fullName || "—"}</strong>
                    <div className="muted" style={{ fontSize: 12 }}>
                      {r.phone || "No phone"}
                      {r.legacyAccountNumber ? ` · Ref ${r.legacyAccountNumber}` : ""}
                    </div>
                  </div>
                )
              },
              {
                key: "branch",
                label: "Branch & Agent",
                render: (r) => (
                  <div>
                    <div>{r.branchCode || "—"}</div>
                    <div className="muted" style={{ fontSize: 12 }}>
                      {r.assignedAgentLabel}
                    </div>
                  </div>
                )
              },
              {
                key: "account",
                label: "Account",
                render: (r) => (
                  <div>
                    <span style={{ textTransform: "capitalize" }}>{r.accountType}</span>
                    {r.accountType === "susu" ? (
                      <div className="muted" style={{ fontSize: 12 }}>
                        Daily: {formatGhs(r.dailyContributionAmount)}
                      </div>
                    ) : null}
                  </div>
                )
              },
              {
                key: "opening",
                label: "Opening Balance",
                render: (r) => (
                  <div>
                    <strong>{formatGhs(r.openingBalance)}</strong>
                    {r.lockedBalance > 0 ? (
                      <div className="muted" style={{ fontSize: 12 }}>
                        Locked: {formatGhs(r.lockedBalance)}
                      </div>
                    ) : null}
                  </div>
                )
              },
              {
                key: "issues",
                label: "Validation Notes",
                render: (r) =>
                  r.issues.length > 0 ? (
                    <span style={{ color: "var(--danger, #dc2626)", fontSize: 12 }}>
                      {r.issues.join("; ")}
                    </span>
                  ) : (
                    <span className="muted" style={{ fontSize: 12 }}>
                      {r.kycTier === "simplified" ? "Simplified KYC" : "Full KYC"} · BBF 0% fee
                    </span>
                  )
              }
            ]}
          />

          {/* Safety Gate & Commit */}
          {preview.canCommit ? (
            <div
              style={{
                marginTop: 18,
                padding: 16,
                borderRadius: 10,
                background: "var(--surface-subtle, #f8fafc)",
                border: "1px solid var(--border-subtle, #cbd5e1)"
              }}
            >
              <h4 style={{ margin: "0 0 8px 0" }}>Control Total Sign-Off Before Commit</h4>
              <p className="muted" style={{ margin: "0 0 12px 0", fontSize: 13 }}>
                Committing will create <strong>{preview.readyCount}</strong> active customer(s) for{" "}
                <strong>{preview.tenantName}</strong> as of cutover date{" "}
                <strong>{preview.cutoverDate}</strong>, credit{" "}
                <strong>{formatGhs(preview.totalOpeningBalance)}</strong> as{" "}
                <strong>Balance Brought Forward (0 Susu commission, excluded from today&apos;s EOD vault cash)</strong>,
                and send <strong>0 customer SMS/emails</strong>.
              </p>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "minmax(240px, 340px) 1fr",
                  gap: 12,
                  alignItems: "end"
                }}
              >
                <label className="field">
                  <span>
                    Type exact Total Opening Balance (<code>{preview.totalOpeningBalance.toFixed(2)}</code>)
                  </span>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={confirmTotalInput}
                    onChange={(e) => setConfirmTotalInput(e.target.value)}
                    placeholder={preview.totalOpeningBalance.toFixed(2)}
                    disabled={committing}
                  />
                </label>

                <label
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 8,
                    paddingBottom: 8,
                    cursor: "pointer"
                  }}
                >
                  <input
                    type="checkbox"
                    checked={confirmChecked}
                    onChange={(e) => setConfirmChecked(e.target.checked)}
                    disabled={committing}
                  />
                  <span style={{ fontSize: 13 }}>
                    I have verified the branch control totals against {preview.tenantName}&apos;s
                    signed manual records.
                  </span>
                </label>
              </div>

              <div style={{ marginTop: 14, display: "flex", justifyContent: "flex-end" }}>
                <button
                  type="button"
                  className="btn-primary"
                  disabled={committing || !totalMatchesControl || !confirmChecked}
                  onClick={() => void handleCommitMigration()}
                >
                  {committing
                    ? "Importing customers & posting BBF…"
                    : `Commit ${preview.readyCount} Customers (${formatGhs(preview.totalOpeningBalance)})`}
                </button>
              </div>
            </div>
          ) : (
            <div className="alert-banner alert-banner--error" style={{ marginTop: 14 }}>
              Fix all <strong>{preview.errorCount}</strong> red error row(s) in your CSV and re-run
              Validate &amp; Preview before committing.
            </div>
          )}
        </section>
      ) : null}

      {/* Step 4: Committed Receipt & Sign-Off Certificate */}
      {commitResult ? (
        <section className="card">
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              flexWrap: "wrap",
              gap: 12,
              marginBottom: 14
            }}
          >
            <div>
              <h3 style={{ margin: 0 }}>
                Step 4 · Opening Balances Migration Completed ({commitResult.tenantName})
              </h3>
              <p className="muted" style={{ margin: "4px 0 0 0", fontSize: 13 }}>
                Cutover {commitResult.cutoverDate} · Audit CSV SHA-256:{" "}
                <code>{commitResult.csvSha256.slice(0, 16)}…</code> · Sealed in immutable audit
                chain.
              </p>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button
                type="button"
                className="btn-primary"
                onClick={() =>
                  triggerCsvDownload(commitResult.certificateFilename, commitResult.certificateCsv)
                }
              >
                Download Sign-Off Certificate (CSV)
              </button>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => {
                  clearResults();
                  setCsvText("");
                  setUploadedFilename("");
                  setConfirmTotalInput("");
                  setConfirmChecked(false);
                }}
              >
                Start another import
              </button>
            </div>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(175px, 1fr))",
              gap: 12,
              marginBottom: 16
            }}
          >
            <div className="kpi-card">
              <div className="kpi-card__label">Customers Migrated</div>
              <div className="kpi-card__value">{commitResult.importedCount.toLocaleString()}</div>
              <div className="muted" style={{ fontSize: 12 }}>
                {commitResult.susuCount} Susu · {commitResult.savingsCount} Savings
              </div>
            </div>
            <div className="kpi-card">
              <div className="kpi-card__label">Opening Balances Posted</div>
              <div className="kpi-card__value">{formatGhs(commitResult.totalOpeningBalance)}</div>
              <div className="muted" style={{ fontSize: 12 }}>
                Susu BBF {formatGhs(commitResult.susuOpeningBalance)} · Savings{" "}
                {formatGhs(commitResult.savingsOpeningBalance)}
              </div>
            </div>
            <div className="kpi-card">
              <div className="kpi-card__label">Locked Savings Min.</div>
              <div className="kpi-card__value">{formatGhs(commitResult.totalLockedBalance)}</div>
              <div className="muted" style={{ fontSize: 12 }}>
                0 SMS sent · 0 EOD cash distortion
              </div>
            </div>
          </div>

          <AdminDataTable<PlatformMigrationCommittedCustomer>
            rows={filteredCommittedRows}
            rowKey={(c) => c.customerId}
            search={committedSearch}
            onSearchChange={setCommittedSearch}
            searchPlaceholder="Search migrated accounts…"
            emptyMessage="No migrated customers."
            columns={[
              {
                key: "acct",
                label: "New Account #",
                render: (c) => (
                  <div>
                    <code>{c.accountNumber}</code>
                    {c.legacyAccountNumber ? (
                      <div className="muted" style={{ fontSize: 12 }}>
                        Legacy: {c.legacyAccountNumber}
                      </div>
                    ) : null}
                  </div>
                )
              },
              {
                key: "name",
                label: "Customer",
                render: (c) => (
                  <div>
                    <strong>{c.fullName}</strong>
                    <div className="muted" style={{ fontSize: 12 }}>
                      {c.phone}
                    </div>
                  </div>
                )
              },
              {
                key: "branch",
                label: "Branch",
                render: (c) => `${c.branchCode} · ${c.branchName}`
              },
              {
                key: "type",
                label: "Account",
                render: (c) => (
                  <span style={{ textTransform: "capitalize" }}>
                    {c.accountType}
                    {c.accountType === "susu" ? ` (${formatGhs(c.dailyContributionAmount)}/day)` : ""}
                  </span>
                )
              },
              {
                key: "bal",
                label: "Opening Balance",
                render: (c) => <strong>{formatGhs(c.openingBalance)}</strong>
              }
            ]}
          />
        </section>
      ) : null}
    </div>
  );
}
