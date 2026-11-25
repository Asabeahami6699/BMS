import { createHash } from "node:crypto";
import sharp from "sharp";

export type PwaIconPurpose = "any" | "maskable" | "apple";
export type PwaIconSize = 48 | 64 | 96 | 144 | 180 | 192 | 256 | 512;

export type TenantIconSource = {
  id: string;
  name: string;
  logoUrl?: string;
  brandColor?: string;
};

const ALLOWED_SIZES = new Set<number>([48, 64, 96, 144, 180, 192, 256, 512]);
const MAX_CACHE_ENTRIES = 200;
const renderedPngCache = new Map<string, Buffer>();

export function parsePwaIconSize(raw: unknown): PwaIconSize {
  const num = Number(raw);
  if (ALLOWED_SIZES.has(num)) {
    return num as PwaIconSize;
  }
  return 512;
}

export function parsePwaIconPurpose(raw: unknown): PwaIconPurpose {
  if (raw === "maskable" || raw === "apple") {
    return raw;
  }
  return "any";
}

export function computeTenantBrandVersion(tenant: TenantIconSource): string {
  return createHash("sha1")
    .update(`${tenant.name}|${tenant.brandColor ?? ""}|${tenant.logoUrl ?? ""}`)
    .digest("hex")
    .slice(0, 12);
}

function parseBase64DataImage(dataUrl: string): Buffer | null {
  const match = /^data:image\/(?:png|jpeg|jpg|webp|gif|svg\+xml);base64,([A-Za-z0-9+/=\s]+)$/i.exec(
    dataUrl.trim()
  );
  if (!match) {
    return null;
  }
  const buffer = Buffer.from(match[1]!.replace(/\s+/g, ""), "base64");
  return buffer.length > 0 ? buffer : null;
}

async function loadRawLogoBuffer(logoUrl: string | undefined): Promise<Buffer | null> {
  const raw = logoUrl?.trim();
  if (!raw) {
    return null;
  }
  const decoded = parseBase64DataImage(raw);
  if (decoded) {
    return decoded;
  }
  if (/^https?:\/\//i.test(raw)) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5_000);
      const res = await fetch(raw, { signal: controller.signal });
      clearTimeout(timer);
      if (!res.ok) {
        return null;
      }
      const contentType = res.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() ?? "";
      if (!contentType.startsWith("image/")) {
        return null;
      }
      const arr = await res.arrayBuffer();
      if (arr.byteLength > 0 && arr.byteLength <= 4 * 1024 * 1024) {
        return Buffer.from(arr);
      }
    } catch {
      return null;
    }
  }
  return null;
}

function companyInitials(name: string): string {
  const parts = name
    .trim()
    .split(/\s+/)
    .filter((p) => /[a-z0-9]/i.test(p));
  if (parts.length === 0) return "CO";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0] ?? ""}${parts[1]![0] ?? ""}`.toUpperCase();
}

function buildMonogramSvg(
  name: string,
  brandColor: string | undefined,
  size: PwaIconSize,
  purpose: PwaIconPurpose
): Buffer {
  const bg = brandColor && /^#[0-9a-f]{3,8}$/i.test(brandColor) ? brandColor : "#3d5afe";
  const text = companyInitials(name).replace(/[<>&"']/g, "");
  const radius = purpose === "any" ? Math.round(size * 0.2) : 0;
  const fontSize = Math.round(size * (purpose === "maskable" ? 0.36 : 0.44));
  const y = Math.round(size * 0.54);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><rect width="${size}" height="${size}" rx="${radius}" fill="${bg}"/><text x="50%" y="${y}" dominant-baseline="middle" text-anchor="middle" fill="#ffffff" font-family="DejaVu Sans, Arial, Helvetica, sans-serif" font-size="${fontSize}" font-weight="700">${text}</text></svg>`;
  return Buffer.from(svg, "utf-8");
}

function rememberPng(key: string, png: Buffer): void {
  if (renderedPngCache.size >= MAX_CACHE_ENTRIES) {
    const oldest = renderedPngCache.keys().next().value;
    if (oldest) {
      renderedPngCache.delete(oldest);
    }
  }
  renderedPngCache.set(key, png);
}

/**
 * Renders an exact square PNG (`64 | 180 | 192 | 512`) from the company's uploaded logo
 * (supporting JPEG, PNG, WebP, GIF, SVG, base64, or HTTPS URLs), or a crisp branded monogram
 * PNG if no logo is uploaded yet. Always returns valid `image/png` bytes that pass Chromium
 * Desktop, Android WebAPK, and iOS Safari home-screen validation.
 */
export async function renderTenantPwaPng(
  tenant: TenantIconSource,
  options: { size: PwaIconSize; purpose: PwaIconPurpose }
): Promise<Buffer> {
  const version = computeTenantBrandVersion(tenant);
  const cacheKey = `${tenant.id}:${options.size}:${options.purpose}:${version}`;
  const cached = renderedPngCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const { size, purpose } = options;
  const padRatio = purpose === "maskable" ? 0.16 : purpose === "apple" ? 0.1 : 0.06;
  const innerSize = Math.max(16, size - Math.round(size * padRatio) * 2);
  const background =
    purpose === "maskable" || purpose === "apple"
      ? { r: 255, g: 255, b: 255, alpha: 1 }
      : { r: 0, g: 0, b: 0, alpha: 0 };

  const rawLogo = await loadRawLogoBuffer(tenant.logoUrl);
  if (rawLogo) {
    try {
      const fitted = await sharp(rawLogo)
        .rotate()
        .resize(innerSize, innerSize, {
          fit: "contain",
          background: { r: 0, g: 0, b: 0, alpha: 0 }
        })
        .png()
        .toBuffer();

      const composed = await sharp({
        create: {
          width: size,
          height: size,
          channels: 4,
          background
        }
      })
        .composite([{ input: fitted, gravity: "center" }])
        .png({ compressionLevel: 9 })
        .toBuffer();

      rememberPng(cacheKey, composed);
      return composed;
    } catch {
      /* fall through to branded monogram PNG */
    }
  }

  const svgBuf = buildMonogramSvg(tenant.name, tenant.brandColor, size, purpose);
  const monogramPng = await sharp(svgBuf)
    .resize(size, size)
    .png({ compressionLevel: 9 })
    .toBuffer();

  rememberPng(cacheKey, monogramPng);
  return monogramPng;
}
