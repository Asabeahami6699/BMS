import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import type { Branch, FieldRoute } from "./api";
import { createFieldRoute, listFieldAgents, updateFieldRoute } from "./api";
import { Modal } from "../components/Modal";
import { useToast } from "../components/Toast";
import { formatBranchLabel } from "./branchDisplay";
import { useBranchesStore } from "./stores/branchesStore";

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
  return formatBranchLabel(route.branchId, branches, route.branchName, route.branchCode);
}

function parseCommunitiesList(raw: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of raw.split(/[,;\n]+/)) {
    const trimmed = part.trim();
    if (!trimmed) {
      continue;
    }
    const key = trimmed.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(trimmed);
  }
  return out;
}

export function RouteFormModal({ open, mode, route, branches, onClose, onSaved }: Props) {
  const { showToast } = useToast();
  const [name, setName] = useState("");
  const [area, setArea] = useState("");
  const [communitiesInput, setCommunitiesInput] = useState("");
  const [branchId, setBranchId] = useState("");
  const [agentId, setAgentId] = useState("");
  const [status, setStatus] = useState<"active" | "inactive">("active");
  const [agents, setAgents] = useState<AgentOption[]>([]);
  const [loadedBranches, setLoadedBranches] = useState<Branch[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [createStep, setCreateStep] = useState<CreateStep>("details");
  const [createdRoute, setCreatedRoute] = useState<FieldRoute | null>(null);
  const wasOpenRef = useRef(false);

  const activeBranches = useMemo(() => {
    const source = branches.length > 0 ? branches : loadedBranches;
    return source.filter((b) => b.status !== "inactive");
  }, [branches, loadedBranches]);

  const parsedCommunities = useMemo(
    () => parseCommunitiesList(communitiesInput),
    [communitiesInput]
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
    if (branches.length === 0) {
      void useBranchesStore
        .getState()
        .refresh()
        .then(() => setLoadedBranches(useBranchesStore.getState().branches))
        .catch(() => setLoadedBranches([]));
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
  }, [open, branches.length]);

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
      setCommunitiesInput((route.communities ?? []).join(", "));
      setBranchId(route.branchId);
      setAgentId(route.assignedFieldAgentId ?? "");
      setStatus(route.status);
      return;
    }

    setName("");
    setArea("");
    setCommunitiesInput("");
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
        communities: parsedCommunities,
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
        communities: parsedCommunities,
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
      ? "Create new route"
      : "Edit route";

  const modalSubtitle = isAssignStep
    ? `${createdRoute!.name} is ready. Choose the responsible mobilizer.`
    : mode === "create"
      ? "Define the territory, covered communities, and branch for this collection route."
      : "Update route details, covered communities, mobilizer, or active status.";

  return (
    <Modal
      open={open}
      title={modalTitle}
      subtitle={modalSubtitle}
      onClose={handleClose}
      panelClassName="route-modal"
      footer={
        isAssignStep ? (
          <>
            <button type="button" className="route-btn route-btn--secondary" onClick={handleSkipAssign}>
              Skip for now
            </button>
            <button
              type="submit"
              form="route-assign-form"
              className="route-btn route-btn--primary"
              disabled={submitting || !agentId.trim() || agentsForBranch.length === 0}
            >
              {submitting ? "Assigning…" : "Assign mobilizer"}
            </button>
          </>
        ) : (
          <>
            <button type="button" className="route-btn route-btn--secondary" onClick={handleClose}>
              Cancel
            </button>
            <button
              type="submit"
              form="route-form"
              className="route-btn route-btn--primary"
              disabled={submitting || activeBranches.length === 0}
            >
              {submitting
                ? "Saving…"
                : mode === "create"
                  ? "Create & next step →"
                  : "Save changes"}
            </button>
          </>
        )
      }
    >
      {mode === "create" ? (
        <div className="route-stepper" aria-label="Route creation progress">
          <div className={`route-stepper__item${!isAssignStep ? " is-active" : " is-done"}`}>
            <span className="route-stepper__num">{isAssignStep ? "✓" : "1"}</span>
            <span>Route details</span>
          </div>
          <div className="route-stepper__line" />
          <div className={`route-stepper__item${isAssignStep ? " is-active" : ""}`}>
            <span className="route-stepper__num">2</span>
            <span>Assign mobilizer</span>
          </div>
        </div>
      ) : null}

      {isAssignStep && createdRoute ? (
        <form id="route-assign-form" className="route-form" onSubmit={handleAssignAgent}>
          <div className="route-form-summary" role="status">
            <div className="route-form-summary__head">
              <strong>{createdRoute.name}</strong>
              <span className="route-badge route-badge--success">Created</span>
            </div>
            <p className="route-cell-meta">
              {createdRoute.area} · {branchLabelForRoute(createdRoute, branches)}
            </p>
          </div>
          <label className="route-field">
            <span className="route-field__label">Responsible field mobilizer</span>
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
                ? "No active field agents for this branch yet. Add one under Field agents, or skip and assign later."
                : "Customers assigned to this route will sync to this mobilizer automatically."}
            </span>
          </label>
        </form>
      ) : (
        <form
          id="route-form"
          className="route-form"
          onSubmit={mode === "create" ? handleCreateDetails : handleEditSubmit}
        >
          <div className="route-form__grid">
            <label className="route-field">
              <span className="route-field__label">Route name</span>
              <input
                className="route-input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                placeholder="e.g. Market Circle"
              />
            </label>
            <label className="route-field">
              <span className="route-field__label">Primary area / locality</span>
              <input
                className="route-input"
                value={area}
                onChange={(e) => setArea(e.target.value)}
                required
                placeholder="e.g. Osu, Oxford Street"
              />
            </label>
          </div>

          <label className="route-field">
            <span className="route-field__label">
              Covered communities / areas (comma-separated, optional)
            </span>
            <input
              className="route-input"
              value={communitiesInput}
              onChange={(e) => setCommunitiesInput(e.target.value)}
              placeholder="e.g. Bondaye, Bondaye Market, Old Town"
            />
            {parsedCommunities.length > 0 ? (
              <div className="route-community-chips" style={{ marginTop: "0.4rem" }}>
                {parsedCommunities.map((c) => (
                  <span key={c} className="route-community-chip route-community-chip--primary">
                    {c}
                  </span>
                ))}
              </div>
            ) : null}
            <span className="route-field__hint">
              Matched against customer locations for Location-Based suggestions and Route Reorganization.
            </span>
          </label>

          <div className={mode === "edit" ? "route-form__grid" : undefined}>
            <label className="route-field">
              <span className="route-field__label">Branch</span>
              <select
                className="route-select"
                value={branchId}
                onChange={(e) => setBranchId(e.target.value)}
                required
              >
                <option value="">Select branch…</option>
                {activeBranches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name} ({b.code})
                  </option>
                ))}
              </select>
              {activeBranches.length === 0 ? (
                <span className="route-field__hint">
                  No active branches loaded. Add a branch under Settings → Branches first.
                </span>
              ) : null}
            </label>

            {mode === "edit" ? (
              <label className="route-field">
                <span className="route-field__label">Status</span>
                <select
                  className="route-select"
                  value={status}
                  onChange={(e) => setStatus(e.target.value as "active" | "inactive")}
                >
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </select>
              </label>
            ) : null}
          </div>

          {mode === "edit" ? (
            <label className="route-field">
              <span className="route-field__label">Responsible field mobilizer</span>
              <select
                className="route-select"
                value={agentId}
                onChange={(e) => setAgentId(e.target.value)}
              >
                <option value="">Unassigned</option>
                {editAgents.map((a) => (
                  <option key={a.userId} value={a.userId}>
                    {a.label}
                  </option>
                ))}
              </select>
              <span className="route-field__hint">
                When saved, route members sync to this mobilizer according to your tenant strategy.
              </span>
            </label>
          ) : null}
        </form>
      )}
    </Modal>
  );
}
