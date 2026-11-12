import { useEffect, useMemo, useState } from "react";
import type { Customer, FieldAgentOption, FieldAgentRosterRow } from "./api";
import { assignCustomerFieldAgent, listFieldAgents } from "./api";
import { useAgentsStore } from "./stores/agentsStore";
import { useCustomersStore } from "./stores/customersStore";
import { useRoutesStore } from "./stores/routesStore";
import { filterRowsBySearch } from "../components/AdminDataTable";
import { Modal } from "../components/Modal";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { useToast } from "../components/Toast";
import { useConfirmDialog } from "../hooks/useConfirmDialog";
import { toUserFacingError } from "../lib/networkError";

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
  agent: FieldAgentRosterRow | null;
  open: boolean;
  onClose: () => void;
  onUpdated: () => void;
};

export function AgentCustomersModal({ agent, open, onClose, onUpdated }: Props) {
  const { showToast } = useToast();
  const { confirm, dialogProps } = useConfirmDialog();
  const allCustomers = useCustomersStore((s) => s.customers);
  const customersLoading = useCustomersStore((s) => s.loading);
  const upsertCustomer = useCustomersStore((s) => s.upsertCustomer);
  const agentsRoster = useAgentsStore((s) => s.roster);
  const routes = useRoutesStore((s) => s.routes);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [transferTo, setTransferTo] = useState<Record<string, string>>({});
  const [transferRoute, setTransferRoute] = useState<Record<string, string>>({});
  const [agentsFallback, setAgentsFallback] = useState<FieldAgentOption[]>([]);

  useEffect(() => {
    if (!open || !agent) {
      setSearch("");
      setTransferTo({});
      setTransferRoute({});
      return;
    }
    useCustomersStore.getState().hydrate();
    useAgentsStore.getState().hydrate();
    useRoutesStore.getState().hydrate();
    if (agentsRoster.length === 0) {
      void listFieldAgents()
        .then((rows) => setAgentsFallback(rows))
        .catch(() => setAgentsFallback([]));
    }
  }, [open, agent, agentsRoster.length]);

  const customers = useMemo(
    () =>
      agent
        ? allCustomers.filter((c) => c.assignedFieldAgentId === agent.userId)
        : [],
    [allCustomers, agent]
  );

  const transferTargets = useMemo(() => {
    const pool =
      agentsRoster.length > 0
        ? agentsRoster.map((r) => ({
            userId: r.userId,
            email: r.email,
            fullName: r.fullName,
            branchId: r.branchId,
            status: r.status
          }))
        : agentsFallback;
    return pool.filter((a) => a.status === "active" && a.userId !== agent?.userId);
  }, [agentsRoster, agentsFallback, agent?.userId]);

  const loading = customersLoading && allCustomers.length === 0;

  const filtered = useMemo(
    () =>
      filterRowsBySearch(customers, search, [
        "fullName",
        "phone",
        "accountNumber",
        "status"
      ] as (keyof Customer)[]),
    [customers, search]
  );

  function routesForAgent(agentId: string, homeBranchId: string) {
    return routes.filter(
      (r) =>
        r.status === "active" &&
        r.assignedFieldAgentId === agentId &&
        r.branchId === homeBranchId
    );
  }

  async function handleTransfer(customer: Customer) {
    const targetId = transferTo[customer.id];
    if (!targetId) {
      showToast("Choose an agent to transfer to", "error");
      return;
    }
    const agentRoutes = routesForAgent(targetId, customer.homeBranchId);
    const pickedRoute = transferRoute[customer.id];
    let routeId: string | null | undefined;
    if (pickedRoute) {
      routeId = pickedRoute;
    } else if (agentRoutes.length === 1) {
      routeId = agentRoutes[0]!.id;
    } else if (agentRoutes.length === 0) {
      routeId = null;
    } else {
      showToast("Pick a destination route for this agent", "error");
      return;
    }

    setBusyId(customer.id);
    try {
      const updated = await assignCustomerFieldAgent(customer.id, targetId, { routeId });
      upsertCustomer(updated);
      const label =
        transferTargets.find((a) => a.userId === targetId)?.fullName ?? "agent";
      showToast(`${customer.fullName} transferred to ${label}`, "success");
      void useCustomersStore.getState().refreshSilent();
      void useRoutesStore.getState().refreshSilent();
      setTransferTo((prev) => {
        const next = { ...prev };
        delete next[customer.id];
        return next;
      });
      setTransferRoute((prev) => {
        const next = { ...prev };
        delete next[customer.id];
        return next;
      });
      onUpdated();
    } catch (error) {
      showToast(toUserFacingError(error, "Transfer failed"), "error");
    } finally {
      setBusyId(null);
    }
  }

  async function handleUnassign(customer: Customer) {
    const ok = await confirm({
      title: "Unassign customer",
      message: `Unassign ${customer.fullName} from ${agent?.displayName}? They will not appear on any agent's list until reassigned.`,
      confirmLabel: "Unassign",
      danger: true
    });
    if (!ok) {
      return;
    }
    setBusyId(customer.id);
    try {
      const updated = await assignCustomerFieldAgent(customer.id, null, { routeId: null });
      upsertCustomer(updated);
      showToast(`${customer.fullName} unassigned`, "success");
      void useCustomersStore.getState().refreshSilent();
      void useRoutesStore.getState().refreshSilent();
      onUpdated();
    } catch (error) {
      showToast(toUserFacingError(error, "Unassign failed"), "error");
    } finally {
      setBusyId(null);
    }
  }

  if (!agent) {
    return null;
  }

  return (
    <Modal
      open={open}
      title={`Customers — ${agent.displayName}`}
      subtitle={`${customers.length} assigned · transfer or unassign below`}
      onClose={onClose}
      panelClassName="modal-panel--70 modal-panel--customer"
      footer={
        <button type="button" className="button secondary" onClick={onClose}>
          Close
        </button>
      }
    >
      <div className="agent-customers-modal">
        <label className="field agent-customers-modal__search">
          <span className="sr-only">Search customers</span>
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, phone, account…"
            disabled={loading}
          />
        </label>

        {loading ? (
          <div className="agent-customers-modal__skeleton">
            {[1, 2, 3].map((n) => (
              <div key={n} className="branch-counter__skeleton-row" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <p className="muted agent-customers-modal__empty">
            {customers.length === 0
              ? "No customers are assigned to this agent."
              : "No customers match your search."}
          </p>
        ) : (
          <ul className="agent-customers-modal__list">
            {filtered.map((customer) => {
              const isBusy = busyId === customer.id;
              return (
                <li key={customer.id} className="agent-customers-modal__row">
                  <div className="agent-customers-modal__row-main">
                    <strong>{customer.fullName}</strong>
                    <span className="muted">
                      {customer.accountNumber ?? "No account #"} · {customer.phone}
                    </span>
                    <span
                      className={`status-pill status-pill--${STATUS_CLASS[customer.status]}`}
                    >
                      {STATUS_LABEL[customer.status]}
                    </span>
                  </div>
                  <div className="agent-customers-modal__row-actions">
                    <label className="field agent-customers-modal__transfer-field">
                      <span className="sr-only">Transfer to</span>
                      <select
                        value={transferTo[customer.id] ?? ""}
                        disabled={isBusy || transferTargets.length === 0}
                        onChange={(e) => {
                          const agentId = e.target.value;
                          setTransferTo((prev) => ({
                            ...prev,
                            [customer.id]: agentId
                          }));
                          setTransferRoute((prev) => {
                            const next = { ...prev };
                            delete next[customer.id];
                            return next;
                          });
                        }}
                      >
                        <option value="">Transfer to…</option>
                        {transferTargets.map((target) => (
                          <option key={target.userId} value={target.userId}>
                            {target.fullName ?? target.email}
                          </option>
                        ))}
                      </select>
                    </label>
                    {(() => {
                      const targetId = transferTo[customer.id];
                      const destRoutes = targetId
                        ? routesForAgent(targetId, customer.homeBranchId)
                        : [];
                      if (destRoutes.length <= 1) {
                        return null;
                      }
                      return (
                        <label className="field agent-customers-modal__transfer-field">
                          <span className="sr-only">Destination route</span>
                          <select
                            value={transferRoute[customer.id] ?? ""}
                            disabled={isBusy}
                            onChange={(e) =>
                              setTransferRoute((prev) => ({
                                ...prev,
                                [customer.id]: e.target.value
                              }))
                            }
                          >
                            <option value="">Pick route…</option>
                            {destRoutes.map((r) => (
                              <option key={r.id} value={r.id}>
                                {r.name}
                              </option>
                            ))}
                          </select>
                        </label>
                      );
                    })()}
                    <button
                      type="button"
                      className="button secondary"
                      disabled={isBusy || !transferTo[customer.id]}
                      onClick={() => void handleTransfer(customer)}
                    >
                      Transfer
                    </button>
                    <button
                      type="button"
                      className="button secondary agent-customers-modal__unassign"
                      disabled={isBusy}
                      onClick={() => void handleUnassign(customer)}
                    >
                      Unassign
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <ConfirmDialog {...dialogProps} />
    </Modal>
  );
}
