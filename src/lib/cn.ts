import { clsx, type ClassValue } from "clsx";

export function cn(...inputs: ClassValue[]): string {
  return clsx(inputs);
}

/** Text color for an amount that went up (green), down (red) or nowhere. */
export function signTone(amount: number): string {
  return amount > 0.005 ? "text-gain-ink" : amount < -0.005 ? "text-loss-ink" : "text-ink";
}

/** Resolves a stored color (swatch token name or #hex) to a CSS color value. */
export function colorValue(color: string | null | undefined): string {
  if (!color) return "var(--color-swatch-slate)";
  return color.startsWith("#") ? color : `var(--color-swatch-${color})`;
}

/** Resolves a stored color to a concrete value for places that can't use CSS variables (SVG attributes). */
export function resolvedColor(color: string | null | undefined): string {
  if (color?.startsWith("#")) return color;
  return swatchHex(color ?? "slate");
}

/** Reads a theme color's current value from colors.css, e.g. themeColor("pending"). */
export function themeColor(token: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(`--color-${token}`).trim();
  return value || "currentColor";
}

/** Reads a swatch's current hex value from colors.css (the native color input needs a hex string). */
export function swatchHex(name: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(`--color-swatch-${name}`).trim();
  return /^#[0-9a-f]{6}$/i.test(value) ? value : "#000000";
}

export const SWATCHES = [
  "sky",
  "butter",
  "lavender",
  "peach",
  "mint",
  "rose",
  "lilac",
  "teal",
  "coral",
  "sage",
  "sand",
  "slate",
] as const;
