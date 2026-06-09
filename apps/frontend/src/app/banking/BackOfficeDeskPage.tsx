import { useEffect, useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { hasAnyPermission } from "@bms/shared";
import { useAuth } from "../../auth/AuthContext";
import { useToast } from "../../components/Toast";
import { toUserFacingError } from "../../lib/networkError";
import { useBranchesLiveSync } from "../hooks/useBranchesLiveSync";
import { useBackOfficeStore } from "../stores/backOfficeStore";
import { useBranchesStore } from "../stores/branchesStore";
import { formatWorkspaceMoney } from "../stores/roleWorkspaceStore";
import { getRoleDeskConfig } from "./roleDeskConfig";
import { RoleDeskShell } from "./RoleDeskShell";

type Props = { displayName?: string };

function statusLabel(status: string): string {
  if (status === "pending_bank") return "Pending";
  if (status === "pending_accountant") return "Awaiting accountant";
  return status;
}

export function BackOfficeDeskPage({ displayName }: Props) {
  const config = getRoleDeskConfig("back_officer");
  const { user } = useAuth();
  const { showToast } = useToast();
  useBranchesLiveSync();

  const branches = useBranchesStore((s) => s.branches);

  const {
    data,
    branchId,
    businessDate,
    loading,
    busyId,
    error,
    lastFetchedAt,
    executionAccountByDeposit,
    hydrate,
    refresh,
    setBranchId,
    setBusinessDate,
    setExecutionAccount,
    openDay,
    markDepositDone,
    approveAccountantDeposit,
    approveEcash,
    requestEcash,
    saveManualEntries,
    startLiveSync,
    stopLiveSync
  } = useBackOfficeStore(
    useShallow((s) => ({
      data: s.data,
      branchId: s.branchId,
      businessDate: s.businessDate,
      loading: s.loading,
      busyId: s.busyId,
      error: s.error,
      lastFetchedAt: s.lastFetchedAt,
      executionAccountByDeposit: s.executionAccountByDeposit,
      hydrate: s.hydrate,
      refresh: s.refresh,
      setBranchId: s.setBranchId,
      setBusinessDate: s.setBusinessDate,
      setExecutionAccount: s.setExecutionAccount,
      openDay: s.openDay,
      markDepositDone: s.markDepositDone,
      approveAccountantDeposit: s.approveAccountantDeposit,
      approveEcash: s.approveEcash,
      requestEcash: s.requestEcash,
      saveManualEntries: s.saveManualEntries,
      startLiveSync: s.startLiveSync,
      stopLiveSync: s.stopLiveSync
    }))
  );

  const [openingsDraft, setOpeningsDraft] = useState<Record<string, { opening: string; ecash: string }>>(
    {}
  );
  const [ecashAmount, setEcashAmount] = useState("");
  const [ecashNotes, setEcashNotes] = useState("");
  const [entriesDraft, setEntriesDraft] = useState<Record<string, string>>({});

  useEffect(() => {
    hydrate({ force: true, fallbackBranchId: user?.branchId });
    startLiveSync();
    return () => stopLiveSync();
  }, [hydrate, startLiveSync, stopLiveSync, user?.branchId]);

  useEffect(() => {
    if (!branchId && branches.length > 0) {
      const preferred =
        user?.branchId && branches.some((b) => b.id === user.branchId)
          ? user.branchId
          : branches[0].id;
      setBranchId(preferred);
    }
  }, [branchId, branches, user?.branchId, setBranchId]);

  useEffect(() => {
    if (!data?.companyAccounts.length) return;
    setOpeningsDraft((prev) => {
      const next = { ...prev };
      for (const account of data.companyAccounts) {
        if (!next[account.id]) {
          next[account.id] = { opening: "", ecash: "0" };
        }
      }
      return next;
    });
  }, [data?.companyAccounts]);

  const kpis = useMemo(
    () => [
      {
        label: "Pending deposits",
        value: data?.depositQueue.length ?? 0,
        tone: "warning" as const
      },
      {
        label: "Awaiting accountant",
        value: data?.pendingAccountantCount ?? 0,
        tone: "primary" as const
      },
      {
        label: "Ecash requests",
        value: data?.pendingEcashCount ?? 0,
        tone: "success" as const
      }
    ],
    [data]
  );

  const updatedLabel = lastFetchedAt
    ? `Updated ${new Date(lastFetchedAt).toLocaleTimeString()}`
    : undefined;

  async function handleOpenDay() {
    if (!branchId || !data?.companyAccounts.length) return;
    try {
      await openDay({
        branchId,
        businessDate,
        openings: data.companyAccounts.map((account) => ({
          bankProductId: account.id,
          openingBalance: Number(openingsDraft[account.id]?.opening ?? 0),
          extraCash: Number(openingsDraft[account.id]?.ecash ?? 0)
        }))
      });
      showToast("Back office day opened", "success");
    } catch (err) {
      showToast(toUserFacingError(err, "Could not open day"), "error");
    }
  }

  async function handleDone(transactionId: string) {
    try {
      await markDepositDone(transactionId);
      showToast("Deposit marked done — teller notified", "success");
    } catch (err) {
      showToast(toUserFacingError(err, "Could not complete deposit"), "error");
    }
  }

  async function handleEcashRequest() {
    if (!branchId) return;
    const amount = Number(ecashAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      showToast("Enter a valid ecash amount", "error");
      return;
    }
    try {
      await requestEcash({ branchId, amount, notes: ecashNotes || undefined });
      setEcashAmount("");
      setEcashNotes("");
      showToast("Ecash request sent to accountant", "success");
    } catch (err) {
      showToast(toUserFacingError(err, "Ecash request failed"), "error");
    }
  }

  async function handleSaveEntries(bankProductId: string) {
    const value = Number(entriesDraft[bankProductId]);
    if (!Number.isFinite(value) || value < 0) {
      showToast("Enter a valid total entries amount", "error");
      return;
    }
    try {
      await saveManualEntries(bankProductId, value);
      showToast("Total entries saved", "success");
    } catch (err) {
      showToast(toUserFacingError(err, "Save failed"), "error");
    }
  }

  const defaultExecutionAccount = data?.companyAccounts[0]?.id ?? "";
  const canAccountantApprove = hasAnyPermission(user?.permissions, ["treasury.read"]);

  return (
    <RoleDeskShell
      config={config}
      displayName={displayName}
      updatedLabel={updatedLabel}
      error={error}
      loading={loading && !data}
      kpis={data || loading ? kpis : undefined}
      onRefresh={() => void refresh()}
      refreshing={loading}
    >
      <section className="card role-workspace__panel">
        <header className="role-workspace__panel-head">
          <div>
            <h3>Day setup</h3>
            <p className="muted">
              Open with company account balances and ecash. Admin marks bank products as company
              accounts on the Bank Products page.
            </p>
          </div>
        </header>
        <div className="back-office-filters">
          {branches.length > 0 ? (
            <label className="field">
              <span>Branch</span>
              <select value={branchId} onChange={(e) => setBranchId(e.target.value)}>
                <option value="">Select branch…</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <label className="field">
            <span>Business date</span>
            <input type="date" value={businessDate} onChange={(e) => setBusinessDate(e.target.value)} />
          </label>
        </div>

        {!data?.sessionOpen ? (
          data?.companyAccounts.length === 0 ? (
            <p className="muted">No company bank accounts configured. Ask admin to mark bank products.</p>
          ) : (
            <div className="back-office-open-grid">
              {data.companyAccounts.map((account) => (
                <div key={account.id} className="back-office-open-row">
                  <strong>
                    {account.bankLabel} — {account.name}
                  </strong>
                  <label className="field">
                    <span>Opening balance (GHS)</span>
                    <input
                      type="number"
                      min={0}
                      step={0.01}
                      value={openingsDraft[account.id]?.opening ?? ""}
                      onChange={(e) =>
                        setOpeningsDraft((prev) => ({
                          ...prev,
                          [account.id]: { ...prev[account.id], opening: e.target.value, ecash: prev[account.id]?.ecash ?? "0" }
                        }))
                      }
                    />
                  </label>
                  <label className="field">
                    <span>Ecash received (GHS)</span>
                    <input
                      type="number"
                      min={0}
                      step={0.01}
                      value={openingsDraft[account.id]?.ecash ?? "0"}
                      onChange={(e) =>
                        setOpeningsDraft((prev) => ({
                          ...prev,
                          [account.id]: { opening: prev[account.id]?.opening ?? "", ecash: e.target.value }
                        }))
                      }
                    />
                  </label>
                </div>
              ))}
              <button
                type="button"
                className="btn primary"
                disabled={busyId === "open-day"}
                onClick={() => void handleOpenDay()}
              >
                {busyId === "open-day" ? "Opening…" : "Start day"}
              </button>
            </div>
          )
        ) : (
          <p className="muted role-workspace__pill">Day session open for {businessDate}</p>
        )}

        <div className="back-office-ecash-request">
          <h4>Request extra ecash from accountant</h4>
          <div className="back-office-filters">
            <label className="field">
              <span>Amount (GHS)</span>
              <input
                type="number"
                min={0.01}
                step={0.01}
                value={ecashAmount}
                onChange={(e) => setEcashAmount(e.target.value)}
              />
            </label>
            <label className="field">
              <span>Notes</span>
              <input type="text" value={ecashNotes} onChange={(e) => setEcashNotes(e.target.value)} />
            </label>
            <button
              type="button"
              className="button secondary"
              disabled={busyId === "ecash"}
              onClick={() => void handleEcashRequest()}
            >
              Request ecash
            </button>
          </div>
        </div>
      </section>

      {canAccountantApprove &&
      ((data?.pendingAccountantCount ?? 0) > 0 || (data?.pendingEcashCount ?? 0) > 0) ? (
        <section className="card role-workspace__panel role-workspace__panel--accent">
          <h3>Accountant approvals</h3>
          <p className="muted">Large deposits and ecash requests need your action.</p>
          <div className="role-workspace__queue">
            {data?.depositQueue
              .filter((row) => row.executionStatus === "pending_accountant")
              .map((row) => (
                <article key={row.id} className="role-workspace__queue-row">
                  <div className="role-workspace__queue-main">
                    <strong>Large deposit — {row.customerName}</strong>
                    <span>{formatWorkspaceMoney(row.amount)}</span>
                  </div>
                  <button
                    type="button"
                    className="btn primary"
                    disabled={busyId === row.id}
                    onClick={() =>
                      void approveAccountantDeposit(row.id)
                        .then(() => showToast("Deposit approved for back office", "success"))
                        .catch((err) =>
                          showToast(toUserFacingError(err, "Approval failed"), "error")
                        )
                    }
                  >
                    Approve
                  </button>
                </article>
              ))}
            {data?.ecashRequests
              .filter((r) => r.status === "pending")
              .map((r) => (
                <article key={r.id} className="role-workspace__queue-row">
                  <div className="role-workspace__queue-main">
                    <strong>Ecash request</strong>
                    <span>{formatWorkspaceMoney(r.amount)}</span>
                  </div>
                  <div className="role-workspace__queue-actions">
                    <button
                      type="button"
                      className="btn primary"
                      disabled={busyId === r.id}
                      onClick={() =>
                        void approveEcash(r.id, true)
                          .then(() => showToast("Ecash approved", "success"))
                          .catch((err) =>
                            showToast(toUserFacingError(err, "Approval failed"), "error")
                          )
                      }
                    >
                      Approve
                    </button>
                    <button
                      type="button"
                      className="button secondary"
                      disabled={busyId === r.id}
                      onClick={() =>
                        void approveEcash(r.id, false)
                          .then(() => showToast("Ecash declined", "success"))
                          .catch((err) =>
                            showToast(toUserFacingError(err, "Decline failed"), "error")
                          )
                      }
                    >
                      Decline
                    </button>
                  </div>
                </article>
              ))}
          </div>
        </section>
      ) : null}

      <section className="card role-workspace__panel">
        <header className="role-workspace__panel-head">
          <div>
            <h3>Teller deposit queue</h3>
            <p className="muted">
              All teller deposits arrive as Pending. Select the company account used at the bank,
              then click Done — teller status updates to completed.
            </p>
          </div>
        </header>

        {(data?.depositQueue.length ?? 0) === 0 ? (
          <p className="muted role-workspace__empty">No pending teller deposits.</p>
        ) : (
          <div className="role-workspace__queue">
            {data?.depositQueue.map((row, index) => (
              <article
                key={row.id}
                className="role-workspace__queue-row role-workspace__queue-row--tall"
                style={{ animationDelay: `${index * 0.05}s` }}
              >
                <div className="role-workspace__queue-main">
                  <strong>{row.customerName ?? "Customer"}</strong>
                  <span>{formatWorkspaceMoney(row.amount)}</span>
                </div>
                <div className="role-workspace__queue-meta muted">
                  <span className="role-workspace__pill">{statusLabel(row.executionStatus)}</span>
                  <span>Teller: {row.recordedByName ?? row.recordedByUserId}</span>
                  {row.bankLabel ? (
                    <span>
                      {row.bankLabel}
                      {row.bankProductName ? ` — ${row.bankProductName}` : ""}
                    </span>
                  ) : null}
                  <span>{new Date(row.createdAt).toLocaleString()}</span>
                </div>
                {row.executionStatus === "pending_bank" ? (
                  <>
                    <label className="field">
                      <span>Company account used at bank</span>
                      <select
                        value={executionAccountByDeposit[row.id] ?? defaultExecutionAccount}
                        disabled={busyId === row.id}
                        onChange={(e) => setExecutionAccount(row.id, e.target.value)}
                      >
                        {(data?.companyAccounts ?? []).map((account) => (
                          <option key={account.id} value={account.id}>
                            {account.bankLabel} — {account.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <button
                      type="button"
                      className="btn primary"
                      disabled={busyId === row.id || !data?.sessionOpen}
                      onClick={() => void handleDone(row.id)}
                    >
                      {busyId === row.id ? "Saving…" : "Done"}
                    </button>
                  </>
                ) : (
                  <p className="muted">Waiting for accountant approval before execution.</p>
                )}
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="card role-workspace__panel">
        <header className="role-workspace__panel-head">
          <div>
            <h3>Bank account balancing</h3>
            <p className="muted">Opening + ecash − total entries = closing balance per company account.</p>
          </div>
        </header>
        {(data?.accountBalances.length ?? 0) === 0 ? (
          <p className="muted">Open the day to see account balances.</p>
        ) : (
          <div className="back-office-table-wrap">
            <table className="back-office-table">
              <thead>
                <tr>
                  <th>Account</th>
                  <th>Opening</th>
                  <th>+ Ecash</th>
                  <th>Total entries</th>
                  <th>= Closing</th>
                </tr>
              </thead>
              <tbody>
                {data?.accountBalances.map((row) => (
                  <tr key={row.bankProductId}>
                    <td>
                      <strong>{row.bankLabel}</strong>
                      <span className="muted back-office-table__sub">{row.accountName}</span>
                    </td>
                    <td>{formatWorkspaceMoney(row.openingBalance)}</td>
                    <td>{formatWorkspaceMoney(row.extraCash)}</td>
                    <td>
                      <div className="back-office-entries-cell">
                        <span className="muted">Auto: {formatWorkspaceMoney(row.computedTotalEntries)}</span>
                        <input
                          type="number"
                          min={0}
                          step={0.01}
                          placeholder="Manual override"
                          value={entriesDraft[row.bankProductId] ?? String(row.manualTotalEntries ?? "")}
                          onChange={(e) =>
                            setEntriesDraft((prev) => ({
                              ...prev,
                              [row.bankProductId]: e.target.value
                            }))
                          }
                        />
                        <button
                          type="button"
                          className="button-link"
                          disabled={busyId === row.bankProductId}
                          onClick={() => void handleSaveEntries(row.bankProductId)}
                        >
                          Save
                        </button>
                      </div>
                    </td>
                    <td>
                      <strong>{formatWorkspaceMoney(row.closingBalance)}</strong>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card role-workspace__panel">
        <header className="role-workspace__panel-head">
          <div>
            <h3>Back office vs teller</h3>
            <p className="muted">Teller deposits recorded vs back office executed — should match per teller.</p>
          </div>
        </header>
        {(data?.tellerReconciliation.length ?? 0) === 0 ? (
          <p className="muted">No teller activity for this date.</p>
        ) : (
          <div className="back-office-table-wrap">
            <table className="back-office-table">
              <thead>
                <tr>
                  <th>Teller</th>
                  <th>Teller deposits</th>
                  <th>Back office executed</th>
                  <th>Difference</th>
                  <th>Count</th>
                </tr>
              </thead>
              <tbody>
                {data?.tellerReconciliation.map((row) => (
                  <tr key={row.tellerUserId}>
                    <td>{row.tellerName}</td>
                    <td>{formatWorkspaceMoney(row.tellerDeposits)}</td>
                    <td>{formatWorkspaceMoney(row.backOfficeExecuted)}</td>
                    <td
                      className={
                        row.difference !== 0 ? "back-office-diff--warn" : "back-office-diff--ok"
                      }
                    >
                      {formatWorkspaceMoney(row.difference)}
                    </td>
                    <td className="muted">
                      {row.depositCount} / {row.executedCount}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </RoleDeskShell>
  );
}
