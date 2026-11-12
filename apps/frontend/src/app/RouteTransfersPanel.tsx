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

const STATUS_CLASS: Record<Customer["status"], string> = {
  pending_activation: "pending",
  active: "active",
  rejected: "inactive",
  suspended: "inactive",
  inactive: "inactive",
  dormant: "dormant",
  closed: "failed"
};

type Props = {
  canManage: boolean;
  onTransferred: () => void;
};

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
    if (agentsRoster.length > 0) {
      return agentsRoster
        .filter((a) => a.status === "active")
        .map((a) => ({
          userId: a.userId,
          label: a.fullName?.trim() || a.email || a.userId,
          branchId: a.branchId
        }));
    }
    return agentsFallback
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
    <section className="card routes-workspace__panel">
      <header className="routes-workspace__panel-head">
        <div>
          <h3>Transfers</h3>
          <p className="muted">
            Move customers between field agents. Route membership updates with the destination
            agent so Branch &amp; servicing stays current.
          </p>
        </div>
      </header>

      <div className="routes-workspace__filters">
        <label className="field">
          <span>From agent</span>
          <select value={sourceAgentId} onChange={(e) => setSourceAgentId(e.target.value)}>
            <option value="">All assigned customers</option>
            {agents.map((a) => (
              <option key={a.userId} value={a.userId}>
                {a.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>From route</span>
          <select value={sourceRouteId} onChange={(e) => setSourceRouteId(e.target.value)}>
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
        <label className="field routes-workspace__search">
          <span>Search</span>
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Name, phone, account…"
          />
        </label>
      </div>

      {loading ? (
        <p className="muted">Loading customers…</p>
      ) : filtered.length === 0 ? (
        <p className="muted">No customers match these filters.</p>
      ) : (
        <ul className="routes-transfer-list">
          {filtered.map((customer) => {
            const isBusy = busyId === customer.id;
            const target = targetByCustomer[customer.id] ?? { agentId: "", routeId: "" };
            const destRoutes = target.agentId
              ? routesForAgent(target.agentId, customer.homeBranchId)
              : [];
            const currentRoute = customer.routeId ? routeById.get(customer.routeId) : undefined;
            return (
              <li key={customer.id} className="routes-transfer-row">
                <div className="routes-transfer-row__main">
                  <strong>{customer.fullName}</strong>
                  <span className="muted">
                    {customer.accountNumber ?? "No account #"} · {customer.phone}
                  </span>
                  <span className="muted">
                    Agent: {customer.assignedFieldAgentName ?? "—"}
                    {currentRoute ? ` · Route: ${currentRoute.name}` : " · No route"}
                  </span>
                  <span className={`status-pill status-pill--${STATUS_CLASS[customer.status]}`}>
                    {STATUS_LABEL[customer.status]}
                  </span>
                </div>
                {canManage ? (
                  <div className="routes-transfer-row__actions">
                    <label className="field">
                      <span className="sr-only">Transfer to agent</span>
                      <select
                        value={target.agentId}
                        disabled={isBusy}
                        onChange={(e) => setTarget(customer.id, { agentId: e.target.value })}
                      >
                        <option value="">To agent…</option>
                        {agents
                          .filter((a) => a.userId !== customer.assignedFieldAgentId)
                          .map((a) => (
                            <option key={a.userId} value={a.userId}>
                              {a.label}
                            </option>
                          ))}
                      </select>
                    </label>
                    <label className="field">
                      <span className="sr-only">Destination route</span>
                      <select
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
                      className="button"
                      disabled={isBusy || !target.agentId}
                      onClick={() => void handleTransfer(customer)}
                    >
                      {isBusy ? "…" : "Transfer"}
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
