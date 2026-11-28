import { useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent } from "react";
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

function countNonEmptyDataLines(csvText: string): number {
  const lines = csvText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  return Math.max(0, lines.length - 1);
}

export function PlatformMigrationPage() {
  const { showToast } = useToast();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

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
  const [dragActive, setDragActive] = useState(false);
  const [showGuide, setShowGuide] = useState(true);
  const [showColumnRef, setShowColumnRef] = useState(false);
  const [showRawEditor, setShowRawEditor] = useState(false);
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

  useEffect(() => {
    if (!selectedTenantId && tenants.length > 0) {
      setSelectedTenantId(tenants[0]!.id);
    }
  }, [selectedTenantId, tenants, setSelectedTenantId]);

  const context = selectedTenantId ? contextByTenant[selectedTenantId] : undefined;

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

  // Determine current active step for the top stepper
  const activeStep: 1 | 2 | 3 | 4 = commitResult
    ? 4
    : preview
      ? 3
      : csvText.trim()
        ? 2
        : 1;

  const csvDataRowsEstimate = useMemo(() => countNonEmptyDataLines(csvText), [csvText]);

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

  async function loadCsvFile(file: File) {
    try {
      const text = await file.text();
      setCsvText(text);
      setUploadedFilename(file.name);
      clearResults();
      setConfirmTotalInput("");
      setConfirmChecked(false);
      showToast(
        `Loaded ${file.name} (~${countNonEmptyDataLines(text)} rows). Click "Validate & Preview" next.`,
        "info"
      );
    } catch (err) {
      showToast(toUserFacingError(err, "Failed to read CSV file"), "error");
    }
  }

  async function handleFileUpload(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    await loadCsvFile(file);
    e.target.value = "";
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragActive(false);
    if (!context || committing) return;
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    void loadCsvFile(file);
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
    setShowRawEditor(true);
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
        setShowRawEditor(true);
        showToast(
          `Dry-run found ${result.errorCount} row error(s). Fix them and re-validate before committing.`,
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
        "Type the exact Total Opening Balance control figure and tick the sign-off checkbox first.",
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

  function handleResetForAnotherImport() {
    clearResults();
    setCsvText("");
    setUploadedFilename("");
    setConfirmTotalInput("");
    setConfirmChecked(false);
    setShowRawEditor(false);
  }

  const steps = [
    {
      num: 1 as const,
      title: "Company & Template",
      sub: context ? context.tenant.name : "Choose target tenant"
    },
    {
      num: 2 as const,
      title: "Upload Customer CSV",
      sub: uploadedFilename || (csvDataRowsEstimate > 0 ? `${csvDataRowsEstimate} rows pasted` : "Drop .csv file")
    },
    {
      num: 3 as const,
      title: "Dry-Run & Verify",
      sub: preview
        ? `${preview.readyCount} ready · ${formatGhs(preview.totalOpeningBalance)}`
        : "Check branch control totals"
    },
    {
      num: 4 as const,
      title: "Sign-Off Certificate",
      sub: commitResult
        ? `${commitResult.importedCount} migrated`
        : "Download account numbers CSV"
    }
  ];

  return (
    <div className="agents-page mig-page">
      <header className="agents-page__header">
        <div>
          <h2>Data Migration &amp; Opening Balances</h2>
          <p className="muted">
            Onboard existing Susu &amp; microfinance companies from paper books or Excel into live
            accounts — zero Susu commission on brought-forward balances, zero EOD cash distortion,
            and zero customer SMS spam.
          </p>
        </div>
        <div className="agents-page__header-actions">
          {selectedTenantId ? (
            <button
              type="button"
              className="button secondary"
              style={{ marginTop: 0 }}
              disabled={loadingContext || previewing || committing}
              onClick={() => void refreshContext(selectedTenantId)}
            >
              {loadingContext ? "Refreshing…" : "↻ Refresh company"}
            </button>
          ) : null}
          <button
            type="button"
            className="button"
            style={{ marginTop: 0 }}
            disabled={!context}
            onClick={handleDownloadTemplate}
          >
            ⬇ Download CSV template
          </button>
        </div>
      </header>

      {/* Visual 4-Step Progress Stepper */}
      <nav className="mig-stepper" aria-label="Migration workflow progress">
        {steps.map((s) => {
          const isDone = activeStep > s.num || (s.num === 4 && Boolean(commitResult));
          const isActive = activeStep === s.num && !isDone;
          return (
            <div
              key={s.num}
              className={`mig-step${isActive ? " mig-step--active" : ""}${isDone ? " mig-step--done" : ""}`}
            >
              <span className="mig-step__num">{isDone ? "✓" : s.num}</span>
              <div className="mig-step__body">
                <div className="mig-step__title">{s.title}</div>
                <div className="mig-step__sub">{s.sub}</div>
              </div>
            </div>
          );
        })}
      </nav>

      {/* Clear Step-by-Step Onboarding Playbook */}
      <section className="mig-guide">
        <div className="mig-guide__head">
          <div>
            <h3>How to migrate an existing company cleanly</h3>
          </div>
          <div className="mig-actions-group">
            <button
              type="button"
              className="button secondary"
              style={{ marginTop: 0, padding: "0.38rem 0.7rem", fontSize: "0.78rem" }}
              onClick={() => setShowColumnRef((v) => !v)}
            >
              {showColumnRef ? "Hide CSV columns" : "CSV column guide"}
            </button>
            <button
              type="button"
              className="button secondary"
              style={{ marginTop: 0, padding: "0.38rem 0.7rem", fontSize: "0.78rem" }}
              onClick={() => setShowGuide((v) => !v)}
            >
              {showGuide ? "Hide steps" : "Show steps"}
            </button>
          </div>
        </div>

        {showGuide ? (
          <div className="mig-guide__grid">
            <div className="mig-guide__item">
              <span className="mig-guide__badge">Before you start</span>
              <strong>1. Freeze books &amp; set up branches</strong>
              <p>
                Pick a weekend or month-end cutover date. Make sure the company&apos;s branches and
                field agents are created first, and get the owner&apos;s signed total balance per
                branch.
              </p>
            </div>
            <div className="mig-guide__item">
              <span className="mig-guide__badge">Prepare Excel / CSV</span>
              <strong>2. Fill the pre-filled template</strong>
              <p>
                Click <strong>Download CSV template</strong> (pre-filled with real branch codes &amp;
                agent emails). Put one customer per row. Use <strong>Simplified KYC</strong> for
                clients missing Ghana Card photos so they can go live immediately.
              </p>
            </div>
            <div className="mig-guide__item">
              <span className="mig-guide__badge">Safe dry-run</span>
              <strong>3. Validate &amp; match branch totals</strong>
              <p>
                Drop the CSV below and click <strong>Validate &amp; Preview</strong>. Zero data is
                written yet. Match the Branch Control Totals against the company&apos;s paper book
                and fix any red rows.
              </p>
            </div>
            <div className="mig-guide__item">
              <span className="mig-guide__badge">Audited cutover</span>
              <strong>4. Commit &amp; enter Opening Vault</strong>
              <p>
                Type the exact total balance to commit. Download the{" "}
                <strong>Sign-Off Certificate CSV</strong> with every new account number, then record
                the branch&apos;s Day-0 safe cash in <strong>Susu → Closing Balances</strong>.
              </p>
            </div>
          </div>
        ) : null}

        {showColumnRef ? (
          <div className="mig-columns-ref">
            <div className="mig-columns-ref__chip">
              <code>full_name</code> · <code>phone</code> (Required)
              <span>Customer full name &amp; phone (0244… or +233…). Duplicates auto-detected.</span>
            </div>
            <div className="mig-columns-ref__chip">
              <code>branch_code</code> · <code>assigned_agent</code>
              <span>Branch code/name &amp; mobilizer email (optional if default branch is picked).</span>
            </div>
            <div className="mig-columns-ref__chip">
              <code>account_type</code> · <code>daily_contribution</code>
              <span>
                <code>susu</code> (with daily rate e.g. 20) or <code>savings</code> (daily = 0).
              </span>
            </div>
            <div className="mig-columns-ref__chip">
              <code>opening_balance</code> · <code>locked_balance</code>
              <span>
                Net brought-forward balance (GHS 0 fee). For Savings, optional locked min (e.g. 20).
              </span>
            </div>
            <div className="mig-columns-ref__chip">
              <code>kyc_tier</code> · <code>legacy_account_number</code>
              <span>
                <code>simplified</code> (Tier 1) or <code>full</code>; optional paper card/book ref.
              </span>
            </div>
            <div className="mig-columns-ref__chip">
              <code>id_card_number</code> · <code>location</code> · <code>occupation</code>
              <span>Optional KYC details plus <code>next_of_kin_name</code> &amp; <code>next_of_kin_phone</code>.</span>
            </div>
          </div>
        ) : null}
      </section>

      {error ? (
        <p className="customers-card-error" role="alert" style={{ margin: 0 }}>
          {error}
        </p>
      ) : null}

      {/* Step 1: Select Company & Cutover Rules */}
      <section className="mig-section">
        <div className="mig-section__head">
          <div>
            <h3>Step 1 · Company &amp; Cutover Rules</h3>
            <p>
              Choose the tenant you are onboarding and configure defaults for rows where branch or
              KYC tier is left blank.
            </p>
          </div>
        </div>

        <div className="mig-form-grid">
          <label className="mig-field">
            <span className="mig-field__label">Target company</span>
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

          <label className="mig-field">
            <span className="mig-field__label">Cutover date (Day 0)</span>
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

          <label className="mig-field">
            <span className="mig-field__label">Default branch (when CSV cell is blank)</span>
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

          <label className="mig-field">
            <span className="mig-field__label">Default KYC tier (when blank)</span>
            <select
              value={defaultKycTier}
              onChange={(e) => {
                setDefaultKycTier(e.target.value as "simplified" | "full");
                clearResults();
              }}
              disabled={committing}
            >
              <option value="simplified">Tier 1 · Simplified KYC (recommended Day 1)</option>
              <option value="full">Full KYC (if ID cards are captured)</option>
            </select>
          </label>
        </div>

        <label className="mig-toggle-row">
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
            Skip duplicate phone numbers automatically (safe if re-uploading a branch sheet)
          </span>
        </label>

        {context ? (
          <div className="mig-tenant-strip">
            <div className="mig-tenant-strip__stats">
              <span>
                <strong>Company:</strong> {context.tenant.name} ({context.tenant.subdomain}.aabanker.com)
              </span>
              <span>
                <strong>Existing customers:</strong> {context.existingCustomerCount.toLocaleString()}
              </span>
              <span>
                <strong>Active staff:</strong> {context.staff.length}
              </span>
            </div>

            <div className="mig-chips">
              <span className="muted" style={{ fontSize: "0.76rem", marginRight: "0.25rem" }}>
                Valid branch codes:
              </span>
              {context.branches.length > 0 ? (
                context.branches.map((b) => (
                  <span key={b.id} className="mig-chip">
                    <strong>{b.code}</strong> · {b.name}
                  </span>
                ))
              ) : (
                <span className="mig-chip mig-chip--warn">
                  No branches yet — create a branch for this company before migrating
                </span>
              )}
            </div>

            {context.staff.length > 0 ? (
              <div className="mig-chips">
                <span className="muted" style={{ fontSize: "0.76rem", marginRight: "0.25rem" }}>
                  Staff emails:
                </span>
                {context.staff.slice(0, 8).map((s) => (
                  <span key={s.id} className="mig-chip">
                    {s.fullName} ({s.email})
                  </span>
                ))}
                {context.staff.length > 8 ? (
                  <span className="mig-chip">+{context.staff.length - 8} more</span>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}
      </section>

      {/* Step 2: Drag & Drop CSV Upload */}
      <section className="mig-section">
        <div className="mig-section__head">
          <div>
            <h3>Step 2 · Upload or Paste Customer CSV</h3>
            <p>
              Export the company&apos;s spreadsheet from Excel as <strong>CSV (UTF-8)</strong> and
              drop it below. Supports up to 2,500 rows per upload.
            </p>
          </div>
          <div className="mig-actions-group">
            <button
              type="button"
              className="button secondary"
              style={{ marginTop: 0 }}
              disabled={!context || committing}
              onClick={handleLoadSampleIntoEditor}
            >
              Load sample rows
            </button>
            <button
              type="button"
              className="button secondary"
              style={{ marginTop: 0 }}
              disabled={!context}
              onClick={() => setShowRawEditor((v) => !v)}
            >
              {showRawEditor ? "Hide raw CSV editor" : "Edit / paste CSV text"}
            </button>
          </div>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,text/csv"
          onChange={(e) => void handleFileUpload(e)}
          style={{ display: "none" }}
          disabled={!context || committing}
        />

        <div
          className={`mig-dropzone${dragActive ? " mig-dropzone--drag" : ""}`}
          role="button"
          tabIndex={0}
          onClick={() => {
            if (context && !committing) fileInputRef.current?.click();
          }}
          onKeyDown={(e) => {
            if ((e.key === "Enter" || e.key === " ") && context && !committing) {
              e.preventDefault();
              fileInputRef.current?.click();
            }
          }}
          onDragOver={(e) => {
            e.preventDefault();
            if (context && !committing) setDragActive(true);
          }}
          onDragLeave={() => setDragActive(false)}
          onDrop={handleDrop}
        >
          <div className="mig-dropzone__title">
            {uploadedFilename
              ? "Click or drop another .csv file to replace"
              : "Drop your customer .csv file here, or click to browse"}
          </div>
          <div className="mig-dropzone__sub">
            Accepts standard Excel CSV exports · Handles <code>GHS 1,250.00</code>, quoted commas,
            and flexible headers
          </div>
          {uploadedFilename || csvDataRowsEstimate > 0 ? (
            <span className="mig-file-pill">
              ✓ {uploadedFilename || "Pasted CSV"} · ~{csvDataRowsEstimate.toLocaleString()} row(s)
            </span>
          ) : null}
        </div>

        {showRawEditor ? (
          <textarea
            className="mig-textarea"
            rows={8}
            value={csvText}
            onChange={(e) => {
              setCsvText(e.target.value);
              clearResults();
              setConfirmTotalInput("");
              setConfirmChecked(false);
            }}
            placeholder="full_name,phone,branch_code,assigned_agent,account_type,daily_contribution,opening_balance..."
            disabled={!context || committing}
          />
        ) : null}

        <div className="mig-actions-bar">
          <span className="muted" style={{ fontSize: "0.8rem" }}>
            Dry-run validation checks every row without creating any accounts or posting any balances.
          </span>
          <div className="mig-actions-group">
            {csvText ? (
              <button
                type="button"
                className="button secondary"
                disabled={previewing || committing}
                onClick={handleResetForAnotherImport}
              >
                Clear CSV
              </button>
            ) : null}
            <button
              type="button"
              className="button"
              disabled={!context || !csvText.trim() || previewing || committing}
              onClick={() => void handleValidatePreview()}
            >
              {previewing ? "Validating CSV…" : "Validate & Preview (Dry-Run)"}
            </button>
          </div>
        </div>
      </section>

      {/* Step 3: Dry-Run Reconciliation & Control Total Sign-Off */}
      {preview && !commitResult ? (
        <section className="mig-section">
          <div className="mig-section__head">
            <div>
              <h3>Step 3 · Dry-Run Reconciliation &amp; Branch Control Totals</h3>
              <p>
                Verify these totals against <strong>{preview.tenantName}</strong>&apos;s signed
                manual book before committing.
              </p>
            </div>
            <span className="mig-chip">
              CSV SHA-256: <code>{preview.csvSha256.slice(0, 12)}…</code>
            </span>
          </div>

          <div className="kpi-grid agents-page__kpis">
            <article className="kpi-card kpi-card--primary">
              <span className="kpi-label">Ready to import</span>
              <p className="kpi-value">{preview.readyCount.toLocaleString()}</p>
              <p className="kpi-meta muted">
                {preview.susuCount} Susu · {preview.savingsCount} Savings
              </p>
            </article>
            <article className="kpi-card kpi-card--success">
              <span className="kpi-label">Total opening balance</span>
              <p className="kpi-value">{formatGhs(preview.totalOpeningBalance)}</p>
              <p className="kpi-meta muted">
                Susu {formatGhs(preview.susuOpeningBalance)} · Savings{" "}
                {formatGhs(preview.savingsOpeningBalance)}
              </p>
            </article>
            <article className="kpi-card kpi-card--purple">
              <span className="kpi-label">Locked savings min.</span>
              <p className="kpi-value">{formatGhs(preview.totalLockedBalance)}</p>
              <p className="kpi-meta muted">
                {preview.simplifiedKycCount} Simplified · {preview.fullKycCount} Full KYC
              </p>
            </article>
            <article
              className={`kpi-card ${preview.errorCount > 0 ? "kpi-card--warning" : ""}`}
            >
              <span className="kpi-label">Errors &amp; duplicates</span>
              <p className="kpi-value">
                {preview.errorCount} err · {preview.duplicateSkippedCount} skip
              </p>
              <p className="kpi-meta muted">
                {preview.errorCount === 0
                  ? "All rows passed validation"
                  : "Fix red rows before committing"}
              </p>
            </article>
          </div>

          {preview.branchTotals.length > 0 ? (
            <>
              <h4 style={{ margin: "0 0 0.55rem", fontSize: "0.9rem" }}>
                Branch-by-Branch Control Totals
              </h4>
              <div className="mig-branch-table-wrap">
                <table className="mig-branch-table">
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
            </>
          ) : null}

          <AdminDataTable<PlatformMigrationPreviewRow>
            rows={filteredPreviewRows}
            rowKey={(r) => `${r.rowNumber}-${r.phone}`}
            search={rowSearch}
            onSearchChange={setRowSearch}
            searchPlaceholder="Search preview rows by name, phone, branch, or card ref…"
            emptyMessage="No rows match this filter."
            toolbar={
              <div className="mig-filter-pills">
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
                    className={rowStatusFilter === key ? "button" : "button secondary"}
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
                render: (r) => <span className="muted">#{r.rowNumber}</span>
              },
              {
                key: "status",
                label: "Status",
                render: (r) => {
                  const pillClass =
                    r.status === "ready"
                      ? "status-pill status-pill--active"
                      : r.status === "duplicate_skipped"
                        ? "status-pill status-pill--pending"
                        : "status-pill status-pill--failed";
                  const label =
                    r.status === "ready"
                      ? "Ready"
                      : r.status === "duplicate_skipped"
                        ? "Duplicate"
                        : "Error";
                  return <span className={pillClass}>{label}</span>;
                }
              },
              {
                key: "customer",
                label: "Customer",
                render: (r) => (
                  <div>
                    <strong>{r.fullName || "—"}</strong>
                    <small className="muted" style={{ display: "block" }}>
                      {r.phone || "No phone"}
                      {r.legacyAccountNumber ? ` · Ref ${r.legacyAccountNumber}` : ""}
                    </small>
                  </div>
                )
              },
              {
                key: "branch",
                label: "Branch & Agent",
                render: (r) => (
                  <div>
                    <strong>{r.branchCode || "—"}</strong>
                    <small className="muted" style={{ display: "block" }}>
                      {r.assignedAgentLabel}
                    </small>
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
                      <small className="muted" style={{ display: "block" }}>
                        Daily: {formatGhs(r.dailyContributionAmount)}
                      </small>
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
                      <small className="muted" style={{ display: "block" }}>
                        Locked: {formatGhs(r.lockedBalance)}
                      </small>
                    ) : null}
                  </div>
                )
              },
              {
                key: "issues",
                label: "Notes",
                render: (r) =>
                  r.issues.length > 0 ? (
                    <span style={{ color: "var(--danger)", fontSize: "0.8rem" }}>
                      {r.issues.join("; ")}
                    </span>
                  ) : (
                    <span className="muted" style={{ fontSize: "0.8rem" }}>
                      {r.kycTier === "simplified" ? "Simplified KYC" : "Full KYC"} · BBF 0% fee
                    </span>
                  )
              }
            ]}
          />

          {preview.canCommit ? (
            <div className="mig-signoff-box">
              <h4>Control Total Sign-Off &amp; Commit</h4>
              <p className="muted" style={{ margin: 0, fontSize: "0.84rem" }}>
                Ready to migrate <strong>{preview.readyCount}</strong> customer(s) into{" "}
                <strong>{preview.tenantName}</strong> as of <strong>{preview.cutoverDate}</strong>.
              </p>
              <div className="mig-guarantees">
                <span className="mig-guarantee-pill">✓ 0% Susu fee on BBF</span>
                <span className="mig-guarantee-pill">✓ Excluded from today&apos;s EOD vault</span>
                <span className="mig-guarantee-pill">✓ 0 customer SMS / emails sent</span>
                <span className="mig-guarantee-pill">✓ Sealed in immutable audit chain</span>
              </div>

              <div className="mig-signoff-grid">
                <label className="mig-field">
                  <span className="mig-field__label">
                    Type exact Total Opening Balance (
                    <code>{preview.totalOpeningBalance.toFixed(2)}</code>)
                  </span>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={confirmTotalInput}
                    onChange={(e) => setConfirmTotalInput(e.target.value)}
                    placeholder={preview.totalOpeningBalance.toFixed(2)}
                    disabled={committing}
                  />
                  <span
                    className={`mig-match-hint ${totalMatchesControl ? "mig-match-hint--ok" : "mig-match-hint--wait"}`}
                  >
                    {totalMatchesControl
                      ? "✓ Matches verified control total"
                      : `Enter ${preview.totalOpeningBalance.toFixed(2)} to unlock commit`}
                  </span>
                </label>

                <label className="mig-toggle-row" style={{ marginTop: 0, paddingBottom: "1.35rem" }}>
                  <input
                    type="checkbox"
                    checked={confirmChecked}
                    onChange={(e) => setConfirmChecked(e.target.checked)}
                    disabled={committing}
                  />
                  <span>
                    I have verified the branch totals against {preview.tenantName}&apos;s signed
                    manual records.
                  </span>
                </label>
              </div>

              <div className="mig-actions-bar" style={{ justifyContent: "flex-end" }}>
                <button
                  type="button"
                  className="button"
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
            <p className="customers-card-error" style={{ marginTop: "1rem", marginBottom: 0 }}>
              Fix all {preview.errorCount} red error row(s) in the CSV editor above and click
              Validate &amp; Preview again before committing.
            </p>
          )}
        </section>
      ) : null}

      {/* Step 4: Completed Receipt & Sign-Off Certificate */}
      {commitResult ? (
        <section className="mig-section">
          <div className="mig-complete-banner">
            <div>
              <h3>✓ Migration Completed for {commitResult.tenantName}</h3>
              <p>
                Cutover {commitResult.cutoverDate} · Audit SHA-256:{" "}
                <code>{commitResult.csvSha256.slice(0, 16)}…</code> · Next step: enter each
                branch&apos;s Day-0 safe cash in <strong>Susu → Closing Balances</strong>.
              </p>
            </div>
            <div className="mig-actions-group">
              <button
                type="button"
                className="button"
                style={{ marginTop: 0 }}
                onClick={() =>
                  triggerCsvDownload(commitResult.certificateFilename, commitResult.certificateCsv)
                }
              >
                ⬇ Download Sign-Off Certificate (CSV)
              </button>
              <button
                type="button"
                className="button secondary"
                style={{ marginTop: 0 }}
                onClick={handleResetForAnotherImport}
              >
                Start another import
              </button>
            </div>
          </div>

          <div className="kpi-grid agents-page__kpis">
            <article className="kpi-card kpi-card--primary">
              <span className="kpi-label">Customers migrated</span>
              <p className="kpi-value">{commitResult.importedCount.toLocaleString()}</p>
              <p className="kpi-meta muted">
                {commitResult.susuCount} Susu · {commitResult.savingsCount} Savings
              </p>
            </article>
            <article className="kpi-card kpi-card--success">
              <span className="kpi-label">Opening balances posted</span>
              <p className="kpi-value">{formatGhs(commitResult.totalOpeningBalance)}</p>
              <p className="kpi-meta muted">
                Susu BBF {formatGhs(commitResult.susuOpeningBalance)} · Savings{" "}
                {formatGhs(commitResult.savingsOpeningBalance)}
              </p>
            </article>
            <article className="kpi-card kpi-card--purple">
              <span className="kpi-label">Locked savings min.</span>
              <p className="kpi-value">{formatGhs(commitResult.totalLockedBalance)}</p>
              <p className="kpi-meta muted">0 SMS sent · 0 EOD cash distortion</p>
            </article>
          </div>

          <AdminDataTable<PlatformMigrationCommittedCustomer>
            rows={filteredCommittedRows}
            rowKey={(c) => c.customerId}
            search={committedSearch}
            onSearchChange={setCommittedSearch}
            searchPlaceholder="Search migrated accounts by name, phone, account #, or legacy ref…"
            emptyMessage="No migrated customers."
            columns={[
              {
                key: "acct",
                label: "New Account #",
                render: (c) => (
                  <div>
                    <code>{c.accountNumber}</code>
                    {c.legacyAccountNumber ? (
                      <small className="muted" style={{ display: "block" }}>
                        Legacy: {c.legacyAccountNumber}
                      </small>
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
                    <small className="muted" style={{ display: "block" }}>
                      {c.phone}
                    </small>
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
                    {c.accountType === "susu"
                      ? ` (${formatGhs(c.dailyContributionAmount)}/day)`
                      : ""}
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
