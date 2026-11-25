import { describe, expect, it } from "vitest";
import sharp from "sharp";
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
});
