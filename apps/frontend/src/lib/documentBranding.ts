const DEFAULT_TITLE = "aabanker — Banking Management System";
const DEFAULT_APP_NAME = "aabanker";
const DEFAULT_FAVICON = "/favicon.png";
const DEFAULT_APPLE_ICON = "/icons/icon-180.png";
const DEFAULT_MANIFEST = "/manifest.webmanifest";

export type DocumentBrandingOptions = {
  companyName?: string;
  pagePrefix?: string;
  logoUrl?: string;
  brandColor?: string;
  subdomain?: string | null;
  apiBaseUrl?: string;
};

let activeManifestSignature = "";
let activeBlobManifestUrl: string | null = null;
let manifestBuildToken = 0;

function setMetaContent(name: string, content: string): void {
  const el = document.querySelector(`meta[name="${name}"]`);
  if (el && el.getAttribute("content") !== content) {
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
 * Renders an arbitrary company logo into an exact square PNG data URL so Chrome's
 * PWA installability validator always sees valid square 192x192 / 512x512 icons.
 */
function renderSquarePngIcon(logoUrl: string, size: number): Promise<string | null> {
  return new Promise((resolve) => {
    if (typeof document === "undefined") {
      resolve(null);
      return;
    }
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          resolve(null);
          return;
        }
        ctx.clearRect(0, 0, size, size);
        const pad = Math.round(size * 0.08);
        const box = size - pad * 2;
        const scale = Math.min(box / Math.max(1, img.naturalWidth), box / Math.max(1, img.naturalHeight));
        const w = Math.round(img.naturalWidth * scale);
        const h = Math.round(img.naturalHeight * scale);
        const x = Math.round((size - w) / 2);
        const y = Math.round((size - h) / 2);
        ctx.drawImage(img, x, y, w, h);
        resolve(canvas.toDataURL("image/png"));
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = logoUrl;
  });
}

async function applyTenantBlobManifest(options: {
  company: string;
  logo?: string;
  brandColor?: string;
  signature: string;
}): Promise<void> {
  if (typeof window === "undefined" || typeof Blob === "undefined" || typeof URL === "undefined") {
    return;
  }
  const token = ++manifestBuildToken;
  const origin = window.location.origin;

  const icons: Array<{ src: string; sizes: string; type: string; purpose?: string }> = [];

  if (options.logo) {
    const [png192, png512] = await Promise.all([
      renderSquarePngIcon(options.logo, 192),
      renderSquarePngIcon(options.logo, 512)
    ]);
    if (token !== manifestBuildToken) {
      return;
    }
    if (png192) {
      icons.push({ src: png192, sizes: "192x192", type: "image/png", purpose: "any" });
    }
    if (png512) {
      icons.push({ src: png512, sizes: "512x512", type: "image/png", purpose: "any" });
    }
  }

  // Always include guaranteed-valid same-origin HTTPS PNG icons so Chrome Desktop &
  // Android WebAPK installability never fail or vanish after branding hydration.
  icons.push(
    { src: `${origin}/icons/icon-192.png`, sizes: "192x192", type: "image/png", purpose: "any" },
    { src: `${origin}/icons/icon-512.png`, sizes: "512x512", type: "image/png", purpose: "any" },
    { src: `${origin}/icons/icon-512.png`, sizes: "512x512", type: "image/png", purpose: "maskable" }
  );

  const manifest = {
    id: `${origin}/`,
    name: options.company,
    short_name: options.company.slice(0, 16),
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
    icons
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

  setLinkHref('link[rel="manifest"]', nextBlobUrl);

  if (prevBlobUrl) {
    window.setTimeout(() => URL.revokeObjectURL(prevBlobUrl), 5_000);
  }
}

/**
 * Updates browser tab title, favicon, apple-touch-icon, app-name meta tags,
 * and same-origin dynamic PWA manifest for white-labeled tenant workspaces/subdomains.
 *
 * Uses a same-origin Blob manifest (never a cross-origin API manifest URL) so Chrome's
 * install prompt and address-bar Install icon remain permanently valid and never vanish.
 */
export function applyDocumentBranding(options: DocumentBrandingOptions): void {
  if (typeof document === "undefined") {
    return;
  }
  const company = options.companyName?.trim();
  const logo = options.logoUrl?.trim();
  const brandColor = options.brandColor?.trim();
  const sub = options.subdomain?.trim().toLowerCase();

  if (company) {
    document.title = options.pagePrefix ? `${options.pagePrefix} · ${company}` : company;
    setMetaContent("application-name", company);
    setMetaContent("apple-mobile-web-app-title", company);
  } else {
    document.title = options.pagePrefix ? `${options.pagePrefix} · ${DEFAULT_APP_NAME}` : DEFAULT_TITLE;
    setMetaContent("application-name", DEFAULT_APP_NAME);
    setMetaContent("apple-mobile-web-app-title", DEFAULT_APP_NAME);
  }

  if (logo) {
    setLinkHref('link[rel="icon"], link[rel="shortcut icon"]', logo);
    setLinkHref('link[rel="apple-touch-icon"]', logo);
  } else {
    setLinkHref('link[rel="icon"][sizes="32x32"]', "/favicon-32.png");
    setLinkHref('link[rel="icon"][sizes="48x48"]', "/favicon-48.png");
    setLinkHref('link[rel="icon"]:not([sizes]), link[rel="shortcut icon"]', DEFAULT_FAVICON);
    setLinkHref('link[rel="apple-touch-icon"]', DEFAULT_APPLE_ICON);
  }

  if (sub && company) {
    const signature = `${sub}|${company}|${brandColor ?? ""}|${logo ?? ""}`;
    if (signature !== activeManifestSignature) {
      void applyTenantBlobManifest({ company, logo, brandColor, signature });
    }
  } else if (!sub) {
    if (activeManifestSignature !== "default") {
      manifestBuildToken += 1;
      activeManifestSignature = "default";
      if (activeBlobManifestUrl) {
        const prev = activeBlobManifestUrl;
        activeBlobManifestUrl = null;
        window.setTimeout(() => URL.revokeObjectURL(prev), 5_000);
      }
      setLinkHref('link[rel="manifest"]', DEFAULT_MANIFEST);
    }
  }
}

export function resetDocumentBranding(): void {
  applyDocumentBranding({});
}
