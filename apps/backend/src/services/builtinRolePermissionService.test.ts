import { describe, expect, it, vi } from "vitest";
import {
  FIELD_AGENT_LOCKED_PERMISSIONS,
  FIELD_AGENT_TOGGLEABLE_PERMISSIONS,
  catalogEntriesForCustomRoleScope,
  catalogEntriesForTenant,
  sanitizeFieldAgentDuties
} from "@bms/shared";

vi.mock("../config/supabaseClient.js", () => ({
  getSupabaseAdminClient: () => null
}));

import {
  listBuiltinRolePermissions,
  resetBuiltinRolePermissions,
  resolvePermissionsForTenantUser,
  saveBuiltinRolePermissions,
  syncBuiltinRolePermissionsForModules
} from "./builtinRolePermissionService.js";

describe("Field Agent curated role controls", () => {
  it("defaults all 4 toggleable capabilities ON alongside locked core permissions", async () => {
    const tenantId = "tenant-fa-defaults";
    const perms = await resolvePermissionsForTenantUser(tenantId, "field_agent");

    for (const locked of FIELD_AGENT_LOCKED_PERMISSIONS) {
      expect(perms).toContain(locked);
    }
    for (const toggle of FIELD_AGENT_TOGGLEABLE_PERMISSIONS) {
      expect(perms).toContain(toggle);
    }

    const views = await listBuiltinRolePermissions(tenantId);
    const fieldAgentView = views.find((v) => v.role === "field_agent");
    expect(fieldAgentView).toBeDefined();
    expect(fieldAgentView?.isCustomized).toBe(false);
    expect(fieldAgentView?.effectiveDuties).toEqual(perms);
  });

  it("persists selective toggles while locking core duties and rejecting office permissions", async () => {
    const tenantId = "tenant-fa-sanitize";

    // Attempt to strip locked duties AND inject privileged office duties.
    const saved = await saveBuiltinRolePermissions(
      tenantId,
      "field_agent",
      {
        duties: [
          "customers.create",
          "audit.read",
          "roles.create",
          "agency.withdrawals.approve",
          "transactions.reverse.daily_susu"
        ]
      },
      "admin-1"
    );

    expect(saved.isCustomized).toBe(true);
    // Locked permissions must remain intact
    for (const locked of FIELD_AGENT_LOCKED_PERMISSIONS) {
      expect(saved.effectiveDuties).toContain(locked);
    }
    // Requested toggle is ON, other 3 toggles are OFF
    expect(saved.effectiveDuties).toContain("customers.create");
    expect(saved.effectiveDuties).not.toContain("field_agent.withdrawals.request");
    expect(saved.effectiveDuties).not.toContain("field_agent.balance.request");
    expect(saved.effectiveDuties).not.toContain("payroll.read");
    // Privileged office duties must NEVER be granted to field_agent
    expect(saved.effectiveDuties).not.toContain("audit.read");
    expect(saved.effectiveDuties).not.toContain("roles.create");
    expect(saved.effectiveDuties).not.toContain("agency.withdrawals.approve");
    expect(saved.effectiveDuties).not.toContain("transactions.reverse.daily_susu");

    // Module sync must NOT silently re-enable toggles an admin turned off
    await syncBuiltinRolePermissionsForModules(tenantId, ["susu_management"]);
    const resolved = await resolvePermissionsForTenantUser(tenantId, "field_agent");
    expect(resolved).toContain("customers.create");
    expect(resolved).not.toContain("field_agent.withdrawals.request");
    expect(resolved).not.toContain("field_agent.balance.request");
    expect(resolved).not.toContain("payroll.read");

    // Reset restores all 4 defaults
    const reset = await resetBuiltinRolePermissions(tenantId, "field_agent");
    expect(reset.isCustomized).toBe(false);
    for (const toggle of FIELD_AGENT_TOGGLEABLE_PERMISSIONS) {
      expect(reset.effectiveDuties).toContain(toggle);
    }
  });

  it("keeps field-agent-only permissions out of office job title and custom role catalogs", () => {
    const tenantEntries = catalogEntriesForTenant(["susu_management", "banking", "loans_credit"]);
    const customEntries = catalogEntriesForCustomRoleScope(["susu_management"], "susu_management");

    for (const list of [tenantEntries, customEntries]) {
      const ids = list.map((e) => e.id);
      expect(ids).not.toContain("field_agent.withdrawals.request");
      expect(ids).not.toContain("field_agent.balance.request");
    }

    expect(sanitizeFieldAgentDuties([])).toEqual([...FIELD_AGENT_LOCKED_PERMISSIONS]);
  });
});
