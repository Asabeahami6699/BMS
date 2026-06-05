import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useShallow } from "zustand/react/shallow";
import type { CoordinatorRosterRow, UserRecord } from "./api";
import { getTenantId, listBranches, updateUser, deleteUser } from "./api";
import { AdminDataTable, filterRowsBySearch } from "../components/AdminDataTable";
import { Modal } from "../components/Modal";
import { RowActionsMenu } from "../components/RowActionsMenu";
import { useToast } from "../components/Toast";
import { useCoordinatorsLiveSync } from "./hooks/useCoordinatorsLiveSync";
import { ResetPasswordModal } from "./ResetPasswordModal";
import { UserFormModal } from "./UserFormModal";
import { selectCoordinatorsKpis, useCoordinatorsStore } from "./stores/coordinatorsStore";

function scopeLabel(row: CoordinatorRosterRow): string {
  return row.scopeType === "head_office" ? "Head office" : "Branch";
}

function coordinatorToUserRecord(row: CoordinatorRosterRow): UserRecord {
  return {
    userId: row.userId,
    email: row.email,
    fullName: row.fullName,
    role: "coordinator",
    scopeType: row.scopeType,
    branchId: row.branchId,
    tenantId: getTenantId(),
    status: row.status,
    createdBy: "system"
  };
}

function CoordinatorDetailModal({
  coordinator,
  open,
  onClose
}: {
  coordinator: CoordinatorRosterRow | null;
  open: boolean;
  onClose: () => void;
}) {
  if (!coordinator) {
    return null;
  }

  const pendingTotal = coordinator.pendingRegistrations + coordinator.pendingRequests;

  return (
    <Modal
      open={open}
      title={coordinator.email}
      subtitle={`Coordinator · ${coordinator.branchLabel}`}
      onClose={onClose}
      panelClassName="modal-panel--70"
      footer={
        <button type="button" className="button secondary" onClick={onClose}>
          Close
        </button>
      }
    >
      <div className="agents-detail">
        <div className="agents-detail__grid">
          <div>
            <span className="agents-detail__label">Email</span>
            <p>{coordinator.email}</p>
          </div>
          <div>
            <span className="agents-detail__label">Status</span>
            <p>
              <span
                className={`status-pill status-pill--${coordinator.status === "active" ? "active" : "inactive"}`}
              >
                {coordinator.status === "active" ? "Active" : "Inactive"}
              </span>
            </p>
          </div>
          <div>
            <span className="agents-detail__label">Scope</span>
            <p>{scopeLabel(coordinator)}</p>
          </div>
          <div>
            <span className="agents-detail__label">User ID</span>
            <p className="agents-detail__mono">{coordinator.userId}</p>
          </div>
        </div>

        <h4 className="agents-detail__section">Queue in scope</h4>
        <div className="agents-detail__metrics">
          <div className="agents-detail__metric agents-detail__metric--highlight">
            <span>Pending registrations</span>
            <strong>{coordinator.pendingRegistrations}</strong>
          </div>
          <div className="agents-detail__metric">
            <span>Pending balance / withdrawal</span>
            <strong>{coordinator.pendingRequests}</strong>
          </div>
          <div className="agents-detail__metric">
            <span>Total open items</span>
            <strong>{pendingTotal}</strong>
          </div>
        </div>

        <h4 className="agents-detail__section">Oversight</h4>
        <div className="agents-detail__metrics">
          <div className="agents-detail__metric">
            <span>Active customers in scope</span>
            <strong>{coordinator.activeCustomersInScope}</strong>
          </div>
          <div className="agents-detail__metric">
            <span>Field agents (branch / company)</span>
            <strong>{coordinator.fieldAgentsInBranch}</strong>
          </div>
          <div className="agents-detail__metric">
            <span>Requests approved</span>
            <strong>{coordinator.approvalsProcessed}</strong>
          </div>
          <div className="agents-detail__metric">
            <span>Requests declined</span>
            <strong>{coordinator.rejectionsProcessed}</strong>
          </div>
        </div>

        <p className="muted agents-detail__hint">
          Coordinators approve new accounts, balance visibility, and withdrawals from{" "}
          <Link to="/app/susu/pending-approvals">Pending approvals</Link>. Branch coordinators only
          see customers in their branch; head-office coordinators see the whole company.
        </p>
      </div>
    </Modal>
  );
}

export function CoordinatorsPage() {
  useCoordinatorsLiveSync();
  const { showToast } = useToast();

  const loading = useCoordinatorsStore((s) => s.loading);
  const error = useCoordinatorsStore((s) => s.error);
  const lastFetchedAt = useCoordinatorsStore((s) => s.lastFetchedAt);
  const branches = useCoordinatorsStore((s) => s.branches);
  const branchFilter = useCoordinatorsStore((s) => s.branchFilter);
  const setBranchFilter = useCoordinatorsStore((s) => s.setBranchFilter);
  const liveSyncActive = useCoordinatorsStore((s) => s.liveSyncActive);
  const roster = useCoordinatorsStore((s) => s.roster);
  const kpis = useCoordinatorsStore(useShallow(selectCoordinatorsKpis));
  const refresh = useCoordinatorsStore((s) => s.refresh);

  const [search, setSearch] = useState("");
  const [detailRow, setDetailRow] = useState<CoordinatorRosterRow | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<"create" | "edit">("create");
  const [editingUser, setEditingUser] = useState<UserRecord | null>(null);
  const [allBranches, setAllBranches] = useState(branches);
  const [resetOpen, setResetOpen] = useState(false);
  const [passwordResetUser, setPasswordResetUser] = useState<UserRecord | null>(null);

  const filtered = useMemo(
    () =>
      filterRowsBySearch(roster, search, [
        "email",
        "branchLabel",
        "userId"
      ] as (keyof CoordinatorRosterRow)[]),
    [roster, search]
  );

  const updatedLabel = useMemo(() => {
    if (!lastFetchedAt) {
      return "Not loaded yet";
    }
    return `Updated ${new Date(lastFetchedAt).toLocaleTimeString()}${liveSyncActive ? " · Live" : ""}`;
  }, [lastFetchedAt, liveSyncActive]);

  async function ensureBranches() {
    if (allBranches.length > 0) {
      return allBranches;
    }
    const rows = await listBranches().catch(() => []);
    setAllBranches(rows);
    return rows;
  }

  function openCreate() {
    void ensureBranches().then(() => {
      setModalMode("create");
      setEditingUser(null);
      setModalOpen(true);
    });
  }

  function openEdit(row: CoordinatorRosterRow) {
    void ensureBranches().then(() => {
      setModalMode("edit");
      setEditingUser(coordinatorToUserRecord(row));
      setModalOpen(true);
    });
  }

  function openReset(row: CoordinatorRosterRow) {
    setPasswordResetUser(coordinatorToUserRecord(row));
    setResetOpen(true);
  }

  async function toggleStatus(row: CoordinatorRosterRow) {
    const next = row.status === "active" ? "inactive" : "active";
    try {
      await updateUser(row.userId, { status: next });
      showToast(`Coordinator ${next === "active" ? "activated" : "deactivated"}`, "success");
      await refresh();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to update status", "error");
    }
  }

  async function handleDelete(row: CoordinatorRosterRow) {
    if (!window.confirm(`Delete coordinator ${row.email}? This cannot be undone.`)) {
      return;
    }
    try {
      await deleteUser(row.userId);
      showToast("Coordinator deleted", "success");
      await refresh();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to delete coordinator", "error");
    }
  }

  return (
    <div className="agents-page">
      <header className="agents-page__header">
        <div>
          <h2>Coordinators</h2>
          <p className="muted">
            Team oversight — pending queues, approvals, and branch scope — {updatedLabel}
          </p>
        </div>
        <div className="agents-page__header-actions">
          <Link to="/app/settings/users" className="button secondary">
            All users
          </Link>
          <button type="button" className="button" onClick={() => openCreate()}>
            Add coordinator
          </button>
          <button
            type="button"
            className="button secondary"
            disabled={loading}
            onClick={() => {
              void refresh().then(() => showToast("Coordinators refreshed", "success"));
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
              🧭
            </span>
            <span className="kpi-label">Active coordinators</span>
          </div>
          <p className="kpi-value">
            {kpis.activeCoordinators}
            <span className="kpi-meta"> / {kpis.totalCoordinators} total</span>
          </p>
        </article>
        <article className="kpi-card kpi-card--warning">
          <div className="kpi-card-head">
            <span className="kpi-icon" aria-hidden>
              📋
            </span>
            <span className="kpi-label">Pending registrations</span>
          </div>
          <p className="kpi-value">{kpis.pendingRegistrations}</p>
        </article>
        <article className="kpi-card kpi-card--warning">
          <div className="kpi-card-head">
            <span className="kpi-icon" aria-hidden>
              ⏳
            </span>
            <span className="kpi-label">Pending requests</span>
          </div>
          <p className="kpi-value">{kpis.pendingRequests}</p>
        </article>
        <article className="kpi-card kpi-card--success">
          <div className="kpi-card-head">
            <span className="kpi-icon" aria-hidden>
              ✓
            </span>
            <span className="kpi-label">Processed (all time)</span>
          </div>
          <p className="kpi-value">{kpis.totalApprovals}</p>
        </article>
      </div>

      {branches.length > 0 ? (
        <label className="field agents-page__branch-filter">
          <span>Highlight branch</span>
          <select value={branchFilter} onChange={(e) => setBranchFilter(e.target.value)}>
            <option value="">All coordinators</option>
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
              key: "email",
              label: "Email",
              render: (row) => (
                <div className="agents-table-agent">
                  <strong>{row.email}</strong>
                  <small className="muted">{row.userId}</small>
                </div>
              )
            },
            {
              key: "scope",
              label: "Scope",
              render: (row) => (
                <div>
                  <span>{scopeLabel(row)}</span>
                  <small className="muted" style={{ display: "block" }}>
                    {row.branchLabel}
                  </small>
                </div>
              )
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
              key: "pending",
              label: "Open queue",
              render: (row) => {
                const total = row.pendingRegistrations + row.pendingRequests;
                return total > 0 ? (
                  <span className="agents-table-badge">{total}</span>
                ) : (
                  <span className="muted">—</span>
                );
              }
            },
            {
              key: "regs",
              label: "Pending regs",
              render: (row) =>
                row.pendingRegistrations > 0 ? (
                  <strong>{row.pendingRegistrations}</strong>
                ) : (
                  <span className="muted">—</span>
                )
            },
            {
              key: "requests",
              label: "Pending requests",
              render: (row) =>
                row.pendingRequests > 0 ? (
                  <strong>{row.pendingRequests}</strong>
                ) : (
                  <span className="muted">—</span>
                )
            },
            {
              key: "processed",
              label: "Processed",
              render: (row) => (
                <div className="agents-table-collections">
                  <strong>{row.approvalsProcessed}</strong>
                  <small className="muted">{row.rejectionsProcessed} declined</small>
                </div>
              )
            },
            {
              key: "customers",
              label: "Customers",
              render: (row) => <strong>{row.activeCustomersInScope}</strong>
            }
          ]}
          rows={filtered}
          rowKey={(row) => row.userId}
          search={search}
          onSearchChange={setSearch}
          searchPlaceholder="Search email, branch, user ID…"
          emptyMessage={loading ? "Loading coordinators…" : "No coordinators match your filters."}
          toolbar={
            <Link to="/app/susu/pending-approvals" className="button secondary">
              Pending approvals
            </Link>
          }
          actions={(row) => (
            <div className="platform-actions-buttons">
              <button
                type="button"
                className="button secondary"
                onClick={() => setDetailRow(row)}
              >
                Details
              </button>
              <RowActionsMenu
                ariaLabel={`Actions for ${row.email}`}
                items={[
                  { label: "Edit", onClick: () => openEdit(row) },
                  { label: "Reset password", onClick: () => openReset(row) },
                  {
                    label: row.status === "active" ? "Deactivate" : "Activate",
                    onClick: () => void toggleStatus(row)
                  },
                  { label: "Delete", onClick: () => void handleDelete(row), danger: true }
                ]}
              />
            </div>
          )}
        />
      </section>

      <CoordinatorDetailModal
        coordinator={detailRow}
        open={detailRow !== null}
        onClose={() => setDetailRow(null)}
      />

      <UserFormModal
        open={modalOpen}
        mode={modalMode}
        user={editingUser}
        branches={allBranches.length > 0 ? allBranches : branches}
        createDefaults={{ role: "coordinator", scopeType: "head_office" }}
        onClose={() => setModalOpen(false)}
        onSaved={() => void refresh()}
      />

      <ResetPasswordModal
        open={resetOpen}
        user={passwordResetUser}
        onClose={() => setResetOpen(false)}
      />
    </div>
  );
}
