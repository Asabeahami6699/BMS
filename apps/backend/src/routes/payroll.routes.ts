import { currentPayrollPeriod, runPayrollInputSchema } from "@bms/shared";
import { Router } from "express";
import { requirePermission } from "../middleware/requirePermission.js";
import { getCommissionPolicy } from "../services/commissionPolicyService.js";
import {
  getMyPayslips,
  getPayslipById,
  listTenantPayslips,
  runPayroll,
  runPayrollForTenant
} from "../services/payrollService.js";
import {
  listRolePayrollDefaults,
  saveRolePayrollDefaultAndApply
} from "../services/rolePayrollDefaultService.js";
import {
  applyRoleDefaultsToAllUsers,
  listStaffPayrollSetup,
  upsertUserPayrollProfile
} from "../services/userPayrollProfileService.js";

export const payrollRouter = Router();

/** Single request for payroll page: setup + published + my payslips. */
payrollRouter.get("/bootstrap", requirePermission("payroll.read"), async (req, res, next) => {
  try {
    const context = req.userContext;
    if (!context) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const period = currentPayrollPeriod();
    const policy = getCommissionPolicy(context.tenantId);
    const canManage = context.role === "admin" || context.role === "accountant";

    const [myPayslips, published, rows, roleDefaults] = await Promise.all([
      getMyPayslips(context.tenantId, context.userId),
      canManage ? listTenantPayslips(context.tenantId, period.id) : Promise.resolve([]),
      canManage ? listStaffPayrollSetup(context.tenantId, period) : Promise.resolve([]),
      canManage ? listRolePayrollDefaults(context.tenantId) : Promise.resolve([])
    ]);

    res.json({
      period,
      policy: {
        enabled: policy.enabled,
        currency: policy.currency,
        bonusRules: policy.bonusRules
      },
      rows,
      roleDefaults,
      payslips: published,
      myPayslips
    });
  } catch (error) {
    next(error);
  }
});

payrollRouter.get("/staff-setup", requirePermission("payroll.run"), async (req, res, next) => {
  try {
    const context = req.userContext;
    if (!context) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const period = currentPayrollPeriod();
    const policy = getCommissionPolicy(context.tenantId);
    const [rows, roleDefaults] = await Promise.all([
      listStaffPayrollSetup(context.tenantId, period),
      listRolePayrollDefaults(context.tenantId)
    ]);
    res.json({
      period,
      rows,
      roleDefaults,
      policy: {
        enabled: policy.enabled,
        currency: policy.currency,
        bonusRules: policy.bonusRules
      }
    });
  } catch (error) {
    next(error);
  }
});

payrollRouter.get("/role-defaults", requirePermission("payroll.run"), async (req, res, next) => {
  try {
    const context = req.userContext;
    if (!context) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const roleDefaults = await listRolePayrollDefaults(context.tenantId);
    res.json({ roleDefaults });
  } catch (error) {
    next(error);
  }
});

payrollRouter.put("/role-defaults/:role", requirePermission("payroll.run"), async (req, res, next) => {
  try {
    const context = req.userContext;
    if (!context) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const role = Array.isArray(req.params.role) ? req.params.role[0] : req.params.role;
    const saved = await saveRolePayrollDefaultAndApply(context.tenantId, role as never, req.body);
    res.json(saved);
  } catch (error) {
    next(error);
  }
});

payrollRouter.post(
  "/apply-role-defaults",
  requirePermission("payroll.run"),
  async (req, res, next) => {
    try {
      const context = req.userContext;
      if (!context) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }
      const count = await applyRoleDefaultsToAllUsers(context.tenantId);
      res.json({ applied: count });
    } catch (error) {
      next(error);
    }
  }
);

payrollRouter.put("/profiles/:userId", requirePermission("payroll.run"), async (req, res, next) => {
  try {
    const context = req.userContext;
    if (!context) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const userId = Array.isArray(req.params.userId) ? req.params.userId[0] : req.params.userId;
    const profile = await upsertUserPayrollProfile(context.tenantId, userId, req.body);
    res.json(profile);
  } catch (error) {
    next(error);
  }
});

payrollRouter.get("/payslips", requirePermission("payroll.run"), async (req, res, next) => {
  try {
    const context = req.userContext;
    if (!context) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const periodId =
      typeof req.query.periodId === "string" ? req.query.periodId : currentPayrollPeriod().id;
    const payslips = await listTenantPayslips(context.tenantId, periodId);
    res.json({ periodId, payslips });
  } catch (error) {
    next(error);
  }
});

payrollRouter.get("/payslips/me", requirePermission("payroll.read"), async (req, res, next) => {
  try {
    const context = req.userContext;
    if (!context) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const myPayslips = await getMyPayslips(context.tenantId, context.userId);
    res.json(myPayslips);
  } catch (error) {
    next(error);
  }
});

payrollRouter.get("/payslips/:id", requirePermission("payroll.read"), async (req, res, next) => {
  try {
    const context = req.userContext;
    if (!context) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const payslipId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    if (payslipId === "me") {
      res.status(400).json({ error: "Use GET /payslips/me" });
      return;
    }

    const payslip = await getPayslipById(context.tenantId, payslipId);
    if (!payslip) {
      res.status(404).json({ error: "Payslip not found" });
      return;
    }

    const isSelf = payslip.userId === context.userId;
    const canViewAll =
      context.role === "admin" || context.role === "auditor" || context.role === "accountant";

    if (!isSelf && !canViewAll) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    res.json(payslip);
  } catch (error) {
    next(error);
  }
});

payrollRouter.post("/run", requirePermission("payroll.run"), async (req, res, next) => {
  try {
    const context = req.userContext;
    if (!context) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const useStaffSetup = req.body?.useStaffSetup === true;
    if (useStaffSetup || !req.body?.collections?.length) {
      const result = await runPayrollForTenant(context.tenantId);
      res.json(result);
      return;
    }

    const parsed = runPayrollInputSchema.safeParse({
      ...req.body,
      tenantId: context.tenantId
    });

    if (!parsed.success) {
      res.status(400).json({ error: "Invalid payroll run payload", details: parsed.error.flatten() });
      return;
    }

    const result = await runPayroll(parsed.data);
    res.json(result);
  } catch (error) {
    next(error);
  }
});
