import { randomUUID } from "node:crypto";
import {
  approvalRouteRecommendationSchema,
  bulkReorganizeCustomersSchema,
  bulkReorganizeResultSchema,
  customerAssignmentHistorySchema,
  routeLocationSuggestionSchema,
  tenantRouteSettingsSchema,
  updateTenantRouteSettingsSchema,
  type ApprovalRouteRecommendation,
  type ApproveCustomerRegistrationInput,
  type BulkReorganizeResult,
  type Customer,
  type CustomerAssignmentChangeSource,
  type CustomerAssignmentHistory,
  type FieldRoute,
  type RouteCandidateSummary,
  type RouteLocationMatchStatus,
  type RouteLocationSuggestion,
  type TenantRouteSettings
} from "@bms/shared";
import { getSupabaseAdminClient } from "../config/supabaseClient.js";
import { listFieldRoutes } from "./routeService.js";
import { fetchTenantUserNameMap } from "./userNameResolver.js";

const memoryRouteSettings = new Map<string, TenantRouteSettings>();
const memoryAssignmentHistory = new Map<string, CustomerAssignmentHistory[]>();

function isMissingRouteManagementTable(message: string): boolean {
  return /tenant_route_settings|customer_assignment_history|does not exist|schema cache|could not find the table/i.test(
    message
  );
}

export function clearMemoryRouteManagement(tenantId?: string): void {
  if (tenantId) {
    memoryRouteSettings.delete(tenantId);
    memoryAssignmentHistory.delete(tenantId);
  } else {
    memoryRouteSettings.clear();
    memoryAssignmentHistory.clear();
  }
}

function defaultSettings(tenantId: string, storageReady = true): TenantRouteSettings {
  return tenantRouteSettingsSchema.parse({
    tenantId,
    strategy: "registration",
    autoAssignOnApproval: true,
    syncAgentOnRouteChange: true,
    storageReady
  });
}

function mapSettingsRow(tenantId: string, row: Record<string, unknown>): TenantRouteSettings {
  return tenantRouteSettingsSchema.parse({
    tenantId,
    strategy: row.strategy ?? "registration",
    autoAssignOnApproval: row.auto_assign_on_approval !== false,
    syncAgentOnRouteChange: row.sync_agent_on_route_change !== false,
    storageReady: true,
    updatedByUserId: row.updated_by_user_id != null ? String(row.updated_by_user_id) : null,
    updatedAt: row.updated_at != null ? String(row.updated_at) : null
  });
}

export async function getTenantRouteSettings(tenantId: string): Promise<TenantRouteSettings> {
  const supabase = getSupabaseAdminClient();
  if (!supabase) {
    return memoryRouteSettings.get(tenantId) ?? defaultSettings(tenantId, true);
  }

  const { data, error } = await supabase
    .from("tenant_route_settings")
    .select("*")
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (error) {
    if (isMissingRouteManagementTable(error.message)) {
      return defaultSettings(tenantId, false);
    }
    throw new Error(`Failed to load route assignment settings: ${error.message}`);
  }

  if (!data) {
    return defaultSettings(tenantId, true);
  }
  return mapSettingsRow(tenantId, data as Record<string, unknown>);
}

export async function updateTenantRouteSettings(
  tenantId: string,
  actorUserId: string,
  rawInput: unknown
): Promise<TenantRouteSettings> {
  const input = updateTenantRouteSettingsSchema.parse(rawInput);
  const current = await getTenantRouteSettings(tenantId);
  const now = new Date().toISOString();
  const next: TenantRouteSettings = tenantRouteSettingsSchema.parse({
    tenantId,
    strategy: input.strategy,
    autoAssignOnApproval: input.autoAssignOnApproval ?? current.autoAssignOnApproval,
    syncAgentOnRouteChange: input.syncAgentOnRouteChange ?? current.syncAgentOnRouteChange,
    storageReady: true,
    updatedByUserId: actorUserId,
    updatedAt: now
  });

  const supabase = getSupabaseAdminClient();
  if (!supabase) {
    memoryRouteSettings.set(tenantId, next);
    return next;
  }

  const { data, error } = await supabase
    .from("tenant_route_settings")
    .upsert(
      {
        tenant_id: tenantId,
        strategy: next.strategy,
        auto_assign_on_approval: next.autoAssignOnApproval,
        sync_agent_on_route_change: next.syncAgentOnRouteChange,
        updated_by_user_id: actorUserId,
        updated_at: now
      },
      { onConflict: "tenant_id" }
    )
    .select("*")
    .single();

  if (error) {
    if (isMissingRouteManagementTable(error.message)) {
      throw new Error(
        "Route settings table is not ready. Apply migration 111_tenant_route_management.sql in Supabase, then try again."
      );
    }
    throw new Error(`Failed to update route assignment settings: ${error.message}`);
  }

  return mapSettingsRow(tenantId, data as Record<string, unknown>);
}

// ---------------------------------------------------------------------------
// Conservative, deterministic geographical location -> route matching
// ---------------------------------------------------------------------------

function normalizeGeoToken(value: string): string {
  return value
    .toLowerCase()
    .replace(/[.,;:/\\|()[\]]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function containsWholePhrase(haystackNormalized: string, needleNormalized: string): boolean {
  if (!haystackNormalized || !needleNormalized || needleNormalized.length < 2) {
    return false;
  }
  const regex = new RegExp(`(^|\\s)${escapeRegExp(needleNormalized)}(\\s|$)`, "i");
  return regex.test(haystackNormalized);
}

export function extractRouteAreaTokens(route: Pick<FieldRoute, "area" | "communities">): string[] {
  const raw: string[] = [];
  if (Array.isArray(route.communities)) {
    for (const item of route.communities) {
      if (typeof item === "string" && item.trim()) {
        raw.push(item.trim());
      }
    }
  }
  if (route.area?.trim()) {
    // Support comma/semicolon-separated area lists (e.g. "Osu, Oxford Street") as well as full area phrase.
    const parts = route.area
      .split(/[,;/]+/)
      .map((part) => part.trim())
      .filter((part) => part.length >= 2);
    raw.push(...parts);
    if (parts.length > 1) {
      raw.push(route.area.trim());
    }
  }

  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const label of raw) {
    const norm = normalizeGeoToken(label);
    if (norm.length < 2 || seen.has(norm)) {
      continue;
    }
    seen.add(norm);
    deduped.push(label);
  }
  return deduped;
}

function toCandidateSummary(route: FieldRoute): RouteCandidateSummary {
  return {
    id: route.id,
    name: route.name,
    area: route.area,
    communities: route.communities ?? [],
    assignedFieldAgentId: route.assignedFieldAgentId ?? null,
    assignedFieldAgentName: route.assignedFieldAgentName ?? null
  };
}

export type LocationRouteMatchResult = {
  matchStatus: RouteLocationMatchStatus;
  matchedRoute: FieldRoute | null;
  matchedArea: string | null;
  candidates: FieldRoute[];
};

/**
 * Matches a customer's existing `location` string against active routes in the customer's branch.
 * - Never invents or guesses location data when `customerLocation` is blank/incomplete.
 * - Exact normalized area/community match takes precedence over whole-word phrase containment.
 * - Multiple matching routes are flagged as `ambiguous` so an administrator must choose explicitly.
 */
export function matchCustomerLocationToRoutes(
  customerLocation: string | null | undefined,
  branchActiveRoutes: FieldRoute[]
): LocationRouteMatchResult {
  const normalizedLocation = normalizeGeoToken(customerLocation ?? "");
  if (normalizedLocation.length < 2) {
    return {
      matchStatus: "incomplete",
      matchedRoute: null,
      matchedArea: null,
      candidates: []
    };
  }

  const exactMatches: Array<{ route: FieldRoute; areaLabel: string }> = [];
  const phraseMatches: Array<{ route: FieldRoute; areaLabel: string }> = [];

  for (const route of branchActiveRoutes) {
    if (route.status !== "active") {
      continue;
    }
    const tokens = extractRouteAreaTokens(route);
    let exactLabel: string | null = null;
    let phraseLabel: string | null = null;

    for (const label of tokens) {
      const normToken = normalizeGeoToken(label);
      if (normToken === normalizedLocation) {
        exactLabel = label;
        break;
      }
      if (
        !phraseLabel &&
        (containsWholePhrase(normalizedLocation, normToken) ||
          containsWholePhrase(normToken, normalizedLocation))
      ) {
        phraseLabel = label;
      }
    }

    if (exactLabel) {
      exactMatches.push({ route, areaLabel: exactLabel });
    } else if (phraseLabel) {
      phraseMatches.push({ route, areaLabel: phraseLabel });
    }
  }

  const winningPool = exactMatches.length > 0 ? exactMatches : phraseMatches;
  if (winningPool.length === 1) {
    const winner = winningPool[0]!;
    return {
      matchStatus: "matched",
      matchedRoute: winner.route,
      matchedArea: winner.areaLabel,
      candidates: [winner.route]
    };
  }
  if (winningPool.length > 1) {
    return {
      matchStatus: "ambiguous",
      matchedRoute: null,
      matchedArea: null,
      candidates: winningPool.map((m) => m.route)
    };
  }
  return {
    matchStatus: "unmatched",
    matchedRoute: null,
    matchedArea: null,
    candidates: []
  };
}

// ---------------------------------------------------------------------------
// Approval route recommendation & resolution (Registration / Location / Manual)
// ---------------------------------------------------------------------------

export async function getApprovalRouteRecommendation(
  tenantId: string,
  customer: Pick<
    Customer,
    "homeBranchId" | "location" | "assignedFieldAgentId" | "assignedFieldAgentName" | "routeId"
  >
): Promise<ApprovalRouteRecommendation> {
  const [settings, allRoutes] = await Promise.all([
    getTenantRouteSettings(tenantId),
    listFieldRoutes(tenantId)
  ]);

  const branchActiveRoutes = allRoutes.filter(
    (r) => r.status === "active" && r.branchId === customer.homeBranchId
  );

  const currentAgentId = customer.assignedFieldAgentId ?? null;
  const currentAgentName = customer.assignedFieldAgentName ?? null;
  const customerLocation = customer.location?.trim() || null;

  if (settings.strategy === "manual") {
    return approvalRouteRecommendationSchema.parse({
      strategy: settings.strategy,
      autoAssignOnApproval: false,
      syncAgentOnRouteChange: settings.syncAgentOnRouteChange,
      customerLocation,
      currentAssignedFieldAgentId: currentAgentId,
      currentAssignedFieldAgentName: currentAgentName,
      recommendedRouteId: null,
      recommendedRouteName: null,
      recommendedFieldAgentId: currentAgentId,
      recommendedFieldAgentName: currentAgentName,
      willAutoAssign: false,
      matchStatus: "manual",
      reason:
        "Manual route strategy is active — no route is automatically assigned on approval. Select a route now or organize later under Route Reorganization.",
      candidateRoutes: [],
      branchActiveRoutes: branchActiveRoutes.map(toCandidateSummary)
    });
  }

  if (settings.strategy === "registration") {
    const agentRoutes = currentAgentId
      ? branchActiveRoutes.filter((r) => r.assignedFieldAgentId === currentAgentId)
      : [];

    if (agentRoutes.length === 1) {
      const onlyRoute = agentRoutes[0]!;
      return approvalRouteRecommendationSchema.parse({
        strategy: settings.strategy,
        autoAssignOnApproval: settings.autoAssignOnApproval,
        syncAgentOnRouteChange: settings.syncAgentOnRouteChange,
        customerLocation,
        currentAssignedFieldAgentId: currentAgentId,
        currentAssignedFieldAgentName: currentAgentName,
        recommendedRouteId: onlyRoute.id,
        recommendedRouteName: onlyRoute.name,
        recommendedFieldAgentId: currentAgentId,
        recommendedFieldAgentName: currentAgentName,
        willAutoAssign: settings.autoAssignOnApproval,
        matchStatus: "matched",
        reason: settings.autoAssignOnApproval
          ? `Registration-based strategy: ${currentAgentName ?? "the registering mobilizer"} covers 1 active route in this branch (${onlyRoute.name}), which will be attached automatically.`
          : `Suggested route: ${onlyRoute.name} (auto-assign on approval is off — confirm to attach).`,
        candidateRoutes: [toCandidateSummary(onlyRoute)],
        branchActiveRoutes: branchActiveRoutes.map(toCandidateSummary)
      });
    }

    if (agentRoutes.length > 1) {
      return approvalRouteRecommendationSchema.parse({
        strategy: settings.strategy,
        autoAssignOnApproval: settings.autoAssignOnApproval,
        syncAgentOnRouteChange: settings.syncAgentOnRouteChange,
        customerLocation,
        currentAssignedFieldAgentId: currentAgentId,
        currentAssignedFieldAgentName: currentAgentName,
        recommendedRouteId: null,
        recommendedRouteName: null,
        recommendedFieldAgentId: currentAgentId,
        recommendedFieldAgentName: currentAgentName,
        willAutoAssign: false,
        matchStatus: "ambiguous",
        reason: `${currentAgentName ?? "This mobilizer"} manages ${agentRoutes.length} active routes in this branch — select the route explicitly or leave unassigned.`,
        candidateRoutes: agentRoutes.map(toCandidateSummary),
        branchActiveRoutes: branchActiveRoutes.map(toCandidateSummary)
      });
    }

    return approvalRouteRecommendationSchema.parse({
      strategy: settings.strategy,
      autoAssignOnApproval: settings.autoAssignOnApproval,
      syncAgentOnRouteChange: settings.syncAgentOnRouteChange,
      customerLocation,
      currentAssignedFieldAgentId: currentAgentId,
      currentAssignedFieldAgentName: currentAgentName,
      recommendedRouteId: null,
      recommendedRouteName: null,
      recommendedFieldAgentId: currentAgentId,
      recommendedFieldAgentName: currentAgentName,
      willAutoAssign: false,
      matchStatus: "unmatched",
      reason:
        "The registering mobilizer has no active route in this branch — customer will remain unassigned to a route until added.",
      candidateRoutes: [],
      branchActiveRoutes: branchActiveRoutes.map(toCandidateSummary)
    });
  }

  // Location-based strategy
  const match = matchCustomerLocationToRoutes(customerLocation, branchActiveRoutes);
  if (match.matchStatus === "matched" && match.matchedRoute) {
    const targetRoute = match.matchedRoute;
    const suggestedAgentId =
      settings.syncAgentOnRouteChange && targetRoute.assignedFieldAgentId
        ? targetRoute.assignedFieldAgentId
        : currentAgentId;
    const suggestedAgentName =
      settings.syncAgentOnRouteChange && targetRoute.assignedFieldAgentId
        ? (targetRoute.assignedFieldAgentName ?? targetRoute.assignedFieldAgentId)
        : currentAgentName;

    return approvalRouteRecommendationSchema.parse({
      strategy: settings.strategy,
      autoAssignOnApproval: settings.autoAssignOnApproval,
      syncAgentOnRouteChange: settings.syncAgentOnRouteChange,
      customerLocation,
      currentAssignedFieldAgentId: currentAgentId,
      currentAssignedFieldAgentName: currentAgentName,
      recommendedRouteId: targetRoute.id,
      recommendedRouteName: targetRoute.name,
      recommendedFieldAgentId: suggestedAgentId,
      recommendedFieldAgentName: suggestedAgentName,
      willAutoAssign: settings.autoAssignOnApproval,
      matchStatus: "matched",
      reason: settings.autoAssignOnApproval
        ? `Location "${customerLocation}" uniquely matches route ${targetRoute.name} (${match.matchedArea}) and will be assigned on approval.`
        : `Location "${customerLocation}" uniquely matches route ${targetRoute.name} (${match.matchedArea}). Review and select to apply.`,
      candidateRoutes: [toCandidateSummary(targetRoute)],
      branchActiveRoutes: branchActiveRoutes.map(toCandidateSummary)
    });
  }

  if (match.matchStatus === "ambiguous") {
    return approvalRouteRecommendationSchema.parse({
      strategy: settings.strategy,
      autoAssignOnApproval: settings.autoAssignOnApproval,
      syncAgentOnRouteChange: settings.syncAgentOnRouteChange,
      customerLocation,
      currentAssignedFieldAgentId: currentAgentId,
      currentAssignedFieldAgentName: currentAgentName,
      recommendedRouteId: null,
      recommendedRouteName: null,
      recommendedFieldAgentId: currentAgentId,
      recommendedFieldAgentName: currentAgentName,
      willAutoAssign: false,
      matchStatus: "ambiguous",
      reason: `Location "${customerLocation}" matches ${match.candidates.length} routes — administrator selection is required (will not auto-assign).`,
      candidateRoutes: match.candidates.map(toCandidateSummary),
      branchActiveRoutes: branchActiveRoutes.map(toCandidateSummary)
    });
  }

  return approvalRouteRecommendationSchema.parse({
    strategy: settings.strategy,
    autoAssignOnApproval: settings.autoAssignOnApproval,
    syncAgentOnRouteChange: settings.syncAgentOnRouteChange,
    customerLocation,
    currentAssignedFieldAgentId: currentAgentId,
    currentAssignedFieldAgentName: currentAgentName,
    recommendedRouteId: null,
    recommendedRouteName: null,
    recommendedFieldAgentId: currentAgentId,
    recommendedFieldAgentName: currentAgentName,
    willAutoAssign: false,
    matchStatus: match.matchStatus,
    reason:
      match.matchStatus === "incomplete"
        ? "Customer location is blank or incomplete — will not auto-assign a route."
        : `No active branch route matches location "${customerLocation}" — customer will remain unassigned until organized.`,
    candidateRoutes: [],
    branchActiveRoutes: branchActiveRoutes.map(toCandidateSummary)
  });
}

export type ResolvedApprovalAssignment = {
  routeId: string | null;
  assignedFieldAgentId: string | null;
  changeSource: CustomerAssignmentChangeSource | null;
  reason: string | null;
};

/**
 * Resolves the final operational route & mobilizer to set on customer approval
 * (never mutating `createdByFieldAgentId`).
 */
export async function resolveApprovalAssignment(
  tenantId: string,
  customer: Customer,
  override?: ApproveCustomerRegistrationInput
): Promise<ResolvedApprovalAssignment> {
  const settings = await getTenantRouteSettings(tenantId);
  const allRoutes = await listFieldRoutes(tenantId);
  const branchActiveRoutes = allRoutes.filter(
    (r) => r.status === "active" && r.branchId === customer.homeBranchId
  );

  const currentAgentId = customer.assignedFieldAgentId ?? null;
  const currentRouteId = customer.routeId ?? null;

  // Explicit administrator selection during approval always takes precedence.
  if (override && (override.routeId !== undefined || override.assignedFieldAgentId !== undefined)) {
    let nextRouteId: string | null =
      override.routeId !== undefined ? (override.routeId ?? null) : currentRouteId;
    let nextAgentId: string | null =
      override.assignedFieldAgentId !== undefined
        ? (override.assignedFieldAgentId ?? null)
        : currentAgentId;

    if (nextRouteId) {
      const targetRoute = allRoutes.find((r) => r.id === nextRouteId);
      if (!targetRoute) {
        throw new Error("Selected route not found");
      }
      if (targetRoute.branchId !== customer.homeBranchId) {
        throw new Error("Selected route must belong to the customer's home branch");
      }
      if (targetRoute.status !== "active") {
        throw new Error("Selected route is inactive");
      }
      if (
        override.assignedFieldAgentId === undefined &&
        settings.syncAgentOnRouteChange &&
        targetRoute.assignedFieldAgentId
      ) {
        nextAgentId = targetRoute.assignedFieldAgentId;
      }
    }

    const changed = nextRouteId !== currentRouteId || nextAgentId !== currentAgentId;
    return {
      routeId: nextRouteId,
      assignedFieldAgentId: nextAgentId,
      changeSource: changed ? "approval_manual" : null,
      reason:
        override.reason?.trim() ||
        (changed ? "Route/mobilizer selected during registration approval" : null)
    };
  }

  // Automatic strategy resolution
  if (settings.strategy === "manual" || !settings.autoAssignOnApproval) {
    return {
      routeId: currentRouteId,
      assignedFieldAgentId: currentAgentId,
      changeSource: null,
      reason: null
    };
  }

  if (settings.strategy === "registration") {
    if (!currentAgentId) {
      return {
        routeId: currentRouteId,
        assignedFieldAgentId: null,
        changeSource: null,
        reason: null
      };
    }
    const agentRoutes = branchActiveRoutes.filter((r) => r.assignedFieldAgentId === currentAgentId);
    if (agentRoutes.length === 1) {
      const route = agentRoutes[0]!;
      const changed = route.id !== currentRouteId;
      return {
        routeId: route.id,
        assignedFieldAgentId: currentAgentId,
        changeSource: changed ? "approval_auto" : null,
        reason: changed
          ? `Auto-attached agent's sole active branch route (${route.name}) on approval`
          : null
      };
    }
    return {
      routeId: currentRouteId,
      assignedFieldAgentId: currentAgentId,
      changeSource: null,
      reason: null
    };
  }

  // Location-based auto-assignment (only when strictly 1 unambiguous route matches)
  const match = matchCustomerLocationToRoutes(customer.location, branchActiveRoutes);
  if (match.matchStatus === "matched" && match.matchedRoute) {
    const route = match.matchedRoute;
    const nextAgentId =
      settings.syncAgentOnRouteChange && route.assignedFieldAgentId
        ? route.assignedFieldAgentId
        : currentAgentId;
    const changed = route.id !== currentRouteId || nextAgentId !== currentAgentId;
    return {
      routeId: route.id,
      assignedFieldAgentId: nextAgentId,
      changeSource: changed ? "approval_auto" : null,
      reason: changed
        ? `Auto-assigned via location "${customer.location?.trim()}" → route ${route.name}`
        : null
    };
  }

  return {
    routeId: currentRouteId,
    assignedFieldAgentId: currentAgentId,
    changeSource: null,
    reason: null
  };
}

// ---------------------------------------------------------------------------
// Customer assignment history audit trail (append-only)
// ---------------------------------------------------------------------------

export type RecordAssignmentHistoryInput = {
  tenantId: string;
  customerId: string;
  branchId: string;
  previousRouteId?: string | null;
  previousRouteName?: string | null;
  newRouteId?: string | null;
  newRouteName?: string | null;
  previousFieldAgentId?: string | null;
  previousFieldAgentName?: string | null;
  newFieldAgentId?: string | null;
  newFieldAgentName?: string | null;
  changedByUserId: string;
  changedByName?: string | null;
  changeSource: CustomerAssignmentChangeSource;
  reason?: string | null;
};

function mapHistoryRow(
  row: Record<string, unknown>,
  customerMeta?: { fullName?: string; accountNumber?: string | null }
): CustomerAssignmentHistory {
  return customerAssignmentHistorySchema.parse({
    id: row.id,
    tenantId: row.tenant_id,
    customerId: row.customer_id,
    customerName: customerMeta?.fullName ?? (row.customer_name != null ? String(row.customer_name) : null),
    customerAccountNumber:
      customerMeta?.accountNumber ??
      (row.customer_account_number != null ? String(row.customer_account_number) : null),
    branchId: row.branch_id,
    previousRouteId: row.previous_route_id ?? null,
    previousRouteName: row.previous_route_name ?? null,
    newRouteId: row.new_route_id ?? null,
    newRouteName: row.new_route_name ?? null,
    previousFieldAgentId: row.previous_field_agent_id ?? null,
    previousFieldAgentName: row.previous_field_agent_name ?? null,
    newFieldAgentId: row.new_field_agent_id ?? null,
    newFieldAgentName: row.new_field_agent_name ?? null,
    changedByUserId: row.changed_by_user_id,
    changedByName: row.changed_by_name ?? null,
    changeSource: row.change_source ?? "manual",
    reason: row.reason ?? null,
    createdAt: String(row.created_at ?? new Date().toISOString())
  });
}

export async function recordCustomerAssignmentHistory(
  entries: RecordAssignmentHistoryInput[]
): Promise<void> {
  const meaningful = entries.filter(
    (e) =>
      (e.previousRouteId ?? null) !== (e.newRouteId ?? null) ||
      (e.previousFieldAgentId ?? null) !== (e.newFieldAgentId ?? null)
  );
  if (meaningful.length === 0) {
    return;
  }

  const tenantId = meaningful[0]!.tenantId;
  const [routes, userNames] = await Promise.all([
    listFieldRoutes(tenantId).catch(() => [] as FieldRoute[]),
    fetchTenantUserNameMap(tenantId).catch(() => new Map<string, string>())
  ]);
  const routeNameById = new Map(routes.map((r) => [r.id, r.name]));
  const now = new Date().toISOString();

  const resolvedRecords: CustomerAssignmentHistory[] = meaningful.map((e) => {
    const prevRouteId = e.previousRouteId ?? null;
    const nextRouteId = e.newRouteId ?? null;
    const prevAgentId = e.previousFieldAgentId ?? null;
    const nextAgentId = e.newFieldAgentId ?? null;
    return {
      id: randomUUID(),
      tenantId: e.tenantId,
      customerId: e.customerId,
      branchId: e.branchId,
      previousRouteId: prevRouteId,
      previousRouteName:
        e.previousRouteName ?? (prevRouteId ? routeNameById.get(prevRouteId) ?? null : null),
      newRouteId: nextRouteId,
      newRouteName: e.newRouteName ?? (nextRouteId ? routeNameById.get(nextRouteId) ?? null : null),
      previousFieldAgentId: prevAgentId,
      previousFieldAgentName:
        e.previousFieldAgentName ?? (prevAgentId ? userNames.get(prevAgentId) ?? null : null),
      newFieldAgentId: nextAgentId,
      newFieldAgentName:
        e.newFieldAgentName ?? (nextAgentId ? userNames.get(nextAgentId) ?? null : null),
      changedByUserId: e.changedByUserId,
      changedByName: e.changedByName ?? userNames.get(e.changedByUserId) ?? e.changedByUserId,
      changeSource: e.changeSource,
      reason: e.reason?.trim() || null,
      createdAt: now
    };
  });

  const supabase = getSupabaseAdminClient();
  if (!supabase) {
    const existing = memoryAssignmentHistory.get(tenantId) ?? [];
    memoryAssignmentHistory.set(tenantId, [...resolvedRecords.reverse(), ...existing]);
    return;
  }

  const rows = resolvedRecords.map((r) => ({
    id: r.id,
    tenant_id: r.tenantId,
    customer_id: r.customerId,
    branch_id: r.branchId,
    previous_route_id: r.previousRouteId ?? null,
    previous_route_name: r.previousRouteName ?? null,
    new_route_id: r.newRouteId ?? null,
    new_route_name: r.newRouteName ?? null,
    previous_field_agent_id: r.previousFieldAgentId ?? null,
    previous_field_agent_name: r.previousFieldAgentName ?? null,
    new_field_agent_id: r.newFieldAgentId ?? null,
    new_field_agent_name: r.newFieldAgentName ?? null,
    changed_by_user_id: r.changedByUserId,
    changed_by_name: r.changedByName ?? null,
    change_source: r.changeSource,
    reason: r.reason ?? null,
    created_at: r.createdAt
  }));

  const { error } = await supabase.from("customer_assignment_history").insert(rows);
  if (error && !isMissingRouteManagementTable(error.message)) {
    throw new Error(`Failed to record customer assignment history: ${error.message}`);
  }
}

export async function listCustomerAssignmentHistory(
  tenantId: string,
  options?: { customerId?: string; branchId?: string; limit?: number }
): Promise<CustomerAssignmentHistory[]> {
  const limit = Math.min(Math.max(options?.limit ?? 100, 1), 500);
  const supabase = getSupabaseAdminClient();

  if (!supabase) {
    const { listCustomers } = await import("./customerService.js");
    const customers = await listCustomers(tenantId).catch(() => [] as Customer[]);
    const customerMap = new Map(
      customers.map((c) => [c.id, { fullName: c.fullName, accountNumber: c.accountNumber ?? null }])
    );
    return (memoryAssignmentHistory.get(tenantId) ?? [])
      .filter((row) => {
        if (options?.customerId && row.customerId !== options.customerId) {
          return false;
        }
        if (options?.branchId && row.branchId !== options.branchId) {
          return false;
        }
        return true;
      })
      .slice(0, limit)
      .map((row) => {
        const meta = customerMap.get(row.customerId);
        return {
          ...row,
          customerName: row.customerName ?? meta?.fullName ?? null,
          customerAccountNumber: row.customerAccountNumber ?? meta?.accountNumber ?? null
        };
      });
  }

  let query = supabase
    .from("customer_assignment_history")
    .select("*")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (options?.customerId) {
    query = query.eq("customer_id", options.customerId);
  }
  if (options?.branchId) {
    query = query.eq("branch_id", options.branchId);
  }

  const { data, error } = await query;
  if (error) {
    if (isMissingRouteManagementTable(error.message)) {
      return [];
    }
    throw new Error(`Failed to load customer assignment history: ${error.message}`);
  }

  const rows = (data ?? []) as Record<string, unknown>[];
  const customerIds = [...new Set(rows.map((r) => String(r.customer_id)).filter(Boolean))];
  const customerMap = new Map<string, { fullName: string; accountNumber: string | null }>();
  if (customerIds.length > 0) {
    for (let i = 0; i < customerIds.length; i += 200) {
      const chunk = customerIds.slice(i, i + 200);
      const { data: custRows } = await supabase
        .from("customers")
        .select("id, full_name, account_number")
        .eq("tenant_id", tenantId)
        .in("id", chunk);
      for (const c of custRows ?? []) {
        customerMap.set(String(c.id), {
          fullName: String(c.full_name ?? "").trim(),
          accountNumber: c.account_number ? String(c.account_number).trim() : null
        });
      }
    }
  }

  return rows.map((row) => mapHistoryRow(row, customerMap.get(String(row.customer_id))));
}

// ---------------------------------------------------------------------------
// Branch location suggestions & bulk Route Reorganization
// ---------------------------------------------------------------------------

export async function getBranchLocationSuggestions(
  tenantId: string,
  branchId: string
): Promise<RouteLocationSuggestion[]> {
  if (!branchId?.trim()) {
    throw new Error("Branch is required");
  }
  const [{ listCustomers }, allRoutes] = await Promise.all([
    import("./customerService.js"),
    listFieldRoutes(tenantId)
  ]);

  const branchActiveRoutes = allRoutes.filter(
    (r) => r.status === "active" && r.branchId === branchId
  );
  const allCustomers = await listCustomers(tenantId);
  const activeBranchCustomers = allCustomers.filter(
    (c) => c.status === "active" && c.homeBranchId === branchId
  );

  return activeBranchCustomers.map((customer) => {
    const match = matchCustomerLocationToRoutes(customer.location, branchActiveRoutes);
    return routeLocationSuggestionSchema.parse({
      customerId: customer.id,
      branchId,
      customerLocation: customer.location?.trim() || null,
      matchStatus: match.matchStatus,
      suggestedRouteId: match.matchedRoute?.id ?? null,
      suggestedRouteName: match.matchedRoute?.name ?? null,
      suggestedFieldAgentId: match.matchedRoute?.assignedFieldAgentId ?? null,
      suggestedFieldAgentName: match.matchedRoute?.assignedFieldAgentName ?? null,
      matchedArea: match.matchedArea,
      candidateRoutes: match.candidates.map(toCandidateSummary)
    });
  });
}

export async function bulkReorganizeCustomerAssignments(
  tenantId: string,
  actor: {
    userId: string;
    role: string;
    scopeType?: "head_office" | "branch";
    branchId?: string;
  },
  rawInput: unknown
): Promise<BulkReorganizeResult> {
  if (actor.role !== "admin" && actor.role !== "coordinator") {
    throw new Error("Only admin or coordinator can reorganize customer routes and mobilizers");
  }

  const input = bulkReorganizeCustomersSchema.parse(rawInput);
  if (actor.scopeType === "branch" && actor.branchId && actor.branchId !== input.branchId) {
    throw new Error("Cannot reorganize customers for another branch");
  }

  const [
    { getCustomerById, setCustomerAssignmentDirect },
    { listTenantFieldAgents },
    allRoutes,
    settings,
    userNames
  ] = await Promise.all([
    import("./customerService.js"),
    import("./authService.js"),
    listFieldRoutes(tenantId),
    getTenantRouteSettings(tenantId),
    fetchTenantUserNameMap(tenantId).catch(() => new Map<string, string>())
  ]);

  const routeById = new Map(allRoutes.map((r) => [r.id, r]));
  const activeAgents = await listTenantFieldAgents(tenantId);
  const activeAgentIds = new Set(
    activeAgents.filter((a) => a.status === "active").map((a) => a.userId)
  );
  const actorName = userNames.get(actor.userId) ?? actor.userId;
  const syncFromRoute = input.syncAgentFromRoute ?? settings.syncAgentOnRouteChange;

  // Validate all targets before mutating any customer so partial bad requests fail cleanly.
  const planned: Array<{
    customer: Customer;
    nextRouteId: string | null;
    nextAgentId: string | null;
  }> = [];

  for (const item of input.assignments) {
    const customer = await getCustomerById(tenantId, item.customerId);
    if (!customer) {
      throw new Error(`Customer ${item.customerId} not found`);
    }
    if (customer.homeBranchId !== input.branchId) {
      throw new Error(
        `Customer ${customer.fullName} belongs to a different branch and cannot be reorganized under this branch`
      );
    }
    if (customer.status !== "active") {
      throw new Error(`Customer ${customer.fullName} is not active`);
    }

    const nextRouteId =
      item.routeId !== undefined ? (item.routeId ?? null) : (customer.routeId ?? null);

    let nextAgentId =
      item.assignedFieldAgentId !== undefined
        ? (item.assignedFieldAgentId ?? null)
        : (customer.assignedFieldAgentId ?? null);

    if (nextRouteId) {
      const targetRoute = routeById.get(nextRouteId);
      if (!targetRoute) {
        throw new Error(`Target route ${nextRouteId} not found`);
      }
      if (targetRoute.branchId !== input.branchId) {
        throw new Error(`Route "${targetRoute.name}" does not belong to the selected branch`);
      }
      if (targetRoute.status !== "active") {
        throw new Error(`Route "${targetRoute.name}" is inactive`);
      }
      if (
        item.assignedFieldAgentId === undefined &&
        syncFromRoute &&
        targetRoute.assignedFieldAgentId
      ) {
        nextAgentId = targetRoute.assignedFieldAgentId;
      }
    }

    if (nextAgentId && !activeAgentIds.has(nextAgentId)) {
      throw new Error("Target field agent not found or is inactive");
    }

    planned.push({ customer, nextRouteId, nextAgentId });
  }

  const changes: BulkReorganizeResult["changes"] = [];
  const historyRows: RecordAssignmentHistoryInput[] = [];
  let skippedCount = 0;

  for (const plan of planned) {
    const prevRouteId = plan.customer.routeId ?? null;
    const prevAgentId = plan.customer.assignedFieldAgentId ?? null;

    if (prevRouteId === plan.nextRouteId && prevAgentId === plan.nextAgentId) {
      skippedCount += 1;
      continue;
    }

    // Only updates operational fields (route_id, assigned_field_agent_id).
    // NEVER touches created_by_field_agent_id, balances, transactions, or financial records.
    await setCustomerAssignmentDirect(
      tenantId,
      plan.customer.id,
      plan.nextAgentId,
      plan.nextRouteId
    );

    const prevRouteName = prevRouteId ? (routeById.get(prevRouteId)?.name ?? null) : null;
    const nextRouteName = plan.nextRouteId
      ? (routeById.get(plan.nextRouteId)?.name ?? null)
      : null;
    const prevAgentName = prevAgentId
      ? (userNames.get(prevAgentId) ?? plan.customer.assignedFieldAgentName ?? null)
      : null;
    const nextAgentName = plan.nextAgentId ? (userNames.get(plan.nextAgentId) ?? null) : null;

    changes.push({
      customerId: plan.customer.id,
      customerName: plan.customer.fullName,
      previousRouteId: prevRouteId,
      previousRouteName: prevRouteName,
      newRouteId: plan.nextRouteId,
      newRouteName: nextRouteName,
      previousFieldAgentId: prevAgentId,
      previousFieldAgentName: prevAgentName,
      newFieldAgentId: plan.nextAgentId,
      newFieldAgentName: nextAgentName
    });

    historyRows.push({
      tenantId,
      customerId: plan.customer.id,
      branchId: input.branchId,
      previousRouteId: prevRouteId,
      previousRouteName: prevRouteName,
      newRouteId: plan.nextRouteId,
      newRouteName: nextRouteName,
      previousFieldAgentId: prevAgentId,
      previousFieldAgentName: prevAgentName,
      newFieldAgentId: plan.nextAgentId,
      newFieldAgentName: nextAgentName,
      changedByUserId: actor.userId,
      changedByName: actorName,
      changeSource: "reorganization",
      reason: input.reason
    });
  }

  if (historyRows.length > 0) {
    await recordCustomerAssignmentHistory(historyRows);
  }

  return bulkReorganizeResultSchema.parse({
    updatedCount: changes.length,
    skippedCount,
    changes
  });
}
