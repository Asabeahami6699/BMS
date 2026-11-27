import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  DEFAULT_APPROVAL_WORKFLOW,
  formatAccountAmount,
  formatGhs,
  roleMayApprove
} from "@bms/shared";
import { useAuth } from "../auth/AuthContext";
import type { BalanceDisclosure, Customer } from "./api";
import {
  approveBalanceDisclosure,
  deleteCustomer,
  rejectBalanceDisclosure
} from "./api";
import { BalanceApproveModal } from "./BalanceApproveModal";
import { CustomerDetailModal } from "./CustomerDetailModal";
import { DeclineRequestModal } from "./DeclineRequestModal";
import { RegistrationReviewModal } from "./RegistrationReviewModal";
import { SendBackToAgentModal } from "./SendBackToAgentModal";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { Modal } from "../components/Modal";
import { useToast } from "../components/Toast";
import { useConfirmDialog } from "../hooks/useConfirmDialog";
import { toUserFacingError } from "../lib/networkError";
import { formatFieldAgent } from "../lib/formatFieldAgent";
import { formatNextOfKin } from "../lib/formatNextOfKin";
import { useCoordinatorLiveSync } from "./hooks/useCoordinatorLiveSync";
import { useCoordinatorStore } from "./stores/coordinatorStore";
import { useCustomersStore } from "./stores/customersStore";
import { usePageLoading } from "./hooks/usePageLoading";

type TabId = "withdrawals" | "registrations" | "rejected";

function requestTypeLabel(type: BalanceDisclosure["requestType"]): string {
  return type === "withdrawal" ? "Withdrawal" : "Balance";
}

function fulfillmentLabel(mode?: BalanceDisclosure["fulfillmentMode"]): string {
  if (mode === "momo") {
    return "MoMo";
  }
  if (mode === "agent_next_day" || mode === "next_day_cash") {
    return "Cash · next visit";
  }
  return "Cash";
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function PendingApprovalsPage() {
  const { user } = useAuth();
  const workflow = user?.approvalWorkflow ?? DEFAULT_APPROVAL_WORKFLOW;
  const canApproveWithdrawal = roleMayApprove(workflow, "withdrawal", user?.role ?? "");
  const canReviewBalance = user?.role === "admin" || user?.role === "coordinator";
  const canReviewRegistration = roleMayApprove(workflow, "registration", user?.role ?? "");

  useCoordinatorLiveSync();

  const { showToast } = useToast();
  const { confirm, dialogProps } = useConfirmDialog();
  const [searchParams, setSearchParams] = useSearchParams();
  const allCustomers = useCoordinatorStore((s) => s.customers);
  const pendingRequests = useCoordinatorStore((s) => s.pendingRequests);
  const pendingRegistrations = useCoordinatorStore((s) => s.pendingRegistrations);
  const branches = useCoordinatorStore((s) => s.branches);
  const loading = useCoordinatorStore((s) => s.loading);
  const refresh = useCoordinatorStore((s) => s.refresh);
  const refreshSilent = useCoordinatorStore((s) => s.refreshSilent);
  const removePendingRequest = useCoordinatorStore((s) => s.removePendingRequest);
  const removePendingRegistration = useCoordinatorStore((s) => s.removePendingRegistration);

  usePageLoading(loading, "pending-approvals");

  const initialTabParam = searchParams.get("tab");
  const [tab, setTab] = useState<TabId>(
    initialTabParam === "registrations" || initialTabParam === "rejected"
      ? initialTabParam
      : "withdrawals"
  );
  useEffect(() => {
    const param = searchParams.get("tab");
    if (param === "withdrawals" || param === "registrations" || param === "rejected") {
      setTab(param);
    }
  }, [searchParams]);

  function selectTab(next: TabId) {
    setTab(next);
    const params = new URLSearchParams(searchParams);
    params.set("tab", next);
    setSearchParams(params, { replace: true });
  }

  const [busyId, setBusyId] = useState<string | null>(null);
  const [balanceApproveTarget, setBalanceApproveTarget] = useState<BalanceDisclosure | null>(null);
  const [declineTarget, setDeclineTarget] = useState<BalanceDisclosure | null>(null);
  const [callConfirmTarget, setCallConfirmTarget] = useState<BalanceDisclosure | null>(null);
  const [callConfirmed, setCallConfirmed] = useState(false);
  const [reviewCustomer, setReviewCustomer] = useState<Customer | null>(null);
  const [detailCustomer, setDetailCustomer] = useState<Customer | null>(null);
  const [sendBackCustomer, setSendBackCustomer] = useState<Customer | null>(null);

  const canPurge = user?.role === "super_admin";
  const canReturnToAgent =
    user?.role === "admin" ||
    user?.role === "super_admin" ||
    user?.role === "coordinator" ||
    canReviewRegistration;

  const rejectedRegistrations = useMemo(
    () => allCustomers.filter((c) => c.status === "rejected"),
    [allCustomers]
  );

  const branchById = useMemo(() => new Map(branches.map((b) => [b.id, b])), [branches]);

  const visibleRequests = useMemo(() => {
    return pendingRequests.filter((row) => {
      if (row.requestType === "withdrawal") {
        if (!canApproveWithdrawal) return false;
        if (
          row.fulfillmentMode !== "momo" &&
          row.isFieldAgentRequest &&
          user?.role === "customer_service"
        ) {
          return false;
        }
        return true;
      }
      return canReviewBalance;
    });
  }, [pendingRequests, canApproveWithdrawal, canReviewBalance, user?.role]);

  const withdrawalCount = visibleRequests.filter((r) => r.requestType === "withdrawal").length;
  const balanceCount = visibleRequests.filter((r) => r.requestType === "balance").length;
  const registrationCount = canReviewRegistration ? pendingRegistrations.length : 0;
  const rejectedCount = canReviewRegistration ? rejectedRegistrations.length : 0;

  const showWithdrawalsTab = canApproveWithdrawal || canReviewBalance;
  const showRegistrationsTab = canReviewRegistration;

  async function handleDeleteRejected(customer: Customer) {
    const ok = await confirm({
      title: "Delete rejected registration",
      message: `Permanently delete the rejected registration for ${customer.fullName}? This cannot be undone.`,
      confirmLabel: "Delete",
      danger: true
    });
    if (!ok) {
      return;
    }
    setBusyId(customer.id);
    try {
      await deleteCustomer(customer.id);
      showToast(`Deleted rejected registration for ${customer.fullName}`, "success");
      await Promise.all([refreshSilent(), useCustomersStore.getState().refreshSilent()]);
    } catch (error) {
      showToast(toUserFacingError(error, "Could not delete rejected registration"), "error");
    } finally {
      setBusyId(null);
    }
  }

  async function handleApproveCash(row: BalanceDisclosure, visibleHours?: number) {
    setBusyId(row.id);
    try {
      const approved = await approveBalanceDisclosure(
        row.id,
        row.requestType === "balance" ? { visibleHours } : undefined
      );
      removePendingRequest(row.id);
      if (approved.requestType === "withdrawal") {
        showToast(
          `Approved for Pay now — ${approved.customerName ?? "Customer"}: ${approved.withdrawalAmount != null ? formatGhs(approved.withdrawalAmount) : "—"}`,
          "success"
        );
        if (row.customerId) {
          void import("./stores/customerLedgerStore").then(({ useCustomerLedgerStore }) => {
            useCustomerLedgerStore.getState().invalidate(row.customerId);
          });
          void import("./stores/susuCycleCommissionStore").then(({ useSusuCycleCommissionStore }) => {
            useSusuCycleCommissionStore.getState().invalidateCustomerPassbook(row.customerId);
          });
        }
      } else {
        showToast(
          `Balance visible — ${approved.customerName ?? "Customer"}: ${approved.balanceAmount != null ? formatGhs(approved.balanceAmount) : "—"}`,
          "success"
        );
      }
      await refreshSilent();
    } catch (error) {
      showToast(toUserFacingError(error, "Approve failed"), "error");
    } finally {
      setBusyId(null);
    }
  }

  function handleApprove(row: BalanceDisclosure) {
    if (row.requestType === "balance") {
      setBalanceApproveTarget(row);
      return;
    }
    setCallConfirmed(false);
    setCallConfirmTarget(row);
  }

  function closeCallConfirm() {
    if (busyId) {
      return;
    }
    setCallConfirmTarget(null);
    setCallConfirmed(false);
  }

  async function confirmCallAndApprove() {
    if (!callConfirmTarget || !callConfirmed) {
      showToast("Confirm that you called the customer before approving", "error");
      return;
    }
    const row = callConfirmTarget;
    setCallConfirmTarget(null);
    setCallConfirmed(false);
    await handleApproveCash(row);
  }

  async function handleDeclineConfirm(reason: string | undefined) {
    if (!declineTarget) return;
    setBusyId(declineTarget.id);
    try {
      await rejectBalanceDisclosure(declineTarget.id, reason);
      removePendingRequest(declineTarget.id);
      showToast("Request declined — agent notified", "success");
      setDeclineTarget(null);
      await refreshSilent();
    } catch (error) {
      showToast(toUserFacingError(error, "Decline failed"), "error");
    } finally {
      setBusyId(null);
    }
  }

  function branchLabel(customer: Customer): string | undefined {
    const branch = branchById.get(customer.homeBranchId);
    return branch ? `${branch.name} (${branch.code})` : undefined;
  }

  if (!showWithdrawalsTab && !showRegistrationsTab) {
    return (
      <article className="card">
        <h2>Access restricted</h2>
        <p className="muted">Your role cannot review pending approvals.</p>
      </article>
    );
  }

  const activeTab: TabId =
    tab === "rejected" && showRegistrationsTab
      ? "rejected"
      : tab === "registrations" && showRegistrationsTab
        ? "registrations"
        : showWithdrawalsTab
          ? "withdrawals"
          : "registrations";

  return (
    <div className="pending-approvals-page">
      <header className="pending-approvals-hero">
        <div className="pending-approvals-hero__copy">
          <p className="pending-approvals-hero__eyebrow">Susu · Approvals</p>
          <h1>Pending approvals</h1>
          <p className="muted">
            Review field-agent withdrawals and registrations. Call the customer on their
            registration phone, then approve — teller Pay now debits the customer account and till.
          </p>
        </div>
        <div className="pending-approvals-hero__actions">
          <button
            type="button"
            className="button secondary"
            disabled={loading}
            onClick={() => void refresh()}
          >
            {loading ? "Refreshing…" : "↻ Refresh"}
          </button>
        </div>
      </header>

      <div className="kpi-grid pending-approvals-kpis">
        <article className="kpi-card kpi-card--warning">
          <p className="kpi-label">Cash / balance requests</p>
          <p className="kpi-value">{loading && visibleRequests.length === 0 ? "—" : visibleRequests.length}</p>
          <p className="kpi-meta muted">
            {withdrawalCount} withdrawal · {balanceCount} balance
          </p>
        </article>
        <article className="kpi-card kpi-card--primary">
          <p className="kpi-label">Registrations</p>
          <p className="kpi-value">{loading && registrationCount === 0 ? "—" : registrationCount}</p>
          <p className="kpi-meta muted">
            Awaiting approval{rejectedCount > 0 ? ` · ${rejectedCount} rejected` : ""}
          </p>
        </article>
        <article className="kpi-card kpi-card--success">
          <p className="kpi-label">Your role</p>
          <p className="kpi-value pending-approvals-role">{user?.role?.replace(/_/g, " ") ?? "—"}</p>
          <p className="kpi-meta muted">Approver for this queue</p>
        </article>
      </div>

      {(showWithdrawalsTab && showRegistrationsTab) || showWithdrawalsTab || showRegistrationsTab ? (
        <div className="pending-approvals-tabs" role="tablist" aria-label="Approval queues">
          {showWithdrawalsTab ? (
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "withdrawals"}
              className={`pending-approvals-tabs__btn${activeTab === "withdrawals" ? " is-active" : ""}`}
              onClick={() => selectTab("withdrawals")}
            >
              Withdrawals &amp; balance
              <span className="pending-approvals-tabs__count">{visibleRequests.length}</span>
            </button>
          ) : null}
          {showRegistrationsTab ? (
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "registrations"}
              className={`pending-approvals-tabs__btn${activeTab === "registrations" ? " is-active" : ""}`}
              onClick={() => selectTab("registrations")}
            >
              Registrations
              <span className="pending-approvals-tabs__count">{registrationCount}</span>
            </button>
          ) : null}
          {showRegistrationsTab ? (
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "rejected"}
              className={`pending-approvals-tabs__btn${activeTab === "rejected" ? " is-active" : ""}`}
              onClick={() => selectTab("rejected")}
            >
              Rejected registrations
              <span className="pending-approvals-tabs__count">{rejectedCount}</span>
            </button>
          ) : null}
        </div>
      ) : null}

      {activeTab === "withdrawals" && showWithdrawalsTab ? (
        <section className="pending-approvals-section" aria-label="Pending withdrawals and balance">
          {loading && visibleRequests.length === 0 ? (
            <p className="muted pending-approvals-empty">Loading requests…</p>
          ) : null}
          {!loading && visibleRequests.length === 0 ? (
            <div className="pending-approvals-empty-card">
              <strong>All clear</strong>
              <p className="muted">No withdrawal or balance requests waiting for you.</p>
            </div>
          ) : (
            <ul className="pending-approvals-list">
              {visibleRequests.map((row) => {
                const name = row.customerName ?? row.customerId;
                const isWithdrawal = row.requestType === "withdrawal";
                return (
                  <li key={row.id} className="pending-approvals-card">
                    <div className="pending-approvals-card__avatar" aria-hidden>
                      {initials(name)}
                    </div>
                    <div className="pending-approvals-card__main">
                      <div className="pending-approvals-card__title-row">
                        <strong>{name}</strong>
                        <span
                          className={`status-pill status-pill--${isWithdrawal ? "pending" : "active"}`}
                        >
                          {requestTypeLabel(row.requestType)}
                        </span>
                      </div>
                      <p className="pending-approvals-card__meta muted">
                        Agent: {row.fieldAgentName ?? row.fieldAgentId.slice(0, 8)} ·{" "}
                        {new Date(row.requestedAt).toLocaleString()}
                      </p>
                      {isWithdrawal ? (
                        <div className="pending-approvals-card__facts">
                          <span className="pending-approvals-chip pending-approvals-chip--amount">
                            {row.withdrawalAmount != null
                              ? `GHS ${formatAccountAmount(row.withdrawalAmount)}`
                              : "—"}
                          </span>
                          <span className="pending-approvals-chip">
                            {fulfillmentLabel(row.fulfillmentMode)}
                          </span>
                          {row.customerPhone ? (
                            <a
                              className="pending-approvals-chip pending-approvals-chip--phone"
                              href={`tel:${row.customerPhone}`}
                            >
                              📞 {row.customerPhone}
                            </a>
                          ) : (
                            <span className="pending-approvals-chip pending-approvals-chip--warn">
                              No registration phone
                            </span>
                          )}
                          {row.fulfillmentMode === "momo" ? (
                            <span className="pending-approvals-chip">
                              MoMo: {row.momoAccountName} · {row.momoNumber}
                            </span>
                          ) : null}
                        </div>
                      ) : null}
                      {row.requestReason ? (
                        <p className="pending-approvals-card__reason">
                          <span className="muted">Reason</span> {row.requestReason}
                        </p>
                      ) : null}
                    </div>
                    <div className="pending-approvals-card__actions">
                      <button
                        type="button"
                        className="button"
                        disabled={busyId === row.id}
                        onClick={() => handleApprove(row)}
                      >
                        Approve
                      </button>
                      <button
                        type="button"
                        className="button secondary"
                        disabled={busyId === row.id}
                        onClick={() => setDeclineTarget(row)}
                      >
                        Decline
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      ) : null}

      {activeTab === "registrations" && showRegistrationsTab ? (
        <section className="pending-approvals-section" aria-label="Pending registrations">
          {loading && pendingRegistrations.length === 0 ? (
            <p className="muted pending-approvals-empty">Loading registrations…</p>
          ) : null}
          {!loading && pendingRegistrations.length === 0 ? (
            <div className="pending-approvals-empty-card">
              <strong>No pending registrations</strong>
              <p className="muted">New field-agent sign-ups will appear here for review.</p>
            </div>
          ) : (
            <ul className="pending-approvals-list">
              {pendingRegistrations.map((c) => (
                <li key={c.id} className="pending-approvals-card">
                  <div className="pending-approvals-card__avatar" aria-hidden>
                    {initials(c.fullName)}
                  </div>
                  <div className="pending-approvals-card__main">
                    <div className="pending-approvals-card__title-row">
                      <strong>{c.fullName}</strong>
                      <span className="status-pill status-pill--pending">Registration</span>
                    </div>
                    <p className="pending-approvals-card__meta muted">
                      {c.phone} · {c.accountType?.replace(/_/g, " ") ?? "—"}
                      {c.location ? ` · ${c.location}` : ""}
                      {c.houseNumber ? ` · House ${c.houseNumber}` : ""}
                    </p>
                    <div className="pending-approvals-card__facts">
                      <span className="pending-approvals-chip">Agent: {formatFieldAgent(c)}</span>
                      {branchLabel(c) ? (
                        <span className="pending-approvals-chip">{branchLabel(c)}</span>
                      ) : null}
                      <span className="pending-approvals-chip">
                        Next of kin: {formatNextOfKin(c.nextOfKin)}
                      </span>
                    </div>
                  </div>
                  <div className="pending-approvals-card__actions">
                    <button type="button" className="button" onClick={() => setReviewCustomer(c)}>
                      Review
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      {activeTab === "rejected" && showRegistrationsTab ? (
        <section className="pending-approvals-section" aria-label="Rejected registrations">
          {loading && rejectedRegistrations.length === 0 ? (
            <p className="muted pending-approvals-empty">Loading rejected registrations…</p>
          ) : null}
          {!loading && rejectedRegistrations.length === 0 ? (
            <div className="pending-approvals-empty-card">
              <strong>No rejected registrations</strong>
              <p className="muted">
                Rejected sign-ups stay here (separate from approved Customers) until the mobilizer
                fixes and resubmits them for approval.
              </p>
            </div>
          ) : (
            <ul className="pending-approvals-list">
              {rejectedRegistrations.map((c) => (
                <li key={c.id} className="pending-approvals-card">
                  <div className="pending-approvals-card__avatar" aria-hidden>
                    {initials(c.fullName)}
                  </div>
                  <div className="pending-approvals-card__main">
                    <div className="pending-approvals-card__title-row">
                      <strong>{c.fullName}</strong>
                      <span className="status-pill status-pill--inactive">Rejected</span>
                    </div>
                    <p className="pending-approvals-card__meta muted">
                      {c.phone} · {c.accountType?.replace(/_/g, " ") ?? "—"}
                      {c.location ? ` · ${c.location}` : ""}
                      {c.houseNumber ? ` · House ${c.houseNumber}` : ""}
                    </p>
                    <div className="pending-approvals-card__facts">
                      <span className="pending-approvals-chip">Agent: {formatFieldAgent(c)}</span>
                      {branchLabel(c) ? (
                        <span className="pending-approvals-chip">{branchLabel(c)}</span>
                      ) : null}
                      {c.dailyContributionAmount > 0 ? (
                        <span className="pending-approvals-chip">
                          Daily: GHS {formatAccountAmount(c.dailyContributionAmount)}
                        </span>
                      ) : null}
                    </div>
                    {c.rejectionReason ? (
                      <p className="pending-approvals-card__reason">
                        <strong>Reason:</strong> {c.rejectionReason}
                      </p>
                    ) : null}
                  </div>
                  <div className="pending-approvals-card__actions">
                    <button
                      type="button"
                      className="button secondary"
                      onClick={() => setDetailCustomer(c)}
                    >
                      View details
                    </button>
                    {canReturnToAgent ? (
                      <button
                        type="button"
                        className="button"
                        disabled={busyId === c.id}
                        onClick={() => setSendBackCustomer(c)}
                      >
                        Send back to mobilizer
                      </button>
                    ) : null}
                    {canPurge ? (
                      <button
                        type="button"
                        className="button secondary"
                        disabled={busyId === c.id}
                        onClick={() => void handleDeleteRejected(c)}
                      >
                        {busyId === c.id ? "Deleting…" : "Delete"}
                      </button>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      <Modal
        open={callConfirmTarget !== null}
        title="Confirm customer call"
        subtitle="Anti-fraud check before cash approval"
        onClose={closeCallConfirm}
        footer={
          <>
            <button
              type="button"
              className="button secondary"
              disabled={busyId === callConfirmTarget?.id}
              onClick={closeCallConfirm}
            >
              Not yet
            </button>
            <button
              type="button"
              className="button"
              disabled={!callConfirmed || busyId === callConfirmTarget?.id}
              onClick={() => void confirmCallAndApprove()}
            >
              {busyId === callConfirmTarget?.id ? "Approving…" : "Yes — approve for Pay now"}
            </button>
          </>
        }
      >
        {callConfirmTarget ? (
          <div className="pending-approvals-call-confirm">
            <p>
              Before approving{" "}
              <strong>{callConfirmTarget.customerName ?? "this customer"}</strong>
              {callConfirmTarget.withdrawalAmount != null
                ? ` for GHS ${formatAccountAmount(callConfirmTarget.withdrawalAmount)}`
                : ""}
              , confirm you called them about this withdrawal.
            </p>
            {callConfirmTarget.customerPhone ? (
              <p className="pending-approvals-call-confirm__phone">
                <a href={`tel:${callConfirmTarget.customerPhone}`}>
                  📞 Call {callConfirmTarget.customerPhone}
                </a>
                <span className="muted"> (registration phone)</span>
              </p>
            ) : (
              <p className="muted">No registration phone on file — verify identity carefully.</p>
            )}
            {callConfirmTarget.fulfillmentMode === "momo" ? (
              <p className="muted">
                MoMo recipient:{" "}
                <strong>
                  {callConfirmTarget.momoAccountName || "—"} · {callConfirmTarget.momoNumber || "—"}
                </strong>
              </p>
            ) : null}
            <label className="pending-approvals-call-confirm__check">
              <input
                type="checkbox"
                checked={callConfirmed}
                onChange={(e) => setCallConfirmed(e.target.checked)}
              />
              <span>I have called the customer and they confirmed this withdrawal.</span>
            </label>
          </div>
        ) : null}
      </Modal>

      <DeclineRequestModal
        open={declineTarget !== null}
        customerName={declineTarget?.customerName}
        submitting={busyId === declineTarget?.id}
        onClose={() => setDeclineTarget(null)}
        onConfirm={(reason) => void handleDeclineConfirm(reason)}
      />

      <BalanceApproveModal
        open={balanceApproveTarget !== null}
        request={balanceApproveTarget}
        submitting={busyId === balanceApproveTarget?.id}
        onClose={() => setBalanceApproveTarget(null)}
        onConfirm={(visibleHours) => {
          if (balanceApproveTarget) {
            void handleApproveCash(balanceApproveTarget, visibleHours).then(() =>
              setBalanceApproveTarget(null)
            );
          }
        }}
      />

      <RegistrationReviewModal
        open={reviewCustomer !== null}
        customer={reviewCustomer}
        agentLabel={reviewCustomer ? formatFieldAgent(reviewCustomer) : undefined}
        branchLabel={reviewCustomer ? branchLabel(reviewCustomer) : undefined}
        onClose={() => setReviewCustomer(null)}
        onDecided={() => {
          if (reviewCustomer) {
            removePendingRegistration(reviewCustomer.id);
          }
          void refreshSilent();
          void useCustomersStore.getState().refreshSilent();
        }}
      />

      <CustomerDetailModal
        open={detailCustomer !== null}
        customer={detailCustomer}
        branchLabel={detailCustomer ? branchLabel(detailCustomer) : undefined}
        agentLabel={detailCustomer ? formatFieldAgent(detailCustomer) : undefined}
        onSendBackToAgent={
          canReturnToAgent ? (c) => setSendBackCustomer(c) : undefined
        }
        onClose={() => setDetailCustomer(null)}
      />

      <SendBackToAgentModal
        open={sendBackCustomer !== null}
        customer={sendBackCustomer}
        agentLabel={sendBackCustomer ? formatFieldAgent(sendBackCustomer) : undefined}
        onClose={() => setSendBackCustomer(null)}
        onSent={() => {
          void refreshSilent();
          void useCustomersStore.getState().refreshSilent();
        }}
      />

      <ConfirmDialog {...dialogProps} />
    </div>
  );
}
