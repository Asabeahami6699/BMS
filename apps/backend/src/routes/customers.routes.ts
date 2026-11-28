import {
  assignCustomerFieldAgentSchema,
  createCustomerInputSchema,
  customerRegistrationInputSchema,
  rejectCustomerSchema,
  roleMayApprove,
  scheduleNextCardDailySusuSchema,
  updateCustomerDetailsSchema,
  upgradeCustomerKycSchema
} from "@bms/shared";

import { Router } from "express";
import { resolveRequestBranchFilter } from "../middleware/branchScope.js";

import { requireAnyPermission, requirePermission } from "../middleware/requirePermission.js";

import { validateBody } from "../middleware/validateBody.js";
import { setRequestAuditContext } from "../services/auditService.js";

import {

  approveCustomerRegistration,

  assignCustomerFieldAgent,

  createCustomer,

  deleteCustomer,

  discardRejectedRegistration,

  getCustomerById,

  listCustomers,

  rejectCustomerRegistration,

  resetCustomerAccount,

  resubmitCustomerRegistration,

  returnRejectedCustomerToAgent,

  scheduleNextCardDailySusu,

  searchActiveCustomers,

  submitCustomerRegistration,

  updateCustomerDetails,

  updateCustomerStatus,

  upgradeCustomerToFullKyc

} from "../services/customerService.js";
import { getCustomerBootstrap } from "../services/customerBootstrapService.js";
import { listDormantSusuCustomers } from "../services/susuRiskAlertsService.js";
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



customersRouter.get("/dormant", requirePermission("customers.read"), async (req, res) => {
  const context = req.userContext;
  if (!context) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const branchId = resolveRequestBranchFilter(req);
  const rawDays = Number(req.query.days ?? 7);
  const days = Number.isFinite(rawDays) && rawDays >= 1 ? Math.floor(rawDays) : 7;
  try {
    const rows = await listDormantSusuCustomers(context.tenantId, {
      days,
      branchId,
      agentId: context.role === "field_agent" ? context.userId : undefined
    });
    res.json(rows);
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : "Failed to load dormant customer alerts"
    });
  }
});

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

customersRouter.get(
  "/:customerId/approval-route-recommendation",
  requireAnyPermission("customers.create", "customers.read"),
  async (req, res) => {
    const context = req.userContext;
    if (!context) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const customerId = Array.isArray(req.params.customerId)
      ? req.params.customerId[0]
      : req.params.customerId;
    try {
      const customer = await getCustomerById(context.tenantId, customerId);
      if (!customer) {
        res.status(404).json({ error: "Customer not found" });
        return;
      }
      const { getApprovalRouteRecommendation } = await import(
        "../services/routeManagementService.js"
      );
      res.json(await getApprovalRouteRecommendation(context.tenantId, customer));
    } catch (error) {
      res.status(400).json({
        error:
          error instanceof Error ? error.message : "Failed to load approval route recommendation"
      });
    }
  }
);

customersRouter.get(
  "/:customerId/assignment-history",
  requirePermission("customers.read"),
  async (req, res) => {
    const context = req.userContext;
    if (!context) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const customerId = Array.isArray(req.params.customerId)
      ? req.params.customerId[0]
      : req.params.customerId;
    try {
      const { listCustomerAssignmentHistory } = await import(
        "../services/routeManagementService.js"
      );
      res.json(
        await listCustomerAssignmentHistory(context.tenantId, {
          customerId,
          limit: 100
        })
      );
    } catch (error) {
      res.status(500).json({
        error: error instanceof Error ? error.message : "Failed to load assignment history"
      });
    }
  }
);

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
    const { approveCustomerRegistrationInputSchema } = await import("@bms/shared");
    const hasOverrideBody =
      req.body &&
      typeof req.body === "object" &&
      ("routeId" in req.body || "assignedFieldAgentId" in req.body || "reason" in req.body);
    const approveOptions = hasOverrideBody
      ? approveCustomerRegistrationInputSchema.parse(req.body)
      : undefined;

    const approved = await approveCustomerRegistration(
      context.tenantId,
      customerId,
      context.userId,
      approveOptions
    );
    if (approved.accountNumber) {
      const [{ notifyCustomerAccountOpened }, { consumeCreditedInitialDepositForNotification }] =
        await Promise.all([
          import("../services/customerNotificationService.js"),
          import("../services/savingsInitialDepositService.js")
        ]);
      const initialDeposit = consumeCreditedInitialDepositForNotification(
        context.tenantId,
        approved.id
      );
      void notifyCustomerAccountOpened({
        tenantId: context.tenantId,
        customerId: approved.id,
        initialDeposit
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
  "/:customerId/return-to-agent",
  requireAnyPermission("customers.create", "customers.read"),
  async (req, res) => {
    const context = req.userContext;
    if (!context) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const workflow = await getApprovalWorkflow(context.tenantId);
    const allowed =
      context.role === "admin" ||
      context.role === "super_admin" ||
      context.role === "coordinator" ||
      roleMayApprove(workflow, "registration", context.role);
    if (!allowed) {
      res
        .status(403)
        .json({ error: "Your role is not allowed to send registrations back to field agents." });
      return;
    }

    const customerId = Array.isArray(req.params.customerId)
      ? req.params.customerId[0]
      : req.params.customerId;
    const parsed = rejectCustomerSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid return-to-agent payload" });
      return;
    }

    try {
      const before = await getCustomerById(context.tenantId, customerId).catch(() => null);
      const updated = await returnRejectedCustomerToAgent(
        context.tenantId,
        customerId,
        parsed.data
      );
      setRequestAuditContext(req, {
        entityType: "customer",
        entityId: customerId,
        action: "Sent rejected registration back to mobilizer for correction",
        before: before
          ? {
              status: before.status,
              rejectionReason: before.rejectionReason ?? null,
              assignedFieldAgentId: before.assignedFieldAgentId ?? null
            }
          : null,
        after: {
          status: updated.status,
          rejectionReason: updated.rejectionReason ?? null,
          assignedFieldAgentId: updated.assignedFieldAgentId ?? null
        }
      });
      res.json(updated);
    } catch (error) {
      res.status(400).json({
        error:
          error instanceof Error ? error.message : "Failed to send registration back to mobilizer"
      });
    }
  }
);

customersRouter.put(
  "/:customerId/resubmit",
  requireAnyPermission("customers.create", "customers.read"),
  validateBody(customerRegistrationInputSchema),
  async (req, res) => {
    const context = req.userContext;
    if (!context) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const customerId = Array.isArray(req.params.customerId)
      ? req.params.customerId[0]
      : req.params.customerId;

    try {
      const before = await getCustomerById(context.tenantId, customerId).catch(() => null);
      const updated = await resubmitCustomerRegistration(
        context.tenantId,
        context.userId,
        context.role,
        customerId,
        req.body
      );
      setRequestAuditContext(req, {
        entityType: "customer",
        entityId: customerId,
        action: "Corrected and resubmitted rejected registration",
        before: before
          ? {
              status: before.status,
              fullName: before.fullName,
              phone: before.phone,
              rejectionReason: before.rejectionReason ?? null
            }
          : null,
        after: {
          status: updated.status,
          fullName: updated.fullName,
          phone: updated.phone,
          rejectionReason: null
        }
      });
      res.json(updated);
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Failed to resubmit registration";
      const statusCode = /not allowed|only resubmit registrations assigned/i.test(msg) ? 403 : 400;
      res.status(statusCode).json({ error: msg });
    }
  }
);

customersRouter.delete(
  "/:customerId/rejected",
  requireAnyPermission("customers.create", "customers.read"),
  async (req, res) => {
    const context = req.userContext;
    if (!context) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const customerId = Array.isArray(req.params.customerId)
      ? req.params.customerId[0]
      : req.params.customerId;

    try {
      const discarded = await discardRejectedRegistration(
        context.tenantId,
        context.userId,
        context.role,
        customerId
      );
      setRequestAuditContext(req, {
        entityType: "customer",
        entityId: customerId,
        action: "Discarded rejected registration",
        before: {
          status: discarded.status,
          fullName: discarded.fullName,
          phone: discarded.phone,
          rejectionReason: discarded.rejectionReason ?? null
        },
        after: null
      });
      res.json({ ok: true, deletedId: customerId });
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Failed to delete rejected registration";
      const statusCode = /not allowed|only delete rejected registrations assigned/i.test(msg)
        ? 403
        : 400;
      res.status(statusCode).json({ error: msg });
    }
  }
);

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
      const before = await getCustomerById(context.tenantId, customerId);
      const updated = await assignCustomerFieldAgent(
        context.tenantId,
        customerId,
        req.body,
        context.userId
      );
      setRequestAuditContext(req, {
        entityType: "customer_assignment",
        entityId: customerId,
        before: before
          ? {
              routeId: before.routeId ?? null,
              assignedFieldAgentId: before.assignedFieldAgentId ?? null
            }
          : null,
        after: {
          routeId: updated.routeId ?? null,
          assignedFieldAgentId: updated.assignedFieldAgentId ?? null
        },
        metadata: {
          reason: typeof req.body?.reason === "string" ? req.body.reason : null
        }
      });
      res.json(updated);
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

const CUSTOMER_EDIT_ROLES = new Set([
  "admin",
  "super_admin",
  "coordinator",
  "customer_service"
]);

/** Update editable customer details after creation (logged in immutable audit trail). */
customersRouter.patch(
  "/:customerId",
  requireAnyPermission("customers.create", "customers.read"),
  validateBody(updateCustomerDetailsSchema),
  async (req, res) => {
    const context = req.userContext;
    if (!context) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    if (!CUSTOMER_EDIT_ROLES.has(context.role)) {
      res.status(403).json({
        error: "Only admins, coordinators, or customer service staff can update customer details"
      });
      return;
    }
    const customerId = Array.isArray(req.params.customerId)
      ? req.params.customerId[0]
      : req.params.customerId;
    try {
      const before = await getCustomerById(context.tenantId, customerId);
      if (!before) {
        res.status(404).json({ error: "Customer not found" });
        return;
      }
      if (
        context.scopeType === "branch" &&
        context.branchId &&
        before.homeBranchId !== context.branchId
      ) {
        res.status(403).json({ error: "Not allowed to edit customers outside your branch" });
        return;
      }
      if (
        context.scopeType === "branch" &&
        context.branchId &&
        typeof req.body?.homeBranchId === "string" &&
        req.body.homeBranchId !== context.branchId
      ) {
        res.status(403).json({ error: "Branch-scoped staff cannot move a customer to another branch" });
        return;
      }

      const updated = await updateCustomerDetails(context.tenantId, customerId, req.body);
      setRequestAuditContext(req, {
        entityType: "customer",
        entityId: customerId,
        action: `Updated customer details (${updated.fullName})`,
        before: {
          fullName: before.fullName,
          phone: before.phone,
          email: before.email ?? null,
          location: before.location ?? null,
          houseNumber: before.houseNumber ?? null,
          dateOfBirth: before.dateOfBirth ?? null,
          occupation: before.occupation ?? null,
          nationality: before.nationality ?? null,
          idCardType: before.idCardType ?? null,
          idCardNumber: before.idCardNumber ?? null,
          homeBranchId: before.homeBranchId,
          assignedFieldAgentId: before.assignedFieldAgentId ?? null,
          nextOfKin: before.nextOfKin ?? null
        },
        after: {
          fullName: updated.fullName,
          phone: updated.phone,
          email: updated.email ?? null,
          location: updated.location ?? null,
          houseNumber: updated.houseNumber ?? null,
          dateOfBirth: updated.dateOfBirth ?? null,
          occupation: updated.occupation ?? null,
          nationality: updated.nationality ?? null,
          idCardType: updated.idCardType ?? null,
          idCardNumber: updated.idCardNumber ?? null,
          homeBranchId: updated.homeBranchId,
          assignedFieldAgentId: updated.assignedFieldAgentId ?? null,
          nextOfKin: updated.nextOfKin ?? null
        }
      });
      res.json(updated);
    } catch (error) {
      res.status(400).json({
        error: error instanceof Error ? error.message : "Failed to update customer details"
      });
    }
  }
);

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
    const customerId = String(req.params.customerId);
    const before = await getCustomerById(context.tenantId, customerId).catch(() => null);
    const updated = await updateCustomerStatus(context.tenantId, customerId, req.body);
    setRequestAuditContext(req, {
      entityType: "customer",
      entityId: customerId,
      action: "Updated customer account status",
      before: before ? { status: before.status, fullName: before.fullName } : null,
      after: { status: updated.status, fullName: updated.fullName },
      metadata: { reason: req.body?.reason ?? null }
    });
    res.json(updated);
  } catch (error) {
    res.status(400).json({
      error: error instanceof Error ? error.message : "Failed to update customer status"
    });
  }
});

const OFFICE_DAILY_SUSU_ROLES = new Set([
  "admin",
  "super_admin",
  "coordinator",
  "teller",
  "customer_service"
]);

customersRouter.patch(
  "/:customerId/daily-susu",
  requireAnyPermission("customers.create", "customers.read"),
  validateBody(scheduleNextCardDailySusuSchema),
  async (req, res) => {
    const context = req.userContext;
    if (!context) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    if (!OFFICE_DAILY_SUSU_ROLES.has(context.role)) {
      res.status(403).json({
        error: "Only office staff can update a customer's daily Susu amount for the next card"
      });
      return;
    }
    const customerId = Array.isArray(req.params.customerId)
      ? req.params.customerId[0]
      : req.params.customerId;
    try {
      const before = await getCustomerById(context.tenantId, customerId).catch(() => null);
      const updated = await scheduleNextCardDailySusu(
        context.tenantId,
        customerId,
        context.userId,
        req.body
      );
      setRequestAuditContext(req, {
        entityType: "customer",
        entityId: customerId,
        action: "Scheduled next-card daily Susu amount",
        before: before
          ? {
              dailyContributionAmount: before.dailyContributionAmount,
              pendingDailyContributionAmount: before.pendingDailyContributionAmount ?? null
            }
          : null,
        after: {
          dailyContributionAmount: updated.customer.dailyContributionAmount,
          pendingDailyContributionAmount: updated.customer.pendingDailyContributionAmount ?? null,
          appliedImmediately: updated.appliedImmediately,
          effectiveCardNumber: updated.effectiveCardNumber
        }
      });
      res.json(updated);
    } catch (error) {
      res.status(400).json({
        error: error instanceof Error ? error.message : "Failed to update daily Susu amount"
      });
    }
  }
);

const KYC_UPGRADE_ROLES = new Set([
  "admin",
  "super_admin",
  "coordinator",
  "branch_manager",
  "manager"
]);

customersRouter.post(
  "/:customerId/upgrade-kyc",
  requireAnyPermission("customers.create", "customers.read"),
  validateBody(upgradeCustomerKycSchema),
  async (req, res) => {
    const context = req.userContext;
    if (!context) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    if (!KYC_UPGRADE_ROLES.has(context.role)) {
      res.status(403).json({ error: "Only admins, managers, or coordinators can upgrade customer KYC" });
      return;
    }
    const customerId = Array.isArray(req.params.customerId)
      ? req.params.customerId[0]
      : req.params.customerId;
    try {
      const updated = await upgradeCustomerToFullKyc(context.tenantId, customerId, req.body);
      res.json(updated);
    } catch (error) {
      res.status(400).json({
        error: error instanceof Error ? error.message : "Failed to upgrade customer KYC"
      });
    }
  }
);

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

