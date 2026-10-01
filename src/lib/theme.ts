import { useSyncExternalStore } from "react";
import type { ColorPalette, ThemeChoice } from "./types";

// Light/dark lives on <html data-theme="light|dark"> and the color palette on <html data-palette="…">
// (colors in src/styles/colors.css). Both are remembered per device so the first screen already uses them.
const STORAGE_KEY = "aura.theme";
const PALETTE_KEY = "aura.palette";
export const PALETTE_IDS: readonly ColorPalette[] = ["pastel", "minimal", "sea", "autumn", "nature", "vivid"];
const listeners = new Set<() => void>();
let choice: ThemeChoice = "light";
let palette: ColorPalette = "pastel";

const darkQuery = () => window.matchMedia?.("(prefers-color-scheme: dark)");

function stored(): ThemeChoice {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === "light" || v === "dark" || v === "system" ? v : "light";
  } catch {
    return "light";
  }
}

function storedPalette(): ColorPalette {
  try {
    const v = localStorage.getItem(PALETTE_KEY);
    return PALETTE_IDS.includes(v as ColorPalette) ? (v as ColorPalette) : "pastel";
  } catch {
    return "pastel";
  }
}

function resolve(c: ThemeChoice): "light" | "dark" {
  if (c === "system") return darkQuery()?.matches ? "dark" : "light";
  return c;
}

function render() {
  const theme = resolve(choice);
  document.documentElement.dataset.theme = theme;
  // Pastel is the default colors; other palettes override them
  if (palette === "pastel") delete document.documentElement.dataset.palette;
  else document.documentElement.dataset.palette = palette;
  // The browser/phone status bar color follows the page background
  const canvas = getComputedStyle(document.documentElement).getPropertyValue("--color-canvas").trim();
  if (canvas) document.querySelector('meta[name="theme-color"]')?.setAttribute("content", canvas);
  listeners.forEach((l) => l());
}

export function applyTheme(next: ThemeChoice) {
  if (next === choice && document.documentElement.dataset.theme === resolve(next)) return;
  choice = next;
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // not remembered on this device; still applied
  }
  render();
}

export function applyPalette(next: ColorPalette) {
  if (next === palette) return;
  palette = next;
  try {
    localStorage.setItem(PALETTE_KEY, next);
  } catch {
    // not remembered on this device; still applied
  }
  render();
}

export function initTheme() {
  choice = stored();
  palette = storedPalette();
  render();
  darkQuery()?.addEventListener?.("change", () => {
    if (choice === "system") render();
  });
}

/** "light" or "dark": what's actually showing. */
export function useResolvedTheme(): "light" | "dark" {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => resolve(choice),
  );
}

/** The color palette that's showing (re-renders when it changes, e.g. for charts that read colors). */
export function usePalette(): ColorPalette {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => palette,
  );
}
