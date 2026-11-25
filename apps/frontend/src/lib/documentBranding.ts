import { parseTenantSubdomain } from "@bms/shared";
import { readCachedCompanyHost } from "./tenantHostCache";

const DEFAULT_TITLE = "aabanker — Banking Management System";
const DEFAULT_APP_NAME = "aabanker";
const DEFAULT_DESCRIPTION = "aabanker — Banking Management System. Install on desktop or mobile.";
const DEFAULT_FAVICON = "/favicon.png";
const DEFAULT_APPLE_ICON = "/icons/icon-180.png";
const DEFAULT_MANIFEST = "/manifest.webmanifest";
const ACTIVE_BRAND_STORAGE_KEY = "bms.activeBrand.v1";

export type DocumentBrandingOptions = {
  companyName?: string;
  pagePrefix?: string;
  logoUrl?: string;
  brandColor?: string;
  subdomain?: string | null;
  apiBaseUrl?: string;
};

type CachedActiveBrand = {
  name: string;
  subdomain?: string;
  logoUrl?: string;
  brandColor?: string;
};

let activeManifestSignature = "";
let activeBlobManifestUrl: string | null = null;
let manifestBuildToken = 0;

function setMetaContent(name: string, content: string): void {
  let el = document.querySelector<HTMLMetaElement>(`meta[name="${name}"]`);
  if (!el) {
    el = document.createElement("meta");
    el.name = name;
    document.head.appendChild(el);
  }
  if (el.getAttribute("content") !== content) {
    el.setAttribute("content", content);
  }
}

function setLinkHref(selector: string, href: string): void {
  document.querySelectorAll<HTMLLinkElement>(selector).forEach((link) => {
    if (link.getAttribute("href") !== href) {
      link.setAttribute("href", href);
    }
  });
}

/**
 * Replaces the `<link rel="manifest">` node in `<head>` so Chromium reliably
 * re-parses updated company name & icon entries instead of sticking to an older manifest.
 */
function setManifestLink(href: string): void {
  const existing = document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
  if (existing && existing.getAttribute("href") === href) {
    return;
  }
  const next = document.createElement("link");
  next.rel = "manifest";
  next.href = href;
  if (existing) {
    existing.replaceWith(next);
  } else {
    document.head.appendChild(next);
  }
}

function deriveShortName(company: string): string {
  const clean = company.trim().replace(/\s+/g, " ");
  if (clean.length <= 15) {
    return clean;
  }
  const words = clean.split(" ");
  let out = "";
  for (const word of words) {
    const candidate = out ? `${out} ${word}` : word;
    if (candidate.length > 15) {
      break;
    }
    out = candidate;
  }
  return out || clean.slice(0, 15).trim();
}

function deriveInitials(company: string): string {
  const parts = company
    .trim()
    .split(/\s+/)
    .filter((p) => /[a-z0-9]/i.test(p));
  if (parts.length === 0) {
    return "CO";
  }
  if (parts.length === 1) {
    return parts[0]!.slice(0, 2).toUpperCase();
  }
  return `${parts[0]![0] ?? ""}${parts[1]![0] ?? ""}`.toUpperCase();
}

function writeActiveBrandCache(brand: CachedActiveBrand | null): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    if (!brand) {
      window.localStorage.removeItem(ACTIVE_BRAND_STORAGE_KEY);
      return;
    }
    window.localStorage.setItem(ACTIVE_BRAND_STORAGE_KEY, JSON.stringify(brand));
  } catch {
    if (brand) {
      try {
        window.localStorage.setItem(
          ACTIVE_BRAND_STORAGE_KEY,
          JSON.stringify({ ...brand, logoUrl: undefined })
        );
      } catch {
        /* ignore storage quota errors */
      }
    }
  }
}

function readActiveBrandCache(): CachedActiveBrand | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    const raw = window.localStorage.getItem(ACTIVE_BRAND_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CachedActiveBrand>;
    if (!parsed || typeof parsed.name !== "string" || !parsed.name.trim()) {
      return null;
    }
    return {
      name: parsed.name.trim(),
      subdomain: typeof parsed.subdomain === "string" && parsed.subdomain.trim() ? parsed.subdomain.trim().toLowerCase() : undefined,
      logoUrl: typeof parsed.logoUrl === "string" && parsed.logoUrl.trim() ? parsed.logoUrl.trim() : undefined,
      brandColor: typeof parsed.brandColor === "string" && parsed.brandColor.trim() ? parsed.brandColor.trim() : undefined
    };
  } catch {
    return null;
  }
}

type IconVariant = "any" | "maskable" | "apple";

function loadImageElement(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    if (typeof Image === "undefined") {
      resolve(null);
      return;
    }
    const img = new Image();
    if (!src.startsWith("data:")) {
      img.crossOrigin = "anonymous";
    }
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

function drawLogoToSquarePng(
  img: HTMLImageElement,
  size: number,
  variant: IconVariant
): string | null {
  if (typeof document === "undefined") {
    return null;
  }
  try {
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return null;
    }
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";

    if (variant === "maskable" || variant === "apple") {
      // Solid light tile guarantees logos remain crisp & never clip inside Android adaptive
      // circles or iOS rounded-square app icons.
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, size, size);
    } else {
      ctx.clearRect(0, 0, size, size);
    }

    const padRatio = variant === "maskable" ? 0.16 : variant === "apple" ? 0.1 : 0.06;
    const pad = Math.round(size * padRatio);
    const box = size - pad * 2;
    const scale = Math.min(
      box / Math.max(1, img.naturalWidth),
      box / Math.max(1, img.naturalHeight)
    );
    const w = Math.round(img.naturalWidth * scale);
    const h = Math.round(img.naturalHeight * scale);
    const x = Math.round((size - w) / 2);
    const y = Math.round((size - h) / 2);
    ctx.drawImage(img, x, y, w, h);
    return canvas.toDataURL("image/png");
  } catch {
    return null;
  }
}

/**
 * Generates a crisp branded monogram PNG icon when a company has not uploaded a logo yet,
 * so installed PWAs never fall back to the platform `aabanker` icon.
 */
function renderMonogramPng(
  company: string,
  brandColor: string | undefined,
  size: number,
  variant: IconVariant
): string | null {
  if (typeof document === "undefined") {
    return null;
  }
  try {
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return null;
    }
    const bg = brandColor && /^#[0-9a-f]{3,8}$/i.test(brandColor) ? brandColor : "#3d5afe";
    ctx.fillStyle = bg;
    if (variant === "any") {
      const r = Math.round(size * 0.2);
      ctx.beginPath();
      ctx.moveTo(r, 0);
      ctx.arcTo(size, 0, size, size, r);
      ctx.arcTo(size, size, 0, size, r);
      ctx.arcTo(0, size, 0, 0, r);
      ctx.arcTo(0, 0, size, 0, r);
      ctx.closePath();
      ctx.fill();
    } else {
      ctx.fillRect(0, 0, size, size);
    }

    const initials = deriveInitials(company);
    const fontScale = variant === "maskable" ? 0.36 : 0.44;
    ctx.fillStyle = "#ffffff";
    ctx.font = `700 ${Math.round(size * fontScale)}px system-ui, -apple-system, "Segoe UI", sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(initials, size / 2, size / 2 + Math.round(size * 0.02));
    return canvas.toDataURL("image/png");
  } catch {
    return null;
  }
}

async function resolveBrandIcons(options: {
  company: string;
  logo?: string;
  brandColor?: string;
  subdomain?: string;
  apiBaseUrl?: string;
}): Promise<{
  icon64: string | null;
  icon180: string | null;
  icon192: string | null;
  icon512: string | null;
  icon512Maskable: string | null;
}> {
  let loadedImg: HTMLImageElement | null = null;
  if (options.logo) {
    loadedImg = await loadImageElement(options.logo);
    // If a cross-origin URL failed CORS canvas loading, retry via backend CORS-enabled proxy.
    if (!loadedImg && options.subdomain && options.apiBaseUrl) {
      const proxyUrl = `${options.apiBaseUrl.replace(/\/+$/, "")}/api/v1/auth/company-icon?subdomain=${encodeURIComponent(options.subdomain)}`;
      loadedImg = await loadImageElement(proxyUrl);
    }
  }

  if (loadedImg) {
    const icon64 = drawLogoToSquarePng(loadedImg, 64, "any");
    const icon180 = drawLogoToSquarePng(loadedImg, 180, "apple");
    const icon192 = drawLogoToSquarePng(loadedImg, 192, "any");
    const icon512 = drawLogoToSquarePng(loadedImg, 512, "any");
    const icon512Maskable = drawLogoToSquarePng(loadedImg, 512, "maskable");
    if (icon192 && icon512) {
      return {
        icon64,
        icon180: icon180 ?? icon192,
        icon192,
        icon512,
        icon512Maskable: icon512Maskable ?? icon512
      };
    }
  }

  // Fallback to company monogram (never platform `aabanker` icon)
  const icon64 = renderMonogramPng(options.company, options.brandColor, 64, "any");
  const icon180 = renderMonogramPng(options.company, options.brandColor, 180, "apple");
  const icon192 = renderMonogramPng(options.company, options.brandColor, 192, "any");
  const icon512 = renderMonogramPng(options.company, options.brandColor, 512, "any");
  const icon512Maskable = renderMonogramPng(options.company, options.brandColor, 512, "maskable");
  return { icon64, icon180, icon192, icon512, icon512Maskable };
}

async function applyCompanyManifestAndIcons(options: {
  company: string;
  logo?: string;
  brandColor?: string;
  subdomain?: string;
  apiBaseUrl?: string;
  signature: string;
}): Promise<void> {
  if (typeof window === "undefined" || typeof Blob === "undefined" || typeof URL === "undefined") {
    return;
  }
  const token = ++manifestBuildToken;
  const origin = window.location.origin;

  const rendered = await resolveBrandIcons({
    company: options.company,
    logo: options.logo,
    brandColor: options.brandColor,
    subdomain: options.subdomain,
    apiBaseUrl: options.apiBaseUrl
  });

  if (token !== manifestBuildToken) {
    return;
  }

  // Update browser tab favicon & iOS Home Screen icon to crisp square company PNGs.
  if (rendered.icon64) {
    setLinkHref('link[rel="icon"], link[rel="shortcut icon"]', rendered.icon64);
  } else if (options.logo) {
    setLinkHref('link[rel="icon"], link[rel="shortcut icon"]', options.logo);
  }
  if (rendered.icon180) {
    setLinkHref('link[rel="apple-touch-icon"]', rendered.icon180);
  } else if (options.logo) {
    setLinkHref('link[rel="apple-touch-icon"]', options.logo);
  }

  const icons: Array<{ src: string; sizes: string; type: string; purpose?: string }> = [];
  if (rendered.icon192) {
    icons.push({ src: rendered.icon192, sizes: "192x192", type: "image/png", purpose: "any" });
  }
  if (rendered.icon512) {
    icons.push({ src: rendered.icon512, sizes: "512x512", type: "image/png", purpose: "any" });
  }
  if (rendered.icon512Maskable) {
    icons.push({
      src: rendered.icon512Maskable,
      sizes: "512x512",
      type: "image/png",
      purpose: "maskable"
    });
  }

  // Only fall back to default platform icons if canvas rendering is completely unavailable.
  if (icons.length === 0) {
    icons.push(
      { src: `${origin}/icons/icon-192.png`, sizes: "192x192", type: "image/png", purpose: "any" },
      { src: `${origin}/icons/icon-512.png`, sizes: "512x512", type: "image/png", purpose: "any" },
      { src: `${origin}/icons/icon-512.png`, sizes: "512x512", type: "image/png", purpose: "maskable" }
    );
  }

  const shortcutIcon = rendered.icon192 ?? `${origin}/icons/icon-192.png`;
  const shortName = deriveShortName(options.company);

  const manifest = {
    id: `${origin}/`,
    name: options.company,
    short_name: shortName,
    description: `${options.company} — Staff & Operations Portal`,
    start_url: `${origin}/`,
    scope: `${origin}/`,
    display: "standalone",
    orientation: "any",
    lang: "en",
    dir: "ltr",
    theme_color: options.brandColor || "#0b0e14",
    background_color: "#0b0e14",
    categories: ["finance", "business"],
    prefer_related_applications: false,
    icons,
    shortcuts: [
      {
        name: "Dashboard",
        short_name: "Dashboard",
        description: `Open ${options.company} dashboard`,
        url: `${origin}/app/dashboard`,
        icons: [{ src: shortcutIcon, sizes: "192x192", type: "image/png" }]
      },
      {
        name: "Field agent",
        short_name: "Agent",
        description: `Open ${options.company} field agent workspace`,
        url: `${origin}/app/agent/home`,
        icons: [{ src: shortcutIcon, sizes: "192x192", type: "image/png" }]
      }
    ]
  };

  if (token !== manifestBuildToken) {
    return;
  }

  const nextBlobUrl = URL.createObjectURL(
    new Blob([JSON.stringify(manifest)], { type: "application/manifest+json" })
  );
  const prevBlobUrl = activeBlobManifestUrl;
  activeBlobManifestUrl = nextBlobUrl;
  activeManifestSignature = options.signature;

  setManifestLink(nextBlobUrl);

  if (prevBlobUrl) {
    window.setTimeout(() => URL.revokeObjectURL(prevBlobUrl), 5_000);
  }
}

/**
 * Bootstraps company branding & PWA manifest immediately at app startup from cached
 * company host/workspace metadata so Chrome/Safari sees the company name and logo
 * immediately without flashing `aabanker`.
 */
export function bootstrapDocumentBrandingFromCache(apiBaseUrl?: string): void {
  if (typeof window === "undefined") {
    return;
  }
  const hostSub = parseTenantSubdomain(window.location.hostname);
  if (hostSub) {
    const cachedHost = readCachedCompanyHost(hostSub);
    if (cachedHost?.name) {
      applyDocumentBranding({
        companyName: cachedHost.name,
        logoUrl: cachedHost.logoUrl,
        brandColor: cachedHost.brandColor,
        subdomain: hostSub,
        apiBaseUrl
      });
    }
    return;
  }

  const active = readActiveBrandCache();
  if (active?.name) {
    applyDocumentBranding({
      companyName: active.name,
      logoUrl: active.logoUrl,
      brandColor: active.brandColor,
      subdomain: active.subdomain,
      apiBaseUrl
    });
  }
}

/**
 * Updates browser tab title, favicon, apple-touch-icon, app-name meta tags,
 * and dynamic PWA manifest so installing the app mimics the company's name & logo
 * on both tenant subdomains and signed-in root-domain company workspaces.
 */
export function applyDocumentBranding(options: DocumentBrandingOptions): void {
  if (typeof document === "undefined") {
    return;
  }
  const company = options.companyName?.trim();
  const logo = options.logoUrl?.trim();
  const brandColor = options.brandColor?.trim();
  const sub = options.subdomain?.trim().toLowerCase() || undefined;

  if (company) {
    document.title = options.pagePrefix ? `${options.pagePrefix} · ${company}` : company;
    setMetaContent("application-name", company);
    setMetaContent("apple-mobile-web-app-title", deriveShortName(company));
    setMetaContent("description", `${company} — Staff & Operations Portal`);
    if (brandColor) {
      setMetaContent("theme-color", brandColor);
    }

    writeActiveBrandCache({
      name: company,
      subdomain: sub,
      logoUrl: logo,
      brandColor
    });

    if (logo) {
      setLinkHref('link[rel="icon"], link[rel="shortcut icon"]', logo);
      setLinkHref('link[rel="apple-touch-icon"]', logo);
    }

    const signature = `${sub ?? "root"}|${company}|${brandColor ?? ""}|${logo ?? ""}`;
    if (signature !== activeManifestSignature) {
      void applyCompanyManifestAndIcons({
        company,
        logo,
        brandColor,
        subdomain: sub,
        apiBaseUrl: options.apiBaseUrl,
        signature
      });
    }
    return;
  }

  // No company context (platform admin or generic aabanker landing page)
  document.title = options.pagePrefix ? `${options.pagePrefix} · ${DEFAULT_APP_NAME}` : DEFAULT_TITLE;
  setMetaContent("application-name", DEFAULT_APP_NAME);
  setMetaContent("apple-mobile-web-app-title", DEFAULT_APP_NAME);
  setMetaContent("description", DEFAULT_DESCRIPTION);
  setLinkHref('link[rel="icon"][sizes="32x32"]', "/favicon-32.png");
  setLinkHref('link[rel="icon"][sizes="48x48"]', "/favicon-48.png");
  setLinkHref('link[rel="icon"]:not([sizes]), link[rel="shortcut icon"]', DEFAULT_FAVICON);
  setLinkHref('link[rel="apple-touch-icon"]', DEFAULT_APPLE_ICON);

  writeActiveBrandCache(null);

  if (activeManifestSignature !== "default") {
    manifestBuildToken += 1;
    activeManifestSignature = "default";
    if (activeBlobManifestUrl) {
      const prev = activeBlobManifestUrl;
      activeBlobManifestUrl = null;
      window.setTimeout(() => URL.revokeObjectURL(prev), 5_000);
    }
    setManifestLink(DEFAULT_MANIFEST);
  }
}

export function resetDocumentBranding(): void {
  applyDocumentBranding({});
}
