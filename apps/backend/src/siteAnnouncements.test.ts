import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import { _resetSiteAnnouncementsMemory } from "./services/siteAnnouncementService.js";

const app = createApp();

function superAdminHeaders() {
  return {
    "x-user-id": "super-1",
    "x-tenant-id": "platform",
    "x-role": "super_admin",
    "x-scope-type": "head_office"
  };
}

function tenantAdminHeaders(tenantId: string) {
  return {
    "x-user-id": `admin-${tenantId}`,
    "x-tenant-id": tenantId,
    "x-role": "admin",
    "x-scope-type": "head_office"
  };
}

function fieldAgentHeaders(tenantId: string) {
  return {
    "x-user-id": `agent-${tenantId}`,
    "x-tenant-id": tenantId,
    "x-role": "field_agent",
    "x-scope-type": "branch",
    "x-branch-id": "branch-a"
  };
}

describe("floating site & admin announcements", () => {
  beforeEach(() => {
    _resetSiteAnnouncementsMemory();
  });

  it("publishes a super admin announcement with timer visible across all tenants", async () => {
    const createRes = await request(app)
      .post("/api/v1/announcements")
      .set(superAdminHeaders())
      .send({
        title: "Scheduled Update",
        message: "Platform maintenance starts in 30 minutes.",
        tone: "warning",
        timerMode: "duration",
        durationMinutes: 30,
        dismissible: false
      });

    expect(createRes.status).toBe(201);
    expect(createRes.body.scope).toBe("platform");
    expect(createRes.body.tenantId).toBeNull();
    expect(createRes.body.expiresAt).toBeTruthy();
    expect(createRes.body.durationMinutes).toBe(30);

    // Visible to field agents in any company
    const activeA = await request(app)
      .get("/api/v1/announcements/active")
      .set(fieldAgentHeaders("tenant-alpha"));
    expect(activeA.status).toBe(200);
    expect(activeA.body.announcements).toHaveLength(1);
    expect(activeA.body.announcements[0].message).toContain("Platform maintenance");

    const activeB = await request(app)
      .get("/api/v1/announcements/active")
      .set(fieldAgentHeaders("tenant-beta"));
    expect(activeB.status).toBe(200);
    expect(activeB.body.announcements).toHaveLength(1);
  });

  it("scopes company admin announcements strictly to their own tenant and prioritizes super admin first", async () => {
    await request(app)
      .post("/api/v1/announcements")
      .set(superAdminHeaders())
      .send({
        title: "System",
        message: "Global platform notice",
        tone: "info",
        timerMode: "duration",
        durationMinutes: 60
      });

    const tenantCreate = await request(app)
      .post("/api/v1/announcements")
      .set(tenantAdminHeaders("tenant-alpha"))
      .send({
        title: "Branch Notice",
        message: "Submit call-over by 4:30 PM today.",
        tone: "info",
        timerMode: "duration",
        durationMinutes: 120
      });
    expect(tenantCreate.status).toBe(201);
    expect(tenantCreate.body.scope).toBe("tenant");
    expect(tenantCreate.body.tenantId).toBe("tenant-alpha");

    // Tenant Alpha sees both (Super Admin first, then Company Admin)
    const activeAlpha = await request(app)
      .get("/api/v1/announcements/active")
      .set(fieldAgentHeaders("tenant-alpha"));
    expect(activeAlpha.status).toBe(200);
    expect(activeAlpha.body.announcements).toHaveLength(2);
    expect(activeAlpha.body.announcements[0].scope).toBe("platform");
    expect(activeAlpha.body.announcements[1].scope).toBe("tenant");

    // Tenant Beta sees ONLY the Super Admin announcement, NOT Tenant Alpha's
    const activeBeta = await request(app)
      .get("/api/v1/announcements/active")
      .set(fieldAgentHeaders("tenant-beta"));
    expect(activeBeta.status).toBe(200);
    expect(activeBeta.body.announcements).toHaveLength(1);
    expect(activeBeta.body.announcements[0].scope).toBe("platform");
  });

  it("blocks non-admins from managing and blocks company admins from modifying super admin announcements", async () => {
    const superCreated = await request(app)
      .post("/api/v1/announcements")
      .set(superAdminHeaders())
      .send({
        message: "Core system upgrade tonight.",
        tone: "critical",
        timerMode: "none"
      });
    expect(superCreated.status).toBe(201);

    // Field agent cannot create or manage
    const agentCreate = await request(app)
      .post("/api/v1/announcements")
      .set(fieldAgentHeaders("tenant-alpha"))
      .send({ message: "Unauthorized", timerMode: "none" });
    expect(agentCreate.status).toBe(403);

    // Company admin cannot stop or delete a platform announcement
    const adminStopPlatform = await request(app)
      .patch(`/api/v1/announcements/${superCreated.body.id}`)
      .set(tenantAdminHeaders("tenant-alpha"))
      .send({ isActive: false });
    expect(adminStopPlatform.status).toBe(404);

    // Super admin CAN extend timer and stop it
    const extended = await request(app)
      .patch(`/api/v1/announcements/${superCreated.body.id}`)
      .set(superAdminHeaders())
      .send({ extendMinutes: 45 });
    expect(extended.status).toBe(200);
    expect(extended.body.expiresAt).toBeTruthy();

    const stopped = await request(app)
      .patch(`/api/v1/announcements/${superCreated.body.id}`)
      .set(superAdminHeaders())
      .send({ isActive: false });
    expect(stopped.status).toBe(200);
    expect(stopped.body.isActive).toBe(false);

    const activeAfterStop = await request(app)
      .get("/api/v1/announcements/active")
      .set(fieldAgentHeaders("tenant-alpha"));
    expect(activeAfterStop.body.announcements).toHaveLength(0);
  });
});
