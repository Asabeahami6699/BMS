import { FormEvent, useEffect, useMemo, useState } from "react";
import type { FieldRoute } from "./api";
import { listFieldAgents, updateFieldRoute } from "./api";
import { Modal } from "../components/Modal";
import { useToast } from "../components/Toast";

type AgentOption = {
  userId: string;
  label: string;
  branchId?: string;
};

type Props = {
  open: boolean;
  route: FieldRoute | null;
  onClose: () => void;
  onSaved: () => void;
};

export function RouteAssignAgentModal({ open, route, onClose, onSaved }: Props) {
  const { showToast } = useToast();
  const [agents, setAgents] = useState<AgentOption[]>([]);
  const [agentId, setAgentId] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const isReassign = Boolean(route?.assignedFieldAgentId);

  const agentsForBranch = useMemo(() => {
    if (!route?.branchId) {
      return agents;
    }
    const matching = agents.filter((a) => !a.branchId || a.branchId === route.branchId);
    return matching.length > 0 ? matching : agents;
  }, [agents, route?.branchId]);

  useEffect(() => {
    if (!open) {
      return;
    }
    void listFieldAgents()
      .then((rows) =>
        setAgents(
          rows
            .filter((a) => a.status === "active")
            .map((a) => ({
              userId: a.userId,
              label: a.fullName?.trim() || a.email || a.userId,
              branchId: a.branchId
            }))
        )
      )
      .catch(() => setAgents([]));
  }, [open]);

  useEffect(() => {
    if (!open || !route) {
      return;
    }
    setAgentId(route.assignedFieldAgentId ?? "");
  }, [open, route]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!route) {
      return;
    }
    if (!agentId.trim()) {
      showToast("Select a field agent", "error");
      return;
    }
    if (isReassign && agentId === route.assignedFieldAgentId) {
      showToast("Choose a different agent to reassign", "info");
      return;
    }
    setSubmitting(true);
    try {
      await updateFieldRoute(route.id, {
        assignedFieldAgentId: agentId.trim(),
        syncAgentToMembers: true
      });
      showToast(isReassign ? "Agent reassigned" : "Agent assigned to route", "success");
      onSaved();
      onClose();
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Failed to update route agent", "error");
    } finally {
      setSubmitting(false);
    }
  }

  if (!route) {
    return null;
  }

  return (
    <Modal
      open={open}
      title={isReassign ? "Reassign field mobilizer" : "Assign field mobilizer"}
      subtitle={
        isReassign
          ? `Replace the responsible mobilizer on ${route.name}.`
          : `Choose who will collect on ${route.name}.`
      }
      onClose={onClose}
      panelClassName="route-modal"
      footer={
        <>
          <button type="button" className="route-btn route-btn--secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            form="route-assign-agent-form"
            className="route-btn route-btn--primary"
            disabled={submitting || !agentId.trim() || agentsForBranch.length === 0}
          >
            {submitting ? "Saving…" : isReassign ? "Reassign mobilizer" : "Assign mobilizer"}
          </button>
        </>
      }
    >
      <form id="route-assign-agent-form" className="route-form" onSubmit={handleSubmit}>
        <div className="route-form-summary" role="status">
          <div className="route-form-summary__head">
            <strong>{route.name}</strong>
            <span className="route-badge route-badge--muted">{route.memberCount ?? 0} members</span>
          </div>
          <p className="route-cell-meta">{route.area}</p>
          {isReassign ? (
            <p className="route-cell-meta" style={{ marginTop: "0.35rem" }}>
              Current mobilizer:{" "}
              <strong>{route.assignedFieldAgentName ?? route.assignedFieldAgentId}</strong>
            </p>
          ) : null}
        </div>
        <label className="route-field">
          <span className="route-field__label">
            {isReassign ? "New field mobilizer" : "Field mobilizer"}
          </span>
          <select
            className="route-select"
            value={agentId}
            onChange={(e) => setAgentId(e.target.value)}
            required
            autoFocus
          >
            <option value="">Choose a mobilizer…</option>
            {agentsForBranch.map((a) => (
              <option key={a.userId} value={a.userId}>
                {a.label}
              </option>
            ))}
          </select>
          <span className="route-field__hint">
            {agentsForBranch.length === 0
              ? "No active field agents for this branch. Add one under Field agents first."
              : "Customers on this route sync to the selected mobilizer according to your tenant strategy."}
          </span>
        </label>
      </form>
    </Modal>
  );
}
