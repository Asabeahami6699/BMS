import type { InvestmentRecord } from "@bms/shared";

function imageFromSnapshot(snapshot: Record<string, unknown>, key: string): string | undefined {
  const value = snapshot[key];
  if (typeof value !== "string") {
    return undefined;
  }
  if (value.startsWith("data:image")) {
    return value;
  }
  if (value.startsWith("http://") || value.startsWith("https://") || value.startsWith("blob:")) {
    return value;
  }
  return undefined;
}

export function resolveInvestmentPortraitUrl(investment: InvestmentRecord): string | undefined {
  const snapshot = investment.customerSnapshot;
  return (
    imageFromSnapshot(snapshot, "passportPhoto") ??
    investment.attachments.find((a) => a.kind === "passport_photo")?.contentUrl
  );
}

export function resolveInvestmentIdPhotoUrl(investment: InvestmentRecord): string | undefined {
  const snapshot = investment.customerSnapshot;
  return (
    imageFromSnapshot(snapshot, "idPhoto") ??
    imageFromSnapshot(snapshot, "nationalIdPhoto") ??
    investment.attachments.find((a) => a.kind === "national_id")?.contentUrl
  );
}

async function urlToDataUrl(url: string): Promise<string> {
  if (url.startsWith("data:")) {
    return url;
  }
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error("Could not load customer photo.");
  }
  const blob = await response.blob();
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Could not encode customer photo."));
    reader.readAsDataURL(blob);
  });
}

/** Ensures image URLs are embeddable data URLs for offline HTML/PDF export. */
export async function embedInvestmentImages(investment: InvestmentRecord): Promise<{
  portraitUrl?: string;
  idPhotoUrl?: string;
}> {
  const portraitRaw = resolveInvestmentPortraitUrl(investment);
  const idPhotoRaw = resolveInvestmentIdPhotoUrl(investment);
  const [portraitUrl, idPhotoUrl] = await Promise.all([
    portraitRaw ? urlToDataUrl(portraitRaw).catch(() => undefined) : Promise.resolve(undefined),
    idPhotoRaw ? urlToDataUrl(idPhotoRaw).catch(() => undefined) : Promise.resolve(undefined)
  ]);
  return { portraitUrl, idPhotoUrl };
}
