import { createSiteAnnouncementSchema, updateSiteAnnouncementSchema, type AnnouncementScope } from "@bms/shared";
import { Router, type Request, type Response } from "express";
import { validateBody } from "../middleware/validateBody.js";
import {
  createSiteAnnouncement,
  deleteSiteAnnouncement,
  listActiveAnnouncementsForContext,
  listAnnouncementsForScope,
  updateSiteAnnouncement
} from "../services/siteAnnouncementService.js";

export const announcementsRouter = Router();

function resolveManageScope(req: Request, res: Response): { scope: AnnouncementScope; tenantId?: string } | null {
  const ctx = req.userContext;
  if (!ctx) {
    res.status(401).json({ error: "Unauthorized" });
    return null;
  }
  if (ctx.role === "super_admin") {
    return { scope: "platform" };
  }
  if (ctx.role === "admin") {
    return { scope: "tenant", tenantId: ctx.tenantId };
  }
  res.status(403).json({ error: "Only Super Admin or Company Admin can manage announcements" });
  return null;
}

/** Live floating-bar announcements visible to the signed-in user (Super Admin + own tenant). */
announcementsRouter.get("/active", async (req, res) => {
  const ctx = req.userContext;
  if (!ctx) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  try {
    const items = await listActiveAnnouncementsForContext({
      role: ctx.role,
      tenantId: ctx.tenantId
    });
    res.json({ announcements: items });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : "Failed to load announcements"
    });
  }
});

/** Management list (active + history) scoped to platform (super_admin) or company (admin). */
announcementsRouter.get("/manage", async (req, res) => {
  const resolved = resolveManageScope(req, res);
  if (!resolved) return;
  try {
    const items = await listAnnouncementsForScope(resolved.scope, resolved.tenantId);
    res.json({ scope: resolved.scope, announcements: items });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : "Failed to load announcements"
    });
  }
});

/** Create & publish a new floating-bar announcement with optional countdown timer. */
announcementsRouter.post("/", validateBody(createSiteAnnouncementSchema), async (req, res) => {
  const resolved = resolveManageScope(req, res);
  if (!resolved || !req.userContext) return;
  try {
    const created = await createSiteAnnouncement(
      {
        userId: req.userContext.userId,
        email: req.userContext.email,
        scope: resolved.scope,
        tenantId: resolved.tenantId
      },
      req.body
    );
    res.status(201).json(created);
  } catch (error) {
    res.status(400).json({
      error: error instanceof Error ? error.message : "Failed to publish announcement"
    });
  }
});

/** Edit, extend timer, pause/resume, or stop an announcement. */
announcementsRouter.patch("/:id", validateBody(updateSiteAnnouncementSchema), async (req, res) => {
  const resolved = resolveManageScope(req, res);
  if (!resolved) return;
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  try {
    const updated = await updateSiteAnnouncement(resolved, id, req.body);
    res.json(updated);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to update announcement";
    res.status(/not found/i.test(message) ? 404 : 400).json({ error: message });
  }
});

/** Delete an announcement from history. */
announcementsRouter.delete("/:id", async (req, res) => {
  const resolved = resolveManageScope(req, res);
  if (!resolved) return;
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  try {
    await deleteSiteAnnouncement(resolved, id);
    res.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to delete announcement";
    res.status(/not found/i.test(message) ? 404 : 400).json({ error: message });
  }
});
