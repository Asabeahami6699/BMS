import { useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { formatAccountAmount } from "@bms/shared";
import type { Customer } from "../../app/api";
import { Modal } from "../../components/Modal";
import { RowActionsMenu } from "../../components/RowActionsMenu";
import { SusuPassbookCard } from "../../components/SusuPassbookCard";
import { CustomerRequestsRow } from "../components/CustomerRequestsRow";
import { RegistrationModal } from "../RegistrationModal";
import { useFieldAgentCapabilities } from "../hooks/useFieldAgentCapabilities";
import {
  formatCustomerAddress,
  selectFilteredCustomers,
  selectCustomerStats,
  useAgentCustomerStore,
  type AgentCustomerFilter
} from "../stores/agentCustomerStore";
import { useAgentBalanceStore } from "../stores/agentBalanceStore";

const BASE_FILTERS: { id: AgentCustomerFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "active", label: "Active" },
  { id: "pending", label: "Pending" }
];

type Props = {
  onQueueChange: () => void;
  registerOpen?: boolean;
  onRegisterOpenChange?: (open: boolean) => void;
};

function statusLabel(status: string): string {
  if (status === "active") {
    return "Active";
  }
  if (status === "pending_activation") {
    return "Pending";
  }
  if (status === "rejected") {
    return "Rejected";
  }
  return status;
}

function statusClass(status: string): string {
  if (status === "active") {
    return "active";
  }
  if (status === "pending_activation") {
    return "pending";
  }
  return "inactive";
}

export function AgentCustomersPage({
  onQueueChange,
  registerOpen: registerOpenProp,
  onRegisterOpenChange
}: Props) {
  const { canRegisterCustomers } = useFieldAgentCapabilities();
  const customers = useAgentCustomerStore(useShallow(selectFilteredCustomers));
  const allCustomers = useAgentCustomerStore((s) => s.customers);
  const stats = useAgentCustomerStore(useShallow(selectCustomerStats));
  const search = useAgentCustomerStore((s) => s.search);
  const filter = useAgentCustomerStore((s) => s.filter);
  const loading = useAgentCustomerStore((s) => s.loading);
  const error = useAgentCustomerStore((s) => s.error);
  const lastFetchedAt = useAgentCustomerStore((s) => s.lastFetchedAt);
  const setSearch = useAgentCustomerStore((s) => s.setSearch);
  const setFilter = useAgentCustomerStore((s) => s.setFilter);
  const refresh = useAgentCustomerStore((s) => s.refresh);
  const mergeCustomer = useAgentCustomerStore((s) => s.mergeCustomer);
  const refreshSilent = useAgentCustomerStore((s) => s.refreshSilent);
  const requestsUpdatedAt = useAgentBalanceStore((s) => s.lastFetchedAt);

  const [registerOpenLocal, setRegisterOpenLocal] = useState(false);
  const [passbookCustomer, setPassbookCustomer] = useState<Customer | null>(null);
  const [resubmitCustomer, setResubmitCustomer] = useState<Customer | null>(null);

  const filters = useMemo(
    () =>
      stats.rejected > 0
        ? [...BASE_FILTERS, { id: "rejected" as const, label: "Needs fix" }]
        : BASE_FILTERS,
    [stats.rejected]
  );

  const registerOpen = registerOpenProp ?? registerOpenLocal;
  function setRegisterOpen(open: boolean) {
    onRegisterOpenChange?.(open);
    if (registerOpenProp === undefined) {
      setRegisterOpenLocal(open);
    }
  }

  const pendingRegistrations = useMemo(
    () =>
      allCustomers.filter((c) => c.status === "pending_activation" || c.status === "rejected"),
    [allCustomers]
  );

  const lastUpdatedLabel = useMemo(() => {
    const stamp = Math.max(lastFetchedAt ?? 0, requestsUpdatedAt ? Date.parse(requestsUpdatedAt) : 0);
    if (!stamp) {
      return null;
    }
    return new Date(stamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }, [lastFetchedAt, requestsUpdatedAt]);

  const moreActions = [
    {
      label: loading ? "Refreshing…" : "Refresh list",
      onClick: () => {
        if (!loading) {
          void refresh();
        }
      }
    }
  ];

  return (
    <div className="agent-page">
      <div className="agent-page-head agent-page-head--clean">
        <div>
          <h2>Customers</h2>
          <p className="muted agent-page-sub">
            {stats.active || "—"} active
            {stats.pending ? ` · ${stats.pending} pending` : ""}
            {stats.rejected ? ` · ${stats.rejected} needs fix` : ""}
            {lastUpdatedLabel ? ` · ${lastUpdatedLabel}` : ""}
          </p>
        </div>
        <RowActionsMenu items={moreActions} ariaLabel="Customer actions" />
      </div>

      {error ? <p className="agent-inline-error">{error}</p> : null}

      {pendingRegistrations.length > 0 ? (
        <details className="agent-pending-panel" open={stats.rejected > 0 || undefined}>
          <summary>
            Submitted accounts
            <span className="agent-pending-panel__count">{pendingRegistrations.length}</span>
          </summary>
          <div className="agent-list">
            {pendingRegistrations.map((c) => (
              <article className="agent-list-item" key={c.id}>
                <strong>{c.fullName}</strong>
                <span
                  className={`status-pill status-pill--${c.status === "pending_activation" ? "pending" : "inactive"}`}
                >
                  {c.status === "pending_activation" ? "Pending approval" : "Rejected · Needs fix"}
                </span>
                <p className="muted">
                  {c.phone} · {c.location ?? "—"}
                </p>
                {c.rejectionReason ? (
                  <p className="muted">
                    <strong>Coordinator note:</strong> {c.rejectionReason}
                  </p>
                ) : null}
                {c.status === "rejected" ? (
                  <div className="agent-customer-card-actions">
                    <button
                      type="button"
                      className="button btn-sm"
                      onClick={() => setResubmitCustomer(c)}
                    >
                      Fix &amp; resubmit
                    </button>
                  </div>
                ) : null}
              </article>
            ))}
          </div>
        </details>
      ) : null}

      <label className="field agent-search-field">
        <span className="sr-only">Search</span>
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search name, phone, account…"
        />
      </label>

      <div className="agent-filter-tabs" role="tablist" aria-label="Filter customers">
        {filters.map((tab) => {
          const count =
            tab.id === "all"
              ? stats.total
              : tab.id === "active"
                ? stats.active
                : tab.id === "pending"
                  ? stats.pending
                  : stats.rejected;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={filter === tab.id}
              className={`agent-filter-tab${filter === tab.id ? " active" : ""}`}
              onClick={() => setFilter(tab.id)}
            >
              {tab.label}
              {count ? <span className="agent-filter-tab__count">{count}</span> : null}
            </button>
          );
        })}
      </div>

      <div className="agent-list">
        {customers.length === 0 ? (
          <p className="muted">
            {loading
              ? "Loading customers…"
              : search.trim()
                ? "No customers match your search."
                : canRegisterCustomers
                  ? "No customers in this view yet. Tap + in the top bar to create one."
                  : "No customers in this view yet."}
          </p>
        ) : (
          customers.map((customer) => (
            <article key={customer.id} className="agent-list-item agent-customer-card">
              <div className="agent-customer-card-head">
                <strong className="agent-customer-card-name">{customer.fullName}</strong>
                <div className="agent-customer-card-head-end">
                  {customer.kycTier === "simplified" ? (
                    <span className="kyc-tier-badge kyc-tier-badge--simplified">
                      Simplified KYC
                    </span>
                  ) : null}
                  {customer.accountNumber ? (
                    <span className="agent-customer-account">{customer.accountNumber}</span>
                  ) : null}
                  <span className={`status-pill status-pill--${statusClass(customer.status)}`}>
                    {statusLabel(customer.status)}
                  </span>
                </div>
              </div>
              {customer.status === "active" ? (
                <CustomerRequestsRow customerId={customer.id} customerName={customer.fullName} />
              ) : null}
              <p className="agent-customer-location">
                <span aria-hidden>📍</span> {formatCustomerAddress(customer)}
              </p>
              <p className="agent-customer-meta muted">{customer.phone}</p>
              {customer.accountType !== "savings" && customer.dailyContributionAmount > 0 ? (
                <p className="agent-customer-amount muted">
                  Daily plan: GHS {formatAccountAmount(customer.dailyContributionAmount)}
                </p>
              ) : customer.accountType === "savings" ? (
                <p className="agent-customer-amount muted">Savings account</p>
              ) : (
                <p className="agent-customer-amount muted">
                  Daily plan: GHS {formatAccountAmount(customer.dailyContributionAmount)}
                </p>
              )}
              {customer.status === "rejected" && customer.rejectionReason ? (
                <p className="muted" style={{ margin: "0.25rem 0 0", fontSize: "0.82rem" }}>
                  <strong>Coordinator note:</strong> {customer.rejectionReason}
                </p>
              ) : null}
              {customer.status === "rejected" ? (
                <div className="agent-customer-card-actions">
                  <button
                    type="button"
                    className="button btn-sm"
                    onClick={() => setResubmitCustomer(customer)}
                  >
                    Fix &amp; resubmit
                  </button>
                </div>
              ) : null}
              {customer.status === "active" && customer.accountType === "susu" ? (
                <div className="agent-customer-card-actions">
                  <button
                    type="button"
                    className="button secondary btn-sm"
                    onClick={() => setPassbookCustomer(customer)}
                  >
                    Susu passbook
                  </button>
                </div>
              ) : null}
            </article>
          ))
        )}
      </div>

      <Modal
        open={passbookCustomer !== null}
        title={passbookCustomer ? `Susu passbook — ${passbookCustomer.fullName}` : "Susu passbook"}
        subtitle={passbookCustomer?.accountNumber ? `Acct ${passbookCustomer.accountNumber}` : undefined}
        onClose={() => setPassbookCustomer(null)}
        footer={
          <button
            type="button"
            className="button secondary"
            onClick={() => setPassbookCustomer(null)}
          >
            Close
          </button>
        }
      >
        {passbookCustomer ? (
          <SusuPassbookCard
            customerId={passbookCustomer.id}
            customerName={passbookCustomer.fullName}
            compact
          />
        ) : null}
      </Modal>

      {canRegisterCustomers ? (
        <RegistrationModal
          open={registerOpen}
          onClose={() => setRegisterOpen(false)}
          onSubmitted={(customer) => {
            onQueueChange();
            if (customer) {
              mergeCustomer(customer);
            } else {
              void refreshSilent();
            }
            setRegisterOpen(false);
          }}
        />
      ) : null}

      <RegistrationModal
        open={resubmitCustomer !== null}
        editCustomer={resubmitCustomer}
        onClose={() => setResubmitCustomer(null)}
        onSubmitted={(customer) => {
          onQueueChange();
          if (customer) {
            mergeCustomer(customer);
          } else {
            void refreshSilent();
          }
          setResubmitCustomer(null);
        }}
      />
    </div>
  );
}
