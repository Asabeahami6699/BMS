import { FONT_SIZE_STEP_MAX, FONT_SIZE_STEP_PX } from "@bms/shared";

export const FONT_SIZE_OPTIONS = [
  { step: 0, label: "Default" },
  { step: 1, label: "Larger" },
  { step: 2, label: "Larger still" },
  { step: 3, label: "Largest" }
] as const;

export function clampFontSizeStep(step: number | undefined): number {
  if (step == null || !Number.isInteger(step) || step < 0 || step > FONT_SIZE_STEP_MAX) {
    return 0;
  }
  return step;
}

/** Applies a company font step on the page. Step 0 leaves the current size unchanged. */
export function applyTenantFontStep(step: number | undefined): void {
  const px = clampFontSizeStep(step) * FONT_SIZE_STEP_PX;
  document.documentElement.style.setProperty("--font-step", `${px}px`);
}
