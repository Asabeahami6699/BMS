import { beforeEach, describe, expect, it, vi } from "vitest";

const BR_1 = "11111111-1111-4111-8111-111111111111";
const BR_2 = "22222222-2222-4222-8222-222222222222";

vi.mock("../config/supabaseClient.js", () => ({
  getSupabaseAdminClient: () => null
}));

vi.mock("./branchService.js", () => ({
  listBranches: async () => [
    { id: BR_1, name: "Bondaye Branch", code: "BND", status: "active" },
    { id: BR_2, name: "Tarkwa Branch", code: "TRK", status: "active" }
  ],
  branchDisplayLabel: async (_tenantId: string, branchId: string) =>
    branchId === BR_1 ? "Bondaye Branch" : "Tarkwa Branch"
}));

vi.mock("./userNameResolver.js", () => {
  const map = new Map([
    ["agent-1", "Kwame Mobilizer"],
    ["agent-2", "Abena Mobilizer"],
    ["agent-3", "Kojo Mobilizer"],
    ["admin-1", "Evans Admin"]
  ]);
  return {
    fetchTenantUserNameMap: async () => map,
    fetchUserNameMap: async () => map
  };
});

vi.mock("./authService.js", () => ({
  listTenantFieldAgents: async () => [
    {
      userId: "agent-1",
      email: "kwame@test.local",
      fullName: "Kwame Mobilizer",
      branchId: BR_1,
      status: "active"
    },
    {
      userId: "agent-2",
      email: "abena@test.local",
      fullName: "Abena Mobilizer",
      branchId: BR_1,
      status: "active"
    },
    {
      userId: "agent-3",
      email: "kojo@test.local",
      fullName: "Kojo Mobilizer",
      branchId: BR_2,
      status: "active"
    }
  ]
}));

vi.mock("./notificationService.js", () => ({
  createAgentNotification: async () => undefined,
  notifyTenantStaff: async () => undefined
}));

vi.mock("./registrationFormSetupService.js", () => ({
  getRegistrationFormSetup: async () => ({
    savingsOpeningFeeGhs: 0,
    savingsOpeningFeeHandling: "cash_now",
    requiredFields: []
  }),
  registrationFormIssue: () => null
}));

import {
  approveCustomerRegistration,
  assignCustomerFieldAgent,
  clearMemoryCustomers,
  getCustomerById,
  submitCustomerRegistration
} from "./customerService.js";
import {
  clearMemoryRoutes,
  createFieldRoute,
  deleteFieldRoute,
  updateFieldRoute
} from "./routeService.js";
import {
  bulkReorganizeCustomerAssignments,
  clearMemoryRouteManagement,
  getApprovalRouteRecommendation,
  getBranchLocationSuggestions,
  getTenantRouteSettings,
  listCustomerAssignmentHistory,
  matchCustomerLocationToRoutes,
  updateTenantRouteSettings
} from "./routeManagementService.js";

const TENANT_A = "tenant-a";
const TENANT_B = "tenant-b";
const ADMIN_ACTOR = {
  userId: "admin-1",
  role: "admin",
  scopeType: "head_office" as const
};

function registrationPayload(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    fullName: "Akosua Mensah",
    phone: "0244001122",
    location: "Bogoso Market",
    houseNumber: "H-101",
    dateOfBirth: "1992-05-10",
    occupation: "Trader",
    accountType: "susu",
    idCardType: "ghana_card",
    idCardNumber: "GHA-123456789-0",
    photoUrl: "https://example.local/photo.jpg",
    idCardPhotoUrl: "https://example.local/id.jpg",
    nationality: "Ghanaian",
    nextOfKin: {
      fullName: "Yaw Mensah",
      phone: "0244998877",
      location: "Bogoso Market",
      houseNumber: "H-101"
    },
    dailyContributionAmount: 20,
    homeBranchId: BR_1,
    ...overrides
  };
}

describe("Tenant-Based Customer Route Management (Feature 2)", () => {
  beforeEach(() => {
    clearMemoryCustomers();
    clearMemoryRoutes();
    clearMemoryRouteManagement();
  });

  it("isolates route assignment settings strictly per tenant", async () => {
    const defaultA = await getTenantRouteSettings(TENANT_A);
    const defaultB = await getTenantRouteSettings(TENANT_B);
    expect(defaultA.strategy).toBe("registration");
    expect(defaultB.strategy).toBe("registration");

    const updatedA = await updateTenantRouteSettings(TENANT_A, "admin-1", {
      strategy: "location",
      autoAssignOnApproval: true,
      syncAgentOnRouteChange: true
    });
    expect(updatedA.strategy).toBe("location");

    const stillB = await getTenantRouteSettings(TENANT_B);
    expect(stillB.strategy).toBe("registration");

    await updateTenantRouteSettings(TENANT_B, "admin-1", {
      strategy: "manual",
      autoAssignOnApproval: false,
      syncAgentOnRouteChange: false
    });
    expect((await getTenantRouteSettings(TENANT_A)).strategy).toBe("location");
    expect((await getTenantRouteSettings(TENANT_B)).strategy).toBe("manual");
  });

  it("conservatively matches customer locations without inventing data or auto-assigning ambiguous matches", async () => {
    const route1 = await createFieldRoute(TENANT_A, {
      branchId: BR_1,
      name: "Market Loop",
      area: "Bogoso Market",
      communities: ["Bogoso Central", "Old Station"],
      assignedFieldAgentId: "agent-1"
    });
    const route2 = await createFieldRoute(TENANT_A, {
      branchId: BR_1,
      name: "Highway Corridor",
      area: "Prestea Junction",
      communities: ["Old Station", "Huni Valley"],
      assignedFieldAgentId: "agent-2"
    });

    const routes = [route1, route2];

    const incomplete = matchCustomerLocationToRoutes(" ", routes);
    expect(incomplete.matchStatus).toBe("incomplete");
    expect(incomplete.matchedRoute).toBeNull();

    const exact = matchCustomerLocationToRoutes("Bogoso Market", routes);
    expect(exact.matchStatus).toBe("matched");
    expect(exact.matchedRoute?.id).toBe(route1.id);

    const communityPhrase = matchCustomerLocationToRoutes("Near Huni Valley Lorry Park", routes);
    expect(communityPhrase.matchStatus).toBe("matched");
    expect(communityPhrase.matchedRoute?.id).toBe(route2.id);

    const ambiguous = matchCustomerLocationToRoutes("Old Station", routes);
    expect(ambiguous.matchStatus).toBe("ambiguous");
    expect(ambiguous.matchedRoute).toBeNull();
    expect(ambiguous.candidates.map((r) => r.id).sort()).toEqual([route1.id, route2.id].sort());

    const unmatched = matchCustomerLocationToRoutes("Unknown Village", routes);
    expect(unmatched.matchStatus).toBe("unmatched");
    expect(unmatched.matchedRoute).toBeNull();
  });

  it("Registration-Based strategy attaches the agent's sole active branch route on approval, and leaves null when 0 or 2+ routes exist", async () => {
    // 1. Agent has 0 routes -> routeId remains undefined
    const pendingZero = await submitCustomerRegistration(
      TENANT_A,
      "agent-1",
      BR_1,
      registrationPayload({ fullName: "Zero Route Client", phone: "0244000001" })
    );
    const approvedZero = await approveCustomerRegistration(TENANT_A, pendingZero.id, "admin-1");
    expect(approvedZero.routeId).toBeUndefined();
    expect(approvedZero.assignedFieldAgentId).toBe("agent-1");
    expect(approvedZero.createdByFieldAgentId).toBe("agent-1");

    // 2. Agent has exactly 1 active route -> automatically attaches that route
    const route1 = await createFieldRoute(TENANT_A, {
      branchId: BR_1,
      name: "Route Alpha",
      area: "Zone A",
      assignedFieldAgentId: "agent-1"
    });
    const pendingOne = await submitCustomerRegistration(
      TENANT_A,
      "agent-1",
      BR_1,
      registrationPayload({ fullName: "Single Route Client", phone: "0244000002" })
    );
    const recOne = await getApprovalRouteRecommendation(TENANT_A, pendingOne);
    expect(recOne.willAutoAssign).toBe(true);
    expect(recOne.recommendedRouteId).toBe(route1.id);

    const approvedOne = await approveCustomerRegistration(TENANT_A, pendingOne.id, "admin-1");
    expect(approvedOne.routeId).toBe(route1.id);
    expect(approvedOne.assignedFieldAgentId).toBe("agent-1");
    expect(approvedOne.createdByFieldAgentId).toBe("agent-1");

    // 3. Agent has 2 active routes -> ambiguous, leaves routeId unset unless admin selects one
    await createFieldRoute(TENANT_A, {
      branchId: BR_1,
      name: "Route Beta",
      area: "Zone B",
      assignedFieldAgentId: "agent-1"
    });
    const pendingTwo = await submitCustomerRegistration(
      TENANT_A,
      "agent-1",
      BR_1,
      registrationPayload({ fullName: "Multi Route Client", phone: "0244000003" })
    );
    const recTwo = await getApprovalRouteRecommendation(TENANT_A, pendingTwo);
    expect(recTwo.matchStatus).toBe("ambiguous");
    expect(recTwo.willAutoAssign).toBe(false);

    const approvedTwo = await approveCustomerRegistration(TENANT_A, pendingTwo.id, "admin-1");
    expect(approvedTwo.routeId).toBeUndefined();
    expect(approvedTwo.assignedFieldAgentId).toBe("agent-1");
  });

  it("Location-Based strategy auto-assigns unambiguous matching route while preserving original creator, and skips ambiguous locations", async () => {
    await updateTenantRouteSettings(TENANT_A, "admin-1", {
      strategy: "location",
      autoAssignOnApproval: true,
      syncAgentOnRouteChange: true
    });

    const marketRoute = await createFieldRoute(TENANT_A, {
      branchId: BR_1,
      name: "Market Route",
      area: "Bogoso Market",
      communities: ["Central Square"],
      assignedFieldAgentId: "agent-2"
    });
    const stationRoute = await createFieldRoute(TENANT_A, {
      branchId: BR_1,
      name: "Station Route",
      area: "Lorry Station",
      communities: ["Central Square"],
      assignedFieldAgentId: "agent-1"
    });

    // Registered by agent-1 in Bogoso Market -> unambiguous match to marketRoute (agent-2)
    const pendingMatch = await submitCustomerRegistration(
      TENANT_A,
      "agent-1",
      BR_1,
      registrationPayload({
        fullName: "Market Trader",
        phone: "0244111111",
        location: "Bogoso Market"
      })
    );
    const approvedMatch = await approveCustomerRegistration(TENANT_A, pendingMatch.id, "admin-1");
    expect(approvedMatch.routeId).toBe(marketRoute.id);
    expect(approvedMatch.assignedFieldAgentId).toBe("agent-2");
    // Original creator MUST NEVER be overwritten
    expect(approvedMatch.createdByFieldAgentId).toBe("agent-1");

    const history = await listCustomerAssignmentHistory(TENANT_A, {
      customerId: approvedMatch.id
    });
    expect(history.length).toBe(1);
    expect(history[0].changeSource).toBe("approval_auto");
    expect(history[0].newRouteId).toBe(marketRoute.id);
    expect(history[0].newFieldAgentId).toBe("agent-2");

    // Ambiguous community ("Central Square" is on both routes) -> must NOT auto-assign
    const pendingAmbig = await submitCustomerRegistration(
      TENANT_A,
      "agent-1",
      BR_1,
      registrationPayload({
        fullName: "Central Trader",
        phone: "0244111112",
        location: "Central Square"
      })
    );
    const recAmbig = await getApprovalRouteRecommendation(TENANT_A, pendingAmbig);
    expect(recAmbig.matchStatus).toBe("ambiguous");
    expect(recAmbig.willAutoAssign).toBe(false);

    const approvedAmbig = await approveCustomerRegistration(TENANT_A, pendingAmbig.id, "admin-1");
    expect(approvedAmbig.routeId).toBeUndefined();
    expect(approvedAmbig.assignedFieldAgentId).toBe("agent-1");
    expect(stationRoute.id).toBeTruthy();

    // Suggestions endpoint exposes reviewable suggestions for branch reorganization
    const suggestions = await getBranchLocationSuggestions(TENANT_A, BR_1);
    const ambigRow = suggestions.find((s) => s.customerId === approvedAmbig.id);
    expect(ambigRow?.matchStatus).toBe("ambiguous");
    expect(ambigRow?.candidateRoutes.length).toBe(2);
  });

  it("Manual strategy never auto-assigns on approval and allows explicit admin override", async () => {
    await updateTenantRouteSettings(TENANT_A, "admin-1", {
      strategy: "manual",
      autoAssignOnApproval: true,
      syncAgentOnRouteChange: false
    });

    const route1 = await createFieldRoute(TENANT_A, {
      branchId: BR_1,
      name: "Manual Route",
      area: "Bogoso Market",
      assignedFieldAgentId: "agent-1"
    });

    const pending = await submitCustomerRegistration(
      TENANT_A,
      "agent-1",
      BR_1,
      registrationPayload({
        fullName: "Manual Client",
        phone: "0244222221",
        location: "Bogoso Market"
      })
    );
    const rec = await getApprovalRouteRecommendation(TENANT_A, pending);
    expect(rec.willAutoAssign).toBe(false);

    const approvedDefault = await approveCustomerRegistration(TENANT_A, pending.id, "admin-1");
    expect(approvedDefault.routeId).toBeUndefined();

    // Explicit admin override on approval works cleanly
    const pendingOverride = await submitCustomerRegistration(
      TENANT_A,
      "agent-1",
      BR_1,
      registrationPayload({
        fullName: "Manual Override Client",
        phone: "0244222222",
        location: "Bogoso Market"
      })
    );
    const approvedOverride = await approveCustomerRegistration(
      TENANT_A,
      pendingOverride.id,
      "admin-1",
      { routeId: route1.id }
    );
    expect(approvedOverride.routeId).toBe(route1.id);
    expect(approvedOverride.createdByFieldAgentId).toBe("agent-1");
  });

  it("bulk reorganization enforces branch isolation, preserves original creator, and retains history after subsequent transfers and route deletion", async () => {
    const routeBr1A = await createFieldRoute(TENANT_A, {
      branchId: BR_1,
      name: "Bondaye North",
      area: "North",
      assignedFieldAgentId: "agent-1"
    });
    const routeBr1B = await createFieldRoute(TENANT_A, {
      branchId: BR_1,
      name: "Bondaye South",
      area: "South",
      assignedFieldAgentId: "agent-2"
    });
    const routeBr2 = await createFieldRoute(TENANT_A, {
      branchId: BR_2,
      name: "Tarkwa Central",
      area: "Tarkwa",
      assignedFieldAgentId: "agent-3"
    });

    const pending = await submitCustomerRegistration(
      TENANT_A,
      "agent-1",
      BR_1,
      registrationPayload({
        fullName: "Kofi Boateng",
        phone: "0244333331",
        location: "North",
        dailyContributionAmount: 35
      })
    );
    const customer = await approveCustomerRegistration(TENANT_A, pending.id, "admin-1", {
      routeId: routeBr1A.id
    });
    expect(customer.createdByFieldAgentId).toBe("agent-1");

    // Cross-branch route assignment MUST be rejected
    await expect(
      bulkReorganizeCustomerAssignments(TENANT_A, ADMIN_ACTOR, {
        branchId: BR_1,
        reason: "Invalid cross-branch move",
        assignments: [{ customerId: customer.id, routeId: routeBr2.id }]
      })
    ).rejects.toThrow(/branch/i);

    // Valid bulk reorganization to Bondaye South (agent-2)
    const result = await bulkReorganizeCustomerAssignments(TENANT_A, ADMIN_ACTOR, {
      branchId: BR_1,
      reason: "Rebalance Bondaye South territory",
      assignments: [{ customerId: customer.id, routeId: routeBr1B.id }]
    });
    expect(result.updatedCount).toBe(1);
    expect(result.skippedCount).toBe(0);

    const moved = await getCustomerById(TENANT_A, customer.id);
    expect(moved?.routeId).toBe(routeBr1B.id);
    expect(moved?.assignedFieldAgentId).toBe("agent-2");
    expect(moved?.createdByFieldAgentId).toBe("agent-1");
    expect(moved?.dailyContributionAmount).toBe(35);

    // Route-agent sync updates members when route mobilizer changes
    await updateFieldRoute(
      TENANT_A,
      routeBr1B.id,
      { assignedFieldAgentId: "agent-1" },
      "admin-1"
    );
    const synced = await getCustomerById(TENANT_A, customer.id);
    expect(synced?.assignedFieldAgentId).toBe("agent-1");
    expect(synced?.createdByFieldAgentId).toBe("agent-1");

    // Individual transfer also records history and preserves original creator
    await assignCustomerFieldAgent(
      TENANT_A,
      customer.id,
      {
        assignedFieldAgentId: "agent-2",
        routeId: null,
        reason: "Temporary coverage"
      },
      "admin-1"
    );

    // Reassign back onto Bondaye South (now owned by agent-1) before deleting route
    await assignCustomerFieldAgent(
      TENANT_A,
      customer.id,
      {
        assignedFieldAgentId: "agent-1",
        routeId: routeBr1B.id,
        reason: "Return to Bondaye South"
      },
      "admin-1"
    );

    // Deleting the route unassigns members but MUST preserve all prior assignment history
    await deleteFieldRoute(TENANT_A, routeBr1B.id, "admin-1");
    const afterDelete = await getCustomerById(TENANT_A, customer.id);
    expect(afterDelete?.routeId).toBeUndefined();
    expect(afterDelete?.createdByFieldAgentId).toBe("agent-1");

    const history = await listCustomerAssignmentHistory(TENANT_A, {
      customerId: customer.id
    });
    expect(history.length).toBeGreaterThanOrEqual(4);
    expect(history.map((h) => h.changeSource)).toEqual(
      expect.arrayContaining([
        "approval_manual",
        "reorganization",
        "route_agent_sync",
        "transfer",
        "route_deleted"
      ])
    );
    expect(history.some((h) => h.reason === "Rebalance Bondaye South territory")).toBe(true);
    expect(history.some((h) => h.newRouteName === "Bondaye South")).toBe(true);
  });
});
