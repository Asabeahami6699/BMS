import { describe, expect, it } from "vitest";
import sharp from "sharp";
import request from "supertest";
import { createApp } from "../app.js";
import { upsertTenantInStore } from "./authStore.js";
import { renderTenantPwaPng } from "./pwaIconService.js";

describe("renderTenantPwaPng", () => {
  it("converts a rectangular JPEG company logo into exact 192x192 and 512x512 square PNGs", async () => {
    const rectJpeg = await sharp({
      create: { width: 320, height: 160, channels: 3, background: { r: 30, g: 90, b: 220 } }
    })
      .jpeg()
      .toBuffer();
    const jpegDataUrl = `data:image/jpeg;base64,${rectJpeg.toString("base64")}`;

    const tenant = {
      id: "tenant-jpeg-logo",
      name: "Opioko Susu",
      logoUrl: jpegDataUrl,
      brandColor: "#1d4ed8"
    };

    const png192 = await renderTenantPwaPng(tenant, { size: 192, purpose: "any" });
    const meta192 = await sharp(png192).metadata();
    expect(meta192.format).toBe("png");
    expect(meta192.width).toBe(192);
    expect(meta192.height).toBe(192);

    const png512Mask = await renderTenantPwaPng(tenant, { size: 512, purpose: "maskable" });
    const meta512 = await sharp(png512Mask).metadata();
    expect(meta512.format).toBe("png");
    expect(meta512.width).toBe(512);
    expect(meta512.height).toBe(512);
  });

  it("renders a branded square PNG monogram when a company has no uploaded logo", async () => {
    const tenant = {
      id: "tenant-no-logo",
      name: "Opioko Susu",
      brandColor: "#0f766e"
    };

    const png180 = await renderTenantPwaPng(tenant, { size: 180, purpose: "apple" });
    const meta180 = await sharp(png180).metadata();
    expect(meta180.format).toBe("png");
    expect(meta180.width).toBe(180);
    expect(meta180.height).toBe(180);

    const png512 = await renderTenantPwaPng(tenant, { size: 512, purpose: "any" });
    const meta512 = await sharp(png512).metadata();
    expect(meta512.format).toBe("png");
    expect(meta512.width).toBe(512);
    expect(meta512.height).toBe(512);
  });

  it("serves /api/v1/auth/company-icon and /api/v1/auth/manifest.webmanifest publicly without auth (never 401)", async () => {
    upsertTenantInStore({
      id: "tenant-pwa-public",
      name: "Opioko Susu",
      subdomain: "opiokopwa",
      subscriptionStatus: "active",
      createdAt: new Date().toISOString()
    });

    const app = createApp();

    const iconRes = await request(app)
      .get("/api/v1/auth/company-icon?subdomain=opiokopwa&size=64&purpose=any")
      .set("Origin", "https://opiokopwa.aabanker.com");

    expect(iconRes.status).toBe(200);
    expect(iconRes.headers["content-type"]).toMatch(/^image\/png/);
    expect(iconRes.headers["access-control-allow-origin"]).toBe("*");
    expect(iconRes.headers["access-control-allow-credentials"]).toBeUndefined();
    expect(iconRes.headers["cross-origin-resource-policy"]).toBe("cross-origin");
    const iconMeta = await sharp(iconRes.body as Buffer).metadata();
    expect(iconMeta.format).toBe("png");
    expect(iconMeta.width).toBe(64);
    expect(iconMeta.height).toBe(64);

    const manifestRes = await request(app)
      .get("/api/v1/auth/manifest.webmanifest?subdomain=opiokopwa&origin=https%3A%2F%2Fopiokopwa.aabanker.com&sameOrigin=1")
      .set("Origin", "https://opiokopwa.aabanker.com");

    expect(manifestRes.status).toBe(200);
    expect(manifestRes.headers["content-type"]).toMatch(/application\/manifest\+json/);
    expect(manifestRes.headers["access-control-allow-origin"]).toBe("*");
    expect(manifestRes.headers["access-control-allow-credentials"]).toBeUndefined();
    expect(manifestRes.body.name).toBe("Opioko Susu");
    expect(manifestRes.body.short_name).toBe("Opioko Susu");
    expect(manifestRes.body.theme_color).toBe("#0b0e14");
    expect(manifestRes.body.id).toBe("https://opiokopwa.aabanker.com/?app=opiokopwa");
    expect(manifestRes.body.icons).toHaveLength(7);
    expect(
      manifestRes.body.icons.every((i: { src: string }) =>
        i.src.startsWith("https://opiokopwa.aabanker.com/pwa/company-icon?")
      )
    ).toBe(true);
  });
});
