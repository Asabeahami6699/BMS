import {
  assignCustomerFieldAgentSchema,
  createCustomerInputSchema,
  customerRegistrationInputSchema,
  rejectCustomerSchema,
  roleMayApprove
} from "@bms/shared";

import { Router } from "express";
import { resolveRequestBranchFilter } from "../middleware/branchScope.js";

import { requireAnyPermission, requirePermission } from "../middleware/requirePermission.js";

import { validateBody } from "../middleware/validateBody.js";

import {

  approveCustomerRegistration,

  assignCustomerFieldAgent,

  createCustomer,

  deleteCustomer,

  getCustomerById,

  listCustomers,

  rejectCustomerRegistration,

  resetCustomerAccount,

  searchActiveCustomers,

  submitCustomerRegistration,

  updateCustomerStatus

} from "../services/customerService.js";
import { getCustomerBootstrap } from "../services/customerBootstrapService.js";
import { getApprovalWorkflow } from "../services/approvalWorkflowService.js";

import {
  approveBalanceDisclosure,
  listPendingBalanceDisclosures,
  rejectBalanceDisclosure
} from "../services/balanceDisclosureService.js";
import { listAgentNotifications, markNotificationRead } from "../services/notificationService.js";



export const customersRouter = Router();



customersRouter.post(

  "/",

  requirePermission("customers.create"),

  validateBody(createCustomerInputSchema),

  async (req, res) => {

    const context = req.userContext;

    if (!context) {

      res.status(401).json({ error: "Unauthorized" });

      return;

    }



    try {

      const customer = await createCustomer(context.tenantId, context.userId, req.body);

      res.status(201).json(customer);

    } catch (error) {

      res.status(400).json({

        error: error instanceof Error ? error.message : "Invalid customer payload"

      });

    }

  }

);



customersRouter.post(

  "/registrations",

  requirePermission("customers.create"),

  validateBody(customerRegistrationInputSchema),

  async (req, res) => {

    const context = req.userContext;

    if (!context) {

      res.status(401).json({ error: "Unauthorized" });

      return;

    }



    try {

      const customer = await submitCustomerRegistration(

        context.tenantId,

        context.userId,

        context.branchId,

        req.body

      );

      res.status(201).json(customer);

    } catch (error) {

      res.status(400).json({

        error: error instanceof Error ? error.message : "Invalid registration payload"

      });

    }

  }

);



customersRouter.get("/bootstrap", requirePermission("customers.read"), async (req, res) => {
  const context = req.userContext;
  if (!context) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    const agentOnly = context.role === "field_agent";
    const branchId = resolveRequestBranchFilter(req);
    const data = await getCustomerBootstrap(context.tenantId, {
      agentId: agentOnly ? context.userId : undefined,
      branchId
    });
    res.json(data);
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : "Failed to load customers bootstrap"
    });
  }
});

customersRouter.get("/", requirePermission("customers.read"), async (req, res) => {

  const context = req.userContext;

  if (!context) {

    res.status(401).json({ error: "Unauthorized" });

    return;

  }



  try {

    const agentOnly = context.role === "field_agent";

    const status = typeof req.query.status === "string" ? req.query.status : undefined;
    const branchId = resolveRequestBranchFilter(req);

    const light =
      agentOnly ||
      req.query.light === "true" ||
      req.query.light === "1";

    res.json(

      await listCustomers(context.tenantId, {

        agentId: agentOnly ? context.userId : undefined,

        status,
        branchId,
        light

      })

    );

  } catch (error) {

    res.status(500).json({ error: error instanceof Error ? error.message : "Failed to fetch customers" });

  }

});



customersRouter.get("/search", requirePermission("customers.read"), async (req, res) => {

  const context = req.userContext;

  if (!context) {

    res.status(401).json({ error: "Unauthorized" });

    return;

  }



  const q = typeof req.query.q === "string" ? req.query.q : "";

  try {

    const agentId = context.role === "field_agent" ? context.userId : undefined;

    res.json(await searchActiveCustomers(context.tenantId, q, agentId));

  } catch (error) {

    res.status(500).json({ error: error instanceof Error ? error.message : "Search failed" });

  }

});

customersRouter.patch("/:customerId/approve", requireAnyPermission("customers.create", "customers.read"), async (req, res) => {

  const context = req.userContext;

  if (!context) {

    res.status(401).json({ error: "Unauthorized" });

    return;

  }

  const workflow = await getApprovalWorkflow(context.tenantId);
  if (!roleMayApprove(workflow, "registration", context.role)) {
    res.status(403).json({ error: "Your role is not allowed to approve account registrations." });
    return;
  }



  const customerId = Array.isArray(req.params.customerId) ? req.params.customerId[0] : req.params.customerId;

  try {

    const approved = await approveCustomerRegistration(context.tenantId, customerId, context.userId);
    if (approved.accountNumber) {
      const { notifyCustomerAccountOpened } = await import("../services/customerNotificationService.js");
      void notifyCustomerAccountOpened({
        tenantId: context.tenantId,
        customerId: approved.id
      });
    }
    res.json(approved);

  } catch (error) {

    res.status(400).json({ error: error instanceof Error ? error.message : "Failed to approve" });

  }

});



customersRouter.patch("/:customerId/reject", requireAnyPermission("customers.create", "customers.read"), async (req, res) => {

  const context = req.userContext;

  if (!context) {

    res.status(401).json({ error: "Unauthorized" });

    return;

  }

  const workflow = await getApprovalWorkflow(context.tenantId);
  if (!roleMayApprove(workflow, "registration", context.role)) {
    res.status(403).json({ error: "Your role is not allowed to reject account registrations." });
    return;
  }



  const customerId = Array.isArray(req.params.customerId) ? req.params.customerId[0] : req.params.customerId;

  const parsed = rejectCustomerSchema.safeParse(req.body);

  if (!parsed.success) {

    res.status(400).json({ error: "Invalid reject payload" });

    return;

  }



  try {

    res.json(await rejectCustomerRegistration(context.tenantId, customerId, parsed.data));

  } catch (error) {

    res.status(400).json({ error: error instanceof Error ? error.message : "Failed to reject" });

  }

});

customersRouter.patch(
  "/:customerId/assignment",
  requirePermission("customers.create"),
  validateBody(assignCustomerFieldAgentSchema),
  async (req, res) => {
    const context = req.userContext;
    if (!context) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    if (context.role !== "admin" && context.role !== "coordinator") {
      res.status(403).json({ error: "Only admin or coordinator can change customer assignment" });
      return;
    }

    const customerId = Array.isArray(req.params.customerId)
      ? req.params.customerId[0]
      : req.params.customerId;

    try {
      res.json(await assignCustomerFieldAgent(context.tenantId, customerId, req.body));
    } catch (error) {
      res.status(400).json({
        error: error instanceof Error ? error.message : "Failed to update assignment"
      });
    }
  }
);

customersRouter.get("/balance-disclosures/pending", requirePermission("customers.read"), async (req, res) => {
  const context = req.userContext;
  if (!context) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const workflow = await getApprovalWorkflow(context.tenantId);
  const canReviewQueue =
    context.role === "admin" ||
    context.role === "coordinator" ||
    roleMayApprove(workflow, "registration", context.role) ||
    roleMayApprove(workflow, "withdrawal", context.role);
  if (!canReviewQueue) {
    res.status(403).json({ error: "Your role is not allowed to review these requests." });
    return;
  }

  try {
    res.json(await listPendingBalanceDisclosures(context.tenantId));
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : "Failed to load balance requests"
    });
  }
});

customersRouter.patch(
  "/balance-disclosures/:disclosureId/approve",
  requirePermission("customers.read"),
  async (req, res) => {
    const context = req.userContext;
    if (!context) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const disclosureId = Array.isArray(req.params.disclosureId)
      ? req.params.disclosureId[0]
      : req.params.disclosureId;

    try {
      res.json(
        await approveBalanceDisclosure(
          {
            userId: context.userId,
            tenantId: context.tenantId,
            role: context.role,
            scopeType: context.scopeType,
            branchId: context.branchId,
            permissions: context.permissions
          },
          disclosureId,
          req.body
        )
      );
    } catch (error) {
      res.status(400).json({
        error: error instanceof Error ? error.message : "Failed to approve balance request"
      });
    }
  }
);

customersRouter.patch(
  "/balance-disclosures/:disclosureId/reject",
  requirePermission("customers.create"),
  async (req, res) => {
    const context = req.userContext;
    if (!context) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const disclosureId = Array.isArray(req.params.disclosureId)
      ? req.params.disclosureId[0]
      : req.params.disclosureId;

    try {
      res.json(
        await rejectBalanceDisclosure(context.tenantId, context.userId, disclosureId, req.body, context.role)
      );
    } catch (error) {
      res.status(400).json({
        error: error instanceof Error ? error.message : "Failed to reject balance request"
      });
    }
  }
);

customersRouter.get(
  "/notifications/me",
  requireAnyPermission("workspace.notifications", "customers.read"),
  async (req, res) => {

  const context = req.userContext;

  if (!context) {

    res.status(401).json({ error: "Unauthorized" });

    return;

  }



  try {

    res.json(await listAgentNotifications(context.tenantId, context.userId));

  } catch (error) {

    res.status(500).json({ error: error instanceof Error ? error.message : "Failed to load notifications" });

  }

});



customersRouter.patch(
  "/notifications/:notificationId/read",
  requireAnyPermission("workspace.notifications", "customers.read"),
  async (req, res) => {

  const context = req.userContext;

  if (!context) {

    res.status(401).json({ error: "Unauthorized" });

    return;

  }



  const notificationId = Array.isArray(req.params.notificationId)

    ? req.params.notificationId[0]

    : req.params.notificationId;



  try {

    await markNotificationRead(context.tenantId, context.userId, notificationId);

    res.json({ ok: true });

  } catch (error) {

    res.status(400).json({ error: error instanceof Error ? error.message : "Failed to update notification" });

  }

});

/** Full customer record including KYC photos (list endpoints use light payloads). */
customersRouter.get("/:customerId", requirePermission("customers.read"), async (req, res) => {
  const context = req.userContext;
  if (!context) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  try {
    const customerId = String(req.params.customerId);
    const customer = await getCustomerById(context.tenantId, customerId);
    if (!customer) {
      res.status(404).json({ error: "Customer not found" });
      return;
    }
    if (
      context.role === "field_agent" &&
      customer.createdByFieldAgentId !== context.userId &&
      customer.assignedFieldAgentId !== context.userId
    ) {
      res.status(403).json({ error: "Not allowed to view this customer" });
      return;
    }
    res.json(customer);
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : "Failed to fetch customer"
    });
  }
});

customersRouter.patch("/:customerId/status", async (req, res) => {
  const context = req.userContext;
  if (!context) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const canManage =
    context.role === "admin" ||
    context.role === "super_admin" ||
    context.permissions.includes("customers.create");
  if (!canManage || (context.role !== "admin" && context.role !== "super_admin")) {
    res.status(403).json({ error: "Only tenant administrators can change account status" });
    return;
  }
  try {
    res.json(await updateCustomerStatus(context.tenantId, String(req.params.customerId), req.body));
  } catch (error) {
    res.status(400).json({
      error: error instanceof Error ? error.message : "Failed to update customer status"
    });
  }
});

customersRouter.post("/:customerId/reset-account", async (req, res) => {
  const context = req.userContext;
  if (!context) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  if (context.role !== "super_admin") {
    res.status(403).json({ error: "Only the platform super user can reset customer accounts" });
    return;
  }
  try {
    res.json(await resetCustomerAccount(context.tenantId, String(req.params.customerId)));
  } catch (error) {
    res.status(400).json({
      error: error instanceof Error ? error.message : "Failed to reset customer account"
    });
  }
});

customersRouter.delete("/:customerId", async (req, res) => {
  const context = req.userContext;
  if (!context) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  if (context.role !== "super_admin") {
    res.status(403).json({ error: "Only the platform super user can delete customers" });
    return;
  }
  try {
    await deleteCustomer(context.tenantId, String(req.params.customerId));
    res.json({ ok: true });
  } catch (error) {
    res.status(400).json({
      error: error instanceof Error ? error.message : "Failed to delete customer"
    });
  }
});

