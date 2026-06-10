import {
  createTenantUserBaseSchema,
  resetUserPasswordSchema,
  updateTenantUserSchema,
  withBranchAssignmentRefine
} from "@bms/shared";

import { Router } from "express";
import { resolveRequestBranchFilter } from "../middleware/branchScope.js";

import { z } from "zod";

import { getSupabaseAdminClient } from "../config/supabaseClient.js";

import { requirePermission } from "../middleware/requirePermission.js";

import {

  createAuthUser,

  deleteTenantUser,

  getTenantUser,

  listTenantFieldAgents,

  resetTenantUserPassword,

  updateTenantUser

} from "../services/authService.js";

import { getAgentsBootstrap } from "../services/agentsBootstrapService.js";
import { getCoordinatorsBootstrap } from "../services/coordinatorsBootstrapService.js";
import { listCoordinatorRoster } from "../services/coordinatorRosterService.js";

import { listUsersByTenant } from "../services/authStore.js";



export const usersRouter = Router();



const createUserSchema = withBranchAssignmentRefine(
  createTenantUserBaseSchema.extend({
    userId: z.string().min(1).optional()
  })
);



function toUsersCsv(

  rows: Array<{

    userId: string;

    email: string;

    fullName?: string;

    role: string;

    scopeType: string;

    branchId?: string;

    status: string;

  }>

): string {

  const headers = ["user_id", "email", "full_name", "role", "scope_type", "branch_id", "status"];

  const body = rows

    .map((row) =>

      [row.userId, row.email, row.fullName ?? "", row.role, row.scopeType, row.branchId ?? "", row.status]

        .map((value) => `"${String(value).replace(/"/g, '""')}"`)

        .join(",")

    )

    .join("\n");

  return `${headers.join(",")}\n${body}`;

}



function mapListUser(user: {

  userId: string;

  email: string;

  fullName?: string;

  role: string;

  scopeType: string;

  branchId?: string;

  tellerType?: 1 | 2 | 3 | 4;

  tenantId: string;

  status: "active" | "inactive";

  createdBy: string;

  createdAt?: string;

}) {

  return user;

}



usersRouter.post("/", requirePermission("users.create"), async (req, res) => {

  const context = req.userContext;

  if (!context) {

    res.status(401).json({ error: "Unauthorized" });

    return;

  }



  if (context.role === "super_admin") {

    res.status(403).json({ error: "Create company users from the tenant admin dashboard" });

    return;

  }



  const parsed = createUserSchema.safeParse(req.body);

  if (!parsed.success) {

    res.status(400).json({ error: "Invalid user payload", details: parsed.error.flatten() });

    return;

  }



  if (parsed.data.role === "super_admin") {

    res.status(400).json({ error: "Cannot assign super_admin to tenant users" });

    return;

  }



  try {

    const created = await createAuthUser({

      userId: parsed.data.userId,

      email: parsed.data.email,

      password: parsed.data.password,

      role: parsed.data.role,

      scopeType: parsed.data.scopeType,

      branchId: parsed.data.branchId,

      tellerType: parsed.data.tellerType ?? null,

      fullName: parsed.data.fullName,

      tenantId: context.tenantId,

      createdBy: context.userId

    });



    const record = await getTenantUser(context.tenantId, created.userId);

    res.status(201).json(

      record ?? {

        userId: created.userId,

        email: created.email ?? parsed.data.email,

        fullName: created.fullName,

        role: created.role,

        scopeType: created.scopeType,

        branchId: created.branchId,

        tenantId: created.tenantId,

        status: "active" as const,

        createdBy: context.userId

      }

    );

  } catch (error) {

    res.status(400).json({ error: error instanceof Error ? error.message : "Failed to create user" });

  }

});



usersRouter.get("/", requirePermission("users.read"), async (req, res) => {

  const tenantId = req.userContext?.tenantId;

  if (!tenantId || tenantId === "platform") {

    res.status(401).json({ error: "Unauthorized" });

    return;

  }



  const supabase = getSupabaseAdminClient();

  if (supabase) {

    const { data, error } = await supabase

      .from("users")

      .select("id, email, role, scope_type, branch_id, teller_type, tenant_id, created_by, full_name, status, created_at")

      .eq("tenant_id", tenantId)

      .order("created_at", { ascending: false });

    if (error) {

      res.status(500).json({ error: `Failed to fetch users: ${error.message}` });

      return;

    }



    res.json(

      (data ?? []).map((user) =>

        mapListUser({

          userId: user.id,

          email: user.email ?? "",

          fullName: user.full_name ?? undefined,

          role: user.role,

          scopeType: user.scope_type,

          branchId: user.branch_id ?? undefined,

          tellerType:
            user.teller_type != null ? (Number(user.teller_type) as 1 | 2 | 3 | 4) : undefined,

          tenantId: user.tenant_id,

          createdBy: user.created_by ?? "system",

          status: user.status === "inactive" ? "inactive" : "active",

          createdAt: user.created_at ?? undefined

        })

      )

    );

    return;

  }



  res.json(

    listUsersByTenant(tenantId).map((user) =>

      mapListUser({

        userId: user.id,

        email: user.email,

        fullName: user.fullName,

        role: user.role,

        scopeType: user.scopeType,

        branchId: user.branchId,

        tellerType: user.tellerType,

        tenantId,

        createdBy: user.createdBy ?? "system",

        status: user.status ?? "active",

        createdAt: user.createdAt

      })

    )

  );

});



usersRouter.get("/field-agents", requirePermission("customers.read"), async (req, res) => {

  const tenantId = req.userContext?.tenantId;

  if (!tenantId || tenantId === "platform") {

    res.status(401).json({ error: "Unauthorized" });

    return;

  }



  try {

    res.json(await listTenantFieldAgents(tenantId));

  } catch (error) {

    res.status(500).json({ error: error instanceof Error ? error.message : "Failed to list field agents" });

  }

});

usersRouter.get("/agents-bootstrap", requirePermission("users.read"), async (req, res) => {
  const context = req.userContext;
  if (!context?.tenantId || context.tenantId === "platform") {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const branchFilter = resolveRequestBranchFilter(req);
  try {
    const data = await getAgentsBootstrap(
      context.tenantId,
      {
        role: context.role,
        scopeType: context.scopeType as "head_office" | "branch",
        branchId: context.branchId
      },
      branchFilter
    );
    res.json(data);
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : "Failed to load agents bootstrap"
    });
  }
});

usersRouter.get("/coordinators/bootstrap", requirePermission("users.read"), async (req, res) => {
  const tenantId = req.userContext?.tenantId;
  if (!tenantId || tenantId === "platform") {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    res.json(await getCoordinatorsBootstrap(tenantId));
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : "Failed to load coordinators bootstrap"
    });
  }
});

usersRouter.get("/coordinators/roster", requirePermission("users.read"), async (req, res) => {
  const tenantId = req.userContext?.tenantId;
  if (!tenantId || tenantId === "platform") {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    res.json(await listCoordinatorRoster(tenantId));
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : "Failed to load coordinator roster"
    });
  }
});

usersRouter.patch("/:userId", requirePermission("users.update"), async (req, res) => {

  const context = req.userContext;

  if (!context?.tenantId || context.tenantId === "platform") {

    res.status(401).json({ error: "Unauthorized" });

    return;

  }



  const userId = Array.isArray(req.params.userId) ? req.params.userId[0] : req.params.userId;

  const parsed = updateTenantUserSchema.safeParse(req.body);

  if (!parsed.success) {

    res.status(400).json({ error: "Invalid user update payload", details: parsed.error.flatten() });

    return;

  }



  try {

    const updated = await updateTenantUser(context.tenantId, userId, parsed.data, context.userId);

    res.json(updated);

  } catch (error) {

    res.status(400).json({ error: error instanceof Error ? error.message : "Failed to update user" });

  }

});



usersRouter.post("/:userId/reset-password", requirePermission("users.update"), async (req, res) => {

  const context = req.userContext;

  if (!context?.tenantId || context.tenantId === "platform") {

    res.status(401).json({ error: "Unauthorized" });

    return;

  }



  const userId = Array.isArray(req.params.userId) ? req.params.userId[0] : req.params.userId;

  const parsed = resetUserPasswordSchema.safeParse(req.body);

  if (!parsed.success) {

    res.status(400).json({ error: "Invalid password payload", details: parsed.error.flatten() });

    return;

  }



  try {

    await resetTenantUserPassword(context.tenantId, userId, parsed.data);

    res.json({ ok: true });

  } catch (error) {

    res.status(400).json({ error: error instanceof Error ? error.message : "Failed to reset password" });

  }

});



usersRouter.delete("/:userId", requirePermission("users.delete"), async (req, res) => {

  const context = req.userContext;

  if (!context?.tenantId || context.tenantId === "platform") {

    res.status(401).json({ error: "Unauthorized" });

    return;

  }



  const userId = Array.isArray(req.params.userId) ? req.params.userId[0] : req.params.userId;



  try {

    await deleteTenantUser(context.tenantId, userId, context.userId);

    res.status(204).send();

  } catch (error) {

    res.status(400).json({ error: error instanceof Error ? error.message : "Failed to delete user" });

  }

});



usersRouter.get("/export.csv", requirePermission("users.read"), async (req, res) => {

  const tenantId = req.userContext?.tenantId;

  if (!tenantId || tenantId === "platform") {

    res.status(401).json({ error: "Unauthorized" });

    return;

  }



  const supabase = getSupabaseAdminClient();

  if (supabase) {

    const { data, error } = await supabase

      .from("users")

      .select("id, email, role, scope_type, branch_id, full_name, status")

      .eq("tenant_id", tenantId);

    if (error) {

      res.status(500).json({ error: `Failed to export users: ${error.message}` });

      return;

    }



    const csv = toUsersCsv(

      (data ?? []).map((user) => ({

        userId: user.id,

        email: user.email ?? "",

        fullName: user.full_name ?? undefined,

        role: user.role,

        scopeType: user.scope_type,

        branchId: user.branch_id ?? undefined,

        status: user.status === "inactive" ? "inactive" : "active"

      }))

    );

    res.setHeader("Content-Type", "text/csv; charset=utf-8");

    res.setHeader("Content-Disposition", "attachment; filename=users.csv");

    res.status(200).send(csv);

    return;

  }



  const csv = toUsersCsv(

    listUsersByTenant(tenantId).map((user) => ({

      userId: user.id,

      email: user.email,

      fullName: user.fullName,

      role: user.role,

      scopeType: user.scopeType,

      branchId: user.branchId,

      status: user.status ?? "active"

    }))

  );

  res.setHeader("Content-Type", "text/csv; charset=utf-8");

  res.setHeader("Content-Disposition", "attachment; filename=users.csv");

  res.status(200).send(csv);

});

