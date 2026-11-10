/** Account-style amount: 11,500.00 (always 2 decimal places, en-GH grouping). */
export function formatAccountAmount(amount: number | string | null | undefined): string {
  const n = typeof amount === "number" ? amount : Number(amount);
  if (!Number.isFinite(n)) {
    return "0.00";
  }
  return n.toLocaleString("en-GH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

/** Prefixed display: GHS 11,500.00 */
export function formatGhs(amount: number | string | null | undefined): string {
  return `GHS ${formatAccountAmount(amount)}`;
}
