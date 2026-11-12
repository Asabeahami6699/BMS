import { FormEvent, useCallback, useEffect, useMemo } from "react";
import { Link } from "react-router-dom";
import type { AppRole, BranchFloatSession } from "./api";
import { isFloatTopUpRequest, pendingFloatAmount } from "./api";
import { Modal } from "../components/Modal";
import { useToast } from "../components/Toast";
import { usePageLoading } from "./hooks/usePageLoading";
import { formatBranchLabel } from "./branchDisplay";
import { useTillFloatAdminStore } from "./stores/tillFloatAdminStore";

type Props = { role: AppRole };

function formatMoney(n: number): string {
  return `GHS ${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const STATUS_LABEL: Record<BranchFloatSession["status"], string> = {
  requested: "Requested",
  approved: "Approved",
  open: "Open",
  closed: "Closed — awaiting settle",
  settled: "Settled",
  rejected: "Rejected"
};

export function BranchFloatAdminPage({ role }: Props) {
  const { showToast } = useToast();
  const pending = useTillFloatAdminStore((s) => s.pending);
  const todaySessions = useTillFloatAdminStore((s) => s.todaySessions);
  const branches = useTillFloatAdminStore((s) => s.branches);
  const users = useTillFloatAdminStore((s) => s.users);
  const loading = useTillFloatAdminStore((s) => s.loading);
  const busy = useTillFloatAdminStore((s) => s.busy);
  const error = useTillFloatAdminStore((s) => s.error);
  const allocateAmount = useTillFloatAdminStore((s) => s.allocateAmount);
  const allocateInitialCash = useTillFloatAdminStore((s) => s.allocateInitialCash);
  const pushOpen = useTillFloatAdminStore((s) => s.pushOpen);
  const pushBranchId = useTillFloatAdminStore((s) => s.pushBranchId);
  const pushUserId = useTillFloatAdminStore((s) => s.pushUserId);
  const pushAmount = useTillFloatAdminStore((s) => s.pushAmount);
  const pushInitialCash = useTillFloatAdminStore((s) => s.pushInitialCash);
  const hydrate = useTillFloatAdminStore((s) => s.hydrate);
  const refresh = useTillFloatAdminStore((s) => s.refresh);
  const startLiveSync = useTillFloatAdminStore((s) => s.startLiveSync);
  const stopLiveSync = useTillFloatAdminStore((s) => s.stopLiveSync);
  const setAllocateAmount = useTillFloatAdminStore((s) => s.setAllocateAmount);
  const setAllocateInitialCash = useTillFloatAdminStore((s) => s.setAllocateInitialCash);
  const openPushModal = useTillFloatAdminStore((s) => s.openPushModal);
  const closePushModal = useTillFloatAdminStore((s) => s.closePushModal);
  const setPushBranchId = useTillFloatAdminStore((s) => s.setPushBranchId);
  const setPushUserId = useTillFloatAdminStore((s) => s.setPushUserId);
  const setPushAmount = useTillFloatAdminStore((s) => s.setPushAmount);
  const setPushInitialCash = useTillFloatAdminStore((s) => s.setPushInitialCash);
  const allocate = useTillFloatAdminStore((s) => s.allocate);
  const push = useTillFloatAdminStore((s) => s.push);
  const settle = useTillFloatAdminStore((s) => s.settle);
  const approveExtraCash = useTillFloatAdminStore((s) => s.approveExtraCash);
  const approveExpense = useTillFloatAdminStore((s) => s.approveExpense);

  usePageLoading(loading || busy, "branch-float");

  useEffect(() => {
    hydrate({ force: true });
    startLiveSync();
    return () => stopLiveSync();
  }, [hydrate, startLiveSync, stopLiveSync]);

  useEffect(() => {
    if (error) {
      showToast(error, "error");
    }
  }, [error, showToast]);

  const counterStaff = useMemo(
    () =>
      users.filter(
        (u) =>
          u.status === "active" &&
          (u.role === "teller" || u.role === "coordinator") &&
          (!pushBranchId || u.branchId === pushBranchId || u.scopeType === "head_office")
      ),
    [users, pushBranchId]
  );

  const userLabel = useCallback(
    (userId: string) => {
      const u = users.find((x) => x.userId === userId);
      return u ? `${u.fullName ?? u.email} (${u.role.replace(/_/g, " ")})` : userId.slice(0, 8) + "…";
    },
    [users]
  );

  const branchLabel = useCallback(
    (branchId: string) => formatBranchLabel(branchId, branches),
    [branches]
  );

  async function handleAllocate(session: BranchFloatSession) {
    try {
      await allocate(session);
      showToast(
        isFloatTopUpRequest(session)
          ? "Extra float released — day capital updated"
          : "Till opened with float + physical cash",
        "success"
      );
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Could not release float", "error");
    }
  }

  async function handlePush(e: FormEvent) {
    e.preventDefault();
    try {
      await push();
      showToast("Till opened with float + physical cash for teller", "success");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to push float", "error");
    }
  }

  async function handleSettle(session: BranchFloatSession) {
    try {
      await settle(session);
      showToast("Session settled", "success");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to settle", "error");
    }
  }

  async function handleApproveExtraCash(session: BranchFloatSession) {
    try {
      await approveExtraCash(session);
      showToast("Extra cash approved", "success");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Could not approve extra cash", "error");
    }
  }

  async function handleApproveExpense(session: BranchFloatSession) {
    try {
      await approveExpense(session);
      showToast("Expense approved", "success");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Could not approve expense", "error");
    }
  }

  const closedAwaitingSettle = todaySessions.filter((s) => s.status === "closed");

  return (
    <div className="branch-float-admin">
      <header className="overview-hero">
        <div>
          <p className="overview-hero__eyebrow">Susu management</p>
          <h1 className="overview-hero__title">Till float</h1>
          <p className="overview-hero__sub muted">
            Open teller tills with separate float capacity and physical cash (cash may be GHS 0). Day
            capital = float + initial cash + extra cash. Tellers work from{" "}
            <Link to="/app/susu/collections">Branch counter</Link>.
          </p>
        </div>
        <button
          type="button"
          className="button secondary"
          disabled={loading || busy}
          onClick={() => void refresh()}
        >
          {loading ? "Loading…" : "Refresh"}
        </button>
      </header>

      {role !== "admin" && role !== "coordinator" ? (
        <p className="muted">Only admin or coordinator can manage till float.</p>
      ) : (
        <>
          <section className="overview-panel branch-float-admin__push">
            <div className="branch-float-admin__push-header">
              <div>
                <h2 className="overview-panel__title">Push float + cash</h2>
                <p className="overview-panel__lead muted">
                  Open a teller&apos;s till for today without a request. Float is deposit capacity;
                  initial cash is physical notes (use 0 if none yet).
                </p>
              </div>
              <button
                type="button"
                className="button"
                disabled={busy || branches.length === 0}
                onClick={openPushModal}
              >
                Push &amp; open till
              </button>
            </div>
          </section>

          <Modal
            open={pushOpen}
            onClose={() => !busy && closePushModal()}
            title="Push float + cash"
            subtitle="Open a teller's till for today — no request needed"
            panelClassName="modal-panel--till-movement"
            footer={
              <>
                <button
                  type="button"
                  className="button secondary"
                  disabled={busy}
                  onClick={closePushModal}
                >
                  Cancel
                </button>
                <button type="submit" form="push-float-form" className="button" disabled={busy}>
                  {busy ? "Opening…" : "Push & open till"}
                </button>
              </>
            }
          >
            <form
              id="push-float-form"
              className="till-movement-form"
              onSubmit={(e) => void handlePush(e)}
            >
              <p className="muted till-movement-form__hint">
                Float is deposit capacity. Initial cash is physical notes handed over — use 0 if none
                yet. Day capital = float + initial cash.
              </p>
              <label className="field">
                <span>Branch</span>
                <select
                  value={pushBranchId}
                  onChange={(e) => setPushBranchId(e.target.value)}
                  required
                >
                  <option value="">Select branch</option>
                  {branches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name} ({b.code})
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Teller / coordinator</span>
                <select
                  value={pushUserId}
                  onChange={(e) => setPushUserId(e.target.value)}
                  required
                >
                  <option value="">Select staff</option>
                  {counterStaff.map((u) => (
                    <option key={u.userId} value={u.userId}>
                      {u.fullName ?? u.email} — {u.role.replace(/_/g, " ")}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Opening float (GHS)</span>
                <input
                  type="number"
                  className="input-no-spin"
                  min={0}
                  step="0.01"
                  value={pushAmount}
                  onChange={(e) => setPushAmount(e.target.value)}
                  placeholder="0.00"
                  required
                  autoFocus
                />
              </label>
              <label className="field">
                <span>Initial physical cash (GHS)</span>
                <input
                  type="number"
                  className="input-no-spin"
                  min={0}
                  step="0.01"
                  value={pushInitialCash}
                  onChange={(e) => setPushInitialCash(e.target.value)}
                  placeholder="0.00"
                  required
                />
              </label>
            </form>
          </Modal>

          <section className="overview-panel">
            <h2 className="overview-panel__title">
              Pending requests
              {pending.length > 0 ? (
                <span className="branch-float-admin__badge">{pending.length}</span>
              ) : null}
            </h2>
            {loading ? (
              <p className="muted">Loading…</p>
            ) : pending.length === 0 ? (
              <p className="muted">No pending float requests right now.</p>
            ) : (
              <ul className="branch-float__pending-list">
                {pending.map((s) => (
                  <li key={s.id} className="branch-float__pending-item">
                    <div>
                      <strong>{userLabel(s.cashierUserId)}</strong>
                      <p className="muted">
                        {branchLabel(s.branchId)} · {s.businessDate} ·{" "}
                        {isFloatTopUpRequest(s) ? "top-up" : "requested"}{" "}
                        {formatMoney(pendingFloatAmount(s))}
                      </p>
                      {isFloatTopUpRequest(s) && s.topUpNote ? (
                        <p className="muted">{s.topUpNote}</p>
                      ) : null}
                      {!isFloatTopUpRequest(s) && s.requestedNote ? (
                        <p className="muted">{s.requestedNote}</p>
                      ) : null}
                    </div>
                    <div className="branch-float__pending-actions">
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        className="input-no-spin branch-float__allocate-input"
                        title="Float amount"
                        placeholder="Float"
                        value={allocateAmount[s.id] ?? String(pendingFloatAmount(s))}
                        onChange={(e) => setAllocateAmount(s.id, e.target.value)}
                      />
                      {!isFloatTopUpRequest(s) ? (
                        <input
                          type="number"
                          min={0}
                          step="0.01"
                          className="input-no-spin branch-float__allocate-input"
                          title="Initial physical cash"
                          placeholder="Initial cash"
                          value={allocateInitialCash[s.id] ?? String(s.initialCash ?? 0)}
                          onChange={(e) => setAllocateInitialCash(s.id, e.target.value)}
                        />
                      ) : null}
                      {s.status === "requested" || isFloatTopUpRequest(s) ? (
                        <button
                          type="button"
                          className="button"
                          disabled={busy}
                          onClick={() => void handleAllocate(s)}
                        >
                          {isFloatTopUpRequest(s) ? "Approve float" : "Approve & open"}
                        </button>
                      ) : null}
                      {(s.extraCashRequested ?? 0) > 0 ? (
                        <button
                          type="button"
                          className="button"
                          disabled={busy}
                          onClick={() => void handleApproveExtraCash(s)}
                        >
                          Approve cash {formatMoney(s.extraCashRequested ?? 0)}
                        </button>
                      ) : null}
                      {(s.expenseRequested ?? 0) > 0 ? (
                        <button
                          type="button"
                          className="button secondary"
                          disabled={busy}
                          onClick={() => void handleApproveExpense(s)}
                        >
                          Approve expense {formatMoney(s.expenseRequested ?? 0)}
                        </button>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {closedAwaitingSettle.length > 0 ? (
            <section className="overview-panel">
              <h2 className="overview-panel__title">Closed — awaiting settlement</h2>
              <ul className="branch-float__pending-list">
                {closedAwaitingSettle.map((s) => (
                  <li key={s.id} className="branch-float__pending-item">
                    <div>
                      <strong>{userLabel(s.cashierUserId)}</strong>
                      <p className="muted">
                        {branchLabel(s.branchId)} · expected {formatMoney(s.expectedClosing ?? 0)} ·
                        actual {formatMoney(s.actualClosing ?? 0)} · variance{" "}
                        {formatMoney(s.variance ?? 0)}
                      </p>
                    </div>
                    <button
                      type="button"
                      className="button secondary"
                      disabled={busy}
                      onClick={() => void handleSettle(s)}
                    >
                      Settle
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <section className="overview-panel">
            <h2 className="overview-panel__title">Today&apos;s till sessions</h2>
            {todaySessions.length === 0 ? (
              <p className="muted">No float sessions for today yet.</p>
            ) : (
              <div className="admin-table-wrap">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>Staff</th>
                      <th>Branch</th>
                      <th>Status</th>
                      <th>Float</th>
                      <th>Cash / capital</th>
                      <th>Expected</th>
                      <th>Variance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {todaySessions.map((s) => (
                      <tr key={s.id}>
                        <td>{userLabel(s.cashierUserId)}</td>
                        <td>{branchLabel(s.branchId)}</td>
                        <td>{STATUS_LABEL[s.status]}</td>
                        <td>{formatMoney(s.openingFloat)}</td>
                        <td>
                          {formatMoney((s.initialCash ?? 0) + (s.extraCash ?? 0))}
                          <span className="muted">
                            {" "}
                            / {formatMoney(s.openingFloat + (s.initialCash ?? 0) + (s.extraCash ?? 0))}
                          </span>
                        </td>
                        <td>
                          {s.status === "open" || s.status === "closed" || s.status === "settled"
                            ? formatMoney(s.expectedClosing ?? 0)
                            : "—"}
                        </td>
                        <td>{s.variance != null ? formatMoney(s.variance) : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
