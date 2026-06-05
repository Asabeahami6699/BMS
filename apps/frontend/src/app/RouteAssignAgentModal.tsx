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
      title={isReassign ? "Reassign field agent" : "Assign field agent"}
      subtitle={
        isReassign
          ? `Replace the agent on ${route.name}. Members can be synced to the new agent.`
          : `Choose who will collect on ${route.name}.`
      }
      onClose={onClose}
      footer={
        <>
          <button type="button" className="button secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            form="route-assign-agent-form"
            className="button"
            disabled={submitting || !agentId.trim() || agentsForBranch.length === 0}
          >
            {submitting ? "Saving…" : isReassign ? "Reassign agent" : "Assign agent"}
          </button>
        </>
      }
    >
      <form id="route-assign-agent-form" className="stack-form" onSubmit={handleSubmit}>
        <div className="route-form-summary" role="status">
          <p>
            <strong>{route.name}</strong>
            <span className="muted"> · {route.area}</span>
          </p>
          {isReassign ? (
            <p className="muted" style={{ margin: "0.35rem 0 0", fontSize: "0.85rem" }}>
              Current agent: {route.assignedFieldAgentName ?? route.assignedFieldAgentId}
            </p>
          ) : null}
        </div>
        <label className="field">
          <span>{isReassign ? "New field agent" : "Field agent"}</span>
          <select
            value={agentId}
            onChange={(e) => setAgentId(e.target.value)}
            required
            autoFocus
          >
            <option value="">Select agent</option>
            {agentsForBranch.map((a) => (
              <option key={a.userId} value={a.userId}>
                {a.label}
              </option>
            ))}
          </select>
          {agentsForBranch.length === 0 ? (
            <p className="muted" style={{ margin: "0.25rem 0 0", fontSize: "0.85rem" }}>
              No active field agents for this branch. Add one under Field agents first.
            </p>
          ) : (
            <p className="muted" style={{ margin: "0.25rem 0 0", fontSize: "0.85rem" }}>
              Customers on this route will be synced to the selected agent when saved.
            </p>
          )}
        </label>
      </form>
    </Modal>
  );
}
