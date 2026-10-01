import { useSyncExternalStore } from "react";
import { ACCENT_TOKENS, accentColors, isHexColor } from "./accent";
import type { ColorPalette, ThemeChoice } from "./types";

// Light/dark lives on <html data-theme="light|dark"> and the color palette on <html data-palette="…">
// (colors in src/styles/colors.css). A palette's hero color, if one was picked, overrides its brand colors
// with inline variables on <html>. All of it is remembered per device so the first screen already uses it.
const STORAGE_KEY = "aura.theme";
const PALETTE_KEY = "aura.palette";
const ACCENTS_KEY = "aura.accents";
export const PALETTE_IDS: readonly ColorPalette[] = ["pastel", "minimal", "sea", "autumn", "nature", "oled"];
/** Palettes made for dark screens: the app is dark while one is chosen, whatever the theme setting */
export const DARK_ONLY_PALETTES: readonly ColorPalette[] = ["oled"];
export type PaletteAccents = Partial<Record<ColorPalette, string>>;

const listeners = new Set<() => void>();
let choice: ThemeChoice = "light";
let palette: ColorPalette = "pastel";
let accents: PaletteAccents = {};

const darkQuery = () => window.matchMedia?.("(prefers-color-scheme: dark)");

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function remember(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // not remembered on this device; still applied
  }
}

function toPalette(v: string | null): ColorPalette {
  if (v === "vivid") return "oled"; // renamed
  return PALETTE_IDS.includes(v as ColorPalette) ? (v as ColorPalette) : "pastel";
}

/** Only well-formed entries: a known palette and a #rrggbb color. */
export function cleanAccents(value: unknown): PaletteAccents {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).filter(
      ([k, v]) => PALETTE_IDS.includes(k as ColorPalette) && typeof v === "string" && isHexColor(v),
    ),
  ) as PaletteAccents;
}

function resolve(c: ThemeChoice): "light" | "dark" {
  if (DARK_ONLY_PALETTES.includes(palette)) return "dark";
  if (c === "system") return darkQuery()?.matches ? "dark" : "light";
  return c;
}

function render() {
  const root = document.documentElement;
  const theme = resolve(choice);
  root.dataset.theme = theme;
  // Pastel is the default colors; other palettes override them
  if (palette === "pastel") delete root.dataset.palette;
  else root.dataset.palette = palette;

  // Hero color: computed against this palette's own card color, so first clear any previous override
  for (const token of ACCENT_TOKENS) root.style.removeProperty(`--color-${token}`);
  const hero = accents[palette];
  if (hero) {
    const surface = getComputedStyle(root).getPropertyValue("--color-surface").trim() || (theme === "dark" ? "#1e1f28" : "#ffffff");
    for (const [token, value] of Object.entries(accentColors(hero, theme, surface))) root.style.setProperty(`--color-${token}`, value);
  }

  // The browser/phone status bar color follows the page background
  const canvas = getComputedStyle(root).getPropertyValue("--color-canvas").trim();
  if (canvas) document.querySelector('meta[name="theme-color"]')?.setAttribute("content", canvas);
  listeners.forEach((l) => l());
}

export function applyTheme(next: ThemeChoice) {
  if (next === choice && document.documentElement.dataset.theme === resolve(next)) return;
  choice = next;
  remember(STORAGE_KEY, next);
  render();
}

export function applyPalette(next: ColorPalette) {
  if (next === palette) return;
  palette = next;
  remember(PALETTE_KEY, next);
  render();
}

/** Hero colors per palette ({} = every palette uses its own). */
export function applyAccents(next: PaletteAccents) {
  const clean = cleanAccents(next);
  if (JSON.stringify(clean) === JSON.stringify(accents)) return;
  accents = clean;
  remember(ACCENTS_KEY, JSON.stringify(clean));
  render();
}

export function initTheme() {
  choice = toTheme(read(STORAGE_KEY));
  palette = toPalette(read(PALETTE_KEY));
  try {
    accents = cleanAccents(JSON.parse(read(ACCENTS_KEY) ?? "{}"));
  } catch {
    accents = {};
  }
  render();
  darkQuery()?.addEventListener?.("change", () => {
    if (choice === "system") render();
  });
}

function toTheme(v: string | null): ThemeChoice {
  return v === "light" || v === "dark" || v === "system" ? v : "light";
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

/** "light" or "dark": what's actually showing. */
export function useResolvedTheme(): "light" | "dark" {
  return useSyncExternalStore(subscribe, () => resolve(choice));
}

/** The color palette that's showing (re-renders when it changes, e.g. for charts that read colors). */
export function usePalette(): ColorPalette {
  return useSyncExternalStore(subscribe, () => palette);
}

/** The hero colors in use (re-renders when one changes). */
export function useAccents(): PaletteAccents {
  return useSyncExternalStore(subscribe, () => accents);
}
