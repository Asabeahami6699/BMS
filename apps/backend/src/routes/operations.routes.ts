import { Router } from "express";
import { requireAnyPermission, requirePermission } from "../middleware/requirePermission.js";
import {
  checkInAttendance,
  checkOutAttendance,
  createMyLeaveRequest,
  getMyAttendanceToday,
  getMyLeaveSummary,
  listMyAttendanceHistory,
  listMyLeaveRequests
} from "../services/hrService.js";
import {
  acknowledgeAnnouncement,
  createAnnouncement,
  createDocument,
  createIncident,
  createStaffLoan,
  getUniversalOpsSummary,
  listAnnouncements,
  listDocuments,
  listMyIncidents,
  listMyStaffLoans
} from "../services/universalOpsService.js";

export const operationsRouter = Router();

const selfService = requireAnyPermission("workspace.notifications");

operationsRouter.get("/summary", selfService, async (req, res, next) => {
  try {
    const ctx = req.userContext!;
    res.json(await getUniversalOpsSummary(ctx.tenantId, ctx.userId));
  } catch (error) {
    next(error);
  }
});

operationsRouter.get("/attendance/today", selfService, async (req, res, next) => {
  try {
    const ctx = req.userContext!;
    res.json(await getMyAttendanceToday(ctx.tenantId, ctx.userId));
  } catch (error) {
    next(error);
  }
});

operationsRouter.get("/attendance/history", selfService, async (req, res, next) => {
  try {
    const ctx = req.userContext!;
    res.json(await listMyAttendanceHistory(ctx.tenantId, ctx.userId));
  } catch (error) {
    next(error);
  }
});

operationsRouter.post("/attendance/check-in", selfService, async (req, res) => {
  try {
    const ctx = req.userContext!;
    const row = await checkInAttendance(ctx.tenantId, ctx.userId, req.body, ctx.branchId);
    res.status(201).json(row);
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Failed" });
  }
});

operationsRouter.post("/attendance/check-out", selfService, async (req, res) => {
  try {
    const ctx = req.userContext!;
    const row = await checkOutAttendance(ctx.tenantId, ctx.userId, req.body);
    res.json(row);
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Failed" });
  }
});

operationsRouter.get("/leave", selfService, async (req, res, next) => {
  try {
    const ctx = req.userContext!;
    res.json(await listMyLeaveRequests(ctx.tenantId, ctx.userId));
  } catch (error) {
    next(error);
  }
});

operationsRouter.get("/leave/summary", selfService, async (req, res, next) => {
  try {
    const ctx = req.userContext!;
    res.json(await getMyLeaveSummary(ctx.tenantId, ctx.userId, ctx.role));
  } catch (error) {
    next(error);
  }
});

operationsRouter.post("/leave", selfService, async (req, res) => {
  try {
    const ctx = req.userContext!;
    const row = await createMyLeaveRequest(ctx.tenantId, ctx.userId, req.body);
    res.status(201).json(row);
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Failed" });
  }
});

operationsRouter.get("/staff-loans", selfService, async (req, res, next) => {
  try {
    const ctx = req.userContext!;
    res.json(await listMyStaffLoans(ctx.tenantId, ctx.userId));
  } catch (error) {
    next(error);
  }
});

operationsRouter.post("/staff-loans", selfService, async (req, res) => {
  try {
    const ctx = req.userContext!;
    const row = await createStaffLoan(ctx.tenantId, ctx.userId, req.body);
    res.status(201).json(row);
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Failed" });
  }
});

operationsRouter.get("/announcements", selfService, async (req, res, next) => {
  try {
    const ctx = req.userContext!;
    res.json(await listAnnouncements(ctx.tenantId, ctx.userId));
  } catch (error) {
    next(error);
  }
});

operationsRouter.post("/announcements/:id/ack", selfService, async (req, res) => {
  try {
    const ctx = req.userContext!;
    await acknowledgeAnnouncement(ctx.tenantId, ctx.userId, String(req.params.id));
    res.json({ ok: true });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Failed" });
  }
});

operationsRouter.post(
  "/announcements",
  requirePermission("users.update"),
  async (req, res) => {
    try {
      const ctx = req.userContext!;
      const row = await createAnnouncement(ctx.tenantId, ctx.userId, req.body);
      res.status(201).json(row);
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : "Failed" });
    }
  }
);

operationsRouter.get("/documents", selfService, async (req, res, next) => {
  try {
    const ctx = req.userContext!;
    res.json(await listDocuments(ctx.tenantId));
  } catch (error) {
    next(error);
  }
});

operationsRouter.post("/documents", requirePermission("users.update"), async (req, res) => {
  try {
    const ctx = req.userContext!;
    const row = await createDocument(ctx.tenantId, ctx.userId, req.body);
    res.status(201).json(row);
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Failed" });
  }
});

operationsRouter.get("/incidents", selfService, async (req, res, next) => {
  try {
    const ctx = req.userContext!;
    res.json(await listMyIncidents(ctx.tenantId, ctx.userId));
  } catch (error) {
    next(error);
  }
});

operationsRouter.post("/incidents", selfService, async (req, res) => {
  try {
    const ctx = req.userContext!;
    const row = await createIncident(ctx.tenantId, ctx.userId, req.body);
    res.status(201).json(row);
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Failed" });
  }
});
