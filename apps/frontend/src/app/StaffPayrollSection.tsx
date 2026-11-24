import { formatAccountAmount } from "@bms/shared";
import { useEffect, useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { AgentCommissionStatementModal } from "./AgentCommissionStatementModal";
import { PayslipViewer } from "./PayslipViewer";
import { formatRoleLabel, parseMoney } from "./payrollRoleUtils";
import { RolePayrollDefaultsModal } from "./RolePayrollDefaultsModal";
import {
  usePayrollStore,
  selectPublishedTotals,
  selectStaffCountByRole,
  selectStaffTotals
} from "./stores/payrollStore";
import { Modal } from "../components/Modal";
import { useToast } from "../components/Toast";

type PayrollTab = "staff" | "published" | "mine";

function staffInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0]![0]}${parts[1]![0]}`.toUpperCase();
  }
  return (parts[0]?.slice(0, 2) ?? "ST").toUpperCase();
}

function escapeCsvCell(value: unknown): string {
  const s = value == null ? "" : String(value);
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function StaffPayrollSection() {
  const { showToast } = useToast();
  const [activeTab, setActiveTab] = useState<PayrollTab>("staff");
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [detailPayslipId, setDetailPayslipId] = useState<string | null>(null);
  const [roleModalOpen, setRoleModalOpen] = useState(false);
  const [commissionTarget, setCommissionTarget] = useState<{ userId: string; name: string } | null>(
    null
  );

  const {
    period,
    policy,
    roleDrafts,
    staffRows,
    published,
    myPayslips,
    loading,
    refreshing,
    running,
    error,
    hydrate,
    refresh,
    startLiveSync,
    stopLiveSync,
    patchStaffDraft,
    saveStaffRow,
    runPayroll
  } = usePayrollStore(
    useShallow((s) => ({
      period: s.period,
      policy: s.policy,
      roleDrafts: s.roleDrafts,
      staffRows: s.staffRows,
      published: s.published,
      myPayslips: s.myPayslips,
      loading: s.loading,
      refreshing: s.refreshing,
      running: s.running,
      error: s.error,
      hydrate: s.hydrate,
      refresh: s.refresh,
      startLiveSync: s.startLiveSync,
      stopLiveSync: s.stopLiveSync,
      patchStaffDraft: s.patchStaffDraft,
      saveStaffRow: s.saveStaffRow,
      runPayroll: s.runPayroll
    }))
  );

  useEffect(() => {
    hydrate();
    startLiveSync();
    return () => stopLiveSync();
  }, [hydrate, startLiveSync, stopLiveSync]);

  useEffect(() => {
    if (error) {
      showToast(error, "error");
    }
  }, [error, showToast]);

  const currency = policy?.currency || "GHS";
  const staffCountByRole = useMemo(() => selectStaffCountByRole(staffRows), [staffRows]);
  const staffTotals = useMemo(() => selectStaffTotals(staffRows), [staffRows]);
  const publishedTotals = useMemo(() => selectPublishedTotals(published), [published]);
  const detailPayslip = detailPayslipId ? published.find((p) => p.id === detailPayslipId) ?? null : null;
  const latestMyPayslip = myPayslips[0] ?? null;

  const uniqueRoles = useMemo(
    () => [...new Set(staffRows.map((r) => r.role))].sort(),
    [staffRows]
  );

  const filteredStaff = useMemo(() => {
    const q = search.trim().toLowerCase();
    return staffRows.filter((row) => {
      if (roleFilter && row.role !== roleFilter) return false;
      if (!q) return true;
      const hay = `${row.fullName ?? ""} ${row.email ?? ""} ${formatRoleLabel(row.role)}`.toLowerCase();
      return hay.includes(q);
    });
  }, [staffRows, roleFilter, search]);

  const filteredTotals = useMemo(() => {
    let basic = 0;
    let collections = 0;
    let commission = 0;
    let gross = 0;
    let deductions = 0;
    let net = 0;
    for (const r of filteredStaff) {
      basic += r.baseSalary;
      collections += r.commissionsApply ? r.collectionsThisPeriod : 0;
      commission += r.commissionsApply ? r.projectedCommission + r.projectedTierBonus : 0;
      gross += r.projectedGross;
      deductions += r.projectedDeductions;
      net += r.projectedNet;
    }
    return { basic, collections, commission, gross, deductions, net };
  }, [filteredStaff]);

  const showInitialLoader = loading && staffRows.length === 0;

  async function handleRunPayroll() {
    try {
      const count = await runPayroll();
      showToast(`${count} payslips published for ${period?.label ?? "this period"}`, "success");
      setActiveTab("published");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Payroll run failed", "error");
    }
  }

  function handleExportCsv() {
    if (filteredStaff.length === 0) return;
    const header = [
      "Staff Name",
      "Email",
      "Role",
      "Status",
      `Basic (${currency})`,
      `Collections (${currency})`,
      `Commission (${currency})`,
      `Gross (${currency})`,
      `Deductions (${currency})`,
      `Net (${currency})`
    ];
    const lines = [
      header.join(","),
      ...filteredStaff.map((r) =>
        [
          r.fullName ?? "",
          r.email ?? "",
          formatRoleLabel(r.role),
          r.status,
          r.baseSalary.toFixed(2),
          (r.commissionsApply ? r.collectionsThisPeriod : 0).toFixed(2),
          (r.commissionsApply ? r.projectedCommission + r.projectedTierBonus : 0).toFixed(2),
          r.projectedGross.toFixed(2),
          r.projectedDeductions.toFixed(2),
          r.projectedNet.toFixed(2)
        ]
          .map(escapeCsvCell)
          .join(",")
      )
    ];
    const blob = new Blob([lines.join("\r\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `payroll-${period?.id ?? new Date().toISOString().slice(0, 7)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast(`Exported ${filteredStaff.length} staff payroll row(s) to CSV`, "success");
  }

  return (
    <div className="payroll-modern-page">
      <header className="overview-hero payroll-modern-hero">
        <div>
          <p className="overview-hero__eyebrow">
            Susu management · Compensation{period?.label ? ` · ${period.label}` : ""}
          </p>
          <h1 className="overview-hero__title">Payroll</h1>
          <p className="overview-hero__sub muted">
            Live staff salaries, collection commissions, deductions, and official payslip runs.
            Edits recalculate gross and net instantly.{refreshing ? " · Syncing…" : ""}
          </p>
        </div>
        <div className="payroll-modern-hero__actions">
          <button
            type="button"
            className="button secondary"
            disabled={loading || refreshing}
            onClick={() => void refresh()}
          >
            {loading || refreshing ? "Refreshing…" : "Refresh"}
          </button>
          <button
            type="button"
            className="button secondary"
            disabled={showInitialLoader}
            onClick={() => setRoleModalOpen(true)}
          >
            Pay by role
          </button>
          <button
            type="button"
            className="button secondary"
            disabled={filteredStaff.length === 0}
            onClick={handleExportCsv}
          >
            Export CSV
          </button>
          <button
            type="button"
            className="button"
            disabled={running || showInitialLoader}
            onClick={() => void handleRunPayroll()}
          >
            {running ? "Publishing…" : "Run & publish payroll"}
          </button>
        </div>
      </header>

      {/* Executive KPI summary strip */}
      <section className="statements-kpis">
        <article className="statements-kpi statements-kpi--primary">
          <span className="statements-kpi__label">Projected gross</span>
          <strong className="statements-kpi__value">
            {showInitialLoader ? "…" : `${currency} ${formatAccountAmount(staffTotals.gross)}`}
          </strong>
          <span className="statements-kpi__sub">
            {staffRows.length} staff member{staffRows.length === 1 ? "" : "s"} ·{" "}
            {period?.label || "Current period"}
          </span>
        </article>
        <article className="statements-kpi statements-kpi--credit">
          <span className="statements-kpi__label">Projected net pay</span>
          <strong className="statements-kpi__value">
            {showInitialLoader ? "…" : `${currency} ${formatAccountAmount(staffTotals.net)}`}
          </strong>
          <span className="statements-kpi__sub">Total take-home after deductions</span>
        </article>
        <article className="statements-kpi statements-kpi--debit">
          <span className="statements-kpi__label">Total deductions</span>
          <strong className="statements-kpi__value">
            {showInitialLoader
              ? "…"
              : `−${currency} ${formatAccountAmount(staffTotals.deductions)}`}
          </strong>
          <span className="statements-kpi__sub">SSNIT, welfare &amp; staff loan deductions</span>
        </article>
        <article className="statements-kpi">
          <span className="statements-kpi__label">Published payslips</span>
          <strong className="statements-kpi__value">
            {published.length}
            <span style={{ fontSize: "0.82rem", fontWeight: 600, color: "var(--text-muted)" }}>
              {" "}
              / {staffRows.length}
            </span>
          </strong>
          <span className="statements-kpi__sub">
            {published.length > 0
              ? `Published net ${currency} ${formatAccountAmount(publishedTotals.net)}`
              : "Not yet published this period"}
          </span>
        </article>
      </section>

      {/* Role basic salary templates strip */}
      {!showInitialLoader && roleDrafts.length > 0 ? (
        <section className="overview-panel payroll-modern-roles" aria-label="Role basic pay templates">
          <div className="payroll-modern-roles__head">
            <span className="platform-company-section-label">Role base templates</span>
            <button
              type="button"
              className="statements-inline-link"
              onClick={() => setRoleModalOpen(true)}
            >
              Edit role defaults
            </button>
          </div>
          <div className="payroll-modern-role-chips">
            {roleDrafts.map((d) => (
              <button
                key={d.role}
                type="button"
                className="payroll-modern-role-chip"
                onClick={() => setRoleModalOpen(true)}
              >
                <span className="payroll-modern-role-chip__name">{formatRoleLabel(d.role)}</span>
                <strong className="payroll-modern-role-chip__amt">
                  {currency} {parseMoney(d.draftBaseSalary).toLocaleString()}
                </strong>
                {staffCountByRole[d.role] ? (
                  <span className="payroll-modern-role-chip__count">
                    {staffCountByRole[d.role]}
                  </span>
                ) : null}
              </button>
            ))}
          </div>
        </section>
      ) : null}

      {/* Clean section tabs */}
      <div className="statements-tabs" role="tablist" aria-label="Payroll views">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "staff"}
          className={`statements-tab${activeTab === "staff" ? " statements-tab--active" : ""}`}
          onClick={() => setActiveTab("staff")}
        >
          Live staff payroll ({staffRows.length})
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "published"}
          className={`statements-tab${activeTab === "published" ? " statements-tab--active" : ""}`}
          onClick={() => setActiveTab("published")}
        >
          Published payslips ({published.length})
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "mine"}
          className={`statements-tab${activeTab === "mine" ? " statements-tab--active" : ""}`}
          onClick={() => setActiveTab("mine")}
        >
          My payslip
        </button>
      </div>

      {/* Tab 1: Live Staff Payroll */}
      {activeTab === "staff" ? (
        <section className="overview-panel statements-section">
          <div className="payroll-modern-toolbar">
            <div>
              <h2 className="statements-section__title">Live staff compensation</h2>
              <p className="muted statements-section__sub">
                Adjust individual loan deductions or commission % overrides inline, then click Save.
              </p>
            </div>
            <div className="payroll-modern-toolbar__filters">
              <div className="statements-search-box" style={{ minWidth: "220px" }}>
                <span className="statements-search-box__icon" aria-hidden>
                  ⌕
                </span>
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search staff name or email…"
                  aria-label="Search staff"
                />
                {search ? (
                  <button
                    type="button"
                    className="statements-search-box__clear"
                    onClick={() => setSearch("")}
                    aria-label="Clear search"
                  >
                    ×
                  </button>
                ) : null}
              </div>
              <select
                className="payroll-modern-select"
                aria-label="Filter by role"
                value={roleFilter}
                onChange={(e) => setRoleFilter(e.target.value)}
              >
                <option value="">All roles ({staffRows.length})</option>
                {uniqueRoles.map((r) => (
                  <option key={r} value={r}>
                    {formatRoleLabel(r)} ({staffCountByRole[r] ?? 0})
                  </option>
                ))}
              </select>
            </div>
          </div>

          {showInitialLoader ? (
            <div className="statements-ledger-empty">
              <p className="muted">Loading payroll workspace…</p>
            </div>
          ) : filteredStaff.length === 0 ? (
            <div className="statements-ledger-empty">
              <p className="muted">No staff members match your current filter.</p>
            </div>
          ) : (
            <div className="statements-table-wrap">
              <table className="statements-table payroll-modern-table">
                <thead>
                  <tr>
                    <th>Staff</th>
                    <th>Role</th>
                    <th className="statements-table__num">Basic</th>
                    <th className="statements-table__num">Collections</th>
                    <th className="statements-table__num">Commission</th>
                    <th className="statements-table__num">Gross</th>
                    <th className="statements-table__num">Deductions</th>
                    <th className="statements-table__num">Net pay</th>
                    <th className="statements-table__num">Loan ded.</th>
                    <th className="statements-table__num">Comm %</th>
                    <th style={{ textAlign: "right" }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredStaff.map((row) => {
                    const displayName = row.fullName ?? row.email ?? row.userId;
                    const earnedComm = row.commissionsApply
                      ? row.projectedCommission + row.projectedTierBonus
                      : 0;
                    return (
                      <tr
                        key={row.userId}
                        className={row.status === "inactive" ? "payroll-modern-row--inactive" : ""}
                      >
                        <td>
                          <div className="payroll-modern-staff-cell">
                            <span className="statements-finder__avatar" aria-hidden>
                              {staffInitials(displayName)}
                            </span>
                            <div className="payroll-modern-staff-cell__text">
                              <strong>{displayName}</strong>
                              {row.email && row.fullName ? (
                                <small className="muted">{row.email}</small>
                              ) : null}
                            </div>
                          </div>
                        </td>
                        <td>
                          <span className="statements-finder__badge">
                            {formatRoleLabel(row.role)}
                          </span>
                        </td>
                        <td className="statements-table__num">
                          {formatAccountAmount(row.baseSalary)}
                        </td>
                        <td className="statements-table__num">
                          {row.commissionsApply ? (
                            formatAccountAmount(row.collectionsThisPeriod)
                          ) : (
                            <span className="muted">—</span>
                          )}
                        </td>
                        <td className="statements-table__num statements-table__amount statements-table__amount--credit">
                          {row.commissionsApply ? (
                            `+${formatAccountAmount(earnedComm)}`
                          ) : (
                            <span className="muted">—</span>
                          )}
                        </td>
                        <td className="statements-table__num statements-table__balance">
                          {formatAccountAmount(row.projectedGross)}
                        </td>
                        <td className="statements-table__num statements-table__amount statements-table__amount--debit">
                          −{formatAccountAmount(row.projectedDeductions)}
                        </td>
                        <td className="statements-table__num payroll-modern-net-cell">
                          <strong>{formatAccountAmount(row.projectedNet)}</strong>
                        </td>
                        <td className="statements-table__num">
                          <input
                            className="input-no-spin payroll-modern-input"
                            inputMode="decimal"
                            aria-label={`Loan deduction for ${displayName}`}
                            value={row.draftLoan}
                            onChange={(e) =>
                              patchStaffDraft(row.userId, { draftLoan: e.target.value })
                            }
                          />
                        </td>
                        <td className="statements-table__num">
                          {row.commissionsApply ? (
                            <input
                              className="input-no-spin payroll-modern-input"
                              inputMode="decimal"
                              aria-label={`Commission percent override for ${displayName}`}
                              placeholder={String(row.defaultCommissionPercent)}
                              value={row.draftCommissionOverride}
                              onChange={(e) =>
                                patchStaffDraft(row.userId, {
                                  draftCommissionOverride: e.target.value
                                })
                              }
                            />
                          ) : (
                            <span className="muted">—</span>
                          )}
                        </td>
                        <td>
                          <div className="payroll-modern-row-actions">
                            <button
                              type="button"
                              className="button secondary payroll-modern-btn-sm"
                              disabled={row.saving}
                              onClick={() => void saveStaffRow(row.userId)}
                            >
                              {row.saving ? "…" : "Save"}
                            </button>
                            {row.commissionsApply ? (
                              <button
                                type="button"
                                className="button secondary payroll-modern-btn-sm"
                                onClick={() =>
                                  setCommissionTarget({
                                    userId: row.userId,
                                    name: displayName
                                  })
                                }
                              >
                                Breakdown
                              </button>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="payroll-modern-totals">
                    <td colSpan={2}>
                      <strong>
                        Total ({filteredStaff.length} staff
                        {filteredStaff.length !== staffRows.length
                          ? ` of ${staffRows.length}`
                          : ""}
                        )
                      </strong>
                    </td>
                    <td className="statements-table__num">
                      <strong>{formatAccountAmount(filteredTotals.basic)}</strong>
                    </td>
                    <td className="statements-table__num">
                      <strong>{formatAccountAmount(filteredTotals.collections)}</strong>
                    </td>
                    <td className="statements-table__num statements-table__amount statements-table__amount--credit">
                      <strong>+{formatAccountAmount(filteredTotals.commission)}</strong>
                    </td>
                    <td className="statements-table__num">
                      <strong>{formatAccountAmount(filteredTotals.gross)}</strong>
                    </td>
                    <td className="statements-table__num statements-table__amount statements-table__amount--debit">
                      <strong>−{formatAccountAmount(filteredTotals.deductions)}</strong>
                    </td>
                    <td className="statements-table__num payroll-modern-net-cell">
                      <strong>{formatAccountAmount(filteredTotals.net)}</strong>
                    </td>
                    <td colSpan={3} />
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </section>
      ) : null}

      {/* Tab 2: Published Payslips */}
      {activeTab === "published" ? (
        <section className="overview-panel statements-section">
          <div className="payroll-modern-toolbar">
            <div>
              <h2 className="statements-section__title">Published payslips</h2>
              <p className="muted statements-section__sub">
                Official published earnings, deductions, and take-home pay for{" "}
                {period?.label ?? "this period"}.
              </p>
            </div>
            {published.length === 0 ? (
              <button
                type="button"
                className="button"
                disabled={running || showInitialLoader}
                onClick={() => void handleRunPayroll()}
              >
                {running ? "Publishing…" : "Run & publish payroll"}
              </button>
            ) : null}
          </div>

          {published.length === 0 ? (
            <div className="statements-ledger-empty">
              <p className="muted">
                No payslips have been published for {period?.label ?? "this period"} yet. Review
                live staff compensation and click <strong>Run &amp; publish payroll</strong> when
                ready.
              </p>
            </div>
          ) : (
            <div className="statements-table-wrap">
              <table className="statements-table">
                <thead>
                  <tr>
                    <th>Staff</th>
                    <th>Role</th>
                    <th className="statements-table__num">Gross pay</th>
                    <th className="statements-table__num">Deductions</th>
                    <th className="statements-table__num">Net pay</th>
                    <th>Published</th>
                    <th style={{ textAlign: "right" }}>Payslip</th>
                  </tr>
                </thead>
                <tbody>
                  {published.map((p) => {
                    const staff = staffRows.find((r) => r.userId === p.userId);
                    const name = staff?.fullName ?? staff?.email ?? p.userId;
                    return (
                      <tr key={p.id}>
                        <td>
                          <div className="payroll-modern-staff-cell">
                            <span className="statements-finder__avatar" aria-hidden>
                              {staffInitials(name)}
                            </span>
                            <div className="payroll-modern-staff-cell__text">
                              <strong>{name}</strong>
                              {staff?.email && staff?.fullName ? (
                                <small className="muted">{staff.email}</small>
                              ) : null}
                            </div>
                          </div>
                        </td>
                        <td>
                          <span className="statements-finder__badge">
                            {formatRoleLabel(p.role)}
                          </span>
                        </td>
                        <td className="statements-table__num statements-table__balance">
                          {currency} {formatAccountAmount(p.grossPay)}
                        </td>
                        <td className="statements-table__num statements-table__amount statements-table__amount--debit">
                          −{currency} {formatAccountAmount(p.totalDeductions)}
                        </td>
                        <td className="statements-table__num payroll-modern-net-cell">
                          <strong>
                            {currency} {formatAccountAmount(p.netPay)}
                          </strong>
                        </td>
                        <td className="muted">
                          {p.runAt ? new Date(p.runAt).toLocaleDateString() : "—"}
                        </td>
                        <td style={{ textAlign: "right" }}>
                          <button
                            type="button"
                            className="button secondary payroll-modern-btn-sm"
                            onClick={() => setDetailPayslipId(p.id)}
                          >
                            View payslip
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="payroll-modern-totals">
                    <td colSpan={2}>
                      <strong>Total ({published.length} workers)</strong>
                    </td>
                    <td className="statements-table__num">
                      <strong>
                        {currency} {formatAccountAmount(publishedTotals.gross)}
                      </strong>
                    </td>
                    <td className="statements-table__num statements-table__amount statements-table__amount--debit">
                      <strong>
                        −{currency} {formatAccountAmount(publishedTotals.deductions)}
                      </strong>
                    </td>
                    <td className="statements-table__num payroll-modern-net-cell">
                      <strong>
                        {currency} {formatAccountAmount(publishedTotals.net)}
                      </strong>
                    </td>
                    <td colSpan={2} />
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </section>
      ) : null}

      {/* Tab 3: My Payslip */}
      {activeTab === "mine" ? (
        <section className="overview-panel statements-section">
          <div>
            <h2 className="statements-section__title">My payslip</h2>
            <p className="muted statements-section__sub">
              Your personal earnings and deductions from the latest published payroll run.
            </p>
          </div>
          {latestMyPayslip ? (
            <PayslipViewer
              payslip={latestMyPayslip}
              subtitle="Your account after the last payroll run"
            />
          ) : (
            <div className="statements-ledger-empty">
              <p className="muted">
                No official payslip published for your account yet. Click{" "}
                <strong>Run &amp; publish payroll</strong> to publish payslips for this period.
              </p>
            </div>
          )}
        </section>
      ) : null}

      <RolePayrollDefaultsModal open={roleModalOpen} onClose={() => setRoleModalOpen(false)} />

      <AgentCommissionStatementModal
        open={Boolean(commissionTarget)}
        userId={commissionTarget?.userId ?? null}
        staffName={commissionTarget?.name}
        onClose={() => setCommissionTarget(null)}
      />

      <Modal
        open={Boolean(detailPayslip)}
        onClose={() => setDetailPayslipId(null)}
        title="Published payslip"
        subtitle={
          detailPayslip
            ? (() => {
                const st = staffRows.find((r) => r.userId === detailPayslip.userId);
                return `${st?.fullName ?? st?.email ?? detailPayslip.userId} · ${formatRoleLabel(detailPayslip.role)}`;
              })()
            : undefined
        }
        panelClassName="modal-panel--70"
        footer={
          <button
            type="button"
            className="button secondary"
            onClick={() => setDetailPayslipId(null)}
          >
            Close
          </button>
        }
      >
        {detailPayslip ? <PayslipViewer payslip={detailPayslip} title="Payslip breakdown" /> : null}
      </Modal>
    </div>
  );
}
