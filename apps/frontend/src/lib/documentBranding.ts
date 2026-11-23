const DEFAULT_TITLE = "aabanker — Banking Management System";
const DEFAULT_APP_NAME = "aabanker";
const DEFAULT_FAVICON = "/favicon.png";
const DEFAULT_APPLE_ICON = "/icons/icon-180.png";
const DEFAULT_MANIFEST = "/manifest.webmanifest";

export type DocumentBrandingOptions = {
  companyName?: string;
  pagePrefix?: string;
  logoUrl?: string;
  subdomain?: string | null;
  apiBaseUrl?: string;
};

function setMetaContent(name: string, content: string): void {
  const el = document.querySelector(`meta[name="${name}"]`);
  if (el) {
    el.setAttribute("content", content);
  }
}

function setLinkHref(selector: string, href: string): void {
  document.querySelectorAll<HTMLLinkElement>(selector).forEach((link) => {
    link.setAttribute("href", href);
  });
}

/**
 * Updates browser tab title, favicon, apple-touch-icon, app-name meta tags,
 * and dynamic PWA manifest link for white-labeled tenant workspaces/subdomains.
 */
export function applyDocumentBranding(options: DocumentBrandingOptions): void {
  if (typeof document === "undefined") {
    return;
  }
  const company = options.companyName?.trim();
  const logo = options.logoUrl?.trim();
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

  if (sub && options.apiBaseUrl) {
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    const manifestHref = `${options.apiBaseUrl}/api/v1/auth/manifest.webmanifest?subdomain=${encodeURIComponent(sub)}&origin=${encodeURIComponent(origin)}`;
    setLinkHref('link[rel="manifest"]', manifestHref);
  } else {
    setLinkHref('link[rel="manifest"]', DEFAULT_MANIFEST);
  }
}

export function resetDocumentBranding(): void {
  applyDocumentBranding({});
}
