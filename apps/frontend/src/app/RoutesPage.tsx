import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { AppRole, FieldRoute } from "./api";
import { deleteFieldRoute, updateFieldRoute } from "./api";
import { AdminDataTable, filterRowsBySearch } from "../components/AdminDataTable";
import { Modal } from "../components/Modal";
import { RowActionsMenu } from "../components/RowActionsMenu";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { useToast } from "../components/Toast";
import { useConfirmDialog } from "../hooks/useConfirmDialog";
import { useRoutesLiveSync } from "./hooks/useRoutesLiveSync";
import { useBranchesStore } from "./stores/branchesStore";
import { useCustomersStore } from "./stores/customersStore";
import { useRoutesStore } from "./stores/routesStore";
import { RouteAssignAgentModal } from "./RouteAssignAgentModal";
import { RouteFormModal } from "./RouteFormModal";
import { RouteMembersModal } from "./RouteMembersModal";
import { RouteTransfersPanel } from "./RouteTransfersPanel";
import { formatBranchLabel } from "./branchDisplay";

type Props = { role: AppRole };
type WorkspaceTab = "routes" | "create" | "assign" | "members" | "transfers";

function branchLabel(route: FieldRoute): string {
  return formatBranchLabel(route.branchId, [], route.branchName, route.branchCode);
}

function RouteDetailModal({
  route,
  open,
  canManage,
  onClose,
  onManageMembers,
  onAssignAgent,
  onReassignAgent,
  onUnassignAgent
}: {
  route: FieldRoute | null;
  open: boolean;
  canManage: boolean;
  onClose: () => void;
  onManageMembers: () => void;
  onAssignAgent: () => void;
  onReassignAgent: () => void;
  onUnassignAgent: () => void;
}) {
  if (!route) {
    return null;
  }
  return (
    <Modal
      open={open}
      title={route.name}
      subtitle={route.area}
      onClose={onClose}
      panelClassName="modal-panel--70"
      footer={
        <div className="route-detail-footer">
          {canManage ? (
            <>
              {route.assignedFieldAgentId ? (
                <>
                  <button type="button" className="button secondary" onClick={onReassignAgent}>
                    Reassign agent
                  </button>
                  <button
                    type="button"
                    className="button secondary route-detail-footer__danger"
                    onClick={onUnassignAgent}
                  >
                    Unassign agent
                  </button>
                </>
              ) : (
                <button type="button" className="button" onClick={onAssignAgent}>
                  Assign agent
                </button>
              )}
              <button type="button" className="button secondary" onClick={onManageMembers}>
                Manage members
              </button>
            </>
          ) : null}
          <button type="button" className="button secondary" onClick={onClose}>
            Close
          </button>
        </div>
      }
    >
      <div className="agents-detail">
        <div className="agents-detail__grid">
          <div>
            <span className="agents-detail__label">Branch</span>
            <p>{branchLabel(route)}</p>
          </div>
          <div>
            <span className="agents-detail__label">Status</span>
            <p>
              <span
                className={`status-pill status-pill--${route.status === "active" ? "active" : "inactive"}`}
              >
                {route.status}
              </span>
            </p>
          </div>
          <div>
            <span className="agents-detail__label">Assigned agent</span>
            <p>{route.assignedFieldAgentName ?? route.assignedFieldAgentId ?? "—"}</p>
          </div>
          <div>
            <span className="agents-detail__label">Members</span>
            <p>
              <strong>{route.memberCount ?? 0}</strong>
              <button type="button" className="agents-detail__link" onClick={onManageMembers}>
                Manage members
              </button>
            </p>
          </div>
        </div>
      </div>
    </Modal>
  );
}

function RoutePickerPanel({
  title,
  description,
  routes,
  selectedId,
  onSelect,
  actionLabel,
  onAction,
  emptyHint
}: {
  title: string;
  description: string;
  routes: FieldRoute[];
  selectedId: string;
  onSelect: (id: string) => void;
  actionLabel: string;
  onAction: () => void;
  emptyHint: string;
}) {
  return (
    <section className="card routes-workspace__panel">
      <header className="routes-workspace__panel-head">
        <div>
          <h3>{title}</h3>
          <p className="muted">{description}</p>
        </div>
      </header>
      {routes.length === 0 ? (
        <p className="muted">{emptyHint}</p>
      ) : (
        <div className="routes-workspace__picker">
          <label className="field">
            <span>Route</span>
            <select value={selectedId} onChange={(e) => onSelect(e.target.value)}>
              <option value="">Select a route…</option>
              {routes.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name} · {branchLabel(r)}
                  {r.assignedFieldAgentName ? ` · ${r.assignedFieldAgentName}` : " · No agent"}
                </option>
              ))}
            </select>
          </label>
          <button type="button" className="button" disabled={!selectedId} onClick={onAction}>
            {actionLabel}
          </button>
        </div>
      )}
    </section>
  );
}

export function RoutesPage({ role }: Props) {
  useRoutesLiveSync();
  const { showToast } = useToast();
  const { confirm, dialogProps } = useConfirmDialog();
  const canManage = role === "admin" || role === "coordinator";

  const routes = useRoutesStore((s) => s.routes);
  const routeBranches = useRoutesStore((s) => s.branches);
  const liveBranches = useBranchesStore((s) => s.branches);
  const branches = liveBranches.length > 0 ? liveBranches : routeBranches;
  const loading = useRoutesStore((s) => s.loading);
  const error = useRoutesStore((s) => s.error);
  const lastFetchedAt = useRoutesStore((s) => s.lastFetchedAt);
  const refresh = useRoutesStore((s) => s.refresh);
  const refreshSilent = useRoutesStore((s) => s.refreshSilent);
  const removeRoute = useRoutesStore((s) => s.removeRoute);

  const [tab, setTab] = useState<WorkspaceTab>("routes");
  const [search, setSearch] = useState("");
  const [branchFilter, setBranchFilter] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [formMode, setFormMode] = useState<"create" | "edit">("create");
  const [editingRoute, setEditingRoute] = useState<FieldRoute | null>(null);
  const [detailRoute, setDetailRoute] = useState<FieldRoute | null>(null);
  const [membersRoute, setMembersRoute] = useState<FieldRoute | null>(null);
  const [assignAgentRoute, setAssignAgentRoute] = useState<FieldRoute | null>(null);
  const [assignPickId, setAssignPickId] = useState("");
  const [membersPickId, setMembersPickId] = useState("");

  const initialLoad = loading && lastFetchedAt == null;

  const filtered = useMemo(() => {
    let list = routes;
    if (branchFilter) {
      list = list.filter((r) => r.branchId === branchFilter);
    }
    return filterRowsBySearch(list, search, [
      "name",
      "area",
      "branchName",
      "assignedFieldAgentName"
    ] as (keyof FieldRoute)[]);
  }, [routes, search, branchFilter]);

  const kpis = useMemo(() => {
    const active = routes.filter((r) => r.status === "active").length;
    const members = routes.reduce((sum, r) => sum + (r.memberCount ?? 0), 0);
    const unassigned = routes.filter((r) => !r.assignedFieldAgentId).length;
    return { total: routes.length, active, members, unassigned };
  }, [routes]);

  function openCreate() {
    if (branches.length === 0) {
      void useBranchesStore.getState().refresh();
      void refresh();
    }
    setFormMode("create");
    setEditingRoute(null);
    setFormOpen(true);
  }

  function openEdit(route: FieldRoute) {
    setFormMode("edit");
    setEditingRoute(route);
    setFormOpen(true);
  }

  function openAssignAgent(route: FieldRoute) {
    setAssignAgentRoute(route);
  }

  function syncDetailRouteFromStore(routeId: string) {
    const updated = useRoutesStore.getState().routes.find((r) => r.id === routeId);
    if (updated) {
      setDetailRoute((prev) => (prev?.id === routeId ? updated : prev));
    }
  }

  function afterMembershipChange() {
    void refreshSilent();
    void useCustomersStore.getState().refreshSilent();
  }

  async function handleUnassignAgent(route: FieldRoute) {
    const agentLabel = route.assignedFieldAgentName ?? "the assigned agent";
    const ok = await confirm({
      title: "Unassign agent",
      message: `Unassign ${agentLabel} from route "${route.name}"? The route will have no field agent.`,
      confirmLabel: "Unassign",
      danger: true
    });
    if (!ok) {
      return;
    }
    try {
      await updateFieldRoute(route.id, { assignedFieldAgentId: null });
      showToast("Agent unassigned from route", "success");
      await refreshSilent();
      syncDetailRouteFromStore(route.id);
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Failed to unassign agent", "error");
    }
  }

  function buildRouteActionItems(row: FieldRoute) {
    const items = [];
    if (!row.assignedFieldAgentId) {
      items.push({ label: "Assign agent", onClick: () => openAssignAgent(row) });
    } else {
      items.push({ label: "Reassign agent", onClick: () => openAssignAgent(row) });
      items.push({
        label: "Unassign agent",
        onClick: () => void handleUnassignAgent(row),
        danger: true
      });
    }
    items.push(
      { label: "Edit", onClick: () => openEdit(row) },
      {
        label: "Manage members",
        onClick: () => {
          setMembersRoute(row);
          setTab("members");
          setMembersPickId(row.id);
        }
      },
      { label: "Delete", onClick: () => void handleDelete(row), danger: true }
    );
    return items;
  }

  async function handleDelete(route: FieldRoute) {
    const ok = await confirm({
      title: "Delete route",
      message: `Delete route "${route.name}"? Members will be unlinked.`,
      confirmLabel: "Delete",
      danger: true
    });
    if (!ok) {
      return;
    }
    try {
      await deleteFieldRoute(route.id);
      removeRoute(route.id);
      showToast("Route deleted", "success");
      await refreshSilent();
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Failed to delete route", "error");
    }
  }

  const tabs: Array<{ id: WorkspaceTab; label: string; manageOnly?: boolean }> = [
    { id: "routes", label: "Routes" },
    { id: "create", label: "Create", manageOnly: true },
    { id: "assign", label: "Assign agent", manageOnly: true },
    { id: "members", label: "Members", manageOnly: true },
    { id: "transfers", label: "Transfers" }
  ];

  return (
    <div className="agents-page routes-workspace">
      <header className="agents-page__header">
        <div>
          <h2>Routes</h2>
          <p className="muted">
            Create routes, assign agents, manage members, and transfer customers — membership and
            Branch &amp; servicing stay in sync.
            {error ? ` ${error}` : ""}
          </p>
        </div>
        <div className="agents-page__header-actions">
          {role === "admin" ? (
            <Link to="/app/susu/agents" className="button secondary">
              Field agents
            </Link>
          ) : null}
          {canManage ? (
            <button
              type="button"
              className="button"
              onClick={() => {
                setTab("create");
                openCreate();
              }}
            >
              Add route
            </button>
          ) : null}
          <button
            type="button"
            className="button secondary"
            disabled={loading}
            onClick={() => void refresh()}
          >
            {loading ? "…" : "↻"}
          </button>
        </div>
      </header>

      <div className="kpi-grid agents-page__kpis">
        <article className="kpi-card kpi-card--primary">
          <p className="kpi-value">
            {kpis.active}
            <span className="kpi-meta"> / {kpis.total}</span>
          </p>
          <span className="kpi-label">Active routes</span>
        </article>
        <article className="kpi-card kpi-card--success">
          <p className="kpi-value">{kpis.members}</p>
          <span className="kpi-label">Customers on routes</span>
        </article>
        <article className="kpi-card kpi-card--warning">
          <p className="kpi-value">{kpis.unassigned}</p>
          <span className="kpi-label">No agent assigned</span>
        </article>
      </div>

      <nav className="bank-products-page__tabs routes-workspace__tabs" aria-label="Routes workspace">
        {tabs
          .filter((t) => !t.manageOnly || canManage)
          .map((t) => (
            <button
              key={t.id}
              type="button"
              className={`bank-products-page__tab${tab === t.id ? " is-active" : ""}`}
              onClick={() => {
                setTab(t.id);
                if (t.id === "create" && canManage) {
                  openCreate();
                }
              }}
            >
              {t.label}
            </button>
          ))}
      </nav>

      {tab === "routes" ? (
        <>
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
                  key: "name",
                  label: "Route",
                  render: (row) => (
                    <div>
                      <strong>{row.name}</strong>
                      <small className="muted" style={{ display: "block" }}>
                        {row.area}
                      </small>
                    </div>
                  )
                },
                { key: "branch", label: "Branch", render: (row) => branchLabel(row) },
                {
                  key: "agent",
                  label: "Agent",
                  render: (row) => row.assignedFieldAgentName ?? <span className="muted">—</span>
                },
                {
                  key: "members",
                  label: "Members",
                  render: (row) => (
                    <button
                      type="button"
                      className="agents-table-customers-btn"
                      onClick={() => {
                        setMembersRoute(row);
                        setMembersPickId(row.id);
                        setTab("members");
                      }}
                    >
                      <strong>{row.memberCount ?? 0}</strong>
                    </button>
                  )
                },
                {
                  key: "status",
                  label: "Status",
                  render: (row) => (
                    <span
                      className={`status-pill status-pill--${row.status === "active" ? "active" : "inactive"}`}
                    >
                      {row.status}
                    </span>
                  )
                }
              ]}
              rows={filtered}
              rowKey={(row) => row.id}
              search={search}
              onSearchChange={setSearch}
              searchPlaceholder="Search route, area, branch, agent…"
              emptyMessage={initialLoad ? "Loading routes…" : "No routes yet. Add one to get started."}
              actions={(row) => (
                <div className="platform-actions-buttons">
                  <button
                    type="button"
                    className="button secondary"
                    onClick={() => setDetailRoute(row)}
                  >
                    Details
                  </button>
                  {canManage ? (
                    <RowActionsMenu
                      ariaLabel={`Actions for ${row.name}`}
                      items={buildRouteActionItems(row)}
                    />
                  ) : null}
                </div>
              )}
            />
          </section>
        </>
      ) : null}

      {tab === "create" && canManage ? (
        <section className="card routes-workspace__panel">
          <header className="routes-workspace__panel-head">
            <div>
              <h3>Create route</h3>
              <p className="muted">
                Add a collection area for a branch, then assign a field agent in the next step.
              </p>
            </div>
            <button type="button" className="button" onClick={openCreate}>
              Open create form
            </button>
          </header>
        </section>
      ) : null}

      {tab === "assign" && canManage ? (
        <RoutePickerPanel
          title="Assign agent"
          description="Pick a route, then choose or reassign its field agent. Members sync to that agent."
          routes={routes}
          selectedId={assignPickId}
          onSelect={setAssignPickId}
          actionLabel="Assign / reassign"
          onAction={() => {
            const route = routes.find((r) => r.id === assignPickId);
            if (route) {
              openAssignAgent(route);
            }
          }}
          emptyHint="Create a route first, then assign an agent."
        />
      ) : null}

      {tab === "members" && canManage ? (
        <RoutePickerPanel
          title="Route members"
          description="Choose which customers belong on a route. Saving syncs the route agent when one is set."
          routes={routes}
          selectedId={membersPickId}
          onSelect={setMembersPickId}
          actionLabel="Manage members"
          onAction={() => {
            const route = routes.find((r) => r.id === membersPickId);
            if (route) {
              setMembersRoute(route);
            }
          }}
          emptyHint="Create a route first, then add members."
        />
      ) : null}

      {tab === "transfers" ? (
        <RouteTransfersPanel canManage={canManage} onTransferred={afterMembershipChange} />
      ) : null}

      {canManage ? (
        <RouteFormModal
          open={formOpen}
          mode={formMode}
          route={editingRoute}
          branches={branches}
          onClose={() => setFormOpen(false)}
          onSaved={() => {
            void refreshSilent();
            setTab("routes");
          }}
        />
      ) : null}

      <RouteAssignAgentModal
        open={assignAgentRoute !== null}
        route={assignAgentRoute}
        onClose={() => setAssignAgentRoute(null)}
        onSaved={() => {
          const routeId = assignAgentRoute?.id;
          afterMembershipChange();
          void refreshSilent().then(() => {
            if (routeId) {
              syncDetailRouteFromStore(routeId);
            }
          });
        }}
      />

      <RouteDetailModal
        route={detailRoute}
        open={detailRoute !== null}
        canManage={canManage}
        onClose={() => setDetailRoute(null)}
        onManageMembers={() => {
          if (detailRoute) {
            setMembersRoute(detailRoute);
            setMembersPickId(detailRoute.id);
            setDetailRoute(null);
            setTab("members");
          }
        }}
        onAssignAgent={() => {
          if (detailRoute) {
            openAssignAgent(detailRoute);
          }
        }}
        onReassignAgent={() => {
          if (detailRoute) {
            openAssignAgent(detailRoute);
          }
        }}
        onUnassignAgent={() => {
          if (detailRoute) {
            void handleUnassignAgent(detailRoute);
          }
        }}
      />

      <RouteMembersModal
        route={membersRoute}
        open={membersRoute !== null}
        onClose={() => setMembersRoute(null)}
        onUpdated={afterMembershipChange}
      />

      <ConfirmDialog {...dialogProps} />
    </div>
  );
}
