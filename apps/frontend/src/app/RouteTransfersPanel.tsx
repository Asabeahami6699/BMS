import { useEffect, useMemo, useState } from "react";
import type { Customer, FieldAgentOption, FieldRoute } from "./api";
import { assignCustomerFieldAgent, listFieldAgents } from "./api";
import { filterRowsBySearch } from "../components/AdminDataTable";
import { useToast } from "../components/Toast";
import { toUserFacingError } from "../lib/networkError";
import { formatBranchLabel } from "./branchDisplay";
import { useAgentsStore } from "./stores/agentsStore";
import { useCustomersStore } from "./stores/customersStore";
import { useRoutesStore } from "./stores/routesStore";

const STATUS_LABEL: Record<Customer["status"], string> = {
  pending_activation: "Pending",
  active: "Active",
  rejected: "Rejected",
  suspended: "Suspended",
  inactive: "Inactive",
  dormant: "Dormant",
  closed: "Closed"
};

const STATUS_TONE: Record<Customer["status"], "success" | "warning" | "muted"> = {
  pending_activation: "warning",
  active: "success",
  rejected: "muted",
  suspended: "muted",
  inactive: "muted",
  dormant: "warning",
  closed: "muted"
};

type Props = {
  canManage: boolean;
  onTransferred: () => void;
};

function formatAccountTypeLabel(accountType?: Customer["accountType"]): string | null {
  switch (accountType) {
    case "susu":
      return "Susu";
    case "savings":
      return "Savings";
    case "group":
      return "Group";
    case "meba_daakye":
      return "Meba Daakye";
    default:
      return accountType ? String(accountType).replace(/_/g, " ") : null;
  }
}

function initialsFromName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0] ?? ""}${parts[parts.length - 1]![0] ?? ""}`.toUpperCase();
}

export function RouteTransfersPanel({ canManage, onTransferred }: Props) {
  const { showToast } = useToast();
  const allCustomers = useCustomersStore((s) => s.customers);
  const customersLoading = useCustomersStore((s) => s.loading);
  const upsertCustomer = useCustomersStore((s) => s.upsertCustomer);
  const routes = useRoutesStore((s) => s.routes);
  const agentsRoster = useAgentsStore((s) => s.roster);

  const [agentsFallback, setAgentsFallback] = useState<FieldAgentOption[]>([]);
  const [sourceAgentId, setSourceAgentId] = useState("");
  const [sourceRouteId, setSourceRouteId] = useState("");
  const [search, setSearch] = useState("");
  const [targetByCustomer, setTargetByCustomer] = useState<
    Record<string, { agentId: string; routeId: string }>
  >({});
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    useCustomersStore.getState().hydrate();
    useAgentsStore.getState().hydrate();
    if (agentsRoster.length === 0) {
      void listFieldAgents()
        .then((rows) => setAgentsFallback(rows))
        .catch(() => setAgentsFallback([]));
    }
  }, [agentsRoster.length]);

  const agents = useMemo(() => {
    const raw = agentsRoster.length > 0 ? agentsRoster : agentsFallback;
    return raw
      .filter((a) => a.status === "active")
      .map((a) => ({
        userId: a.userId,
        label: a.fullName?.trim() || a.email || a.userId,
        branchId: a.branchId
      }));
  }, [agentsRoster, agentsFallback]);

  const routeById = useMemo(() => {
    const map = new Map<string, FieldRoute>();
    for (const route of routes) {
      map.set(route.id, route);
    }
    return map;
  }, [routes]);

  const sourceCustomers = useMemo(() => {
    let list = allCustomers.filter((c) => c.status === "active" || c.status === "pending_activation");
    if (sourceAgentId) {
      list = list.filter((c) => c.assignedFieldAgentId === sourceAgentId);
    } else {
      list = list.filter((c) => Boolean(c.assignedFieldAgentId));
    }
    if (sourceRouteId) {
      list = list.filter((c) => c.routeId === sourceRouteId);
    }
    return list;
  }, [allCustomers, sourceAgentId, sourceRouteId]);

  const filtered = useMemo(
    () =>
      filterRowsBySearch(sourceCustomers, search, [
        "fullName",
        "phone",
        "accountNumber",
        "assignedFieldAgentName"
      ] as (keyof Customer)[]),
    [sourceCustomers, search]
  );

  const loading = customersLoading && allCustomers.length === 0;
  const hasFilters = Boolean(sourceAgentId || sourceRouteId || search);

  function routesForAgent(agentId: string, homeBranchId: string): FieldRoute[] {
    return routes.filter(
      (r) =>
        r.status === "active" &&
        r.assignedFieldAgentId === agentId &&
        r.branchId === homeBranchId
    );
  }

  function setTarget(
    customerId: string,
    patch: Partial<{ agentId: string; routeId: string }>
  ) {
    setTargetByCustomer((prev) => {
      const current = prev[customerId] ?? { agentId: "", routeId: "" };
      const next = { ...current, ...patch };
      if (patch.agentId !== undefined) {
        next.routeId = "";
      }
      return { ...prev, [customerId]: next };
    });
  }

  async function handleTransfer(customer: Customer) {
    if (!canManage) {
      return;
    }
    const target = targetByCustomer[customer.id];
    if (!target?.agentId) {
      showToast("Choose a destination agent", "error");
      return;
    }
    if (target.agentId === customer.assignedFieldAgentId && !target.routeId) {
      showToast("Choose a different agent or route", "info");
      return;
    }

    const agentRoutes = routesForAgent(target.agentId, customer.homeBranchId);
    let routeId: string | null | undefined;
    if (target.routeId) {
      routeId = target.routeId;
    } else if (agentRoutes.length === 1) {
      routeId = agentRoutes[0]!.id;
    } else if (agentRoutes.length === 0) {
      routeId = null;
    } else {
      showToast("This agent has multiple routes — pick one", "error");
      return;
    }

    setBusyId(customer.id);
    try {
      const updated = await assignCustomerFieldAgent(customer.id, target.agentId, { routeId });
      upsertCustomer(updated);
      const agentLabel = agents.find((a) => a.userId === target.agentId)?.label ?? "agent";
      const routeLabel = routeId ? routeById.get(routeId)?.name : null;
      showToast(
        routeLabel
          ? `${customer.fullName} → ${agentLabel} · ${routeLabel}`
          : `${customer.fullName} → ${agentLabel}`,
        "success"
      );
      setTargetByCustomer((prev) => {
        const next = { ...prev };
        delete next[customer.id];
        return next;
      });
      onTransferred();
      void useCustomersStore.getState().refreshSilent();
      void useRoutesStore.getState().refreshSilent();
    } catch (error) {
      showToast(toUserFacingError(error, "Transfer failed"), "error");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="card routes-panel">
      <header className="routes-panel__head">
        <div>
          <h3>Individual transfers</h3>
          <p className="muted">
            Move individual customers between mobilizers. Original account creators and financial
            history remain untouched, and every change is logged to assignment history.
          </p>
        </div>
        <span className="route-badge route-badge--muted">
          {filtered.length} customer{filtered.length === 1 ? "" : "s"}
        </span>
      </header>

      <div className="routes-filter-bar routes-filter-bar--3">
        <label className="route-field">
          <span className="route-field__label">From mobilizer</span>
          <select
            className="route-select"
            value={sourceAgentId}
            onChange={(e) => setSourceAgentId(e.target.value)}
          >
            <option value="">All assigned customers</option>
            {agents.map((a) => (
              <option key={a.userId} value={a.userId}>
                {a.label}
              </option>
            ))}
          </select>
        </label>

        <label className="route-field">
          <span className="route-field__label">From route</span>
          <select
            className="route-select"
            value={sourceRouteId}
            onChange={(e) => setSourceRouteId(e.target.value)}
          >
            <option value="">Any route</option>
            {routes
              .filter((r) => r.status === "active")
              .map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name} · {formatBranchLabel(r.branchId, [], r.branchName, r.branchCode)}
                </option>
              ))}
          </select>
        </label>

        <label className="route-field">
          <span className="route-field__label">Search customer</span>
          <div className="route-search-wrap">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              type="search"
              className="route-input route-input--search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Name, phone, account #…"
            />
          </div>
        </label>

        {hasFilters ? (
          <button
            type="button"
            className="route-btn route-btn--ghost"
            onClick={() => {
              setSourceAgentId("");
              setSourceRouteId("");
              setSearch("");
            }}
          >
            Reset
          </button>
        ) : null}
      </div>

      {loading ? (
        <div className="routes-empty-state">
          <p className="muted">Loading customers…</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="routes-empty-state">
          <p className="muted">No customers match these filters.</p>
        </div>
      ) : (
        <ul className="routes-transfer-list">
          {filtered.map((customer) => {
            const isBusy = busyId === customer.id;
            const target = targetByCustomer[customer.id] ?? { agentId: "", routeId: "" };
            const destRoutes = target.agentId
              ? routesForAgent(target.agentId, customer.homeBranchId)
              : [];
            const currentRoute = customer.routeId ? routeById.get(customer.routeId) : undefined;
            const accountTypeLabel = formatAccountTypeLabel(customer.accountType);
            return (
              <li key={customer.id} className="routes-transfer-row">
                <div className="routes-transfer-row__info">
                  <span className="route-avatar route-avatar--lg" aria-hidden="true">
                    {initialsFromName(customer.fullName)}
                  </span>
                  <div className="routes-transfer-row__main">
                    <div className="routes-transfer-row__title">
                      <strong>{customer.fullName}</strong>
                      {accountTypeLabel ? (
                        <span
                          className={`route-badge route-badge--${
                            customer.accountType === "savings" ? "warning" : "primary"
                          }`}
                        >
                          {accountTypeLabel}
                        </span>
                      ) : null}
                      <span className={`route-badge route-badge--${STATUS_TONE[customer.status]}`}>
                        {STATUS_LABEL[customer.status]}
                      </span>
                    </div>
                    <div className="route-cell-meta">
                      <span>{customer.accountNumber ?? "No account #"}</span>
                      <span>·</span>
                      <span>{customer.phone}</span>
                      {customer.location ? (
                        <>
                          <span>·</span>
                          <span>{customer.location}</span>
                        </>
                      ) : null}
                    </div>
                    <div className="routes-transfer-row__current">
                      <span className="route-mini-pill">
                        Mobilizer: <strong>{customer.assignedFieldAgentName ?? "—"}</strong>
                      </span>
                      <span className="route-mini-pill">
                        Route: <strong>{currentRoute ? currentRoute.name : "Unassigned"}</strong>
                      </span>
                    </div>
                  </div>
                </div>

                {canManage ? (
                  <div className="routes-transfer-row__actions">
                    <label className="route-field">
                      <span className="route-field__label">Destination mobilizer</span>
                      <select
                        className="route-select"
                        value={target.agentId}
                        disabled={isBusy}
                        onChange={(e) => setTarget(customer.id, { agentId: e.target.value })}
                      >
                        <option value="">Choose mobilizer…</option>
                        {agents
                          .filter((a) => a.userId !== customer.assignedFieldAgentId)
                          .map((a) => (
                            <option key={a.userId} value={a.userId}>
                              {a.label}
                            </option>
                          ))}
                      </select>
                    </label>
                    <label className="route-field">
                      <span className="route-field__label">Destination route</span>
                      <select
                        className="route-select"
                        value={target.routeId}
                        disabled={isBusy || !target.agentId || destRoutes.length === 0}
                        onChange={(e) => setTarget(customer.id, { routeId: e.target.value })}
                      >
                        <option value="">
                          {destRoutes.length === 0
                            ? "No route (agent only)"
                            : destRoutes.length === 1
                              ? destRoutes[0]!.name
                              : "Pick route…"}
                        </option>
                        {destRoutes.length > 1
                          ? destRoutes.map((r) => (
                              <option key={r.id} value={r.id}>
                                {r.name}
                              </option>
                            ))
                          : null}
                      </select>
                    </label>
                    <button
                      type="button"
                      className="route-btn route-btn--primary"
                      disabled={isBusy || !target.agentId}
                      onClick={() => void handleTransfer(customer)}
                    >
                      {isBusy ? "Moving…" : "Transfer →"}
                    </button>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
