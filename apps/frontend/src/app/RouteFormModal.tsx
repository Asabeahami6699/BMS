import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import type { Branch, FieldRoute } from "./api";
import { createFieldRoute, listFieldAgents, updateFieldRoute } from "./api";
import { Modal } from "../components/Modal";
import { useToast } from "../components/Toast";

type Mode = "create" | "edit";
type CreateStep = "details" | "assign-agent";

type AgentOption = {
  userId: string;
  label: string;
  branchId?: string;
};

type Props = {
  open: boolean;
  mode: Mode;
  route: FieldRoute | null;
  branches: Branch[];
  onClose: () => void;
  onSaved: () => void;
};

function branchLabelForRoute(route: FieldRoute, branches: Branch[]): string {
  const branch = branches.find((b) => b.id === route.branchId);
  if (branch) {
    return `${branch.name} (${branch.code})`;
  }
  return route.branchName && route.branchCode
    ? `${route.branchName} (${route.branchCode})`
    : route.branchId;
}

export function RouteFormModal({ open, mode, route, branches, onClose, onSaved }: Props) {
  const { showToast } = useToast();
  const [name, setName] = useState("");
  const [area, setArea] = useState("");
  const [branchId, setBranchId] = useState("");
  const [agentId, setAgentId] = useState("");
  const [status, setStatus] = useState<"active" | "inactive">("active");
  const [agents, setAgents] = useState<AgentOption[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [createStep, setCreateStep] = useState<CreateStep>("details");
  const [createdRoute, setCreatedRoute] = useState<FieldRoute | null>(null);
  const wasOpenRef = useRef(false);

  const activeBranches = useMemo(
    () => branches.filter((b) => b.status !== "inactive"),
    [branches]
  );

  const assignBranchId = createdRoute?.branchId ?? branchId;

  function agentsMatchingBranch(targetBranchId: string | undefined): AgentOption[] {
    if (!targetBranchId) {
      return agents;
    }
    const matching = agents.filter((a) => !a.branchId || a.branchId === targetBranchId);
    return matching.length > 0 ? matching : agents;
  }

  const agentsForBranch = useMemo(
    () => agentsMatchingBranch(assignBranchId),
    [agents, assignBranchId]
  );

  const editAgents = useMemo(() => agentsMatchingBranch(branchId), [agents, branchId]);

  function resetCreateFlow() {
    setCreateStep("details");
    setCreatedRoute(null);
  }

  function handleClose() {
    resetCreateFlow();
    onClose();
  }

  useEffect(() => {
    if (!open) {
      wasOpenRef.current = false;
      resetCreateFlow();
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
    if (!open) {
      wasOpenRef.current = false;
      return;
    }
    if (wasOpenRef.current) {
      return;
    }
    wasOpenRef.current = true;
    resetCreateFlow();

    if (mode === "edit" && route) {
      setName(route.name);
      setArea(route.area);
      setBranchId(route.branchId);
      setAgentId(route.assignedFieldAgentId ?? "");
      setStatus(route.status);
      return;
    }

    setName("");
    setArea("");
    setBranchId(activeBranches[0]?.id ?? "");
    setAgentId("");
    setStatus("active");
  }, [open, mode, route, activeBranches]);

  useEffect(() => {
    if (!open || mode !== "create" || createStep !== "details" || branchId) {
      return;
    }
    const first = activeBranches[0]?.id;
    if (first) {
      setBranchId(first);
    }
  }, [open, mode, createStep, branchId, activeBranches]);

  async function handleCreateDetails(event: FormEvent) {
    event.preventDefault();
    if (!name.trim() || !area.trim() || !branchId) {
      showToast("Name, area, and branch are required", "error");
      return;
    }
    setSubmitting(true);
    try {
      const created = await createFieldRoute({
        name: name.trim(),
        area: area.trim(),
        branchId,
        assignedFieldAgentId: null,
        status
      });
      setCreatedRoute(created);
      setCreateStep("assign-agent");
      setAgentId("");
      showToast("Route created — assign a field agent", "success");
      onSaved();
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Failed to create route", "error");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleAssignAgent(event: FormEvent) {
    event.preventDefault();
    if (!createdRoute) {
      return;
    }
    if (!agentId.trim()) {
      showToast("Select a field agent to assign", "error");
      return;
    }
    setSubmitting(true);
    try {
      await updateFieldRoute(createdRoute.id, {
        assignedFieldAgentId: agentId.trim(),
        syncAgentToMembers: true
      });
      showToast("Field agent assigned to route", "success");
      onSaved();
      handleClose();
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Failed to assign agent", "error");
    } finally {
      setSubmitting(false);
    }
  }

  function handleSkipAssign() {
    showToast("Route saved without an agent", "info");
    handleClose();
  }

  async function handleEditSubmit(event: FormEvent) {
    event.preventDefault();
    if (!route || !name.trim() || !area.trim() || !branchId) {
      showToast("Name, area, and branch are required", "error");
      return;
    }
    setSubmitting(true);
    try {
      await updateFieldRoute(route.id, {
        name: name.trim(),
        area: area.trim(),
        branchId,
        assignedFieldAgentId: agentId.trim() || null,
        status,
        syncAgentToMembers: true
      });
      showToast("Route updated", "success");
      onSaved();
      handleClose();
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Failed to save route", "error");
    } finally {
      setSubmitting(false);
    }
  }

  const isAssignStep = mode === "create" && createStep === "assign-agent" && createdRoute !== null;

  const modalTitle = isAssignStep
    ? "Assign field agent"
    : mode === "create"
      ? "Add route"
      : "Edit route";

  const modalSubtitle = isAssignStep
    ? `${createdRoute!.name} was created. Choose who will collect on this route.`
    : mode === "create"
      ? "Step 1 — route details. You will assign an agent next."
      : "Collection route for a branch and field agent.";

  return (
    <Modal
      open={open}
      title={modalTitle}
      subtitle={modalSubtitle}
      onClose={handleClose}
      footer={
        isAssignStep ? (
          <>
            <button type="button" className="button secondary" onClick={handleSkipAssign}>
              Skip for now
            </button>
            <button
              type="submit"
              form="route-assign-form"
              className="button"
              disabled={submitting || !agentId.trim() || agentsForBranch.length === 0}
            >
              {submitting ? "Assigning…" : "Assign agent"}
            </button>
          </>
        ) : (
          <>
            <button type="button" className="button secondary" onClick={handleClose}>
              Cancel
            </button>
            <button
              type="submit"
              form="route-form"
              className="button"
              disabled={submitting || activeBranches.length === 0}
            >
              {submitting
                ? "Saving…"
                : mode === "create"
                  ? "Create & assign agent"
                  : "Save changes"}
            </button>
          </>
        )
      }
    >
      {isAssignStep && createdRoute ? (
        <form id="route-assign-form" className="stack-form" onSubmit={handleAssignAgent}>
          <div className="route-form-summary" role="status">
            <p>
              <strong>{createdRoute.name}</strong>
              <span className="muted"> · {createdRoute.area}</span>
            </p>
            <p className="muted" style={{ margin: "0.35rem 0 0", fontSize: "0.85rem" }}>
              {branchLabelForRoute(createdRoute, branches)}
            </p>
          </div>
          <label className="field">
            <span>Assigned field agent</span>
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
                No active field agents for this branch. Add one under Field agents, or skip and
                assign later via Edit route.
              </p>
            ) : (
              <p className="muted" style={{ margin: "0.25rem 0 0", fontSize: "0.85rem" }}>
                Customers added to this route will be synced to this agent.
              </p>
            )}
          </label>
        </form>
      ) : (
        <form
          id="route-form"
          className="stack-form"
          onSubmit={mode === "create" ? handleCreateDetails : handleEditSubmit}
        >
          <label className="field">
            <span>Route name</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              placeholder="e.g. Market Circle"
            />
          </label>
          <label className="field">
            <span>Area / locality</span>
            <input
              value={area}
              onChange={(e) => setArea(e.target.value)}
              required
              placeholder="e.g. Osu, Oxford Street"
            />
          </label>
          <label className="field">
            <span>Branch</span>
            <select value={branchId} onChange={(e) => setBranchId(e.target.value)} required>
              <option value="">Select branch</option>
              {activeBranches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name} ({b.code})
                </option>
              ))}
            </select>
            {activeBranches.length === 0 ? (
              <p className="muted" style={{ margin: "0.25rem 0 0", fontSize: "0.85rem" }}>
                No active branches loaded. Add a branch under Settings → Branches, then try again.
              </p>
            ) : null}
          </label>
          {mode === "edit" ? (
            <>
              <label className="field">
                <span>Assigned field agent</span>
                <select value={agentId} onChange={(e) => setAgentId(e.target.value)}>
                  <option value="">Unassigned</option>
                  {editAgents.map((a) => (
                    <option key={a.userId} value={a.userId}>
                      {a.label}
                    </option>
                  ))}
                </select>
                <p className="muted" style={{ margin: "0.25rem 0 0", fontSize: "0.85rem" }}>
                  When saved, members on this route can be synced to this agent.
                </p>
              </label>
              <label className="field">
                <span>Status</span>
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value as "active" | "inactive")}
                >
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </select>
              </label>
            </>
          ) : (
            <p className="muted" style={{ margin: 0, fontSize: "0.85rem" }}>
              After you create the route, you will choose a field agent on the next step.
            </p>
          )}
        </form>
      )}
    </Modal>
  );
}
