import { Router } from "express";
import { requirePermission } from "../middleware/requirePermission.js";
import {
  getAgentPerformance,
  getBranchBreakdown,
  getBranchPerformanceSummary
} from "../services/analyticsService.js";
import { getCoordinatorBootstrap } from "../services/coordinatorBootstrapService.js";
import { getGroupSavingsBootstrap } from "../services/groupSavingsBootstrapService.js";
import { getPerformanceBootstrap } from "../services/performanceBootstrapService.js";
import { getWithdrawalsBootstrap } from "../services/withdrawalsBootstrapService.js";
import { getReportsAnalyticsBootstrap } from "../services/reportsAnalyticsBootstrapService.js";

import { resolveRequestBranchFilter } from "../middleware/branchScope.js";

export const reportsRouter = Router();

reportsRouter.get("/analytics-bootstrap", requirePermission("reports.read"), async (req, res) => {
  const context = req.userContext;
  if (!context) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const branchFilter = resolveRequestBranchFilter(req);
  try {
    res.json(
      await getReportsAnalyticsBootstrap(
        context.tenantId,
        {
          role: context.role,
          scopeType: context.scopeType as "head_office" | "branch",
          branchId: context.branchId
        },
        branchFilter
      )
    );
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : "Failed to load reports analytics"
    });
  }
});

reportsRouter.get("/withdrawals-bootstrap", requirePermission("customers.read"), async (req, res) => {
  const context = req.userContext;
  if (!context) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const branchFilter = resolveRequestBranchFilter(req);
  try {
    res.json(
      await getWithdrawalsBootstrap(
        context.tenantId,
        {
          role: context.role,
          scopeType: context.scopeType as "head_office" | "branch",
          branchId: context.branchId,
          userId: context.userId
        },
        { branchId: branchFilter }
      )
    );
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : "Failed to load withdrawals bootstrap"
    });
  }
});

reportsRouter.get("/group-savings-bootstrap", requirePermission("customers.read"), async (req, res) => {
  const context = req.userContext;
  if (!context) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const branchFilter = resolveRequestBranchFilter(req);
  try {
    res.json(
      await getGroupSavingsBootstrap(
        context.tenantId,
        {
          scopeType: context.scopeType as "head_office" | "branch",
          branchId: context.branchId
        },
        branchFilter
      )
    );
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : "Failed to load group savings bootstrap"
    });
  }
});

reportsRouter.get("/performance-bootstrap", requirePermission("reports.read"), async (req, res) => {
  const context = req.userContext;
  if (!context) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const branchFilter = resolveRequestBranchFilter(req);
  try {
    res.json(
      await getPerformanceBootstrap(
        context.tenantId,
        {
          role: context.role,
          scopeType: context.scopeType as "head_office" | "branch",
          branchId: context.branchId
        },
        branchFilter
      )
    );
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : "Failed to load performance bootstrap"
    });
  }
});

reportsRouter.get("/coordinator-bootstrap", requirePermission("reports.read"), async (req, res) => {
  const context = req.userContext;
  if (!context) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const branchFilter = resolveRequestBranchFilter(req);
  try {
    const data = await getCoordinatorBootstrap(
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
      error: error instanceof Error ? error.message : "Failed to load coordinator bootstrap"
    });
  }
});

function toCsv(headers: string[], rows: Array<Array<string | number>>): string {
  const headerLine = headers.join(",");
  const body = rows
    .map((row) =>
      row
        .map((value) => `"${String(value).replace(/"/g, '""')}"`)
        .join(",")
    )
    .join("\n");
  return `${headerLine}\n${body}`;
}

reportsRouter.get("/summary", requirePermission("reports.read"), async (req, res) => {
  const context = req.userContext;
  if (!context) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const branchIdFilter = resolveRequestBranchFilter(req);
  try {
    const summary = await getBranchPerformanceSummary(context.tenantId, {
      role: context.role,
      scopeType: context.scopeType,
      branchId: context.branchId,
      filterBranchId: branchIdFilter
    });
    res.json(summary);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Failed to build summary report" });
  }
});

reportsRouter.get("/agents", requirePermission("reports.read"), async (req, res) => {
  const context = req.userContext;
  if (!context) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const branchIdFilter = resolveRequestBranchFilter(req);
  try {
    const result = await getAgentPerformance(context.tenantId, {
      role: context.role,
      scopeType: context.scopeType,
      branchId: context.branchId,
      filterBranchId: branchIdFilter
    });
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Failed to build agent report" });
  }
});

reportsRouter.get("/branches", requirePermission("reports.read"), async (req, res) => {
  const context = req.userContext;
  if (!context) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const branchIdFilter = resolveRequestBranchFilter(req);
  try {
    const result = await getBranchBreakdown(context.tenantId, {
      role: context.role,
      scopeType: context.scopeType,
      branchId: context.branchId,
      filterBranchId: branchIdFilter
    });
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Failed to build branch report" });
  }
});

reportsRouter.get("/export.csv", requirePermission("reports.read"), async (req, res) => {
  const context = req.userContext;
  if (!context) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const branchIdFilter = resolveRequestBranchFilter(req);
  try {
    const [summary, agents, branches] = await Promise.all([
      getBranchPerformanceSummary(context.tenantId, {
        role: context.role,
        scopeType: context.scopeType,
        branchId: context.branchId,
        filterBranchId: branchIdFilter
      }),
      getAgentPerformance(context.tenantId, {
        role: context.role,
        scopeType: context.scopeType,
        branchId: context.branchId,
        filterBranchId: branchIdFilter
      }),
      getBranchBreakdown(context.tenantId, {
        role: context.role,
        scopeType: context.scopeType,
        branchId: context.branchId,
        filterBranchId: branchIdFilter
      })
    ]);

    const csv = toCsv(
      [
        "section",
        "key",
        "value",
        "branch_id",
        "agent_id",
        "transactions",
        "deposits",
        "withdrawals",
        "daily_susu"
      ],
      [
        ["summary", "totalTransactions", summary.totalTransactions, "", "", "", "", "", ""],
        ["summary", "totalDeposits", summary.totalDeposits, "", "", "", "", "", ""],
        ["summary", "totalWithdrawals", summary.totalWithdrawals, "", "", "", "", "", ""],
        ["summary", "totalDailySusu", summary.totalDailySusu, "", "", "", "", "", ""],
        ...branches.map((b) => [
          "branch",
          "totalAmount",
          b.totalAmount,
          b.branchId,
          "",
          b.transactionCount,
          b.depositAmount,
          b.withdrawalAmount,
          b.dailySusuAmount
        ]),
        ...agents.map((a) => [
          "agent",
          "totalCollections",
          a.totalCollections,
          "",
          a.fieldAgentId,
          a.dailySusuCount + a.depositCount + a.withdrawalCount,
          "",
          "",
          ""
        ])
      ]
    );

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", "attachment; filename=reports.csv");
    res.status(200).send(csv);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Failed to export reports CSV" });
  }
});
