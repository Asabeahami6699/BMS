import { useEffect, useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { bankProductAppliesToBranch, hasAnyPermission, type OpenBackOfficeDayInput } from "@bms/shared";
import { useAuth } from "../../auth/AuthContext";
import { useToast } from "../../components/Toast";
import { toUserFacingError } from "../../lib/networkError";
import { useBranchesLiveSync } from "../hooks/useBranchesLiveSync";
import { useBackOfficeStore } from "../stores/backOfficeStore";
import { useBranchesStore } from "../stores/branchesStore";
import { formatWorkspaceMoney } from "../stores/roleWorkspaceStore";
import {
  BackOfficeBalancingEntryModal,
  type BalancingEntryMode
} from "./BackOfficeBalancingEntryModal";
import { getRoleDeskConfig } from "./roleDeskConfig";
import { RoleDeskShell } from "./RoleDeskShell";

type Props = { displayName?: string };

function statusLabel(status: string): string {
  if (status === "pending_bank") return "Pending";
  if (status === "pending_accountant") return "Awaiting accountant";
  return status;
}

function branchLabel(name?: string, code?: string): string {
  if (!name) return "—";
  return code ? `${name} (${code})` : name;
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
      startLiveSync: s.startLiveSync,
      stopLiveSync: s.stopLiveSync
    }))
  );

  const [balancingEntryMode, setBalancingEntryMode] = useState<BalancingEntryMode | null>(null);

  useEffect(() => {
    hydrate({
      force: true,
      fallbackBranchId: user?.scopeType === "head_office" ? "all" : user?.branchId
    });
    startLiveSync();
    return () => stopLiveSync();
  }, [hydrate, startLiveSync, stopLiveSync, user?.branchId, user?.scopeType]);

  const isHeadOffice = user?.scopeType === "head_office";
  const viewingAllBranches = branchId === "all" || Boolean(data?.viewAllBranches);

  useEffect(() => {
    if (branchId || branches.length === 0) return;
    const preferred = isHeadOffice
      ? "all"
      : user?.branchId && branches.some((b) => b.id === user.branchId)
        ? user.branchId
        : branches[0].id;
    setBranchId(preferred);
  }, [branchId, branches, isHeadOffice, user?.branchId, setBranchId]);

  const companyAccounts = data?.companyAccounts ?? [];
  const canRunDayOps = Boolean(branchId && branchId !== "all" && !viewingAllBranches);
  const canViewBalances = canRunDayOps || viewingAllBranches;
  const depositQueue = data?.depositQueue ?? [];
  const accountBalances = data?.accountBalances ?? [];
  const ecashRequests = data?.ecashRequests ?? [];
  const tellerReconciliation = data?.tellerReconciliation ?? [];
  const sessionOpen = Boolean(data?.sessionOpen);

  const kpis = useMemo(
    () => [
      { label: "Pending deposits", value: depositQueue.length, tone: "warning" as const },
      {
        label: "Awaiting accountant",
        value: data?.pendingAccountantCount ?? 0,
        tone: "primary" as const
      },
      { label: "Ecash requests", value: data?.pendingEcashCount ?? 0, tone: "success" as const }
    ],
    [data, depositQueue.length]
  );

  const updatedLabel = lastFetchedAt
    ? `Updated ${new Date(lastFetchedAt).toLocaleTimeString()}`
    : undefined;

  function depositBranchLabel(row: (typeof depositQueue)[0]): string {
    if (row.branchName) {
      return row.branchCode ? `${row.branchName} (${row.branchCode})` : row.branchName;
    }
    const branch = branches.find((b) => b.id === row.transactionBranchId);
    return branch ? `${branch.name} (${branch.code})` : "—";
  }

  async function handleOpenDay(payload: OpenBackOfficeDayInput) {
    try {
      await openDay(payload);
      showToast("Opening balances saved — day started", "success");
    } catch (err) {
      showToast(toUserFacingError(err, "Could not open day"), "error");
      throw err;
    }
  }

  function companyAccountsForBranch(transactionBranchId: string) {
    return companyAccounts.filter((account) =>
      bankProductAppliesToBranch({ branchId: account.branchId ?? undefined }, transactionBranchId)
    );
  }

  async function handleDone(transactionId: string, accountId: string) {
    if (!accountId?.trim()) {
      showToast(
        "No company account for this branch — add one under Bank Products → Company accounts",
        "error"
      );
      return;
    }
    try {
      await markDepositDone(transactionId, accountId.trim());
      showToast("Deposit marked done — teller notified", "success");
    } catch (err) {
      showToast(toUserFacingError(err, "Could not complete deposit"), "error");
    }
  }

  async function handleEcashRequest(payload: {
    amount: number;
    notes?: string;
    bankProductId?: string;
  }) {
    if (!branchId || branchId === "all") return;
    try {
      await requestEcash({ branchId, ...payload });
      showToast("Ecash request sent to accountant", "success");
    } catch (err) {
      showToast(toUserFacingError(err, "Ecash request failed"), "error");
      throw err;
    }
  }

  const canAccountantApprove = hasAnyPermission(user?.permissions, ["treasury.read"]);

  return (
    <RoleDeskShell
      config={config}
      displayName={displayName}
      updatedLabel={updatedLabel}
      error={error}
      loading={false}
      kpis={data || loading ? kpis : undefined}
      onRefresh={() => void refresh()}
      refreshing={loading}
    >
      {branches.length > 0 ? (
        <section className="card role-workspace__panel back-office-workspace-filters">
          <div className="back-office-balancing-head__filters">
            <label className="field">
              <span>Branch</span>
              <select value={branchId} onChange={(e) => setBranchId(e.target.value)}>
                <option value="">Select branch…</option>
                {isHeadOffice ? <option value="all">All branches</option> : null}
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name} ({b.code})
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Business date</span>
              <input
                type="date"
                value={businessDate}
                onChange={(e) => setBusinessDate(e.target.value)}
              />
            </label>
          </div>
          <p className="muted back-office-workspace-filters__hint">
            {viewingAllBranches
              ? "All branches — deposit queue, balances, and teller reconciliation across every branch. Pick one branch to enter opening balances or ecash."
              : "Filters apply to the deposit queue, account balances, and teller reconciliation below."}
          </p>
        </section>
      ) : null}

      {canAccountantApprove &&
      ((data?.pendingAccountantCount ?? 0) > 0 || (data?.pendingEcashCount ?? 0) > 0) ? (
        <section className="card role-workspace__panel role-workspace__panel--accent">
          <h3>Accountant approvals</h3>
          <p className="muted">Large deposits and ecash requests need your action.</p>
          <div className="role-workspace__queue">
            {depositQueue
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
            {ecashRequests
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

      <section className="card role-workspace__panel agency-deposit-table-card">
        <header className="agency-deposit-table-card__head role-workspace__panel-head">
          <div>
            <p className="agency-deposit-table-card__eyebrow">Execution queue</p>
            <h3>Teller deposit queue</h3>
            <p className="muted">
              Pick the company account used at the bank, then click Done — teller status updates
              immediately.
              {viewingAllBranches ? " Set branch above to filter this queue." : ""}
            </p>
          </div>
          <span className="agency-deposit-table-card__stat agency-deposit-table-card__stat--pending">
            {depositQueue.length} awaiting action
          </span>
        </header>

        {depositQueue.length === 0 ? (
          <p className="muted agency-deposit-table-card__empty">
            No pending teller deposits
            {viewingAllBranches ? " across any branch" : " for this branch"}.
          </p>
        ) : (
          <div className="agency-deposit-table-wrap">
            <table className="agency-deposit-table agency-deposit-table--actions">
              <thead>
                <tr>
                  <th>Recorded</th>
                  <th>Branch</th>
                  <th>Customer</th>
                  <th>Account</th>
                  <th>Teller</th>
                  <th>Bank product</th>
                  <th className="agency-deposit-table__num">Amount</th>
                  <th>Status</th>
                  <th>Company account</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {depositQueue.map((row) => {
                  const canExecute = row.executionStatus === "pending_bank";
                  const rowCompanyAccounts = companyAccountsForBranch(row.transactionBranchId);
                  const rowDefaultAccount = rowCompanyAccounts[0]?.id ?? "";
                  const selectedAccount =
                    executionAccountByDeposit[row.id] ?? rowDefaultAccount;
                  return (
                    <tr
                      key={row.id}
                      className={
                        canExecute
                          ? "agency-deposit-table__row agency-deposit-table__row--pending"
                          : "agency-deposit-table__row"
                      }
                    >
                      <td className="agency-deposit-table__time muted">
                        {new Date(row.createdAt).toLocaleString(undefined, {
                          month: "short",
                          day: "numeric",
                          hour: "2-digit",
                          minute: "2-digit"
                        })}
                      </td>
                      <td>
                        <span className="agency-deposit-table__branch">
                          {depositBranchLabel(row)}
                        </span>
                      </td>
                      <td>
                        <strong className="agency-deposit-table__customer">
                          {row.customerName ?? "Customer"}
                        </strong>
                      </td>
                      <td className="muted agency-deposit-table__account">
                        {row.partnerAccountNumber ?? "—"}
                      </td>
                      <td className="muted">{row.recordedByName ?? row.recordedByUserId}</td>
                      <td className="muted">
                        {row.bankLabel
                          ? `${row.bankLabel}${row.bankProductName ? ` · ${row.bankProductName}` : ""}`
                          : "—"}
                      </td>
                      <td className="agency-deposit-table__num agency-deposit-table__amount">
                        {formatWorkspaceMoney(row.amount)}
                      </td>
                      <td>
                        <span
                          className={`teller-deposit-status__badge teller-deposit-status__badge--${
                            row.executionStatus === "pending_accountant" ? "warning" : "pending"
                          }`}
                        >
                          {statusLabel(row.executionStatus)}
                        </span>
                      </td>
                      <td>
                        {canExecute ? (
                          <select
                            className="agency-deposit-table__select"
                            value={selectedAccount}
                            disabled={busyId === row.id || rowCompanyAccounts.length === 0}
                            onChange={(e) => setExecutionAccount(row.id, e.target.value)}
                            aria-label={`Company account for ${row.customerName ?? "deposit"}`}
                          >
                            {rowCompanyAccounts.length === 0 ? (
                              <option value="">No account for {depositBranchLabel(row)}</option>
                            ) : (
                              rowCompanyAccounts.map((account) => (
                                <option key={account.id} value={account.id}>
                                  {account.bankLabel} — {account.name}
                                  {account.branchName ? ` (${account.branchName})` : ""}
                                </option>
                              ))
                            )}
                          </select>
                        ) : (
                          <span className="muted">Accountant first</span>
                        )}
                      </td>
                      <td className="agency-deposit-table__action">
                        {canExecute ? (
                          <button
                            type="button"
                            className="btn primary agency-deposit-table__done-btn"
                            disabled={
                              busyId === row.id ||
                              rowCompanyAccounts.length === 0 ||
                              !selectedAccount
                            }
                            onClick={() => void handleDone(row.id, selectedAccount)}
                          >
                            {busyId === row.id ? "…" : "Done"}
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card role-workspace__panel agency-deposit-table-card">
        <header className="agency-deposit-table-card__head role-workspace__panel-head">
          <div className="back-office-balancing-head">
            <div>
              <h3>Bank account balancing</h3>
              <p className="muted">
                Opening + ecash − total entries = closing. Total entries update live as deposits are
                marked done.
                {sessionOpen ? ` Day open for ${businessDate}.` : ""}
              </p>
            </div>
          </div>
          {canRunDayOps ? (
            <div className="back-office-balancing-actions">
              <button
                type="button"
                className="back-office-balancing-actions__btn back-office-balancing-actions__btn--opening"
                disabled={companyAccounts.length === 0 || busyId === "open-day"}
                onClick={() => setBalancingEntryMode("opening")}
              >
                <strong>{sessionOpen ? "Update balances" : "Opening balances"}</strong>
                <small>
                  {sessionOpen
                    ? "Edit opening & ecash on hand"
                    : "Enter values & start the day"}
                </small>
              </button>
              <button
                type="button"
                className="back-office-balancing-actions__btn back-office-balancing-actions__btn--ecash"
                disabled={busyId === "ecash"}
                onClick={() => setBalancingEntryMode("ecash")}
              >
                <strong>Ecash request</strong>
                <small>Ask accountant for extra cash</small>
              </button>
            </div>
          ) : null}
        </header>

        {!canViewBalances ? (
          <p className="muted agency-deposit-table-card__empty">
            Select a branch to view account balances.
          </p>
        ) : loading && accountBalances.length === 0 ? (
          <p className="muted agency-deposit-table-card__empty">Loading account balances…</p>
        ) : accountBalances.length === 0 ? (
          <p className="muted agency-deposit-table-card__empty">
            No company accounts for this branch — add one under Bank Products → Company accounts,
            then click <strong>Opening balances</strong>.
          </p>
        ) : (
          <div className="agency-deposit-table-wrap">
            <table className="agency-deposit-table back-office-balancing-table">
              <thead>
                <tr>
                  {viewingAllBranches ? <th>Branch</th> : null}
                  <th>Company account</th>
                  <th className="agency-deposit-table__num">Opening</th>
                  <th className="agency-deposit-table__num">+ Ecash</th>
                  <th className="agency-deposit-table__num">Total entries</th>
                  <th className="agency-deposit-table__num">Daily cap</th>
                  <th className="agency-deposit-table__num">Headroom</th>
                  <th className="agency-deposit-table__num">= Closing</th>
                </tr>
              </thead>
              <tbody>
                {accountBalances.map((row) => {
                  const rowSessionOpen = viewingAllBranches
                    ? Boolean(row.sessionOpen)
                    : sessionOpen;
                  return (
                  <tr
                    key={`${row.branchId ?? "branch"}-${row.bankProductId}`}
                    className="agency-deposit-table__row"
                  >
                    {viewingAllBranches ? (
                      <td>
                        <span className="agency-deposit-table__branch">
                          {branchLabel(row.branchName, row.branchCode)}
                        </span>
                      </td>
                    ) : null}
                    <td>
                      <strong>{row.bankLabel}</strong>
                      <span className="muted agency-deposit-table__account">{row.accountName}</span>
                    </td>
                    <td className="agency-deposit-table__num">
                      {rowSessionOpen ? formatWorkspaceMoney(row.openingBalance) : "—"}
                    </td>
                    <td className="agency-deposit-table__num">
                      {rowSessionOpen ? formatWorkspaceMoney(row.extraCash) : "—"}
                    </td>
                    <td className="agency-deposit-table__num agency-deposit-table__amount">
                      {formatWorkspaceMoney(row.totalEntries)}
                    </td>
                    <td className="agency-deposit-table__num muted">
                      {row.executionLimit != null ? formatWorkspaceMoney(row.executionLimit) : "—"}
                    </td>
                    <td
                      className={`agency-deposit-table__num ${
                        rowSessionOpen && row.limitReached
                          ? "back-office-diff--warn"
                          : rowSessionOpen && row.headroom != null && row.headroom > 0
                            ? "back-office-diff--ok"
                            : ""
                      }`}
                    >
                      {rowSessionOpen && row.headroom != null
                        ? formatWorkspaceMoney(row.headroom)
                        : "—"}
                    </td>
                    <td className="agency-deposit-table__num">
                      <strong>
                        {rowSessionOpen ? formatWorkspaceMoney(row.closingBalance) : "—"}
                      </strong>
                    </td>
                  </tr>
                );
                })}
              </tbody>
            </table>
            {!viewingAllBranches && !sessionOpen && accountBalances.length > 0 ? (
              <p className="muted agency-deposit-table-card__hint">
                Click <strong>Opening balances</strong> to enter opening and ecash on hand. Total
                entries already reflect deposits marked done today.
              </p>
            ) : viewingAllBranches ? (
              <p className="muted agency-deposit-table-card__hint">
                Select a single branch above to enter opening balances or request ecash. Total entries
                update live across all branches.
              </p>
            ) : null}
          </div>
        )}
      </section>

      <section className="card role-workspace__panel agency-deposit-table-card">
        <header className="agency-deposit-table-card__head role-workspace__panel-head">
          <div>
            <h3>Back office vs teller</h3>
            <p className="muted">
              Teller deposits recorded vs back office executed — should match per teller.
              {viewingAllBranches
                ? " Showing all branches for the selected date."
                : branchId
                  ? ` Filtered to ${branches.find((b) => b.id === branchId)?.name ?? "this branch"}.`
                  : ""}
            </p>
          </div>
        </header>
        {!branchId ? (
          <p className="muted agency-deposit-table-card__empty">Select a branch above to load teller reconciliation.</p>
        ) : tellerReconciliation.length === 0 ? (
          <p className="muted agency-deposit-table-card__empty">
            No teller activity for this date
            {viewingAllBranches ? " across any branch" : ""}.
          </p>
        ) : (
          <div className="agency-deposit-table-wrap">
            <table className="agency-deposit-table">
              <thead>
                <tr>
                  <th>Branch</th>
                  <th>Teller</th>
                  <th className="agency-deposit-table__num">Teller deposits</th>
                  <th className="agency-deposit-table__num">Back office executed</th>
                  <th className="agency-deposit-table__num">Difference</th>
                  <th>Count</th>
                </tr>
              </thead>
              <tbody>
                {tellerReconciliation.map((row) => (
                  <tr
                    key={`${row.branchId ?? "branch"}-${row.tellerUserId}`}
                    className="agency-deposit-table__row"
                  >
                    <td>
                      <span className="agency-deposit-table__branch">
                        {branchLabel(row.branchName, row.branchCode)}
                      </span>
                    </td>
                    <td>
                      <strong>{row.tellerName ?? row.tellerUserId}</strong>
                    </td>
                    <td className="agency-deposit-table__num">
                      {formatWorkspaceMoney(row.tellerDeposits)}
                    </td>
                    <td className="agency-deposit-table__num">
                      {formatWorkspaceMoney(row.backOfficeExecuted)}
                    </td>
                    <td
                      className={`agency-deposit-table__num ${
                        row.difference !== 0 ? "back-office-diff--warn" : "back-office-diff--ok"
                      }`}
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

      {canRunDayOps && balancingEntryMode ? (
        <BackOfficeBalancingEntryModal
          open
          mode={balancingEntryMode}
          busy={balancingEntryMode === "opening" ? busyId === "open-day" : busyId === "ecash"}
          branchId={branchId}
          businessDate={businessDate}
          companyAccounts={companyAccounts}
          onClose={() => setBalancingEntryMode(null)}
          onOpenDay={handleOpenDay}
          onRequestEcash={handleEcashRequest}
        />
      ) : null}
    </RoleDeskShell>
  );
}
