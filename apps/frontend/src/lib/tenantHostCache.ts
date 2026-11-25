export type CachedCompanyHost = {
  name: string;
  subdomain: string;
  logoUrl?: string;
  brandColor?: string;
  cachedAt: number;
};

const STORAGE_PREFIX = "bms.hostBrand.v1.";

function storageKey(subdomain: string): string {
  return `${STORAGE_PREFIX}${subdomain.trim().toLowerCase()}`;
}

export function readCachedCompanyHost(subdomain: string | null | undefined): CachedCompanyHost | null {
  if (!subdomain || typeof window === "undefined") {
    return null;
  }
  try {
    const raw = window.localStorage.getItem(storageKey(subdomain));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CachedCompanyHost>;
    if (!parsed || typeof parsed.name !== "string" || !parsed.name.trim()) {
      return null;
    }
    return {
      name: parsed.name.trim(),
      subdomain: (parsed.subdomain ?? subdomain).trim().toLowerCase(),
      logoUrl: typeof parsed.logoUrl === "string" && parsed.logoUrl.trim() ? parsed.logoUrl : undefined,
      brandColor:
        typeof parsed.brandColor === "string" && parsed.brandColor.trim() ? parsed.brandColor : undefined,
      cachedAt: typeof parsed.cachedAt === "number" ? parsed.cachedAt : Date.now()
    };
  } catch {
    return null;
  }
}

export function writeCachedCompanyHost(
  subdomain: string | null | undefined,
  data: { name: string; logoUrl?: string; brandColor?: string }
): void {
  if (!subdomain || !data.name.trim() || typeof window === "undefined") {
    return;
  }
  const cleanSub = subdomain.trim().toLowerCase();
  const payload: CachedCompanyHost = {
    name: data.name.trim(),
    subdomain: cleanSub,
    logoUrl: data.logoUrl?.trim() || undefined,
    brandColor: data.brandColor?.trim() || undefined,
    cachedAt: Date.now()
  };
  try {
    window.localStorage.setItem(storageKey(cleanSub), JSON.stringify(payload));
  } catch {
    // Fallback without large base64 logo if localStorage quota is tight
    try {
      window.localStorage.setItem(
        storageKey(cleanSub),
        JSON.stringify({ ...payload, logoUrl: undefined })
      );
    } catch {
      /* ignore storage errors */
    }
  }
}

export function clearCachedCompanyHost(subdomain: string | null | undefined): void {
  if (!subdomain || typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.removeItem(storageKey(subdomain));
  } catch {
    /* ignore */
  }
}
