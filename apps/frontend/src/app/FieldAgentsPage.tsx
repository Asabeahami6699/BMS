import { formatAccountAmount } from "@bms/shared";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useShallow } from "zustand/react/shallow";
import type { AppRole, FieldAgentRosterRow } from "./api";
import { AdminDataTable, filterRowsBySearch } from "../components/AdminDataTable";
import { Modal } from "../components/Modal";
import { useToast } from "../components/Toast";
import { AgentCommissionStatementModal } from "./AgentCommissionStatementModal";
import { AgentCustomersModal } from "./AgentCustomersModal";
import { useAgentsLiveSync } from "./hooks/useAgentsLiveSync";
import { selectAgentsKpis, useAgentsStore } from "./stores/agentsStore";
import { useSusuRiskAlertsStore } from "./stores/susuRiskAlertsStore";

type Props = { role: AppRole };

function formatMoney(amount: number): string {
  return `GHS ${formatAccountAmount(amount)}`;
}

function AgentDetailModal({
  agent,
  open,
  onClose,
  onViewCustomers,
  onViewCommission
}: {
  agent: FieldAgentRosterRow | null;
  open: boolean;
  onClose: () => void;
  onViewCustomers?: () => void;
  onViewCommission?: () => void;
}) {
  if (!agent) {
    return null;
  }

  return (
    <Modal
      open={open}
      title={agent.displayName}
      subtitle={`Field agent · ${agent.branchLabel}`}
      onClose={onClose}
      panelClassName="modal-panel--70"
      footer={
        <>
          {onViewCommission ? (
            <button type="button" className="button secondary" onClick={onViewCommission}>
              Commission breakdown
            </button>
          ) : null}
          <button type="button" className="button secondary" onClick={onClose}>
            Close
          </button>
        </>
      }
    >
      <div className="agents-detail">
        <div className="agents-detail__grid">
          <div>
            <span className="agents-detail__label">Email</span>
            <p>{agent.email}</p>
          </div>
          <div>
            <span className="agents-detail__label">Status</span>
            <p>
              <span
                className={`status-pill status-pill--${agent.status === "active" ? "active" : "inactive"}`}
              >
                {agent.status === "active" ? "Active" : "Inactive"}
              </span>
            </p>
          </div>
          <div>
            <span className="agents-detail__label">Branch</span>
            <p>{agent.branchLabel}</p>
          </div>
          <div>
            <span className="agents-detail__label">User ID</span>
            <p className="agents-detail__mono">{agent.userId}</p>
          </div>
        </div>

        <h4 className="agents-detail__section">Portfolio</h4>
        <div className="agents-detail__metrics">
          <div className="agents-detail__metric">
            <span>Active customers</span>
            <strong>{agent.activeCustomers}</strong>
            <button
              type="button"
              className="agents-detail__link"
              onClick={() => {
                onClose();
                onViewCustomers?.();
              }}
            >
              View all customers
            </button>
          </div>
          <div className="agents-detail__metric">
            <span>Pending registrations</span>
            <strong>{agent.pendingRegistrations}</strong>
          </div>
          <div className="agents-detail__metric">
            <span>Pending requests</span>
            <strong>{agent.pendingRequests}</strong>
          </div>
        </div>

        <h4 className="agents-detail__section">Collections (reporting period)</h4>
        <div className="agents-detail__metrics">
          <div className="agents-detail__metric agents-detail__metric--highlight">
            <span>Total collections</span>
            <strong>{formatMoney(agent.totalCollections)}</strong>
          </div>
          <div className="agents-detail__metric">
            <span>Transactions</span>
            <strong>{agent.transactionCount}</strong>
          </div>
          <div className="agents-detail__metric">
            <span>Daily Susu</span>
            <strong>{formatMoney(agent.dailySusuAmount)}</strong>
            <small className="muted">{agent.dailySusuCount} transactions</small>
          </div>
          <div className="agents-detail__metric">
            <span>Deposits</span>
            <strong>{formatMoney(agent.depositAmount)}</strong>
            <small className="muted">{agent.depositCount} transactions</small>
          </div>
          <div className="agents-detail__metric">
            <span>Withdrawals</span>
            <strong>{formatMoney(agent.withdrawalAmount)}</strong>
            <small className="muted">{agent.withdrawalCount} transactions</small>
          </div>
        </div>

        <p className="muted agents-detail__hint">
          Agents record collections in the field app. Coordinators approve registrations and balance
          requests from Pending approvals.
        </p>
      </div>
    </Modal>
  );
}

export function FieldAgentsPage({ role }: Props) {
  useAgentsLiveSync();
  const { showToast } = useToast();
  const isAdmin = role === "admin";

  const loading = useAgentsStore((s) => s.loading);
  const error = useAgentsStore((s) => s.error);
  const lastFetchedAt = useAgentsStore((s) => s.lastFetchedAt);
  const branches = useAgentsStore((s) => s.branches);
  const branchFilter = useAgentsStore((s) => s.branchFilter);
  const setBranchFilter = useAgentsStore((s) => s.setBranchFilter);
  const liveSyncActive = useAgentsStore((s) => s.liveSyncActive);
  const roster = useAgentsStore((s) => s.roster);
  const kpis = useAgentsStore(useShallow(selectAgentsKpis));

  const [search, setSearch] = useState("");
  const [detailAgent, setDetailAgent] = useState<FieldAgentRosterRow | null>(null);
  const [customersAgent, setCustomersAgent] = useState<FieldAgentRosterRow | null>(null);
  const [commissionAgent, setCommissionAgent] = useState<FieldAgentRosterRow | null>(null);
  const refresh = useAgentsStore((s) => s.refresh);
  const zeroCollectionAgents = useSusuRiskAlertsStore((s) => s.zeroCollectionAgents);
  const hydrateRiskAlerts = useSusuRiskAlertsStore((s) => s.hydrate);

  useEffect(() => {
    hydrateRiskAlerts();
  }, [hydrateRiskAlerts]);

  const filteredZeroAgents = useMemo(() => {
    if (!branchFilter) return zeroCollectionAgents;
    return zeroCollectionAgents.filter((a) => a.branchId === branchFilter);
  }, [zeroCollectionAgents, branchFilter]);

  const filtered = useMemo(
    () =>
      filterRowsBySearch(roster, search, [
        "displayName",
        "email",
        "branchLabel",
        "userId"
      ] as (keyof FieldAgentRosterRow)[]),
    [roster, search]
  );

  const updatedLabel = useMemo(() => {
    if (!lastFetchedAt) {
      return "Not loaded yet";
    }
    return `Updated ${new Date(lastFetchedAt).toLocaleTimeString()}${liveSyncActive ? " · Live" : ""}`;
  }, [lastFetchedAt, liveSyncActive]);

  return (
    <div className="agents-page">
      <header className="agents-page__header">
        <div>
          <h2>Field agents</h2>
          <p className="muted">
            Roster, customer assignments, collections, and pending work — {updatedLabel}
          </p>
        </div>
        <div className="agents-page__header-actions">
          {isAdmin ? (
            <Link to="/app/settings/users" className="button secondary">
              Manage users
            </Link>
          ) : null}
          <button
            type="button"
            className="button secondary"
            disabled={loading}
            onClick={() => {
              void refresh().then(() => showToast("Agents refreshed", "success"));
            }}
          >
            {loading ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </header>

      {error ? (
        <p className="agents-page__error" role="alert">
          {error}
        </p>
      ) : null}

      <div className="kpi-grid agents-page__kpis">
        <article className="kpi-card kpi-card--primary">
          <div className="kpi-card-head">
            <span className="kpi-icon" aria-hidden>
              👤
            </span>
            <span className="kpi-label">Active agents</span>
          </div>
          <p className="kpi-value">
            {kpis.activeAgents}
            <span className="kpi-meta"> / {kpis.totalAgents} total</span>
          </p>
        </article>
        <article className="kpi-card kpi-card--success">
          <div className="kpi-card-head">
            <span className="kpi-icon" aria-hidden>
              📋
            </span>
            <span className="kpi-label">Assigned customers</span>
          </div>
          <p className="kpi-value">{kpis.assignedCustomers}</p>
        </article>
        <article className="kpi-card kpi-card--warning">
          <div className="kpi-card-head">
            <span className="kpi-icon" aria-hidden>
              ⏳
            </span>
            <span className="kpi-label">Pending work</span>
          </div>
          <p className="kpi-value">{kpis.pendingRegistrations + kpis.pendingAgentRequests}</p>
          <p className="kpi-meta muted">
            {kpis.pendingRegistrations} reg · {kpis.pendingAgentRequests} requests
          </p>
        </article>
        <article className="kpi-card kpi-card--purple">
          <div className="kpi-card-head">
            <span className="kpi-icon" aria-hidden>
              💰
            </span>
            <span className="kpi-label">Collections</span>
          </div>
          <p className="kpi-value">{formatMoney(kpis.totalCollections)}</p>
        </article>
      </div>

      {filteredZeroAgents.length > 0 ? (
        <section className="overview-panel eod-guard-panel" style={{ marginBottom: "1rem" }}>
          <div className="eod-guard-panel__head">
            <h3 className="overview-panel__title">
              Zero collections recorded today ({filteredZeroAgents.length} agent
              {filteredZeroAgents.length === 1 ? "" : "s"})
            </h3>
            <p className="muted" style={{ margin: "0.2rem 0 0", fontSize: "0.84rem" }}>
              Active field agents with assigned Susu savers who have GHS 0 recorded so far today —
              follow up to confirm route activity or offline sync.
            </p>
          </div>
          <div className="eod-guard-list">
            {filteredZeroAgents.map((a) => (
              <div key={a.agentId} className="eod-guard-list__row">
                <div>
                  <strong>{a.fullName}</strong>
                  <span className="muted">
                    {" "}
                    · {a.activeCustomerCount} active customer
                    {a.activeCustomerCount === 1 ? "" : "s"} · Daily target{" "}
                    {formatMoney(a.expectedDailyTarget)}
                  </span>
                </div>
                <span className="eod-guard-date">GHS 0.00 today</span>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {branches.length > 0 ? (
        <label className="field agents-page__branch-filter">
          <span>Filter by branch</span>
          <select value={branchFilter} onChange={(e) => setBranchFilter(e.target.value)}>
            <option value="">All branches</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name} ({b.code})
              </option>
            ))}
          </select>
        </label>
      ) : null}

      <section className="card agents-page__table-card">
        <AdminDataTable
          columns={[
            {
              key: "agent",
              label: "Agent",
              render: (row) => (
                <div className="agents-table-agent">
                  <strong>{row.displayName}</strong>
                  <small className="muted">{row.email}</small>
                </div>
              )
            },
            {
              key: "branch",
              label: "Branch",
              render: (row) => row.branchLabel
            },
            {
              key: "status",
              label: "Status",
              render: (row) => (
                <span
                  className={`status-pill status-pill--${row.status === "active" ? "active" : "inactive"}`}
                >
                  {row.status === "active" ? "Active" : "Inactive"}
                </span>
              )
            },
            {
              key: "customers",
              label: "Customers",
              render: (row) => {
                const total = row.activeCustomers + row.pendingRegistrations;
                return (
                  <button
                    type="button"
                    className="agents-table-customers-btn"
                    onClick={() => setCustomersAgent(row)}
                    title="View assigned customers"
                  >
                    <strong>{total}</strong>
                    <span className="muted">
                      {row.activeCustomers} active
                      {row.pendingRegistrations > 0
                        ? ` · ${row.pendingRegistrations} pending`
                        : ""}
                    </span>
                  </button>
                );
              }
            },
            {
              key: "requests",
              label: "Open requests",
              render: (row) =>
                row.pendingRequests > 0 ? (
                  <span className="agents-table-badge">{row.pendingRequests}</span>
                ) : (
                  <span className="muted">—</span>
                )
            },
            {
              key: "collections",
              label: "Collections",
              render: (row) => (
                <div className="agents-table-collections">
                  <strong>{formatMoney(row.totalCollections)}</strong>
                  <small className="muted">{row.transactionCount} tx</small>
                </div>
              )
            }
          ]}
          rows={filtered}
          rowKey={(row) => row.userId}
          search={search}
          onSearchChange={setSearch}
          searchPlaceholder="Search agent name, email, branch…"
          emptyMessage={loading ? "Loading agents…" : "No field agents match your filters."}
          toolbar={
            <Link to="/app/susu/pending-approvals" className="button secondary">
              Pending approvals
            </Link>
          }
          actions={(row) => (
            <button
              type="button"
              className="button secondary"
              onClick={() => setDetailAgent(row)}
            >
              Details
            </button>
          )}
        />
      </section>

      <AgentDetailModal
        agent={detailAgent}
        open={detailAgent !== null}
        onClose={() => setDetailAgent(null)}
        onViewCustomers={() => {
          if (detailAgent) {
            setCustomersAgent(detailAgent);
          }
        }}
        onViewCommission={() => {
          if (detailAgent) {
            setCommissionAgent(detailAgent);
          }
        }}
      />

      <AgentCommissionStatementModal
        open={commissionAgent !== null}
        userId={commissionAgent?.userId ?? null}
        staffName={commissionAgent?.displayName}
        onClose={() => setCommissionAgent(null)}
      />

      <AgentCustomersModal
        agent={customersAgent}
        open={customersAgent !== null}
        onClose={() => setCustomersAgent(null)}
        onUpdated={() => void refresh()}
      />
    </div>
  );
}
