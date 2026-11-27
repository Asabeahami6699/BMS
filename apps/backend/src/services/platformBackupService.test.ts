import { createHash } from "node:crypto";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

vi.mock("../config/supabaseClient.js", () => ({
  getSupabaseAdminClient: () => null
}));

import { createApp } from "../app.js";

const app = createApp();

function superAdminHeaders() {
  return {
    "x-user-id": "super-admin-backup-test",
    "x-tenant-id": "platform",
    "x-role": "super_admin",
    "x-scope-type": "head_office"
  };
}

function tenantAdminHeaders(tenantId: string) {
  return {
    "x-user-id": "admin-backup-test",
    "x-tenant-id": tenantId,
    "x-role": "admin",
    "x-scope-type": "head_office"
  };
}

describe("platform super admin backups & financial snapshots", () => {
  it("blocks non-super-admin access and serves overview, chain verification, checksummed JSON snapshot, balances CSV, and consolidated snapshot", async () => {
    // 1. Create a test tenant as super_admin
    const slug = `bktest${Date.now().toString().slice(-5)}`;
    const createTenantRes = await request(app)
      .post("/api/v1/platform/tenants")
      .set(superAdminHeaders())
      .send({
        id: slug,
        name: "Backup Test Microfinance",
        subscriptionStatus: "active",
        subscribedModules: ["susu_management"],
        subscribedAddons: []
      });
    expect(createTenantRes.status, JSON.stringify(createTenantRes.body)).toBe(201);
    const tenantId = String(createTenantRes.body.id ?? createTenantRes.body.tenant?.id);
    expect(tenantId).toBe(slug);

    // 2. Register and approve a customer with a fake photo to verify photo stripping/inclusion
    const regRes = await request(app)
      .post("/api/v1/customers/registrations")
      .set(tenantAdminHeaders(tenantId))
      .send({
        fullName: "Kofi Backup",
        phone: "0244998877",
        location: "Kumasi",
        houseNumber: "8",
        dateOfBirth: "1988-07-02",
        occupation: "Merchant",
        accountType: "susu",
        idCardNumber: "GHA-BK-001",
        idCardPhotoUrl: "data:image/png;base64,iVBORw0KGgo=",
        photoUrl: "data:image/png;base64,iVBORw0KGgo=",
        nextOfKin: {
          fullName: "Ama Backup",
          phone: "0244998800",
          location: "Kumasi",
          houseNumber: "8"
        },
        dailyContributionAmount: 40
      });
    expect(regRes.status, JSON.stringify(regRes.body)).toBe(201);
    const customerId = String(regRes.body.id);

    const approveRes = await request(app)
      .patch(`/api/v1/customers/${customerId}/approve`)
      .set(tenantAdminHeaders(tenantId));
    expect(approveRes.status, JSON.stringify(approveRes.body)).toBe(200);

    // Guard: regular company admin is forbidden from platform backup endpoints
    const forbiddenOverview = await request(app)
      .get("/api/v1/platform/backups/overview")
      .set(tenantAdminHeaders(tenantId));
    expect(forbiddenOverview.status).toBe(403);

    const forbiddenSnapshot = await request(app)
      .get(`/api/v1/platform/backups/snapshot/${tenantId}`)
      .set(tenantAdminHeaders(tenantId));
    expect(forbiddenSnapshot.status).toBe(403);

    // 3. Super admin fetches backup overview
    const overviewRes = await request(app)
      .get("/api/v1/platform/backups/overview")
      .set(superAdminHeaders());
    expect(overviewRes.status, JSON.stringify(overviewRes.body)).toBe(200);
    const tenantRow = (
      overviewRes.body.tenants as Array<{
        tenantId: string;
        activeCustomers: number;
        totalCustomers: number;
      }>
    ).find((t) => t.tenantId === tenantId);
    expect(tenantRow).toBeTruthy();
    expect(tenantRow?.activeCustomers).toBe(1);
    expect(tenantRow?.totalCustomers).toBe(1);

    // 4. Verify audit chain for the tenant
    const verifyRes = await request(app)
      .post(`/api/v1/platform/backups/verify-chain/${tenantId}`)
      .set(superAdminHeaders());
    expect(verifyRes.status, JSON.stringify(verifyRes.body)).toBe(200);
    expect(verifyRes.body.tenantId).toBe(tenantId);
    expect(verifyRes.body.ok).toBe(true);

    // 5. Download single-tenant JSON snapshot (default: photos stripped, password hashes excluded, valid SHA-256)
    const snapRes = await request(app)
      .get(`/api/v1/platform/backups/snapshot/${tenantId}`)
      .set(superAdminHeaders());
    expect(snapRes.status).toBe(200);
    expect(snapRes.headers["x-snapshot-sha256"]).toBeTruthy();
    const snapshot = JSON.parse(snapRes.text) as {
      formatVersion: string;
      includePhotos: boolean;
      summary: { activeCustomers: number; customers: number };
      data: {
        staff: Array<Record<string, unknown>>;
        customers: Array<Record<string, unknown>>;
      };
      integrity: { sha256: string };
    };
    expect(snapshot.formatVersion).toBe("1.0");
    expect(snapshot.includePhotos).toBe(false);
    expect(snapshot.summary.activeCustomers).toBe(1);
    // SHA-256 matches serialized data payload exactly
    const recomputed = createHash("sha256")
      .update(JSON.stringify(snapshot.data))
      .digest("hex");
    expect(snapshot.integrity.sha256).toBe(recomputed);
    expect(snapRes.headers["x-snapshot-sha256"]).toBe(recomputed);
    // Password hashes must never leak
    for (const s of snapshot.data.staff) {
      expect(s).not.toHaveProperty("passwordHash");
      expect(s).not.toHaveProperty("password_hash");
    }
    // Photos stripped by default
    const custDefault = snapshot.data.customers.find((c) => c.id === customerId);
    expect(custDefault?.photoUrl).toBeUndefined();
    expect(custDefault?.idCardPhotoUrl).toBeUndefined();

    // With includePhotos=true, photos are included
    const snapPhotosRes = await request(app)
      .get(`/api/v1/platform/backups/snapshot/${tenantId}?includePhotos=true`)
      .set(superAdminHeaders());
    expect(snapPhotosRes.status).toBe(200);
    const snapPhotos = JSON.parse(snapPhotosRes.text) as {
      includePhotos: boolean;
      data: { customers: Array<Record<string, unknown>> };
    };
    expect(snapPhotos.includePhotos).toBe(true);
    const custWithPhotos = snapPhotos.data.customers.find((c) => c.id === customerId);
    expect(custWithPhotos?.idCardPhotoUrl).toBe("data:image/png;base64,iVBORw0KGgo=");

    // 6. Download balances CSV
    const csvRes = await request(app)
      .get(`/api/v1/platform/backups/balances/${tenantId}.csv`)
      .set(superAdminHeaders());
    expect(csvRes.status).toBe(200);
    expect(csvRes.headers["content-type"]).toContain("text/csv");
    expect(csvRes.text).toContain("Customer ID,Account Number,Full Name");
    expect(csvRes.text).toContain("Kofi Backup");

    // 7. Consolidated platform-wide snapshot
    const allRes = await request(app)
      .get("/api/v1/platform/backups/snapshot-all")
      .set(superAdminHeaders());
    expect(allRes.status).toBe(200);
    const bundle = JSON.parse(allRes.text) as {
      tenantCount: number;
      snapshots: Array<{ tenant: { id: string } }>;
      integrity: { sha256: string };
    };
    expect(bundle.tenantCount).toBeGreaterThanOrEqual(1);
    expect(bundle.snapshots.some((s) => s.tenant.id === tenantId)).toBe(true);
    expect(bundle.integrity.sha256).toHaveLength(64);
  });
});
