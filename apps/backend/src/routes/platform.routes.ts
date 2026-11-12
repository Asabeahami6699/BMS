import { createTenantSchema, tenantSubdomainSchema } from "@bms/shared";
import { Router } from "express";
import { z } from "zod";
import {
  createPlatformTenant,
  createTenantCompanyAdmin,
  listPlatformTenants,
  terminateTenantCompany,
  updateTenantProductModules,
  updateTenantAddons,
  updateTenantSubscription,
  updateTenantSubdomain
} from "../services/authService.js";
import {
  deleteCustomer,
  listCustomers,
  resetCustomerAccount
} from "../services/customerService.js";
import {
  approveSubscriptionPaymentClaim,
  assignTenantSubscriptionPlan,
  getPlatformBillingSettings,
  getTenantSubscriptionSnapshot,
  listPendingPaymentClaims,
  listSubscriptionPlans,
  rejectSubscriptionPaymentClaim,
  updatePlatformBillingSettings
} from "../services/subscriptionBillingService.js";
import { requirePermission } from "../middleware/requirePermission.js";

const subscriptionUpdateSchema = z.object({
  subscriptionStatus: z.enum(["active", "inactive"])
});

export const platformRouter = Router();

import type { NextFunction, Request, Response } from "express";

function requireSuperAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.userContext || req.userContext.role !== "super_admin") {
    res.status(403).json({ error: "Platform super admin access required" });
    return;
  }
  next();
}

platformRouter.use(requireSuperAdmin);

platformRouter.get("/tenants", requirePermission("platform.tenants.read"), async (_req, res) => {
  try {
    res.json(await listPlatformTenants());
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Failed to list tenants" });
  }
});

platformRouter.post("/tenants", requirePermission("platform.tenants.create"), async (req, res) => {
  try {
    const parsed = createTenantSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid tenant payload" });
      return;
    }
    const tenant = await createPlatformTenant(parsed.data);
    res.status(201).json(tenant);
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Failed to create tenant" });
  }
});

platformRouter.patch(
  "/tenants/:tenantId/modules",
  requirePermission("platform.tenants.update"),
  async (req, res) => {
    try {
      const tenant = await updateTenantProductModules(String(req.params.tenantId), req.body);
      res.json(tenant);
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : "Failed to update modules" });
    }
  }
);

platformRouter.patch(
  "/tenants/:tenantId/addons",
  requirePermission("platform.tenants.update"),
  async (req, res) => {
    try {
      const tenant = await updateTenantAddons(String(req.params.tenantId), req.body);
      res.json(tenant);
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : "Failed to update add-ons" });
    }
  }
);

platformRouter.patch(
  "/tenants/:tenantId/subdomain",
  requirePermission("platform.tenants.update"),
  async (req, res) => {
    const parsed = z.object({ subdomain: tenantSubdomainSchema }).safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid web address" });
      return;
    }
    try {
      const tenant = await updateTenantSubdomain(String(req.params.tenantId), parsed.data.subdomain);
      res.json(tenant);
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : "Failed to save web address" });
    }
  }
);

platformRouter.patch(
  "/tenants/:tenantId/subscription",
  requirePermission("platform.tenants.update"),
  async (req, res) => {
    const parsed = subscriptionUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid subscription payload" });
      return;
    }

    try {
      const tenantId = String(req.params.tenantId);
      const tenant = await updateTenantSubscription(tenantId, parsed.data.subscriptionStatus);
      res.json(tenant);
    } catch (error) {
      res.status(404).json({ error: error instanceof Error ? error.message : "Tenant not found" });
    }
  }
);

platformRouter.post("/tenants/:tenantId/admins", requirePermission("users.create"), async (req, res) => {
  try {
    const tenantId = String(req.params.tenantId);
    const admin = await createTenantCompanyAdmin(tenantId, req.body);
    res.status(201).json(admin);
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Failed to create company admin" });
  }
});

/** Permanently terminate a company and purge all related tenant data. */
platformRouter.delete(
  "/tenants/:tenantId",
  requirePermission("platform.tenants.update"),
  async (req, res) => {
    try {
      const tenantId = String(req.params.tenantId);
      const confirmName =
        typeof req.body?.confirmName === "string" ? req.body.confirmName.trim() : "";
      const tenants = await listPlatformTenants();
      const tenant = tenants.find((t) => t.id === tenantId);
      if (!tenant) {
        res.status(404).json({ error: "Company not found" });
        return;
      }
      if (!confirmName || confirmName.toLowerCase() !== tenant.name.trim().toLowerCase()) {
        res.status(400).json({
          error: `Type the exact company name "${tenant.name}" to confirm termination`
        });
        return;
      }
      const result = await terminateTenantCompany(tenantId);
      res.json(result);
    } catch (error) {
      res.status(400).json({
        error: error instanceof Error ? error.message : "Failed to terminate company"
      });
    }
  }
);

platformRouter.get("/billing/settings", requirePermission("platform.tenants.read"), async (_req, res) => {
  try {
    res.json(await getPlatformBillingSettings());
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Failed to load billing settings" });
  }
});

platformRouter.put("/billing/settings", requirePermission("platform.tenants.update"), async (req, res) => {
  try {
    res.json(await updatePlatformBillingSettings(req.body));
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Failed to save billing settings" });
  }
});

platformRouter.get("/billing/plans", requirePermission("platform.tenants.read"), async (_req, res) => {
  try {
    res.json(await listSubscriptionPlans(false));
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Failed to list plans" });
  }
});

platformRouter.get("/billing/claims", requirePermission("platform.tenants.read"), async (_req, res) => {
  try {
    res.json(await listPendingPaymentClaims());
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Failed to list claims" });
  }
});

platformRouter.post(
  "/billing/claims/:claimId/approve",
  requirePermission("platform.tenants.update"),
  async (req, res) => {
    try {
      const reviewedBy = req.userContext?.userId ?? "super_admin";
      res.json(await approveSubscriptionPaymentClaim(String(req.params.claimId), reviewedBy));
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : "Failed to approve claim" });
    }
  }
);

platformRouter.post(
  "/billing/claims/:claimId/reject",
  requirePermission("platform.tenants.update"),
  async (req, res) => {
    try {
      const reviewedBy = req.userContext?.userId ?? "super_admin";
      res.json(await rejectSubscriptionPaymentClaim(String(req.params.claimId), reviewedBy, req.body));
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : "Failed to reject claim" });
    }
  }
);

platformRouter.get(
  "/tenants/:tenantId/billing",
  requirePermission("platform.tenants.read"),
  async (req, res) => {
    try {
      res.json(await getTenantSubscriptionSnapshot(String(req.params.tenantId)));
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : "Failed to load tenant billing" });
    }
  }
);

platformRouter.post(
  "/tenants/:tenantId/billing/assign-plan",
  requirePermission("platform.tenants.update"),
  async (req, res) => {
    try {
      res.json(
        await assignTenantSubscriptionPlan(String(req.params.tenantId), req.body, {
          reviewedBy: req.userContext?.userId
        })
      );
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : "Failed to assign plan" });
    }
  }
);

/** Super-admin support: list a tenant's customers (for ledger reset / delete). */
platformRouter.get(
  "/tenants/:tenantId/customers",
  requirePermission("platform.tenants.read"),
  async (req, res) => {
    try {
      const tenantId = String(req.params.tenantId);
      const q = typeof req.query.q === "string" ? req.query.q.trim().toLowerCase() : "";
      const customers = await listCustomers(tenantId, { light: true });
      const filtered = q
        ? customers.filter((c) =>
            [c.fullName, c.phone, c.accountNumber, c.id]
              .filter(Boolean)
              .some((v) => String(v).toLowerCase().includes(q))
          )
        : customers;
      res.json({ customers: filtered });
    } catch (error) {
      res.status(500).json({
        error: error instanceof Error ? error.message : "Failed to list tenant customers"
      });
    }
  }
);

/** Clear ledger/balances; keep the customer profile. */
platformRouter.post(
  "/tenants/:tenantId/customers/:customerId/reset-account",
  requirePermission("platform.tenants.update"),
  async (req, res) => {
    try {
      const tenantId = String(req.params.tenantId);
      const customerId = String(req.params.customerId);
      res.json(await resetCustomerAccount(tenantId, customerId));
    } catch (error) {
      res.status(400).json({
        error: error instanceof Error ? error.message : "Failed to reset customer account"
      });
    }
  }
);

/** Permanently delete customer + related financial history. */
platformRouter.delete(
  "/tenants/:tenantId/customers/:customerId",
  requirePermission("platform.tenants.update"),
  async (req, res) => {
    try {
      const tenantId = String(req.params.tenantId);
      const customerId = String(req.params.customerId);
      await deleteCustomer(tenantId, customerId);
      res.json({ ok: true });
    } catch (error) {
      res.status(400).json({
        error: error instanceof Error ? error.message : "Failed to delete customer"
      });
    }
  }
);

/** Clear ledgers for every customer in the tenant (profiles kept). */
platformRouter.post(
  "/tenants/:tenantId/customers/reset-all",
  requirePermission("platform.tenants.update"),
  async (req, res) => {
    try {
      const tenantId = String(req.params.tenantId);
      const customers = await listCustomers(tenantId, { light: true });
      let reset = 0;
      const errors: string[] = [];
      for (const customer of customers) {
        try {
          await resetCustomerAccount(tenantId, customer.id);
          reset += 1;
        } catch (error) {
          errors.push(
            `${customer.fullName}: ${error instanceof Error ? error.message : "reset failed"}`
          );
        }
      }
      res.json({ ok: true, total: customers.length, reset, errors });
    } catch (error) {
      res.status(400).json({
        error: error instanceof Error ? error.message : "Failed to reset all customers"
      });
    }
  }
);

/** Permanently delete every customer in the tenant. */
platformRouter.delete(
  "/tenants/:tenantId/customers",
  requirePermission("platform.tenants.update"),
  async (req, res) => {
    try {
      const tenantId = String(req.params.tenantId);
      const customers = await listCustomers(tenantId, { light: true });
      let deleted = 0;
      const errors: string[] = [];
      for (const customer of customers) {
        try {
          await deleteCustomer(tenantId, customer.id);
          deleted += 1;
        } catch (error) {
          errors.push(
            `${customer.fullName}: ${error instanceof Error ? error.message : "delete failed"}`
          );
        }
      }
      res.json({ ok: true, total: customers.length, deleted, errors });
    } catch (error) {
      res.status(400).json({
        error: error instanceof Error ? error.message : "Failed to delete all customers"
      });
    }
  }
);
