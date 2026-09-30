import { useSyncExternalStore } from "react";
import type { AnimationSpeed } from "./types";

// The chosen speed lives on <html data-motion="…"> (styles in src/styles/motion.css) and is
// remembered per device so the first paint already uses it, before the profile loads.
const STORAGE_KEY = "aura.motion";
const SCALES: Record<Exclude<AnimationSpeed, "system">, number> = { off: 0, fast: 0.55, normal: 1, slow: 1.6 };
const listeners = new Set<() => void>();

function stored(): AnimationSpeed {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === "off" || v === "slow" || v === "normal" || v === "fast" || v === "system" ? v : "system";
  } catch {
    return "system";
  }
}

/** Applies a speed to the page immediately. */
export function applyMotion(speed: AnimationSpeed) {
  if (document.documentElement.dataset.motion === speed) return;
  document.documentElement.dataset.motion = speed;
  try {
    localStorage.setItem(STORAGE_KEY, speed);
  } catch {
    // not remembered on this device; still applied
  }
  listeners.forEach((l) => l());
}

export function initMotion() {
  document.documentElement.dataset.motion = stored();
  window.matchMedia?.("(prefers-reduced-motion: reduce)").addEventListener?.("change", () => listeners.forEach((l) => l()));
}

/** Current multiplier for JS-driven motion (0 = no animation). */
export function motionScale(): number {
  const speed = (document.documentElement.dataset.motion ?? "system") as AnimationSpeed;
  if (speed === "system") return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? 0 : 1;
  return SCALES[speed];
}

export function useMotionScale(): number {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    motionScale,
  );
}
