import { useEffect, useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import {
  bankLabelsMatch,
  bankProductAppliesToBranch,
  hasAnyPermission,
  type OpenBackOfficeDayInput
} from "@bms/shared";
import { useAuth } from "../../auth/AuthContext";
import { useToast } from "../../components/Toast";
import { toUserFacingError } from "../../lib/networkError";
import { useBankProductsLiveSync } from "../hooks/useBankProductsLiveSync";
import { useBranchesLiveSync } from "../hooks/useBranchesLiveSync";
import { CopyableText } from "../../components/CopyableText";
import { useBackOfficeStore } from "../stores/backOfficeStore";
import { useBankProductsStore } from "../stores/bankProductsStore";
import { useBranchesStore } from "../stores/branchesStore";
import { formatWorkspaceMoney } from "../stores/roleWorkspaceStore";
import { BackOfficeAgentTransferModal } from "./BackOfficeAgentTransferModal";
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
  useBankProductsLiveSync();

  const branches = useBranchesStore((s) => s.branches);
  const bankProducts = useBankProductsStore((s) => s.products);

  const {
    data,
    branchId,
    dateFrom,
    dateTo,
    busyId,
    error,
    executionAccountByDeposit,
    hydrate,
    setBranchId,
    setDateRange,
    setExecutionAccount,
    openDay,
    markDepositDone,
    approveAccountantDeposit,
    approveEcash,
    requestEcash,
    agentTransfer,
    startLiveSync,
    stopLiveSync
  } = useBackOfficeStore(
    useShallow((s) => ({
      data: s.data,
      branchId: s.branchId,
      dateFrom: s.dateFrom,
      dateTo: s.dateTo,
      busyId: s.busyId,
      error: s.error,
      executionAccountByDeposit: s.executionAccountByDeposit,
      hydrate: s.hydrate,
      setBranchId: s.setBranchId,
      setDateRange: s.setDateRange,
      setExecutionAccount: s.setExecutionAccount,
      openDay: s.openDay,
      markDepositDone: s.markDepositDone,
      approveAccountantDeposit: s.approveAccountantDeposit,
      approveEcash: s.approveEcash,
      requestEcash: s.requestEcash,
      agentTransfer: s.agentTransfer,
      startLiveSync: s.startLiveSync,
      stopLiveSync: s.stopLiveSync
    }))
  );

  const [balancingEntryMode, setBalancingEntryMode] = useState<BalancingEntryMode | null>(null);
  const [agentTransferOpen, setAgentTransferOpen] = useState(false);

  useEffect(() => {
    hydrate({
      force: true,
      fallbackBranchId: user?.scopeType === "head_office" ? "all" : user?.branchId
    });
    startLiveSync();
    return () => stopLiveSync();
  }, [hydrate, startLiveSync, stopLiveSync, user?.branchId, user?.scopeType]);

  useEffect(() => {
    const hash = window.location.hash.replace("#", "");
    if (!hash) {
      return;
    }
    const el = document.getElementById(hash);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, []);

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

  const allCompanyAccounts = useMemo(
    () =>
      bankProducts
        .filter((p) => p.isCompanyBankAccount && p.isActive)
        .map((p) => ({
          id: p.id,
          name: p.name,
          bankLabel: p.bankLabel,
          branchId: p.branchId ?? null,
          branchName: p.branchName
        })),
    [bankProducts]
  );

  const mergedCompanyAccounts = useMemo(() => {
    const byId = new Map(allCompanyAccounts.map((account) => [account.id, account]));
    for (const account of data?.companyAccounts ?? []) {
      if (!byId.has(account.id)) {
        byId.set(account.id, {
          id: account.id,
          name: account.name,
          bankLabel: account.bankLabel,
          branchId: account.branchId ?? null,
          branchName: account.branchName
        });
      }
    }
    return [...byId.values()];
  }, [allCompanyAccounts, data?.companyAccounts]);

  const operationalBranches = useMemo(
    () => branches.filter((b) => b.status === "active"),
    [branches]
  );

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

  function companyAccountsForDeposit(row: (typeof depositQueue)[0]) {
    if (row.eligibleCompanyAccounts != null) {
      return row.eligibleCompanyAccounts;
    }
    return mergedCompanyAccounts.filter((account) => {
      if (
        !bankProductAppliesToBranch(
          { branchId: account.branchId ?? undefined },
          row.transactionBranchId
        )
      ) {
        return false;
      }
      if (row.bankLabel?.trim()) {
        return bankLabelsMatch(account.bankLabel, row.bankLabel);
      }
      return true;
    });
  }

  async function handleDone(
    transactionId: string,
    accountId: string,
    row: (typeof depositQueue)[0]
  ) {
    if (!accountId?.trim()) {
      const bankHint = row.bankLabel ? `${row.bankLabel} ` : "";
      showToast(
        `No ${bankHint}company account for ${depositBranchLabel(row)} — add one under Bank Products → Company accounts`,
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
    branchId: string;
    amount: number;
    notes?: string;
    bankProductId?: string;
  }) {
    try {
      await requestEcash(payload);
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
      error={error}
      loading={false}
      kpis={kpis}
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
              <span>From</span>
              <input
                type="date"
                value={dateFrom}
                max={dateTo}
                onChange={(e) => setDateRange(e.target.value, dateTo)}
              />
            </label>
            <label className="field">
              <span>To</span>
              <input
                type="date"
                value={dateTo}
                min={dateFrom}
                onChange={(e) => setDateRange(dateFrom, e.target.value)}
              />
            </label>
          </div>
          <p className="muted back-office-workspace-filters__hint">
            {viewingAllBranches
              ? `All branches · ${dateFrom} to ${dateTo}. Opening balances use the end date (${dateTo}).`
              : `Filters apply to the deposit queue, account balances, and teller reconciliation · ${dateFrom} to ${dateTo}.`}
          </p>
        </section>
      ) : null}

      {canAccountantApprove &&
      ((data?.pendingAccountantCount ?? 0) > 0 || (data?.pendingEcashCount ?? 0) > 0) ? (
        <section className="card role-workspace__panel role-workspace__panel--accent" id="approvals">
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

      <section
        className="card role-workspace__panel agency-deposit-table-card"
        id="deposits"
      >
        <header className="agency-deposit-table-card__head role-workspace__panel-head">
          <div>
            <p className="agency-deposit-table-card__eyebrow">Execution queue</p>
            <h3>Teller deposit queue</h3>
            <p className="muted">
              Pick the company account used at the bank, then click Done — teller status updates
              immediately.
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
                  <th>Account holder</th>
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
                  const rowCompanyAccounts = companyAccountsForDeposit(row);
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
                      <td className="agency-deposit-table__account">
                        {row.partnerAccountNumber ? (
                          <CopyableText value={row.partnerAccountNumber} label="Account number" />
                        ) : (
                          <span className="muted">—</span>
                        )}
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
                            disabled={busyId === row.id}
                            onChange={(e) => setExecutionAccount(row.id, e.target.value)}
                            aria-label={`Company account for ${row.customerName ?? "deposit"}`}
                          >
                            {rowCompanyAccounts.length === 0 ? (
                              <option value="">
                                No {row.bankLabel ? `${row.bankLabel} ` : ""}account for{" "}
                                {depositBranchLabel(row)}
                              </option>
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
                            disabled={busyId === row.id || !selectedAccount}
                            onClick={() => void handleDone(row.id, selectedAccount, row)}
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

      <section
        className="card role-workspace__panel agency-deposit-table-card"
        id="balancing"
      >
        <header className="agency-deposit-table-card__head role-workspace__panel-head">
          <div className="back-office-balancing-head">
            <div>
              <h3>Bank account balancing</h3>
              <p className="muted">
                Opening + ecash − total entries = closing. Total entries update live as deposits are
                marked done.
                {sessionOpen ? ` Day open for ${dateTo}.` : ""}
              </p>
            </div>
          </div>
          <div className="back-office-balancing-actions">
            <button
              type="button"
              className="back-office-balancing-actions__btn back-office-balancing-actions__btn--opening"
              disabled={busyId === "open-day"}
              onClick={() => setBalancingEntryMode("opening")}
            >
              <strong>{sessionOpen ? "Update balances" : "Opening balances"}</strong>
              <small>
                {sessionOpen ? "Edit opening & ecash on hand" : "Enter values & start the day"}
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
            <button
              type="button"
              className="back-office-balancing-actions__btn back-office-balancing-actions__btn--opening"
              disabled={busyId === "agent-transfer"}
              onClick={() => setAgentTransferOpen(true)}
            >
              <strong>Agent to agent</strong>
              <small>Move ecash between company accounts</small>
            </button>
          </div>
        </header>

        {accountBalances.length === 0 ? (
          <p className="muted agency-deposit-table-card__empty">
            No company accounts yet — add one under Bank Products → Company accounts, then click{" "}
            <strong>Opening balances</strong>.
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
          </div>
        )}
      </section>

      <section
        className="card role-workspace__panel agency-deposit-table-card"
        id="reconciliation"
      >
        <header className="agency-deposit-table-card__head role-workspace__panel-head">
          <div>
            <h3>Teller/Back Officer reconciliation</h3>
            <p className="muted">
              Teller vs back office per drawer
              {viewingAllBranches
                ? ` · all branches · ${dateFrom} to ${dateTo}`
                : branchId
                  ? ` · ${branches.find((b) => b.id === branchId)?.name ?? "Branch"} · ${dateFrom} to ${dateTo}`
                  : ""}
            </p>
          </div>
        </header>
        {!branchId ? (
          <p className="muted agency-deposit-table-card__empty">
            Select a branch above to load teller reconciliation.
          </p>
        ) : tellerReconciliation.length === 0 ? (
          <p className="muted agency-deposit-table-card__empty">
            No teller activity for this period
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

      {balancingEntryMode ? (
        <BackOfficeBalancingEntryModal
          open
          mode={balancingEntryMode}
          busy={balancingEntryMode === "opening" ? busyId === "open-day" : busyId === "ecash"}
          businessDate={dateTo}
          branches={operationalBranches}
          companyAccounts={mergedCompanyAccounts}
          defaultBranchId={branchId !== "all" ? branchId : user?.branchId}
          onClose={() => setBalancingEntryMode(null)}
          onOpenDay={handleOpenDay}
          onRequestEcash={handleEcashRequest}
        />
      ) : null}

      {agentTransferOpen ? (
        <BackOfficeAgentTransferModal
          open
          busy={busyId === "agent-transfer"}
          businessDate={dateTo}
          branches={operationalBranches}
          companyAccounts={mergedCompanyAccounts}
          defaultBranchId={branchId !== "all" ? branchId : user?.branchId}
          onClose={() => setAgentTransferOpen(false)}
          onTransfer={async (payload) => {
            try {
              await agentTransfer(payload);
              showToast("Ecash transferred between agent accounts", "success");
            } catch (err) {
              showToast(toUserFacingError(err, "Transfer failed"), "error");
              throw err;
            }
          }}
        />
      ) : null}
    </RoleDeskShell>
  );
}
