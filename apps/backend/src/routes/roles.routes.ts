import { permissionSchema, roleSchema } from "@bms/shared";
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
  listSusuNavVisibilityConfig,
  resetSusuNavVisibility,
  saveSusuNavVisibility
} from "../services/susuNavVisibilityService.js";

const createRoleSchema = z.object({
  roleKey: z.string().min(1),
  displayName: z.string().min(1),
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
        duties: parsed.data.duties,
        created_by: context.userId
      });
      if (error) {
        res.status(500).json({ error: `Failed to create role: ${error.message}` });
        return;
      }
      res.status(201).json(record);
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
  res.status(201).json(record);
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
        .select("role_key, display_name, duties")
        .eq("tenant_id", tenantId);
      if (error) {
        res.status(500).json({ error: `Failed to fetch roles: ${error.message}` });
        return;
      }
      res.json(
        (data ?? []).map((item) => ({
          roleKey: item.role_key,
          displayName: item.display_name,
          duties: item.duties ?? []
        }))
      );
    })();
    return;
  }

  res.json(tenantRoles.filter((role) => role.tenantId === tenantId));
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
        .select("id")
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
