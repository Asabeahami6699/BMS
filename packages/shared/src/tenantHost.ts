import { z } from "zod";

/** Company sites live at {name}.aabanker.com */
export const TENANT_ROOT_DOMAIN = "aabanker.com";

export const RESERVED_TENANT_SUBDOMAINS = [
  "www",
  "api",
  "admin",
  "app",
  "mail",
  "platform",
  "ns1",
  "ns2",
  "vercel",
  "ftp",
  "smtp"
] as const;

const SUBDOMAIN_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

const RESERVED = new Set<string>(RESERVED_TENANT_SUBDOMAINS);

export const tenantSubdomainSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(2, "Use at least 2 characters for the web address.")
  .max(63, "Web address is too long.")
  .regex(SUBDOMAIN_PATTERN, "Use letters, numbers, and hyphens only.")
  .refine((value) => !RESERVED.has(value), "That web address is reserved.");

export function isTenantSubdomain(value: string | null | undefined): boolean {
  return tenantSubdomainSchema.safeParse(value ?? "").success;
}

export function tenantSignInHost(subdomain: string): string {
  return `${subdomain.trim().toLowerCase()}.${TENANT_ROOT_DOMAIN}`;
}

/**
 * Company label from the browser host.
 * evanssusu.aabanker.com and evanssusu.localhost return "evanssusu".
 * The apex, www, and localhost itself return null so platform sign-in still works.
 */
export function parseTenantSubdomain(hostname: string | null | undefined): string | null {
  const host = (hostname ?? "").split(":")[0].trim().toLowerCase().replace(/\.$/, "");
  if (!host) {
    return null;
  }
  const suffixes = [TENANT_ROOT_DOMAIN, "localhost"];
  for (const suffix of suffixes) {
    if (host === suffix || host === `www.${suffix}`) {
      return null;
    }
    const marker = `.${suffix}`;
    if (!host.endsWith(marker)) {
      continue;
    }
    const label = host.slice(0, -marker.length);
    if (!label || label.includes(".")) {
      return null;
    }
    return isTenantSubdomain(label) ? label : null;
  }
  return null;
}
