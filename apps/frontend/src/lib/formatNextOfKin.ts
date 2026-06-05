import type { NextOfKinDetails } from "@bms/shared";

export function formatNextOfKin(kin: NextOfKinDetails | undefined): string {
  if (!kin) {
    return "—";
  }
  const parts = [
    kin.fullName,
    kin.phone ? `Tel: ${kin.phone}` : null,
    kin.location,
    kin.houseNumber ? `House: ${kin.houseNumber}` : null
  ].filter(Boolean);
  return parts.join(" · ");
}
