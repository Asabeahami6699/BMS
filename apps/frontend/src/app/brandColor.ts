import type { CSSProperties } from "react";

type Rgb = { r: number; g: number; b: number };

function parseHex(hex: string): Rgb | null {
  const match = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) {
    return null;
  }
  const value = Number.parseInt(match[1], 16);
  return { r: (value >> 16) & 255, g: (value >> 8) & 255, b: value & 255 };
}

function channel(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

function luminance(rgb: Rgb): number {
  return 0.2126 * channel(rgb.r) + 0.7152 * channel(rgb.g) + 0.0722 * channel(rgb.b);
}

function mix(from: number, to: number, amount: number): number {
  return Math.round(from + (to - from) * amount);
}

function toHex(rgb: Rgb): string {
  return `#${[rgb.r, rgb.g, rgb.b].map((n) => n.toString(16).padStart(2, "0")).join("")}`;
}

function shift(rgb: Rgb, toward: number, amount: number): Rgb {
  return {
    r: mix(rgb.r, toward, amount),
    g: mix(rgb.g, toward, amount),
    b: mix(rgb.b, toward, amount)
  };
}

/** Brand fills stay the chosen color. Hover, text, and tints stay readable against it. */
export function brandColorStyle(hex: string): CSSProperties | undefined {
  const rgb = parseHex(hex);
  if (!rgb) {
    return undefined;
  }
  const light = luminance(rgb);
  const hover = shift(rgb, light > 0.42 ? 0 : 255, light > 0.42 ? 0.34 : 0.28);
  const ink = light > 0.45 ? shift(rgb, 0, 0.72) : shift(rgb, 255, 0.55);
  const onPrimary = light > 0.62 ? "#0f172a" : "#ffffff";
  return {
    "--primary": toHex(rgb),
    "--primary-hover": toHex(hover),
    "--primary-ink": toHex(ink),
    "--primary-soft": `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.16)`,
    "--on-primary": onPrimary
  } as CSSProperties;
}
