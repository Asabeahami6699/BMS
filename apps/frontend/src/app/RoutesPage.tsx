import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ROUTE_ASSIGNMENT_STRATEGY_LABELS } from "@bms/shared";
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
import { RouteReorganizationPanel } from "./RouteReorganizationPanel";
import { RouteTransfersPanel } from "./RouteTransfersPanel";
import { formatBranchLabel } from "./branchDisplay";

type Props = { role: AppRole };
type WorkspaceTab = "routes" | "reorganize" | "assign" | "members" | "transfers";

function branchLabel(route: FieldRoute): string {
  return formatBranchLabel(route.branchId, [], route.branchName, route.branchCode);
}

function initialsFromName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0] ?? ""}${parts[parts.length - 1]![0] ?? ""}`.toUpperCase();
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
      subtitle={`${route.area} · ${branchLabel(route)}`}
      onClose={onClose}
      panelClassName="modal-panel--70 route-modal"
      footer={
        <div className="route-detail-footer">
          {canManage ? (
            <>
              {route.assignedFieldAgentId ? (
                <>
                  <button
                    type="button"
                    className="route-btn route-btn--secondary"
                    onClick={onReassignAgent}
                  >
                    Reassign agent
                  </button>
                  <button
                    type="button"
                    className="route-btn route-btn--danger"
                    onClick={onUnassignAgent}
                  >
                    Unassign agent
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className="route-btn route-btn--primary"
                  onClick={onAssignAgent}
                >
                  Assign agent
                </button>
              )}
              <button
                type="button"
                className="route-btn route-btn--secondary"
                onClick={onManageMembers}
              >
                Manage members
              </button>
            </>
          ) : null}
          <button type="button" className="route-btn route-btn--secondary" onClick={onClose}>
            Close
          </button>
        </div>
      }
    >
      <div className="route-detail-modern">
        <div className="route-detail-modern__stats">
          <div className="route-detail-stat">
            <span className="route-detail-stat__label">Branch</span>
            <strong className="route-detail-stat__value">{branchLabel(route)}</strong>
          </div>
          <div className="route-detail-stat">
            <span className="route-detail-stat__label">Status</span>
            <div>
              <span
                className={`route-badge route-badge--${route.status === "active" ? "success" : "muted"}`}
              >
                <span className="route-badge__dot" />
                {route.status === "active" ? "Active" : "Inactive"}
              </span>
            </div>
          </div>
          <div className="route-detail-stat">
            <span className="route-detail-stat__label">Responsible mobilizer</span>
            {route.assignedFieldAgentName || route.assignedFieldAgentId ? (
              <div className="route-agent-chip">
                <span className="route-avatar">
                  {initialsFromName(route.assignedFieldAgentName ?? route.assignedFieldAgentId ?? "")}
                </span>
                <strong>{route.assignedFieldAgentName ?? route.assignedFieldAgentId}</strong>
              </div>
            ) : (
              <span className="route-badge route-badge--warning">Unassigned</span>
            )}
          </div>
          <div className="route-detail-stat">
            <span className="route-detail-stat__label">Route members</span>
            <div className="route-detail-stat__row">
              <strong className="route-detail-stat__number">{route.memberCount ?? 0}</strong>
              {canManage ? (
                <button type="button" className="route-link-btn" onClick={onManageMembers}>
                  Manage members →
                </button>
              ) : null}
            </div>
          </div>
        </div>

        <div className="route-detail-modern__areas">
          <span className="route-detail-stat__label">Primary area &amp; covered communities</span>
          <div className="route-community-chips">
            <span className="route-community-chip route-community-chip--primary">{route.area}</span>
            {(route.communities ?? []).map((c) => (
              <span key={c} className="route-community-chip">
                {c}
              </span>
            ))}
          </div>
          {(!route.communities || route.communities.length === 0) ? (
            <p className="muted" style={{ margin: "0.4rem 0 0", fontSize: "0.8rem" }}>
              Add covered communities in Edit route to enable precise location-based route matching.
            </p>
          ) : null}
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
  onQuickPick,
  emptyHint
}: {
  title: string;
  description: string;
  routes: FieldRoute[];
  selectedId: string;
  onSelect: (id: string) => void;
  actionLabel: string;
  onAction: () => void;
  onQuickPick: (route: FieldRoute) => void;
  emptyHint: string;
}) {
  return (
    <section className="card routes-panel">
      <header className="routes-panel__head">
        <div>
          <h3>{title}</h3>
          <p className="muted">{description}</p>
        </div>
        <span className="route-badge route-badge--muted">{routes.length} routes</span>
      </header>
      {routes.length === 0 ? (
        <div className="routes-empty-state">
          <p className="muted">{emptyHint}</p>
        </div>
      ) : (
        <>
          <div className="routes-picker-bar">
            <label className="route-field">
              <span className="route-field__label">Select route</span>
              <select
                className="route-select"
                value={selectedId}
                onChange={(e) => onSelect(e.target.value)}
              >
                <option value="">Choose a route…</option>
                {routes.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name} · {branchLabel(r)}
                    {r.assignedFieldAgentName ? ` · ${r.assignedFieldAgentName}` : " · No agent"}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="route-btn route-btn--primary"
              disabled={!selectedId}
              onClick={onAction}
            >
              {actionLabel}
            </button>
          </div>

          <div className="routes-quick-grid">
            {routes.map((r) => {
              const isSelected = r.id === selectedId;
              return (
                <button
                  key={r.id}
                  type="button"
                  className={`routes-quick-card${isSelected ? " is-selected" : ""}`}
                  onClick={() => {
                    onSelect(r.id);
                    onQuickPick(r);
                  }}
                >
                  <div className="routes-quick-card__top">
                    <strong>{r.name}</strong>
                    <span
                      className={`route-badge route-badge--${r.status === "active" ? "success" : "muted"}`}
                    >
                      {r.memberCount ?? 0} members
                    </span>
                  </div>
                  <span className="routes-quick-card__sub">
                    {r.area} · {branchLabel(r)}
                  </span>
                  <div className="routes-quick-card__foot">
                    {r.assignedFieldAgentName ? (
                      <span className="route-agent-chip route-agent-chip--sm">
                        <span className="route-avatar route-avatar--sm">
                          {initialsFromName(r.assignedFieldAgentName)}
                        </span>
                        {r.assignedFieldAgentName}
                      </span>
                    ) : (
                      <span className="route-badge route-badge--warning">No agent</span>
                    )}
                    <span className="routes-quick-card__cta">{actionLabel} →</span>
                  </div>
                </button>
              );
            })}
          </div>
        </>
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
  const routeSettings = useRoutesStore((s) => s.settings);
  const liveBranches = useBranchesStore((s) => s.branches);
  const branches = liveBranches.length > 0 ? liveBranches : routeBranches;
  const loading = useRoutesStore((s) => s.loading);
  const error = useRoutesStore((s) => s.error);
  const lastFetchedAt = useRoutesStore((s) => s.lastFetchedAt);
  const refresh = useRoutesStore((s) => s.refresh);
  const refreshSilent = useRoutesStore((s) => s.refreshSilent);
  const removeRoute = useRoutesStore((s) => s.removeRoute);
  const allCustomers = useCustomersStore((s) => s.customers);

  const [tab, setTab] = useState<WorkspaceTab>("routes");
  const [search, setSearch] = useState("");
  const [branchFilter, setBranchFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<"" | "active" | "inactive">("");
  const [agentCoverageFilter, setAgentCoverageFilter] = useState<"" | "assigned" | "unassigned">("");
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
    if (statusFilter) {
      list = list.filter((r) => r.status === statusFilter);
    }
    if (agentCoverageFilter === "assigned") {
      list = list.filter((r) => Boolean(r.assignedFieldAgentId));
    } else if (agentCoverageFilter === "unassigned") {
      list = list.filter((r) => !r.assignedFieldAgentId);
    }
    return filterRowsBySearch(list, search, [
      "name",
      "area",
      "branchName",
      "assignedFieldAgentName"
    ] as (keyof FieldRoute)[]);
  }, [routes, search, branchFilter, statusFilter, agentCoverageFilter]);

  const hasListFilters = Boolean(branchFilter || statusFilter || agentCoverageFilter || search);

  const kpis = useMemo(() => {
    const active = routes.filter((r) => r.status === "active").length;
    const members = routes.reduce((sum, r) => sum + (r.memberCount ?? 0), 0);
    const unassignedRoutes = routes.filter((r) => !r.assignedFieldAgentId).length;
    const unassignedCustomers = allCustomers.filter(
      (c) => c.status === "active" && !c.routeId
    ).length;
    return {
      total: routes.length,
      active,
      members,
      unassignedRoutes,
      unassignedCustomers
    };
  }, [routes, allCustomers]);

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
      { label: "Edit route", onClick: () => openEdit(row) },
      {
        label: "Manage members",
        onClick: () => {
          setMembersRoute(row);
          setMembersPickId(row.id);
        }
      },
      { label: "Delete route", onClick: () => void handleDelete(row), danger: true }
    );
    return items;
  }

  async function handleDelete(route: FieldRoute) {
    const ok = await confirm({
      title: "Delete route",
      message: `Delete route "${route.name}"? Members will be unlinked while assignment history is preserved.`,
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

  const tabs: Array<{
    id: WorkspaceTab;
    label: string;
    badge?: number;
    manageOnly?: boolean;
    icon: JSX.Element;
  }> = [
    {
      id: "routes",
      label: "All routes",
      badge: routes.length,
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path d="M9 20l-5.447-2.724A1 1 0 0 1 3 16.382V5.618a1 1 0 0 1 1.447-.894L9 7m0 13 6-3m-6 3V7m6 10 5.447 2.724A1 1 0 0 0 21 18.83V8.118a1 1 0 0 0-.553-.894L15 4m0 13V4m0 0L9 7" />
        </svg>
      )
    },
    {
      id: "reorganize",
      label: "Route Reorganization",
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path d="M16 3h5v5M4 20 21 3M21 16v5h-5M15 15l6 6M4 4l5 5" />
        </svg>
      )
    },
    {
      id: "assign",
      label: "Assign agent",
      manageOnly: true,
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M19 8v6M22 11h-6" />
        </svg>
      )
    },
    {
      id: "members",
      label: "Members",
      manageOnly: true,
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
        </svg>
      )
    },
    {
      id: "transfers",
      label: "Transfers",
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path d="M7 16V4m0 0L3 8m4-4 4 4M17 8v12m0 0 4-4m-4 4-4-4" />
        </svg>
      )
    }
  ];

  return (
    <div className="routes-workspace">
      <header className="routes-hero">
        <div className="routes-hero__left">
          <div className="routes-hero__icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="6" cy="19" r="3" />
              <path d="M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15" />
              <circle cx="18" cy="5" r="3" />
            </svg>
          </div>
          <div className="routes-hero__copy">
            <div className="routes-hero__title-row">
              <h2>Routes</h2>
              {routeSettings ? (
                <button
                  type="button"
                  className="route-strategy-pill"
                  onClick={() => setTab("reorganize")}
                  title="Configure route assignment strategy"
                >
                  <span className="route-strategy-pill__dot" />
                  <span>{ROUTE_ASSIGNMENT_STRATEGY_LABELS[routeSettings.strategy]} mode</span>
                </button>
              ) : null}
            </div>
            <p className="muted">
              Organize collection territories, assign mobilizers, review location matches, and
              audit route changes across branches.
              {error ? ` ${error}` : ""}
            </p>
          </div>
        </div>

        <div className="routes-hero__actions">
          {role === "admin" ? (
            <Link to="/app/susu/agents" className="route-btn route-btn--secondary">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
              </svg>
              Field agents
            </Link>
          ) : null}
          <button
            type="button"
            className="route-btn route-btn--secondary"
            disabled={loading}
            onClick={() => void refresh()}
            title="Refresh routes"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              className={loading ? "route-spin" : undefined}
              aria-hidden="true"
            >
              <path d="M21 12a9 9 0 1 1-2.64-6.36" />
              <polyline points="21 3 21 9 15 9" />
            </svg>
            {loading ? "Syncing…" : "Refresh"}
          </button>
          {canManage ? (
            <button type="button" className="route-btn route-btn--primary" onClick={openCreate}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              Add route
            </button>
          ) : null}
        </div>
      </header>

      <div className="routes-kpi-grid">
        <article className="routes-kpi routes-kpi--primary">
          <div className="routes-kpi__icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
              <circle cx="12" cy="10" r="3" />
            </svg>
          </div>
          <div className="routes-kpi__body">
            <span className="routes-kpi__label">Active routes</span>
            <p className="routes-kpi__value">
              {kpis.active}
              <span className="routes-kpi__sub"> / {kpis.total} total</span>
            </p>
          </div>
        </article>

        <article className="routes-kpi routes-kpi--success">
          <div className="routes-kpi__icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
            </svg>
          </div>
          <div className="routes-kpi__body">
            <span className="routes-kpi__label">Customers on routes</span>
            <p className="routes-kpi__value">{kpis.members}</p>
          </div>
        </article>

        <article className="routes-kpi routes-kpi--warning">
          <div className="routes-kpi__icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
          </div>
          <div className="routes-kpi__body">
            <span className="routes-kpi__label">Routes without agent</span>
            <p className="routes-kpi__value">{kpis.unassignedRoutes}</p>
          </div>
        </article>

        <button
          type="button"
          className="routes-kpi routes-kpi--accent routes-kpi--interactive"
          onClick={() => setTab("reorganize")}
          title="Open Route Reorganization to organize unassigned customers"
        >
          <div className="routes-kpi__icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M16 3h5v5M4 20 21 3M21 16v5h-5M15 15l6 6" />
            </svg>
          </div>
          <div className="routes-kpi__body">
            <span className="routes-kpi__label">Customers without route</span>
            <p className="routes-kpi__value">
              {kpis.unassignedCustomers}
              <span className="routes-kpi__sub"> · Organize →</span>
            </p>
          </div>
        </button>
      </div>

      <nav className="routes-tabs" aria-label="Routes workspace">
        {tabs
          .filter((t) => !t.manageOnly || canManage)
          .map((t) => (
            <button
              key={t.id}
              type="button"
              className={`routes-tab${tab === t.id ? " is-active" : ""}`}
              onClick={() => setTab(t.id)}
            >
              <span className="routes-tab__icon">{t.icon}</span>
              <span>{t.label}</span>
              {t.badge !== undefined ? <span className="routes-tab__badge">{t.badge}</span> : null}
            </button>
          ))}
      </nav>

      {tab === "routes" ? (
        <section className="card routes-panel routes-panel--table">
          <div className="routes-filter-bar">
            {branches.length > 0 ? (
              <label className="route-field">
                <span className="route-field__label">Branch</span>
                <select
                  className="route-select"
                  value={branchFilter}
                  onChange={(e) => setBranchFilter(e.target.value)}
                >
                  <option value="">All branches</option>
                  {branches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name} ({b.code})
                    </option>
                  ))}
                </select>
              </label>
            ) : null}

            <label className="route-field">
              <span className="route-field__label">Status</span>
              <select
                className="route-select"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as "" | "active" | "inactive")}
              >
                <option value="">All statuses</option>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </label>

            <label className="route-field">
              <span className="route-field__label">Agent coverage</span>
              <select
                className="route-select"
                value={agentCoverageFilter}
                onChange={(e) =>
                  setAgentCoverageFilter(e.target.value as "" | "assigned" | "unassigned")
                }
              >
                <option value="">Any coverage</option>
                <option value="assigned">Agent assigned</option>
                <option value="unassigned">Unassigned only</option>
              </select>
            </label>

            {hasListFilters ? (
              <button
                type="button"
                className="route-btn route-btn--ghost"
                onClick={() => {
                  setBranchFilter("");
                  setStatusFilter("");
                  setAgentCoverageFilter("");
                  setSearch("");
                }}
              >
                Reset filters
              </button>
            ) : null}
          </div>

          <AdminDataTable
            columns={[
              {
                key: "name",
                label: "Route & Coverage",
                render: (row) => (
                  <div className="route-cell-primary">
                    <strong>{row.name}</strong>
                    <div className="route-cell-meta">
                      <span>{row.area}</span>
                    </div>
                    {row.communities && row.communities.length > 0 ? (
                      <div className="route-community-chips">
                        {row.communities.slice(0, 3).map((c) => (
                          <span key={c} className="route-community-chip">
                            {c}
                          </span>
                        ))}
                        {row.communities.length > 3 ? (
                          <span className="route-community-chip">
                            +{row.communities.length - 3}
                          </span>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                )
              },
              {
                key: "branch",
                label: "Branch",
                render: (row) => <span className="route-branch-text">{branchLabel(row)}</span>
              },
              {
                key: "agent",
                label: "Mobilizer",
                render: (row) =>
                  row.assignedFieldAgentName ? (
                    <span className="route-agent-chip">
                      <span className="route-avatar">
                        {initialsFromName(row.assignedFieldAgentName)}
                      </span>
                      <span>{row.assignedFieldAgentName}</span>
                    </span>
                  ) : canManage ? (
                    <button
                      type="button"
                      className="route-badge route-badge--warning route-badge--btn"
                      onClick={() => openAssignAgent(row)}
                    >
                      + Assign agent
                    </button>
                  ) : (
                    <span className="route-badge route-badge--muted">Unassigned</span>
                  )
              },
              {
                key: "members",
                label: "Members",
                render: (row) => (
                  <button
                    type="button"
                    className="route-member-pill"
                    onClick={() => {
                      setMembersRoute(row);
                      setMembersPickId(row.id);
                    }}
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                      <circle cx="9" cy="7" r="4" />
                    </svg>
                    <strong>{row.memberCount ?? 0}</strong>
                  </button>
                )
              },
              {
                key: "status",
                label: "Status",
                render: (row) => (
                  <span
                    className={`route-badge route-badge--${row.status === "active" ? "success" : "muted"}`}
                  >
                    <span className="route-badge__dot" />
                    {row.status === "active" ? "Active" : "Inactive"}
                  </span>
                )
              }
            ]}
            rows={filtered}
            rowKey={(row) => row.id}
            search={search}
            onSearchChange={setSearch}
            searchPlaceholder="Search route name, area, branch, or mobilizer…"
            emptyMessage={initialLoad ? "Loading routes…" : "No routes match your filters."}
            actions={(row) => (
              <div className="route-row-actions">
                <button
                  type="button"
                  className="route-btn route-btn--secondary route-btn--sm"
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
      ) : null}

      {tab === "reorganize" ? (
        <RouteReorganizationPanel
          role={role}
          canManage={canManage}
          onReorganized={afterMembershipChange}
        />
      ) : null}

      {tab === "assign" && canManage ? (
        <RoutePickerPanel
          title="Assign field agent"
          description="Pick a route below to assign or replace its responsible mobilizer. Members sync automatically based on your tenant strategy."
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
          onQuickPick={(route) => openAssignAgent(route)}
          emptyHint="Create a route first, then assign a field agent."
        />
      ) : null}

      {tab === "members" && canManage ? (
        <RoutePickerPanel
          title="Route members"
          description="Choose a route to add or remove active branch customers. Original creators and financial records are never altered."
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
          onQuickPick={(route) => setMembersRoute(route)}
          emptyHint="Create a route first, then add route members."
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
