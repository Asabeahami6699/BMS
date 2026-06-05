import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useShallow } from "zustand/react/shallow";
import type { AppRole, Branch, Customer } from "./api";
import { getRuntimeBranchId } from "./api";
import { AdminDataTable, filterRowsBySearch } from "../components/AdminDataTable";
import { RowActionsMenu } from "../components/RowActionsMenu";
import { formatFieldAgent } from "../lib/formatFieldAgent";
import { RegistrationModal } from "../agent/RegistrationModal";
import { CustomerDetailModal } from "./CustomerDetailModal";
import { useCustomersLiveSync } from "./hooks/useCustomersLiveSync";
import { useCustomersStore } from "./stores/customersStore";

type Props = { role: AppRole };

const STATUS_CLASS: Record<Customer["status"], string> = {
  pending_activation: "pending",
  active: "active",
  rejected: "inactive",
  suspended: "inactive",
  closed: "inactive"
};

const STATUS_LABEL: Record<Customer["status"], string> = {
  pending_activation: "Pending",
  active: "Active",
  rejected: "Rejected",
  suspended: "Suspended",
  closed: "Closed"
};

function branchLabel(branchId: string, branches: Branch[]): string {
  const match = branches.find((b) => b.id === branchId);
  return match ? `${match.name} (${match.code})` : branchId;
}

export function CustomerOpsCard({ role }: Props) {
  useCustomersLiveSync();
  const canCreate = role === "admin" || role === "coordinator" || role === "field_agent";
  const [searchParams] = useSearchParams();
  const [search, setSearch] = useState(() => searchParams.get("q") ?? "");

  useEffect(() => {
    const q = searchParams.get("q");
    if (q != null) {
      setSearch(q);
    }
  }, [searchParams]);
  const [createOpen, setCreateOpen] = useState(false);
  const [detailCustomerId, setDetailCustomerId] = useState<string | null>(null);

  const {
    customers,
    branches,
    loading,
    error,
    lastFetchedAt,
    liveSyncActive,
    refresh,
    refreshSilent
  } = useCustomersStore(
    useShallow((s) => ({
      customers: s.customers,
      branches: s.branches,
      loading: s.loading,
      error: s.error,
      lastFetchedAt: s.lastFetchedAt,
      liveSyncActive: s.liveSyncActive,
      refresh: s.refresh,
      refreshSilent: s.refreshSilent
    }))
  );

  const detailCustomer = useMemo(
    () => (detailCustomerId ? (customers.find((c) => c.id === detailCustomerId) ?? null) : null),
    [customers, detailCustomerId]
  );

  const filtered = useMemo(
    () =>
      filterRowsBySearch(customers, search, [
        "fullName",
        "phone",
        "accountNumber",
        "location",
        "houseNumber",
        "idCardNumber",
        "status",
        "createdByFieldAgentName",
        "assignedFieldAgentName"
      ] as (keyof Customer)[]),
    [customers, search]
  );

  const statusLine = useMemo(() => {
    if (!lastFetchedAt) {
      return "Loading customer records…";
    }
    const time = new Date(lastFetchedAt).toLocaleTimeString();
    return `Updated ${time}${liveSyncActive ? " · Live" : ""}`;
  }, [lastFetchedAt, liveSyncActive]);

  const initialLoad = loading && lastFetchedAt == null;

  return (
    <>
      <section className="card customers-card">
        <div className="customers-card-head">
          <div>
            <h2>Customers</h2>
            <p className="muted">
              Browse and search customer records. Use Register customer for walk-in onboarding (full KYC, pending
              approval). {statusLine}
            </p>
          </div>
          <div className="customers-card-head-actions">
            <button
              type="button"
              className="button secondary"
              disabled={loading}
              onClick={() => void refresh()}
            >
              {loading ? "Refreshing…" : "Refresh"}
            </button>
            {canCreate ? (
              <button type="button" className="button" onClick={() => setCreateOpen(true)}>
                + Register customer
              </button>
            ) : null}
          </div>
        </div>

        {error ? (
          <p className="customers-card-error" role="alert">
            {error}
          </p>
        ) : null}

        {initialLoad ? <p className="muted">Loading customers…</p> : null}

        {!initialLoad ? (
          <AdminDataTable
            columns={[
              {
                key: "name",
                label: "Customer",
                render: (row) => (
                  <div className="customers-table-name">
                    <strong>{row.fullName}</strong>
                    <small>{row.phone}</small>
                  </div>
                )
              },
              {
                key: "account",
                label: "Account",
                render: (row) => (
                  <div>
                    <span>{row.accountNumber ?? "—"}</span>
                    <small className="customers-table-sub">
                      {row.accountType?.replace(/_/g, " ") ?? "—"}
                    </small>
                  </div>
                )
              },
              {
                key: "agent",
                label: "Field agent",
                render: (row) => formatFieldAgent(row)
              },
              {
                key: "branch",
                label: "Branch",
                render: (row) => branchLabel(row.homeBranchId, branches)
              },
              {
                key: "contribution",
                label: "Daily (GHS)",
                render: (row) => Number(row.dailyContributionAmount).toFixed(2)
              },
              {
                key: "status",
                label: "Status",
                render: (row) => (
                  <span className={`status-pill status-pill--${STATUS_CLASS[row.status]}`}>
                    {STATUS_LABEL[row.status]}
                  </span>
                )
              }
            ]}
            rows={filtered}
            rowKey={(row) => row.id}
            search={search}
            onSearchChange={setSearch}
            searchPlaceholder="Search name, phone, account, agent…"
            emptyMessage="No customers found."
            actions={(row) => (
              <RowActionsMenu
                items={[
                  {
                    label: "View details",
                    onClick: () => setDetailCustomerId(row.id)
                  }
                ]}
              />
            )}
          />
        ) : null}
      </section>

      <RegistrationModal
        open={createOpen}
        variant="office"
        defaultBranchId={getRuntimeBranchId()}
        branches={branches}
        onClose={() => setCreateOpen(false)}
        onSubmitted={() => void refreshSilent()}
      />

      <CustomerDetailModal
        open={detailCustomerId !== null && detailCustomer !== null}
        customer={detailCustomer}
        branchLabel={detailCustomer ? branchLabel(detailCustomer.homeBranchId, branches) : undefined}
        onClose={() => setDetailCustomerId(null)}
      />
    </>
  );
}
