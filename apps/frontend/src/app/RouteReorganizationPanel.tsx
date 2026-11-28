import { useEffect, useMemo, useState } from "react";
import {
  ASSIGNMENT_CHANGE_SOURCE_LABELS,
  ROUTE_ASSIGNMENT_STRATEGY_DESCRIPTIONS,
  ROUTE_ASSIGNMENT_STRATEGY_LABELS,
  type RouteAssignmentStrategy,
  type RouteLocationSuggestion
} from "@bms/shared";
import type { AppRole, Branch, Customer, FieldAgentOption, FieldRoute } from "./api";
import { getRouteReorganizationSuggestions, listFieldAgents } from "./api";
import { Modal } from "../components/Modal";
import { useToast } from "../components/Toast";
import { toUserFacingError } from "../lib/networkError";
import { formatBranchLabel } from "./branchDisplay";
import { useAgentsStore } from "./stores/agentsStore";
import { useBranchesStore } from "./stores/branchesStore";
import { useCustomersStore } from "./stores/customersStore";
import { useRoutesStore } from "./stores/routesStore";

type Props = {
  role: AppRole;
  canManage: boolean;
  onReorganized: () => void;
};

type PlannedChange = {
  customer: Customer;
  nextRouteId: string | null;
  nextAgentId: string | null;
  changed: boolean;
};

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return iso;
  }
  return d.toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

const STRATEGIES: Array<{
  id: RouteAssignmentStrategy;
  icon: JSX.Element;
}> = [
  {
    id: "registration",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <polyline points="16 11 18 13 22 9" />
      </svg>
    )
  },
  {
    id: "location",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
        <circle cx="12" cy="10" r="3" />
      </svg>
    )
  },
  {
    id: "manual",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <line x1="4" y1="21" x2="4" y2="14" />
        <line x1="4" y1="10" x2="4" y2="3" />
        <line x1="12" y1="21" x2="12" y2="12" />
        <line x1="12" y1="8" x2="12" y2="3" />
        <line x1="20" y1="21" x2="20" y2="16" />
        <line x1="20" y1="12" x2="20" y2="3" />
        <line x1="1" y1="14" x2="7" y2="14" />
        <line x1="9" y1="8" x2="15" y2="8" />
        <line x1="17" y1="16" x2="23" y2="16" />
      </svg>
    )
  }
];

export function RouteReorganizationPanel({ role, canManage, onReorganized }: Props) {
  const { showToast } = useToast();
  const isAdmin = role === "admin";

  const routes = useRoutesStore((s) => s.routes);
  const storeBranches = useRoutesStore((s) => s.branches);
  const liveBranches = useBranchesStore((s) => s.branches);
  const settings = useRoutesStore((s) => s.settings);
  const savingSettings = useRoutesStore((s) => s.savingSettings);
  const saveSettings = useRoutesStore((s) => s.saveSettings);
  const assignmentHistory = useRoutesStore((s) => s.assignmentHistory);
  const historyLoading = useRoutesStore((s) => s.historyLoading);
  const loadAssignmentHistory = useRoutesStore((s) => s.loadAssignmentHistory);
  const reorganizing = useRoutesStore((s) => s.reorganizing);
  const applyReorganization = useRoutesStore((s) => s.applyReorganization);

  const allCustomers = useCustomersStore((s) => s.customers);
  const customersLoading = useCustomersStore((s) => s.loading);
  const agentsRoster = useAgentsStore((s) => s.roster);

  const branches: Branch[] = useMemo(() => {
    const source = liveBranches.length > 0 ? liveBranches : storeBranches;
    return source.filter((b) => b.status !== "inactive");
  }, [liveBranches, storeBranches]);

  const [agentsFallback, setAgentsFallback] = useState<FieldAgentOption[]>([]);
  const [branchId, setBranchId] = useState("");
  const [communityFilter, setCommunityFilter] = useState("");
  const [routeFilter, setRouteFilter] = useState("");
  const [agentFilter, setAgentFilter] = useState("");
  const [search, setSearch] = useState("");

  // Settings draft synced from tenant route settings
  const [strategyDraft, setStrategyDraft] = useState<RouteAssignmentStrategy>("registration");
  const [autoAssignDraft, setAutoAssignDraft] = useState(true);
  const [syncAgentDraft, setSyncAgentDraft] = useState(true);

  // Selection & bulk target state
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [targetMode, setTargetMode] = useState<"bulk" | "location_suggestions">("bulk");
  const [targetRouteChoice, setTargetRouteChoice] = useState<string>("__keep__");
  const [targetAgentChoice, setTargetAgentChoice] = useState<string>("__sync__");
  const [reason, setReason] = useState("");

  // Location suggestions
  const [suggestions, setSuggestions] = useState<Record<string, RouteLocationSuggestion>>({});
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);

  // Preview modal & history filter
  const [previewOpen, setPreviewOpen] = useState(false);
  const [historySearch, setHistorySearch] = useState("");

  useEffect(() => {
    useCustomersStore.getState().hydrate();
    useAgentsStore.getState().hydrate();
    if (agentsRoster.length === 0) {
      void listFieldAgents()
        .then((rows) => setAgentsFallback(rows))
        .catch(() => setAgentsFallback([]));
    }
  }, [agentsRoster.length]);

  useEffect(() => {
    if (!branchId && branches.length > 0) {
      setBranchId(branches[0]!.id);
    }
  }, [branchId, branches]);

  useEffect(() => {
    if (!settings) {
      return;
    }
    setStrategyDraft(settings.strategy);
    setAutoAssignDraft(settings.autoAssignOnApproval);
    setSyncAgentDraft(settings.syncAgentOnRouteChange);
  }, [settings]);

  useEffect(() => {
    if (!branchId) {
      return;
    }
    setSelectedIds([]);
    setSuggestions({});
    setRouteFilter("");
    setCommunityFilter("");
    setTargetRouteChoice("__keep__");
    void loadAssignmentHistory({ branchId, limit: 100 });
  }, [branchId, loadAssignmentHistory]);

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

  const agentLabelById = useMemo(
    () => new Map(agents.map((a) => [a.userId, a.label])),
    [agents]
  );

  const branchRoutes = useMemo(
    () => routes.filter((r) => r.branchId === branchId && r.status === "active"),
    [routes, branchId]
  );

  const routeById = useMemo(() => {
    const map = new Map<string, FieldRoute>();
    for (const r of routes) {
      map.set(r.id, r);
    }
    return map;
  }, [routes]);

  const activeBranchCustomers = useMemo(
    () =>
      allCustomers.filter(
        (c) => c.status === "active" && (!branchId || c.homeBranchId === branchId)
      ),
    [allCustomers, branchId]
  );

  const communities = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of activeBranchCustomers) {
      const loc = c.location?.trim();
      if (!loc) {
        continue;
      }
      const key = loc.toLowerCase();
      if (!map.has(key)) {
        map.set(key, loc);
      }
    }
    return [...map.values()].sort((a, b) => a.localeCompare(b));
  }, [activeBranchCustomers]);

  const unassignedCount = useMemo(
    () => activeBranchCustomers.filter((c) => !c.routeId).length,
    [activeBranchCustomers]
  );

  const filteredCustomers = useMemo(() => {
    const q = search.trim().toLowerCase();
    return activeBranchCustomers.filter((c) => {
      if (communityFilter === "__missing__") {
        if (c.location?.trim()) {
          return false;
        }
      } else if (communityFilter) {
        if ((c.location?.trim().toLowerCase() ?? "") !== communityFilter.toLowerCase()) {
          return false;
        }
      }

      if (routeFilter === "__unassigned__") {
        if (c.routeId) {
          return false;
        }
      } else if (routeFilter) {
        if (c.routeId !== routeFilter) {
          return false;
        }
      }

      if (agentFilter === "__unassigned__") {
        if (c.assignedFieldAgentId) {
          return false;
        }
      } else if (agentFilter) {
        if (c.assignedFieldAgentId !== agentFilter) {
          return false;
        }
      }

      if (!q) {
        return true;
      }
      const currentRouteName = c.routeId ? (routeById.get(c.routeId)?.name ?? "") : "";
      return (
        c.fullName.toLowerCase().includes(q) ||
        c.phone.toLowerCase().includes(q) ||
        (c.accountNumber ?? "").toLowerCase().includes(q) ||
        (c.location ?? "").toLowerCase().includes(q) ||
        (c.assignedFieldAgentName ?? "").toLowerCase().includes(q) ||
        currentRouteName.toLowerCase().includes(q)
      );
    });
  }, [activeBranchCustomers, communityFilter, routeFilter, agentFilter, search, routeById]);

  const hasFilters = Boolean(communityFilter || routeFilter || agentFilter || search);

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const allFilteredSelected =
    filteredCustomers.length > 0 && filteredCustomers.every((c) => selectedSet.has(c.id));

  const suggestionStats = useMemo(() => {
    const list = Object.values(suggestions);
    return {
      loaded: list.length > 0,
      matched: list.filter((s) => s.matchStatus === "matched").length,
      ambiguous: list.filter((s) => s.matchStatus === "ambiguous").length,
      unmatched: list.filter((s) => s.matchStatus === "unmatched").length,
      incomplete: list.filter((s) => s.matchStatus === "incomplete").length
    };
  }, [suggestions]);

  const settingsDirty =
    settings != null &&
    (strategyDraft !== settings.strategy ||
      autoAssignDraft !== settings.autoAssignOnApproval ||
      syncAgentDraft !== settings.syncAgentOnRouteChange);

  async function handleSaveSettings() {
    try {
      await saveSettings({
        strategy: strategyDraft,
        autoAssignOnApproval: strategyDraft === "manual" ? false : autoAssignDraft,
        syncAgentOnRouteChange: syncAgentDraft
      });
      showToast(
        `Route strategy updated to ${ROUTE_ASSIGNMENT_STRATEGY_LABELS[strategyDraft]}`,
        "success"
      );
    } catch (err) {
      showToast(toUserFacingError(err, "Failed to update settings"), "error");
    }
  }

  async function handleLoadSuggestions() {
    if (!branchId) {
      showToast("Select a branch first", "error");
      return;
    }
    setLoadingSuggestions(true);
    try {
      const rows = await getRouteReorganizationSuggestions(branchId);
      const map: Record<string, RouteLocationSuggestion> = {};
      for (const row of rows) {
        map[row.customerId] = row;
      }
      setSuggestions(map);
      const matched = rows.filter((r) => r.matchStatus === "matched").length;
      const ambiguous = rows.filter((r) => r.matchStatus === "ambiguous").length;
      showToast(`Location review ready: ${matched} matched, ${ambiguous} ambiguous`, "info");
    } catch (err) {
      showToast(toUserFacingError(err, "Failed to load location suggestions"), "error");
    } finally {
      setLoadingSuggestions(false);
    }
  }

  function handleSelectUnambiguousMatches() {
    const matchingIds = filteredCustomers
      .filter((c) => {
        const sug = suggestions[c.id];
        return (
          sug?.matchStatus === "matched" &&
          sug.suggestedRouteId &&
          sug.suggestedRouteId !== c.routeId
        );
      })
      .map((c) => c.id);

    if (matchingIds.length === 0) {
      showToast("No unassigned or mismatched customers have an unambiguous location match", "info");
      return;
    }
    setSelectedIds(matchingIds);
    setTargetMode("location_suggestions");
    if (!reason.trim()) {
      setReason("Location-based route reorganization");
    }
    showToast(
      `Selected ${matchingIds.length} customer(s) with unambiguous location matches — review in Preview before applying`,
      "success"
    );
  }

  function toggleOne(customerId: string) {
    setSelectedIds((prev) =>
      prev.includes(customerId) ? prev.filter((id) => id !== customerId) : [...prev, customerId]
    );
  }

  function toggleAllFiltered() {
    if (allFilteredSelected) {
      const filteredSet = new Set(filteredCustomers.map((c) => c.id));
      setSelectedIds((prev) => prev.filter((id) => !filteredSet.has(id)));
    } else {
      setSelectedIds((prev) => [...new Set([...prev, ...filteredCustomers.map((c) => c.id)])]);
    }
  }

  const plannedChanges = useMemo<PlannedChange[]>(() => {
    const customerMap = new Map(activeBranchCustomers.map((c) => [c.id, c]));
    const syncByDefault = settings?.syncAgentOnRouteChange !== false;
    const rows: PlannedChange[] = [];

    for (const id of selectedIds) {
      const customer = customerMap.get(id);
      if (!customer) {
        continue;
      }
      const prevRouteId = customer.routeId ?? null;
      const prevAgentId = customer.assignedFieldAgentId ?? null;

      let nextRouteId = prevRouteId;
      let nextAgentId = prevAgentId;

      if (targetMode === "location_suggestions") {
        const sug = suggestions[id];
        if (sug?.matchStatus === "matched" && sug.suggestedRouteId) {
          nextRouteId = sug.suggestedRouteId;
          const targetRoute = routeById.get(nextRouteId);
          if (syncByDefault && targetRoute?.assignedFieldAgentId) {
            nextAgentId = targetRoute.assignedFieldAgentId;
          }
        }
      } else {
        if (targetRouteChoice === "__clear__") {
          nextRouteId = null;
        } else if (targetRouteChoice !== "__keep__") {
          nextRouteId = targetRouteChoice;
        }

        if (targetAgentChoice === "__sync__") {
          if (nextRouteId) {
            const targetRoute = routeById.get(nextRouteId);
            if (targetRoute?.assignedFieldAgentId) {
              nextAgentId = targetRoute.assignedFieldAgentId;
            }
          }
        } else if (targetAgentChoice === "__clear__") {
          nextAgentId = null;
        } else if (targetAgentChoice !== "__keep__") {
          nextAgentId = targetAgentChoice;
        }
      }

      rows.push({
        customer,
        nextRouteId,
        nextAgentId,
        changed: nextRouteId !== prevRouteId || nextAgentId !== prevAgentId
      });
    }
    return rows;
  }, [
    selectedIds,
    activeBranchCustomers,
    targetMode,
    suggestions,
    targetRouteChoice,
    targetAgentChoice,
    routeById,
    settings?.syncAgentOnRouteChange
  ]);

  const effectiveChanges = useMemo(
    () => plannedChanges.filter((p) => p.changed),
    [plannedChanges]
  );

  function openPreview() {
    if (selectedIds.length === 0) {
      showToast("Select at least one customer", "error");
      return;
    }
    if (reason.trim().length < 3) {
      showToast("Enter a reason for reassignment (at least 3 characters)", "error");
      return;
    }
    if (effectiveChanges.length === 0) {
      showToast("No route or mobilizer changes would occur for the selected customers", "info");
      return;
    }
    setPreviewOpen(true);
  }

  async function handleConfirmApply() {
    if (!branchId || effectiveChanges.length === 0) {
      return;
    }
    try {
      const result = await applyReorganization({
        branchId,
        reason: reason.trim(),
        syncAgentFromRoute:
          targetMode === "location_suggestions"
            ? settings?.syncAgentOnRouteChange !== false
            : targetAgentChoice === "__sync__",
        assignments: effectiveChanges.map((item) => ({
          customerId: item.customer.id,
          routeId: item.nextRouteId,
          assignedFieldAgentId: item.nextAgentId
        }))
      });
      setPreviewOpen(false);
      setSelectedIds([]);
      setReason("");
      showToast(
        `Reorganized ${result.updatedCount} customer${result.updatedCount === 1 ? "" : "s"}${
          result.skippedCount > 0 ? ` (${result.skippedCount} unchanged)` : ""
        }`,
        "success"
      );
      onReorganized();
    } catch (err) {
      showToast(toUserFacingError(err, "Failed to apply reorganization"), "error");
    }
  }

  const filteredHistory = useMemo(() => {
    const q = historySearch.trim().toLowerCase();
    if (!q) {
      return assignmentHistory;
    }
    return assignmentHistory.filter(
      (h) =>
        (h.customerName ?? "").toLowerCase().includes(q) ||
        (h.customerAccountNumber ?? "").toLowerCase().includes(q) ||
        (h.previousRouteName ?? "").toLowerCase().includes(q) ||
        (h.newRouteName ?? "").toLowerCase().includes(q) ||
        (h.previousFieldAgentName ?? "").toLowerCase().includes(q) ||
        (h.newFieldAgentName ?? "").toLowerCase().includes(q) ||
        (h.changedByName ?? "").toLowerCase().includes(q) ||
        (h.reason ?? "").toLowerCase().includes(q)
    );
  }, [assignmentHistory, historySearch]);

  const selectedBranchLabel = useMemo(() => {
    const b = branches.find((br) => br.id === branchId);
    return b ? formatBranchLabel(b.id, branches, b.name, b.code) : "Selected branch";
  }, [branches, branchId]);

  return (
    <div className="route-reorg">
      {/* A. Tenant Route Assignment Strategy Settings */}
      <section className="card routes-panel route-reorg__settings" aria-labelledby="route-strategy-heading">
        <header className="routes-panel__head">
          <div>
            <h3 id="route-strategy-heading">Tenant route assignment strategy</h3>
            <p className="muted">
              Choose how this company organizes customers onto routes and mobilizers. Isolated per
              tenant — never modifies original account creator or financial history.
            </p>
          </div>
          {settings ? (
            <span className="route-badge route-badge--primary">
              <span className="route-badge__dot" />
              Active: {ROUTE_ASSIGNMENT_STRATEGY_LABELS[settings.strategy]}
            </span>
          ) : null}
        </header>

        {settings?.storageReady === false ? (
          <div className="route-banner route-banner--warning" role="status">
            Route settings &amp; assignment history tables are not migrated yet. Apply{" "}
            <code>111_tenant_route_management.sql</code> in Supabase, then refresh.
          </div>
        ) : null}

        <div className="route-strategy-grid" role="radiogroup" aria-label="Route assignment strategy">
          {STRATEGIES.map(({ id, icon }) => {
            const active = strategyDraft === id;
            return (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={active}
                disabled={!isAdmin || savingSettings}
                className={`route-strategy-card${active ? " is-selected" : ""}`}
                onClick={() => setStrategyDraft(id)}
              >
                <div className="route-strategy-card__top">
                  <span className="route-strategy-card__icon">{icon}</span>
                  <span className={`route-strategy-card__radio${active ? " is-selected" : ""}`}>
                    {active ? (
                      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <polyline points="3.5 8.5 6.5 11.5 12.5 4.5" />
                      </svg>
                    ) : null}
                  </span>
                </div>
                <strong className="route-strategy-card__title">
                  {ROUTE_ASSIGNMENT_STRATEGY_LABELS[id]}
                </strong>
                <span className="route-strategy-card__desc">
                  {ROUTE_ASSIGNMENT_STRATEGY_DESCRIPTIONS[id]}
                </span>
              </button>
            );
          })}
        </div>

        <div className="route-strategy-footer">
          <div className="route-switch-list">
            {strategyDraft !== "manual" ? (
              <label className="route-switch">
                <input
                  type="checkbox"
                  checked={autoAssignDraft}
                  disabled={!isAdmin || savingSettings}
                  onChange={(e) => setAutoAssignDraft(e.target.checked)}
                />
                <span className="route-switch__track" aria-hidden="true">
                  <span className="route-switch__thumb" />
                </span>
                <span className="route-switch__label">
                  {strategyDraft === "registration"
                    ? "Auto-attach registering mobilizer's sole active branch route on approval"
                    : "Auto-assign unambiguous location-matched route on approval (otherwise suggest for review)"}
                </span>
              </label>
            ) : null}

            <label className="route-switch">
              <input
                type="checkbox"
                checked={syncAgentDraft}
                disabled={!isAdmin || savingSettings}
                onChange={(e) => setSyncAgentDraft(e.target.checked)}
              />
              <span className="route-switch__track" aria-hidden="true">
                <span className="route-switch__thumb" />
              </span>
              <span className="route-switch__label">
                Sync responsible mobilizer when a customer&apos;s route or route agent changes
                (original creator always preserved)
              </span>
            </label>
          </div>

          <div className="route-strategy-actions">
            {isAdmin ? (
              <button
                type="button"
                className="route-btn route-btn--primary"
                disabled={!settingsDirty || savingSettings || settings?.storageReady === false}
                onClick={() => void handleSaveSettings()}
              >
                {settingsDirty ? <span className="route-dirty-dot" /> : null}
                {savingSettings ? "Saving…" : "Save strategy settings"}
              </button>
            ) : (
              <span className="route-badge route-badge--muted">Admin only</span>
            )}
          </div>
        </div>
      </section>

      {/* C & D. Route Reorganization Workspace */}
      <section className="card routes-panel route-reorg__workspace" aria-labelledby="route-reorg-heading">
        <header className="routes-panel__head">
          <div>
            <h3 id="route-reorg-heading">Route reorganization</h3>
            <p className="muted">
              Filter active branch customers by community, route, or mobilizer, preview before/after
              changes, and apply bulk reassignments safely.
            </p>
          </div>
          <div className="route-reorg__head-actions">
            <button
              type="button"
              className="route-btn route-btn--secondary"
              disabled={!branchId || loadingSuggestions}
              onClick={() => void handleLoadSuggestions()}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                <circle cx="12" cy="10" r="3" />
              </svg>
              {loadingSuggestions ? "Scanning locations…" : "Review location matches"}
            </button>
            {canManage && suggestionStats.matched > 0 ? (
              <button
                type="button"
                className="route-btn route-btn--primary"
                onClick={handleSelectUnambiguousMatches}
              >
                Stage {suggestionStats.matched} match{suggestionStats.matched === 1 ? "" : "es"}
              </button>
            ) : null}
          </div>
        </header>

        <div className="route-reorg__chips">
          <span className="route-badge route-badge--primary">{selectedBranchLabel}</span>
          <span className="route-badge route-badge--muted">
            {activeBranchCustomers.length} active customers
          </span>
          <button
            type="button"
            className={`route-badge route-badge--btn ${
              routeFilter === "__unassigned__" ? "route-badge--warning" : "route-badge--muted"
            }`}
            onClick={() =>
              setRouteFilter((prev) => (prev === "__unassigned__" ? "" : "__unassigned__"))
            }
            title="Toggle filter for customers without an assigned route"
          >
            {unassignedCount} without route
          </button>
          {suggestionStats.loaded ? (
            <>
              <span className="route-badge route-badge--success">
                {suggestionStats.matched} matched
              </span>
              {suggestionStats.ambiguous > 0 ? (
                <span className="route-badge route-badge--warning">
                  {suggestionStats.ambiguous} ambiguous
                </span>
              ) : null}
              <span className="route-badge route-badge--muted">
                {suggestionStats.unmatched} unmatched · {suggestionStats.incomplete} incomplete
              </span>
            </>
          ) : null}
          {hasFilters ? (
            <button
              type="button"
              className="route-link-btn"
              onClick={() => {
                setCommunityFilter("");
                setRouteFilter("");
                setAgentFilter("");
                setSearch("");
              }}
            >
              Clear filters
            </button>
          ) : null}
        </div>

        <div className="route-reorg__filters">
          <label className="route-field">
            <span className="route-field__label">Branch</span>
            <select
              className="route-select"
              value={branchId}
              onChange={(e) => setBranchId(e.target.value)}
            >
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name} ({b.code})
                </option>
              ))}
            </select>
          </label>

          <label className="route-field">
            <span className="route-field__label">Community / area</span>
            <select
              className="route-select"
              value={communityFilter}
              onChange={(e) => setCommunityFilter(e.target.value)}
            >
              <option value="">All communities</option>
              <option value="__missing__">Missing / blank location</option>
              {communities.map((loc) => (
                <option key={loc} value={loc}>
                  {loc}
                </option>
              ))}
            </select>
          </label>

          <label className="route-field">
            <span className="route-field__label">Current route</span>
            <select
              className="route-select"
              value={routeFilter}
              onChange={(e) => setRouteFilter(e.target.value)}
            >
              <option value="">All routes</option>
              <option value="__unassigned__">Unassigned (no route)</option>
              {branchRoutes.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name} ({r.area})
                </option>
              ))}
            </select>
          </label>

          <label className="route-field">
            <span className="route-field__label">Current mobilizer</span>
            <select
              className="route-select"
              value={agentFilter}
              onChange={(e) => setAgentFilter(e.target.value)}
            >
              <option value="">All mobilizers</option>
              <option value="__unassigned__">No mobilizer</option>
              {agents.map((a) => (
                <option key={a.userId} value={a.userId}>
                  {a.label}
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
                placeholder="Name, account #, phone…"
              />
            </div>
          </label>
        </div>

        {canManage ? (
          <div className={`route-reorg__bulk${selectedIds.length > 0 ? " is-active" : ""}`}>
            <div className="route-reorg__bulk-head">
              <div className="route-reorg__selection-pill">
                <span className="route-reorg__count-badge">{selectedIds.length}</span>
                <span>
                  customer{selectedIds.length === 1 ? "" : "s"} selected
                </span>
                {selectedIds.length > 0 ? (
                  <button
                    type="button"
                    className="route-link-btn"
                    onClick={() => setSelectedIds([])}
                  >
                    Clear
                  </button>
                ) : null}
              </div>

              <div className="route-segmented" role="radiogroup" aria-label="Reassignment mode">
                <button
                  type="button"
                  role="radio"
                  aria-checked={targetMode === "bulk"}
                  className={`route-segmented__btn${targetMode === "bulk" ? " is-active" : ""}`}
                  onClick={() => setTargetMode("bulk")}
                >
                  Assign to target
                </button>
                <button
                  type="button"
                  role="radio"
                  aria-checked={targetMode === "location_suggestions"}
                  disabled={!suggestionStats.loaded}
                  className={`route-segmented__btn${targetMode === "location_suggestions" ? " is-active" : ""}`}
                  onClick={() => setTargetMode("location_suggestions")}
                >
                  Apply location matches
                </button>
              </div>
            </div>

            <div className="route-reorg__bulk-controls">
              {targetMode === "bulk" ? (
                <>
                  <label className="route-field">
                    <span className="route-field__label">
                      Destination route ({selectedBranchLabel})
                    </span>
                    <select
                      className="route-select"
                      value={targetRouteChoice}
                      onChange={(e) => setTargetRouteChoice(e.target.value)}
                    >
                      <option value="__keep__">Keep current route</option>
                      <option value="__clear__">Remove from route (unassign)</option>
                      {branchRoutes.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.name} · {r.area}
                          {r.assignedFieldAgentName ? ` (${r.assignedFieldAgentName})` : ""}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="route-field">
                    <span className="route-field__label">Destination mobilizer</span>
                    <select
                      className="route-select"
                      value={targetAgentChoice}
                      onChange={(e) => setTargetAgentChoice(e.target.value)}
                    >
                      <option value="__sync__">Sync from destination route</option>
                      <option value="__keep__">Keep current mobilizer</option>
                      <option value="__clear__">Unassign mobilizer</option>
                      {agents.map((a) => (
                        <option key={a.userId} value={a.userId}>
                          {a.label}
                        </option>
                      ))}
                    </select>
                  </label>
                </>
              ) : (
                <div className="route-banner route-banner--info">
                  Each selected customer with an unambiguous match will move to its suggested branch
                  route{settings?.syncAgentOnRouteChange !== false ? " and route mobilizer" : ""}.
                </div>
              )}

              <label className="route-field route-reorg__reason">
                <span className="route-field__label">Reason for reassignment</span>
                <input
                  type="text"
                  className="route-input"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  maxLength={500}
                  placeholder="e.g. Zone rebalance or new mobilizer coverage"
                />
              </label>

              <button
                type="button"
                className="route-btn route-btn--primary"
                disabled={selectedIds.length === 0 || reorganizing}
                onClick={openPreview}
              >
                Preview changes ({effectiveChanges.length})
              </button>
            </div>
          </div>
        ) : null}

        {customersLoading && activeBranchCustomers.length === 0 ? (
          <div className="routes-empty-state">
            <p className="muted">Loading branch customers…</p>
          </div>
        ) : filteredCustomers.length === 0 ? (
          <div className="routes-empty-state">
            <p className="muted">No active customers match the current filters.</p>
          </div>
        ) : (
          <div className="admin-table-wrap route-table-wrap">
            <div className="admin-table-scroll">
              <table className="admin-table route-reorg__table">
                <thead>
                  <tr>
                    {canManage ? (
                      <th style={{ width: "2.5rem" }}>
                        <input
                          type="checkbox"
                          className="route-checkbox"
                          checked={allFilteredSelected}
                          onChange={toggleAllFiltered}
                          aria-label="Select all filtered customers"
                        />
                      </th>
                    ) : null}
                    <th>Customer</th>
                    <th>Community / location</th>
                    <th>Current route</th>
                    <th>Mobilizer &amp; original creator</th>
                    {suggestionStats.loaded ? <th>Location match</th> : null}
                  </tr>
                </thead>
                <tbody>
                  {filteredCustomers.map((customer) => {
                    const currentRoute = customer.routeId
                      ? routeById.get(customer.routeId)
                      : undefined;
                    const sug = suggestions[customer.id];
                    const checked = selectedSet.has(customer.id);
                    return (
                      <tr
                        key={customer.id}
                        className={checked ? "route-reorg__row--selected" : undefined}
                      >
                        {canManage ? (
                          <td>
                            <input
                              type="checkbox"
                              className="route-checkbox"
                              checked={checked}
                              onChange={() => toggleOne(customer.id)}
                              aria-label={`Select ${customer.fullName}`}
                            />
                          </td>
                        ) : null}
                        <td>
                          <strong>{customer.fullName}</strong>
                          <div className="route-cell-meta">
                            <span>{customer.accountNumber ?? "No account #"}</span>
                            <span>·</span>
                            <span>{customer.phone}</span>
                          </div>
                        </td>
                        <td>
                          {customer.location?.trim() ? (
                            <span className="route-location-tag">{customer.location}</span>
                          ) : (
                            <span className="muted">Not recorded</span>
                          )}
                        </td>
                        <td>
                          {currentRoute ? (
                            <div>
                              <strong>{currentRoute.name}</strong>
                              <div className="route-cell-meta">{currentRoute.area}</div>
                            </div>
                          ) : (
                            <span className="route-badge route-badge--warning">Unassigned</span>
                          )}
                        </td>
                        <td>
                          <div>
                            <strong>
                              {customer.assignedFieldAgentName ??
                                (customer.assignedFieldAgentId
                                  ? agentLabelById.get(customer.assignedFieldAgentId) ??
                                    customer.assignedFieldAgentId
                                  : "Unassigned")}
                            </strong>
                          </div>
                          <div className="route-cell-meta">
                            Creator:{" "}
                            {customer.createdByFieldAgentName ??
                              (customer.createdByFieldAgentId
                                ? agentLabelById.get(customer.createdByFieldAgentId) ??
                                  customer.createdByFieldAgentId
                                : "—")}
                          </div>
                        </td>
                        {suggestionStats.loaded ? (
                          <td>
                            {!sug ? (
                              <span className="muted">—</span>
                            ) : sug.matchStatus === "matched" ? (
                              <div>
                                <span className="route-badge route-badge--success">
                                  → {sug.suggestedRouteName}
                                </span>
                                {sug.matchedArea ? (
                                  <div className="route-cell-meta">Matched: {sug.matchedArea}</div>
                                ) : null}
                              </div>
                            ) : sug.matchStatus === "ambiguous" ? (
                              <div>
                                <span className="route-badge route-badge--warning">
                                  Ambiguous ({sug.candidateRoutes.length})
                                </span>
                                <div className="route-cell-meta">
                                  {sug.candidateRoutes.map((r) => r.name).join(", ")}
                                </div>
                              </div>
                            ) : sug.matchStatus === "incomplete" ? (
                              <span className="route-badge route-badge--muted">Incomplete</span>
                            ) : (
                              <span className="route-badge route-badge--muted">No match</span>
                            )}
                          </td>
                        ) : null}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>

      {/* F. Customer Assignment History Audit Trail */}
      <section className="card routes-panel route-reorg__history" aria-labelledby="route-history-heading">
        <header className="routes-panel__head">
          <div>
            <h3 id="route-history-heading">Assignment history</h3>
            <p className="muted">
              Immutable audit log of route and mobilizer changes for {selectedBranchLabel}. Persists
              across subsequent transfers and route deletions.
            </p>
          </div>
          <div className="route-search-wrap route-search-wrap--wide">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              type="search"
              className="route-input route-input--search"
              value={historySearch}
              onChange={(e) => setHistorySearch(e.target.value)}
              placeholder="Filter history by customer, route, agent, reason…"
              aria-label="Filter assignment history"
            />
          </div>
        </header>

        {historyLoading && assignmentHistory.length === 0 ? (
          <div className="routes-empty-state">
            <p className="muted">Loading assignment history…</p>
          </div>
        ) : filteredHistory.length === 0 ? (
          <div className="routes-empty-state">
            <p className="muted">No route or mobilizer reassignment history recorded yet.</p>
          </div>
        ) : (
          <div className="admin-table-wrap route-table-wrap">
            <div className="admin-table-scroll">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Date &amp; time</th>
                    <th>Customer</th>
                    <th>Route change</th>
                    <th>Mobilizer change</th>
                    <th>Performed by</th>
                    <th>Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredHistory.map((item) => (
                    <tr key={item.id}>
                      <td className="admin-table-mono">{formatDateTime(item.createdAt)}</td>
                      <td>
                        <strong>{item.customerName ?? item.customerId}</strong>
                        {item.customerAccountNumber ? (
                          <div className="route-cell-meta">{item.customerAccountNumber}</div>
                        ) : null}
                      </td>
                      <td>
                        <div className="route-diff">
                          <span className="route-diff__old">
                            {item.previousRouteName ?? "Unassigned"}
                          </span>
                          <span className="route-diff__arrow">→</span>
                          <span className="route-diff__new">
                            {item.newRouteName ?? "Unassigned"}
                          </span>
                        </div>
                      </td>
                      <td>
                        <div className="route-diff">
                          <span className="route-diff__old">
                            {item.previousFieldAgentName ??
                              item.previousFieldAgentId ??
                              "Unassigned"}
                          </span>
                          <span className="route-diff__arrow">→</span>
                          <span className="route-diff__new">
                            {item.newFieldAgentName ?? item.newFieldAgentId ?? "Unassigned"}
                          </span>
                        </div>
                      </td>
                      <td>
                        <div>{item.changedByName ?? item.changedByUserId}</div>
                        <span className="route-badge route-badge--muted" style={{ marginTop: "0.2rem" }}>
                          {ASSIGNMENT_CHANGE_SOURCE_LABELS[item.changeSource] ?? item.changeSource}
                        </span>
                      </td>
                      <td>{item.reason || <span className="muted">—</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>

      {/* Preview & Confirm Bulk Reorganization Modal */}
      <Modal
        open={previewOpen}
        title="Preview route reorganization"
        subtitle={`${effectiveChanges.length} customer${effectiveChanges.length === 1 ? "" : "s"} will be updated in ${selectedBranchLabel}.`}
        onClose={() => !reorganizing && setPreviewOpen(false)}
        panelClassName="modal-panel--70 route-modal"
        footer={
          <>
            <button
              type="button"
              className="route-btn route-btn--secondary"
              disabled={reorganizing}
              onClick={() => setPreviewOpen(false)}
            >
              Cancel
            </button>
            <button
              type="button"
              className="route-btn route-btn--primary"
              disabled={reorganizing || effectiveChanges.length === 0}
              onClick={() => void handleConfirmApply()}
            >
              {reorganizing
                ? "Applying changes…"
                : `Confirm & apply (${effectiveChanges.length})`}
            </button>
          </>
        }
      >
        <div className="route-reorg__preview">
          <div className="route-banner route-banner--info">
            <div>
              <strong>Reason:</strong> {reason.trim()}
              {plannedChanges.length > effectiveChanges.length ? (
                <>
                  {" "}
                  · {plannedChanges.length - effectiveChanges.length} selected customer(s) unchanged
                  and skipped.
                </>
              ) : null}
            </div>
            <div style={{ marginTop: "0.25rem", opacity: 0.85, fontSize: "0.8rem" }}>
              Original registration creators, savings, Susu accounts, loans, and financial history
              remain completely untouched.
            </div>
          </div>

          <div className="admin-table-wrap route-table-wrap">
            <div className="admin-table-scroll">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Customer</th>
                    <th>Route change</th>
                    <th>Mobilizer change</th>
                  </tr>
                </thead>
                <tbody>
                  {effectiveChanges.map((change) => {
                    const prevRouteName = change.customer.routeId
                      ? (routeById.get(change.customer.routeId)?.name ?? "Assigned route")
                      : "Unassigned";
                    const nextRouteName = change.nextRouteId
                      ? (routeById.get(change.nextRouteId)?.name ?? "Assigned route")
                      : "Unassigned";
                    const prevAgentName =
                      change.customer.assignedFieldAgentName ??
                      (change.customer.assignedFieldAgentId
                        ? agentLabelById.get(change.customer.assignedFieldAgentId) ??
                          change.customer.assignedFieldAgentId
                        : "Unassigned");
                    const nextAgentName = change.nextAgentId
                      ? (agentLabelById.get(change.nextAgentId) ?? change.nextAgentId)
                      : "Unassigned";

                    return (
                      <tr key={change.customer.id}>
                        <td>
                          <strong>{change.customer.fullName}</strong>
                          <div className="route-cell-meta">
                            {change.customer.accountNumber ?? change.customer.phone}
                          </div>
                        </td>
                        <td>
                          <div className="route-diff">
                            <span className="route-diff__old">{prevRouteName}</span>
                            <span className="route-diff__arrow">→</span>
                            <span className="route-diff__new">{nextRouteName}</span>
                          </div>
                        </td>
                        <td>
                          <div className="route-diff">
                            <span className="route-diff__old">{prevAgentName}</span>
                            <span className="route-diff__arrow">→</span>
                            <span className="route-diff__new">{nextAgentName}</span>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </Modal>
    </div>
  );
}
