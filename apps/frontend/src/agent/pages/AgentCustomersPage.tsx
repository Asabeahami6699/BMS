import { useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { RowActionsMenu } from "../../components/RowActionsMenu";
import { CustomerRequestsRow } from "../components/CustomerRequestsRow";
import { RegistrationModal } from "../RegistrationModal";
import {
  formatCustomerAddress,
  selectFilteredCustomers,
  selectCustomerStats,
  useAgentCustomerStore,
  type AgentCustomerFilter
} from "../stores/agentCustomerStore";
import { useAgentBalanceStore } from "../stores/agentBalanceStore";

const FILTERS: { id: AgentCustomerFilter; label: string }[] = [
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
            {lastUpdatedLabel ? ` · ${lastUpdatedLabel}` : ""}
          </p>
        </div>
        <RowActionsMenu items={moreActions} ariaLabel="Customer actions" />
      </div>

      {error ? <p className="agent-inline-error">{error}</p> : null}

      {pendingRegistrations.length > 0 ? (
        <details className="agent-pending-panel">
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
                  {c.status === "pending_activation" ? "Pending approval" : "Rejected"}
                </span>
                <p className="muted">
                  {c.phone} · {c.location ?? "—"}
                </p>
                {c.rejectionReason ? <p className="muted">Reason: {c.rejectionReason}</p> : null}
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
        {FILTERS.map((tab) => {
          const count =
            tab.id === "all" ? stats.total : tab.id === "active" ? stats.active : stats.pending;
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
                : "No customers in this view yet. Tap + in the top bar to create one."}
          </p>
        ) : (
          customers.map((customer) => (
            <article key={customer.id} className="agent-list-item agent-customer-card">
              <div className="agent-customer-card-head">
                <strong className="agent-customer-card-name">{customer.fullName}</strong>
                <div className="agent-customer-card-head-end">
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
              <p className="agent-customer-amount muted">
                Daily plan: GHS {Number(customer.dailyContributionAmount).toFixed(2)}
              </p>
            </article>
          ))
        )}
      </div>

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
    </div>
  );
}
