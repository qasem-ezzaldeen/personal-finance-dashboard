import { useSyncExternalStore } from "react";
import type { ThemeChoice } from "./types";

// The active palette lives on <html data-theme="light|dark"> (colors in src/styles/colors.css).
// The choice is remembered per device so the first screen is already in the right theme.
const STORAGE_KEY = "aura.theme";
const listeners = new Set<() => void>();
let choice: ThemeChoice = "light";

const darkQuery = () => window.matchMedia?.("(prefers-color-scheme: dark)");

function stored(): ThemeChoice {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === "light" || v === "dark" || v === "system" ? v : "light";
  } catch {
    return "light";
  }
}

function resolve(c: ThemeChoice): "light" | "dark" {
  if (c === "system") return darkQuery()?.matches ? "dark" : "light";
  return c;
}

function render() {
  const theme = resolve(choice);
  document.documentElement.dataset.theme = theme;
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

export function initTheme() {
  choice = stored();
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
