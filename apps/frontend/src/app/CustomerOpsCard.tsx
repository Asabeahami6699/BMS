import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useShallow } from "zustand/react/shallow";
import { formatAccountAmount } from "@bms/shared";
import type { AppRole, Branch, Customer } from "./api";
import {
  deleteCustomer,
  getRuntimeBranchId,
  resetCustomerAccount,
  updateCustomerStatus
} from "./api";
import { AdminDataTable, filterRowsBySearch } from "../components/AdminDataTable";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { RowActionsMenu } from "../components/RowActionsMenu";
import { useToast } from "../components/Toast";
import { useConfirmDialog } from "../hooks/useConfirmDialog";
import { formatFieldAgent } from "../lib/formatFieldAgent";
import { toUserFacingError } from "../lib/networkError";
import { RegistrationModal } from "../agent/RegistrationModal";
import { CustomerAccountStatementModal } from "./CustomerAccountStatementModal";
import { CustomerDetailModal } from "./CustomerDetailModal";
import { useCustomersLiveSync } from "./hooks/useCustomersLiveSync";
import { useAgentsStore } from "./stores/agentsStore";
import { useCustomersStore } from "./stores/customersStore";
import { formatBranchLabel } from "./branchDisplay";

type Props = { role: AppRole };

type ManagedStatus = "active" | "inactive" | "dormant" | "closed";

const STATUS_CLASS: Record<Customer["status"], string> = {
  pending_activation: "pending",
  active: "active",
  rejected: "inactive",
  suspended: "inactive",
  inactive: "inactive",
  dormant: "dormant",
  closed: "failed"
};

const STATUS_LABEL: Record<Customer["status"], string> = {
  pending_activation: "Pending",
  active: "Active",
  rejected: "Rejected",
  suspended: "Suspended",
  inactive: "Inactive",
  dormant: "Dormant",
  closed: "Closed"
};

function branchLabel(branchId: string, branches: Branch[]): string {
  return formatBranchLabel(branchId, branches);
}

export function CustomerOpsCard({ role }: Props) {
  useCustomersLiveSync();
  const { showToast } = useToast();
  const { confirm, dialogProps } = useConfirmDialog();
  const canCreate = role === "admin" || role === "coordinator" || role === "field_agent";
  const canPurge = role === "super_admin";
  const canManageStatus = role === "admin" || role === "super_admin";
  const [searchParams] = useSearchParams();
  const [search, setSearch] = useState(() => searchParams.get("q") ?? "");
  const [purgeBusyId, setPurgeBusyId] = useState<string | null>(null);

  useEffect(() => {
    const q = searchParams.get("q");
    if (q != null) {
      setSearch(q);
    }
  }, [searchParams]);
  const [createOpen, setCreateOpen] = useState(false);
  const [detailCustomerId, setDetailCustomerId] = useState<string | null>(null);
  const [statementCustomerId, setStatementCustomerId] = useState<string | null>(null);

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

  const agentsRoster = useAgentsStore((s) => s.roster);

  useEffect(() => {
    useAgentsStore.getState().hydrate();
  }, []);

  const agentNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const agent of agentsRoster) {
      const label = (agent.displayName || agent.fullName || agent.email || "").trim();
      if (label && !/^user[_-]/i.test(label)) {
        map.set(agent.userId, label);
      }
    }
    return map;
  }, [agentsRoster]);

  function fieldAgentLabel(customer: Customer): string {
    const fromApi = formatFieldAgent(customer);
    if (fromApi !== "—") {
      return fromApi;
    }
    const id = customer.assignedFieldAgentId ?? customer.createdByFieldAgentId;
    if (id && agentNameById.has(id)) {
      return agentNameById.get(id)!;
    }
    return "—";
  }

  const detailCustomer = useMemo(
    () => (detailCustomerId ? (customers.find((c) => c.id === detailCustomerId) ?? null) : null),
    [customers, detailCustomerId]
  );

  const statementCustomer = useMemo(
    () =>
      statementCustomerId ? (customers.find((c) => c.id === statementCustomerId) ?? null) : null,
    [customers, statementCustomerId]
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

  async function handleResetAccount(customer: Customer) {
    const ok = await confirm({
      title: "Reset account",
      message: `Reset account for ${customer.fullName}? This clears ledger history and balances but keeps the customer profile.`,
      confirmLabel: "Reset account",
      danger: true
    });
    if (!ok) {
      return;
    }
    setPurgeBusyId(customer.id);
    try {
      await resetCustomerAccount(customer.id);
      showToast("Customer account reset", "success");
      await refreshSilent();
    } catch (error) {
      showToast(toUserFacingError(error, "Could not reset customer"), "error");
    } finally {
      setPurgeBusyId(null);
    }
  }

  async function handleDeleteCustomer(customer: Customer) {
    const ok = await confirm({
      title: "Delete customer",
      message: `Permanently delete ${customer.fullName}? This removes the customer and related transactions. This cannot be undone.`,
      confirmLabel: "Delete",
      danger: true
    });
    if (!ok) {
      return;
    }
    setPurgeBusyId(customer.id);
    try {
      await deleteCustomer(customer.id);
      if (detailCustomerId === customer.id) {
        setDetailCustomerId(null);
      }
      showToast("Customer deleted", "success");
      await refreshSilent();
    } catch (error) {
      showToast(toUserFacingError(error, "Could not delete customer"), "error");
    } finally {
      setPurgeBusyId(null);
    }
  }

  async function handleSetStatus(customer: Customer, status: ManagedStatus) {
    const labels: Record<ManagedStatus, string> = {
      active: "ACTIVE",
      inactive: "INACTIVE",
      dormant: "DORMANT",
      closed: "CLOSED"
    };
    const ok = await confirm({
      title: status === "active" ? "Reactivate account" : "Change account status",
      message:
        status === "active"
          ? `Reactivate ${customer.fullName} to ACTIVE?`
          : `Flag ${customer.fullName} as ${labels[status]}?`,
      confirmLabel: status === "active" ? "Reactivate" : `Set ${labels[status]}`,
      danger: status === "closed"
    });
    if (!ok) {
      return;
    }
    setPurgeBusyId(customer.id);
    try {
      await updateCustomerStatus(customer.id, status);
      showToast(`Account marked ${labels[status].toLowerCase()}`, "success");
      await refreshSilent();
    } catch (error) {
      showToast(toUserFacingError(error, "Could not update status"), "error");
    } finally {
      setPurgeBusyId(null);
    }
  }

  function statusActions(row: Customer) {
    if (!canManageStatus) {
      return [];
    }
    if (row.status === "pending_activation" || row.status === "rejected") {
      return [];
    }
    const busy = purgeBusyId === row.id;
    const items: { label: string; onClick: () => void; danger?: boolean }[] = [];
    if (row.status !== "active") {
      items.push({
        label: busy ? "Working…" : "Reactivate (ACTIVE)",
        onClick: () => {
          if (purgeBusyId != null) return;
          void handleSetStatus(row, "active");
        }
      });
    }
    if (row.status !== "inactive") {
      items.push({
        label: busy ? "Working…" : "Flag Inactive",
        onClick: () => {
          if (purgeBusyId != null) return;
          void handleSetStatus(row, "inactive");
        }
      });
    }
    if (row.status !== "dormant") {
      items.push({
        label: busy ? "Working…" : "Flag Dormant",
        onClick: () => {
          if (purgeBusyId != null) return;
          void handleSetStatus(row, "dormant");
        }
      });
    }
    if (row.status !== "closed") {
      items.push({
        label: busy ? "Working…" : "Flag Closed",
        onClick: () => {
          if (purgeBusyId != null) return;
          void handleSetStatus(row, "closed");
        },
        danger: true
      });
    }
    return items;
  }

  return (
    <>
      <section className="card customers-card">
        <div className="customers-card-head">
          <div>
            <h2>Customers</h2>
            <p className="muted">
              Browse and search customer records. Use Register customer for walk-in onboarding (full KYC, pending
              approval).
              {canManageStatus
                ? " Admins can flag accounts closed, inactive, or dormant, and reactivate them."
                : ""}
              {canPurge ? " Super users can reset balances or permanently delete accounts." : ""}{" "}
              {statusLine}
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
                render: (row) => fieldAgentLabel(row)
              },
              {
                key: "branch",
                label: "Branch",
                render: (row) => branchLabel(row.homeBranchId, branches)
              },
              {
                key: "contribution",
                label: "Daily (GHS)",
                render: (row) => formatAccountAmount(row.dailyContributionAmount)
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
            onRowClick={(row) => setDetailCustomerId(row.id)}
            actions={(row) => (
              <RowActionsMenu
                items={[
                  {
                    label: "View details",
                    onClick: () => setDetailCustomerId(row.id)
                  },
                  {
                    label: "Account statement",
                    onClick: () => setStatementCustomerId(row.id)
                  },
                  ...statusActions(row),
                  ...(canPurge
                    ? [
                        {
                          label: purgeBusyId === row.id ? "Working…" : "Reset account",
                          onClick: () => {
                            if (purgeBusyId != null) {
                              return;
                            }
                            void handleResetAccount(row);
                          }
                        },
                        {
                          label: purgeBusyId === row.id ? "Working…" : "Delete customer",
                          onClick: () => {
                            if (purgeBusyId != null) {
                              return;
                            }
                            void handleDeleteCustomer(row);
                          },
                          danger: true
                        }
                      ]
                    : [])
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
        agentLabel={detailCustomer ? fieldAgentLabel(detailCustomer) : undefined}
        onClose={() => setDetailCustomerId(null)}
      />

      <CustomerAccountStatementModal
        open={statementCustomerId !== null && statementCustomer !== null}
        customer={statementCustomer}
        onClose={() => setStatementCustomerId(null)}
      />

      <ConfirmDialog {...dialogProps} />
    </>
  );
}
