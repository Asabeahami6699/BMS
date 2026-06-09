import { customRoleProductScopeSchema, permissionSchema, roleSchema, tenantRoleKindSchema, validateCustomRoleDuties } from "@bms/shared";
import { Router } from "express";
import { z } from "zod";
import { getSupabaseAdminClient } from "../config/supabaseClient.js";
import { requirePermission } from "../middleware/requirePermission.js";
import {
  listBuiltinRolePermissions,
  resetBuiltinRolePermissions,
  saveBuiltinRolePermissions
} from "../services/builtinRolePermissionService.js";
import {
  createTenantJobTitle,
  deleteTenantJobTitle,
  listTenantJobTitles,
  updateTenantJobTitle
} from "../services/tenantJobTitleService.js";
import {
  listSusuNavVisibilityConfig,
  resetSusuNavVisibility,
  saveSusuNavVisibility
} from "../services/susuNavVisibilityService.js";

const createRoleSchema = z.object({
  roleKey: z.string().min(1),
  displayName: z.string().min(1),
  roleKind: tenantRoleKindSchema.default("extra_duties"),
  productScope: customRoleProductScopeSchema.default("all"),
  duties: z.array(permissionSchema).min(1)
});

const assignRoleSchema = z.object({
  userId: z.string().min(1),
  roleKey: z.string().min(1)
});

type TenantRole = z.infer<typeof createRoleSchema> & { tenantId: string; createdBy: string };
type UserRoleAssignment = z.infer<typeof assignRoleSchema> & { tenantId: string; assignedBy: string };

const tenantRoles: TenantRole[] = [];
const roleAssignments: UserRoleAssignment[] = [];

function mapTenantRole(record: TenantRole) {
  return {
    roleKey: record.roleKey,
    displayName: record.displayName,
    roleKind: record.roleKind ?? "extra_duties",
    productScope: record.productScope ?? "all",
    duties: record.duties
  };
}

export const rolesRouter = Router();

rolesRouter.post("/", requirePermission("roles.create"), (req, res) => {
  const context = req.userContext;
  if (!context) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const parsed = createRoleSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid role payload", details: parsed.error.flatten() });
    return;
  }

  const dutyValidation = validateCustomRoleDuties(
    parsed.data.duties,
    parsed.data.productScope,
    context.subscribedModules
  );
  if (dutyValidation.errors.length > 0) {
    res.status(400).json({ error: dutyValidation.errors[0], details: dutyValidation.errors });
    return;
  }

  if (
    parsed.data.productScope !== "all" &&
    !context.subscribedModules?.includes(parsed.data.productScope)
  ) {
    res.status(400).json({ error: "Product scope is not enabled on this subscription" });
    return;
  }

  if (roleSchema.safeParse(parsed.data.roleKey).success) {
    res.status(400).json({ error: "This key is reserved for a system job title" });
    return;
  }

  if (parsed.data.roleKind === "job_title") {
    void (async () => {
      try {
        const view = await createTenantJobTitle(
          context.tenantId,
          {
            roleKey: parsed.data.roleKey,
            displayName: parsed.data.displayName,
            productScope: parsed.data.productScope,
            duties: parsed.data.duties
          },
          context.userId,
          context.subscribedModules
        );
        res.status(201).json({ ...view, roleKind: "job_title" as const });
      } catch (error) {
        res.status(400).json({
          error: error instanceof Error ? error.message : "Failed to create job title"
        });
      }
    })();
    return;
  }

  const record: TenantRole = {
    ...parsed.data,
    tenantId: context.tenantId,
    createdBy: context.userId
  };

  const supabase = getSupabaseAdminClient();
  if (supabase) {
    void (async () => {
      const { data: existing, error: findError } = await supabase
        .from("tenant_roles")
        .select("id")
        .eq("tenant_id", context.tenantId)
        .eq("role_key", parsed.data.roleKey)
        .maybeSingle();
      if (findError) {
        res.status(500).json({ error: `Failed to check role: ${findError.message}` });
        return;
      }
      if (existing) {
        res.status(409).json({ error: "Role already exists for this tenant" });
        return;
      }

      const { error } = await supabase.from("tenant_roles").insert({
        tenant_id: context.tenantId,
        role_key: parsed.data.roleKey,
        display_name: parsed.data.displayName,
        product_scope: parsed.data.productScope,
        duties: parsed.data.duties,
        role_kind: "extra_duties",
        created_by: context.userId
      });
      if (error) {
        res.status(500).json({ error: `Failed to create role: ${error.message}` });
        return;
      }
      res.status(201).json(mapTenantRole(record));
    })();
    return;
  }

  const existing = tenantRoles.find(
    (role) => role.tenantId === context.tenantId && role.roleKey === parsed.data.roleKey
  );
  if (existing) {
    res.status(409).json({ error: "Role already exists for this tenant" });
    return;
  }

  tenantRoles.push(record);
  res.status(201).json(mapTenantRole(record));
});

rolesRouter.get("/", requirePermission("roles.read"), (req, res) => {
  const tenantId = req.userContext?.tenantId;
  if (!tenantId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const supabase = getSupabaseAdminClient();
  if (supabase) {
    void (async () => {
      const { data, error } = await supabase
        .from("tenant_roles")
        .select("role_key, display_name, role_kind, product_scope, duties")
        .eq("tenant_id", tenantId);
      if (error) {
        res.status(500).json({ error: `Failed to fetch roles: ${error.message}` });
        return;
      }
      res.json(
        (data ?? []).map((item) => ({
          roleKey: item.role_key,
          displayName: item.display_name,
          roleKind: item.role_kind ?? "extra_duties",
          productScope: item.product_scope ?? "all",
          duties: item.duties ?? []
        }))
      );
    })();
    return;
  }

  res.json(
    tenantRoles
      .filter((role) => role.tenantId === tenantId)
      .map((role) => mapTenantRole(role))
  );
});

rolesRouter.post("/assign", requirePermission("roles.assign"), (req, res) => {
  const context = req.userContext;
  if (!context) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const parsed = assignRoleSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid assignment payload", details: parsed.error.flatten() });
    return;
  }

  const assignment: UserRoleAssignment = {
    ...parsed.data,
    tenantId: context.tenantId,
    assignedBy: context.userId
  };

  const supabase = getSupabaseAdminClient();
  if (supabase) {
    void (async () => {
      const { data: role, error: roleErr } = await supabase
        .from("tenant_roles")
        .select("id, role_kind")
        .eq("tenant_id", context.tenantId)
        .eq("role_key", parsed.data.roleKey)
        .maybeSingle();
      if (roleErr) {
        res.status(500).json({ error: `Failed to validate role: ${roleErr.message}` });
        return;
      }
      if (!role) {
        res.status(404).json({ error: "Role not found in tenant" });
        return;
      }
      if (role.role_kind === "job_title") {
        res.status(400).json({ error: "Job titles are assigned as a user's primary title, not as add-on roles" });
        return;
      }

      const { data: existing, error: existingErr } = await supabase
        .from("user_role_assignments")
        .select("id")
        .eq("tenant_id", context.tenantId)
        .eq("user_id", parsed.data.userId)
        .eq("role_key", parsed.data.roleKey)
        .maybeSingle();
      if (existingErr) {
        res.status(500).json({ error: `Failed to check assignment: ${existingErr.message}` });
        return;
      }
      if (existing) {
        res.status(409).json({ error: "Role already assigned to user" });
        return;
      }

      const { error } = await supabase.from("user_role_assignments").insert({
        tenant_id: context.tenantId,
        user_id: parsed.data.userId,
        role_key: parsed.data.roleKey,
        assigned_by: context.userId
      });
      if (error) {
        res.status(500).json({ error: `Failed to assign role: ${error.message}` });
        return;
      }
      res.status(201).json(assignment);
    })();
    return;
  }

  const tenantRole = tenantRoles.find(
    (role) => role.tenantId === context.tenantId && role.roleKey === parsed.data.roleKey
  );
  if (!tenantRole) {
    res.status(404).json({ error: "Role not found in tenant" });
    return;
  }
  if (tenantRole.roleKind === "job_title") {
    res.status(400).json({ error: "Job titles are assigned as a user's primary title, not as add-on roles" });
    return;
  }

  const existing = roleAssignments.find(
    (entry) =>
      entry.tenantId === context.tenantId &&
      entry.userId === parsed.data.userId &&
      entry.roleKey === parsed.data.roleKey
  );
  if (existing) {
    res.status(409).json({ error: "Role already assigned to user" });
    return;
  }

  roleAssignments.push(assignment);
  res.status(201).json(assignment);
});

rolesRouter.delete("/assign", requirePermission("roles.assign"), (req, res) => {
  const context = req.userContext;
  if (!context) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const parsed = assignRoleSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid assignment payload", details: parsed.error.flatten() });
    return;
  }

  const supabase = getSupabaseAdminClient();
  if (supabase) {
    void (async () => {
      const { error } = await supabase
        .from("user_role_assignments")
        .delete()
        .eq("tenant_id", context.tenantId)
        .eq("user_id", parsed.data.userId)
        .eq("role_key", parsed.data.roleKey);
      if (error) {
        res.status(500).json({ error: `Failed to remove assignment: ${error.message}` });
        return;
      }
      res.status(204).send();
    })();
    return;
  }

  const index = roleAssignments.findIndex(
    (entry) =>
      entry.tenantId === context.tenantId &&
      entry.userId === parsed.data.userId &&
      entry.roleKey === parsed.data.roleKey
  );
  if (index === -1) {
    res.status(404).json({ error: "Assignment not found" });
    return;
  }
  roleAssignments.splice(index, 1);
  res.status(204).send();
});

rolesRouter.get("/assignments", requirePermission("roles.read"), (req, res) => {
  const tenantId = req.userContext?.tenantId;
  if (!tenantId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const supabase = getSupabaseAdminClient();
  if (supabase) {
    void (async () => {
      const { data, error } = await supabase
        .from("user_role_assignments")
        .select("user_id, role_key")
        .eq("tenant_id", tenantId);
      if (error) {
        res.status(500).json({ error: `Failed to fetch assignments: ${error.message}` });
        return;
      }
      res.json(
        (data ?? []).map((item) => ({
          userId: item.user_id,
          roleKey: item.role_key
        }))
      );
    })();
    return;
  }

  res.json(roleAssignments.filter((entry) => entry.tenantId === tenantId));
});

rolesRouter.get("/builtin", requirePermission("roles.read"), async (req, res) => {
  const tenantId = req.userContext?.tenantId;
  if (!tenantId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    res.json(await listBuiltinRolePermissions(tenantId));
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : "Failed to load built-in role permissions"
    });
  }
});

const saveBuiltinSchema = z.object({
  duties: z.array(permissionSchema)
});

rolesRouter.put("/builtin/:role", requirePermission("roles.create"), async (req, res) => {
  const context = req.userContext;
  if (!context) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const roleParsed = roleSchema.safeParse(req.params.role);
  if (!roleParsed.success) {
    res.status(400).json({ error: "Invalid job title" });
    return;
  }

  const parsed = saveBuiltinSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid duties payload", details: parsed.error.flatten() });
    return;
  }

  try {
    const view = await saveBuiltinRolePermissions(
      context.tenantId,
      roleParsed.data,
      parsed.data,
      context.userId
    );
    res.json(view);
  } catch (error) {
    res.status(400).json({
      error: error instanceof Error ? error.message : "Failed to save role permissions"
    });
  }
});

rolesRouter.get("/susu-nav", requirePermission("roles.read"), async (req, res) => {
  const tenantId = req.userContext?.tenantId;
  if (!tenantId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    res.json(await listSusuNavVisibilityConfig(tenantId));
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : "Failed to load Susu nav visibility"
    });
  }
});

rolesRouter.put("/susu-nav", requirePermission("roles.create"), async (req, res) => {
  const context = req.userContext;
  if (!context) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    const config = await saveSusuNavVisibility(context.tenantId, req.body, context.userId);
    res.json(config);
  } catch (error) {
    res.status(400).json({
      error: error instanceof Error ? error.message : "Failed to save Susu nav visibility"
    });
  }
});

rolesRouter.delete("/susu-nav", requirePermission("roles.create"), async (req, res) => {
  const context = req.userContext;
  if (!context) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    res.json(await resetSusuNavVisibility(context.tenantId));
  } catch (error) {
    res.status(400).json({
      error: error instanceof Error ? error.message : "Failed to reset Susu nav visibility"
    });
  }
});

rolesRouter.delete("/builtin/:role", requirePermission("roles.create"), async (req, res) => {
  const context = req.userContext;
  if (!context) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const roleParsed = roleSchema.safeParse(req.params.role);
  if (!roleParsed.success) {
    res.status(400).json({ error: "Invalid job title" });
    return;
  }

  try {
    res.json(await resetBuiltinRolePermissions(context.tenantId, roleParsed.data));
  } catch (error) {
    res.status(400).json({
      error: error instanceof Error ? error.message : "Failed to reset role permissions"
    });
  }
});

rolesRouter.get("/job-titles", requirePermission("roles.read"), async (req, res) => {
  const tenantId = req.userContext?.tenantId;
  if (!tenantId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    res.json(await listTenantJobTitles(tenantId));
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : "Failed to load tenant job titles"
    });
  }
});

rolesRouter.put("/job-title/:roleKey", requirePermission("roles.create"), async (req, res) => {
  const context = req.userContext;
  if (!context) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    const roleKey = String(req.params.roleKey);
    const view = await updateTenantJobTitle(
      context.tenantId,
      roleKey,
      req.body,
      context.subscribedModules
    );
    res.json(view);
  } catch (error) {
    res.status(400).json({
      error: error instanceof Error ? error.message : "Failed to update job title"
    });
  }
});

rolesRouter.delete("/job-title/:roleKey", requirePermission("roles.create"), async (req, res) => {
  const context = req.userContext;
  if (!context) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    await deleteTenantJobTitle(context.tenantId, String(req.params.roleKey));
    res.status(204).send();
  } catch (error) {
    res.status(400).json({
      error: error instanceof Error ? error.message : "Failed to delete job title"
    });
  }
});
