import { useCallback, useSyncExternalStore } from "react";

// Which groups/assets are collapsed is remembered per device (a convenience, not financial data).
const STORAGE_KEY = "aura.expanded";
const listeners = new Set<() => void>();
let snapshot: string = read();

function read(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? "[]";
  } catch {
    return "[]";
  }
}

function write(keys: string[]) {
  snapshot = JSON.stringify(keys);
  try {
    localStorage.setItem(STORAGE_KEY, snapshot);
  } catch {
    // storage unavailable: state still works for this session
  }
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Opens an item from elsewhere (e.g. tapping a donut slice). */
export function expandItem(key: string, defaultExpanded = false) {
  const current = new Set<string>(JSON.parse(snapshot) as string[]);
  current.delete(`-${key}`);
  if (!defaultExpanded) current.add(`+${key}`);
  write([...current]);
}

/** Returns [isExpanded, toggle]. Items start collapsed unless `defaultExpanded`. */
export function useExpanded(key: string, defaultExpanded = false): [boolean, () => void] {
  const raw = useSyncExternalStore(subscribe, () => snapshot);
  const set = new Set<string>(JSON.parse(raw) as string[]);
  const expanded = set.has(`+${key}`) || (defaultExpanded && !set.has(`-${key}`));
  const toggle = useCallback(() => {
    const current = new Set<string>(JSON.parse(snapshot) as string[]);
    const wasExpanded = current.has(`+${key}`) || (defaultExpanded && !current.has(`-${key}`));
    current.delete(`+${key}`);
    current.delete(`-${key}`);
    // Only store a marker when the state differs from the default
    const next = !wasExpanded;
    if (next !== defaultExpanded) current.add(next ? `+${key}` : `-${key}`);
    write([...current]);
  }, [key, defaultExpanded]);
  return [expanded, toggle];
}
