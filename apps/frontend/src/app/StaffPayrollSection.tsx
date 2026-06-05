import { useEffect, useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { PayslipViewer } from "./PayslipViewer";
import { formatRoleLabel, parseMoney } from "./payrollRoleUtils";
import { RolePayrollDefaultsModal } from "./RolePayrollDefaultsModal";
import {
  usePayrollStore,
  selectPublishedTotals,
  selectStaffCountByRole,
  selectStaffTotals
} from "./stores/payrollStore";
import { useToast } from "../components/Toast";

export function StaffPayrollSection() {
  const { showToast } = useToast();
  const [detailPayslipId, setDetailPayslipId] = useState<string | null>(null);
  const [roleModalOpen, setRoleModalOpen] = useState(false);

  const {
    period,
    policy,
    roleDrafts,
    staffRows,
    published,
    loading,
    refreshing,
    running,
    error,
    hydrate,
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
      loading: s.loading,
      refreshing: s.refreshing,
      running: s.running,
      error: s.error,
      hydrate: s.hydrate,
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

  const staffCountByRole = useMemo(() => selectStaffCountByRole(staffRows), [staffRows]);
  const staffTotals = useMemo(() => selectStaffTotals(staffRows), [staffRows]);
  const publishedTotals = useMemo(() => selectPublishedTotals(published), [published]);
  const detailPayslip = detailPayslipId ? published.find((p) => p.id === detailPayslipId) : null;

  const showInitialLoader = loading && staffRows.length === 0;

  async function handleRunPayroll() {
    try {
      const count = await runPayroll();
      showToast(`${count} payslips published for ${period?.label ?? "this period"}`, "success");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Payroll run failed", "error");
    }
  }

  return (
    <div className="payroll-workspace">
      <header className="agents-page__header payroll-workspace__header">
        <div>
          <h2>Payroll</h2>
          <p className="muted">
            Cached for fast return visits. Edits update gross and net instantly; background sync keeps
            collections fresh.
            {refreshing ? " · Syncing…" : null}
          </p>
        </div>
        <div className="agents-page__header-actions">
          <button
            type="button"
            className="secondary"
            disabled={showInitialLoader}
            onClick={() => setRoleModalOpen(true)}
          >
            Pay by role
          </button>
          <button
            type="button"
            className="primary"
            disabled={running || showInitialLoader}
            onClick={() => void handleRunPayroll()}
          >
            {running ? "Publishing…" : "Run & publish payroll"}
          </button>
        </div>
      </header>

      {!showInitialLoader && policy ? (
        <>
          <div className="payroll-kpi-row">
            <div className="payroll-kpi">
              <span className="muted">Period</span>
              <strong>{period?.label}</strong>
            </div>
            <div className="payroll-kpi">
              <span className="muted">Staff projected gross</span>
              <strong>{staffTotals.gross.toFixed(2)}</strong>
            </div>
            <div className="payroll-kpi">
              <span className="muted">Staff projected net</span>
              <strong>{staffTotals.net.toFixed(2)}</strong>
            </div>
            <div className="payroll-kpi">
              <span className="muted">Published payslips</span>
              <strong>{published.length}</strong>
            </div>
          </div>

          <div className="payroll-role-summary">
            <span className="muted">Role basics:</span>
            <ul className="payroll-role-chips">
              {roleDrafts.map((d) => (
                <li key={d.role}>
                  <button
                    type="button"
                    className="payroll-role-chip"
                    onClick={() => setRoleModalOpen(true)}
                  >
                    <span>{formatRoleLabel(d.role)}</span>
                    <strong>{parseMoney(d.draftBaseSalary).toLocaleString()}</strong>
                    {staffCountByRole[d.role] ? (
                      <span className="muted">({staffCountByRole[d.role]})</span>
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </>
      ) : null}

      <RolePayrollDefaultsModal open={roleModalOpen} onClose={() => setRoleModalOpen(false)} />

      <section className="payroll-panel">
        <h3>Staff preview (live)</h3>
        <p className="muted payroll-panel__lead">
          Basic, SSNIT, and welfare from role templates. Gross and net update as you type — no reload
          needed.
        </p>

        {showInitialLoader ? (
          <p className="muted">Loading payroll…</p>
        ) : (
          <div className="payroll-table-scroll">
            <table className="payroll-table">
              <thead>
                <tr>
                  <th>Staff</th>
                  <th>Role</th>
                  <th>Basic</th>
                  <th>Collections</th>
                  <th>Gross</th>
                  <th>Deductions</th>
                  <th>Net</th>
                  <th>Loan</th>
                  <th>Comm %</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {staffRows.map((row) => (
                  <tr key={row.userId} className={row.status === "inactive" ? "muted-row" : ""}>
                    <td>
                      <strong>{row.fullName ?? row.email ?? row.userId}</strong>
                    </td>
                    <td>{formatRoleLabel(row.role)}</td>
                    <td className="payroll-num">{row.baseSalary.toFixed(2)}</td>
                    <td className="payroll-num">
                      {row.commissionsApply ? row.collectionsThisPeriod.toFixed(2) : "—"}
                    </td>
                    <td className="payroll-num live-gross">
                      <strong>{row.projectedGross.toFixed(2)}</strong>
                    </td>
                    <td className="payroll-num deduction-amount">
                      −{row.projectedDeductions.toFixed(2)}
                    </td>
                    <td className="payroll-num live-net">
                      <strong>{row.projectedNet.toFixed(2)}</strong>
                    </td>
                    <td>
                      <input
                        className="input-no-spin payroll-input"
                        inputMode="decimal"
                        value={row.draftLoan}
                        onChange={(e) =>
                          patchStaffDraft(row.userId, { draftLoan: e.target.value })
                        }
                      />
                    </td>
                    <td>
                      {row.commissionsApply ? (
                        <input
                          className="input-no-spin payroll-input"
                          inputMode="decimal"
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
                      <button
                        type="button"
                        className="secondary small"
                        disabled={row.saving}
                        onClick={() => void saveStaffRow(row.userId)}
                      >
                        {row.saving ? "…" : "Save"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="payroll-totals-row">
                  <td colSpan={4}>
                    <strong>All staff (projected)</strong>
                  </td>
                  <td className="payroll-num">
                    <strong>{staffTotals.gross.toFixed(2)}</strong>
                  </td>
                  <td className="payroll-num deduction-amount">
                    <strong>−{staffTotals.deductions.toFixed(2)}</strong>
                  </td>
                  <td className="payroll-num">
                    <strong>{staffTotals.net.toFixed(2)}</strong>
                  </td>
                  <td colSpan={3} />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </section>

      <section className="payroll-panel">
        <h3>Published payslips</h3>
        <p className="muted payroll-panel__lead">Full gross and net for every worker after payroll run.</p>

        {published.length === 0 ? (
          <p className="muted">No payslips published for {period?.label ?? "this period"} yet.</p>
        ) : (
          <>
            <div className="payroll-table-scroll">
              <table className="payroll-table payroll-table--published">
                <thead>
                  <tr>
                    <th>Staff</th>
                    <th>Role</th>
                    <th>Gross pay</th>
                    <th>Deductions</th>
                    <th>Net pay</th>
                    <th>Published</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {published.map((p) => {
                    const staff = staffRows.find((r) => r.userId === p.userId);
                    const name = staff?.fullName ?? staff?.email ?? p.userId;
                    return (
                      <tr key={p.id}>
                        <td>
                          <strong>{name}</strong>
                        </td>
                        <td>{formatRoleLabel(p.role)}</td>
                        <td className="payroll-num">
                          <strong>{p.grossPay.toFixed(2)}</strong>
                        </td>
                        <td className="payroll-num deduction-amount">
                          −{p.totalDeductions.toFixed(2)}
                        </td>
                        <td className="payroll-num live-net">
                          <strong>{p.netPay.toFixed(2)}</strong>
                        </td>
                        <td className="muted payroll-published-at">
                          {p.runAt ? new Date(p.runAt).toLocaleDateString() : "—"}
                        </td>
                        <td>
                          <button
                            type="button"
                            className="secondary small"
                            onClick={() =>
                              setDetailPayslipId(detailPayslipId === p.id ? null : p.id)
                            }
                          >
                            {detailPayslipId === p.id ? "Hide" : "Details"}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="payroll-totals-row">
                    <td colSpan={2}>
                      <strong>Total ({published.length} workers)</strong>
                    </td>
                    <td className="payroll-num">
                      <strong>{publishedTotals.gross.toFixed(2)}</strong>
                    </td>
                    <td className="payroll-num deduction-amount">
                      <strong>−{publishedTotals.deductions.toFixed(2)}</strong>
                    </td>
                    <td className="payroll-num">
                      <strong>{publishedTotals.net.toFixed(2)}</strong>
                    </td>
                    <td colSpan={2} />
                  </tr>
                </tfoot>
              </table>
            </div>

            {detailPayslip ? (
              <div className="payroll-detail-drawer">
                <PayslipViewer payslip={detailPayslip} title="Payslip breakdown" />
              </div>
            ) : null}
          </>
        )}
      </section>
    </div>
  );
}
