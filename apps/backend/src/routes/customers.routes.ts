import {
  assignCustomerFieldAgentSchema,
  createCustomerInputSchema,
  customerRegistrationInputSchema,
  rejectCustomerSchema
} from "@bms/shared";

import { Router } from "express";
import { resolveRequestBranchFilter } from "../middleware/branchScope.js";

import { requireAnyPermission, requirePermission } from "../middleware/requirePermission.js";

import { validateBody } from "../middleware/validateBody.js";

import {

  approveCustomerRegistration,

  assignCustomerFieldAgent,

  createCustomer,

  listCustomers,

  rejectCustomerRegistration,

  searchActiveCustomers,

  submitCustomerRegistration

} from "../services/customerService.js";
import { getCustomerBootstrap } from "../services/customerBootstrapService.js";

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

    res.json(

      await listCustomers(context.tenantId, {

        agentId: agentOnly ? context.userId : undefined,

        status,
        branchId

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



customersRouter.patch("/:customerId/approve", requirePermission("customers.create"), async (req, res) => {

  const context = req.userContext;

  if (!context) {

    res.status(401).json({ error: "Unauthorized" });

    return;

  }

  if (context.role !== "admin" && context.role !== "coordinator") {

    res.status(403).json({ error: "Only admin or coordinator can approve registrations" });

    return;

  }



  const customerId = Array.isArray(req.params.customerId) ? req.params.customerId[0] : req.params.customerId;

  try {

    res.json(
      await approveCustomerRegistration(context.tenantId, customerId, context.userId)
    );

  } catch (error) {

    res.status(400).json({ error: error instanceof Error ? error.message : "Failed to approve" });

  }

});



customersRouter.patch("/:customerId/reject", requirePermission("customers.create"), async (req, res) => {

  const context = req.userContext;

  if (!context) {

    res.status(401).json({ error: "Unauthorized" });

    return;

  }

  if (context.role !== "admin" && context.role !== "coordinator") {

    res.status(403).json({ error: "Only admin or coordinator can reject registrations" });

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
  if (context.role !== "admin" && context.role !== "coordinator") {
    res.status(403).json({ error: "Only admin or coordinator can review balance requests" });
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
    if (context.role !== "admin" && context.role !== "coordinator") {
      res.status(403).json({ error: "Only admin or coordinator can reject balance requests" });
      return;
    }

    const disclosureId = Array.isArray(req.params.disclosureId)
      ? req.params.disclosureId[0]
      : req.params.disclosureId;

    try {
      res.json(
        await rejectBalanceDisclosure(context.tenantId, context.userId, disclosureId, req.body)
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


