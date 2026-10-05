// Number, money and date formatting. Everything goes through Intl so it respects the user's locale.

import type { UnitTotal } from "./valuation";

let activeLocale = "en-US";

export function setFormatLocale(locale: string) {
  try {
    new Intl.NumberFormat(locale);
    activeLocale = locale;
  } catch {
    activeLocale = "en-US";
  }
}

const cache = new Map<string, Intl.NumberFormat>();
function nf(key: string, options: Intl.NumberFormatOptions): Intl.NumberFormat {
  const k = `${activeLocale}|${key}`;
  let f = cache.get(k);
  if (!f) {
    f = new Intl.NumberFormat(activeLocale, options);
    cache.set(k, f);
  }
  return f;
}

/** Money at or above this (either sign) is shown without decimals. */
export const WHOLE_MONEY_FROM = 100_000;

export function formatMoney(
  amount: number | null | undefined,
  currency: string,
  opts: { compact?: boolean; signed?: boolean; decimals?: number } = {},
): string {
  if (amount === null || amount === undefined || !Number.isFinite(amount)) return "—";
  const decimals = !opts.compact && Math.abs(amount) >= WHOLE_MONEY_FROM ? 0 : (opts.decimals ?? 2);
  const key = `money|${currency}|${opts.compact ? "c" : ""}|${opts.signed ? "s" : ""}|${opts.compact ? (opts.decimals ?? "default") : decimals}`;
  try {
    return nf(key, {
      style: "currency",
      currency,
      // "symbol" keeps currencies distinct: $ (USD), A$ (AUD), EGP; narrow symbols would show AUD as plain $
      currencyDisplay: "symbol",
      notation: opts.compact ? "compact" : "standard",
      minimumFractionDigits: opts.compact ? (opts.decimals ?? 0) : decimals,
      maximumFractionDigits: opts.compact ? (opts.decimals ?? 1) : decimals,
      signDisplay: opts.signed ? "exceptZero" : "auto",
    }).format(amount);
  } catch {
    return `${formatNumber(amount, decimals)} ${currency}`;
  }
}

export function formatNumber(value: number | null | undefined, maxDecimals = 2, minDecimals = 0): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return nf(`num|${maxDecimals}|${minDecimals}`, {
    maximumFractionDigits: maxDecimals,
    minimumFractionDigits: minDecimals,
  }).format(value);
}

/** A short number for chart axes: 1.2K, 736K, 1.5M. */
export function formatCompactNumber(value: number): string {
  if (!Number.isFinite(value)) return "—";
  return nf("compact", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

export function formatPercent(value: number | null | undefined, opts: { signed?: boolean; decimals?: number } = {}): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const decimals = opts.decimals ?? 1;
  return nf(`pct|${opts.signed ? "s" : ""}|${decimals}`, {
    style: "percent",
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
    signDisplay: opts.signed ? "exceptZero" : "auto",
  }).format(value);
}

export function formatGrams(grams: number | null | undefined): string {
  if (grams === null || grams === undefined || !Number.isFinite(grams)) return "— g";
  return `${formatNumber(grams, 3)} g`;
}

export function formatQuantity(kind: "gold" | "stock" | "other", quantity: number): string {
  if (kind === "gold") return formatGrams(quantity);
  if (kind === "stock") return `${formatNumber(quantity, 4)} ${quantity === 1 ? "share" : "shares"}`;
  return `${formatNumber(quantity, 4)} ${quantity === 1 ? "unit" : "units"}`;
}

/** A group's unit total: "24k 45.5 g" for gold, the amount in its own currency otherwise. */
export function formatUnitTotal(total: UnitTotal): string {
  return total.unit === "gold" ? `${total.karat}k ${formatGrams(total.grams)}` : formatMoney(total.amount, total.currency);
}

export function formatDate(value: string | Date, opts: Intl.DateTimeFormatOptions = { dateStyle: "medium" }): string {
  const d = typeof value === "string" ? parseDateish(value) : value;
  return new Intl.DateTimeFormat(activeLocale, opts).format(d);
}

export function formatDateTime(value: string | Date, timeZone?: string): string {
  const d = typeof value === "string" ? new Date(value) : value;
  return new Intl.DateTimeFormat(activeLocale, { dateStyle: "medium", timeStyle: "short", timeZone }).format(d);
}

export function formatTime(value: string | Date, timeZone?: string): string {
  const d = typeof value === "string" ? new Date(value) : value;
  return new Intl.DateTimeFormat(activeLocale, { timeStyle: "short", timeZone }).format(d);
}

/** "just now", "12 min ago", "3 h ago", "2 days ago" */
export function formatAge(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "never";
  const minutes = Math.max(0, Math.round((now - Date.parse(iso)) / 60000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.round(hours / 24)} days ago`;
}

/** Plain dates ("2026-09-28") are calendar days, not instants; parse them at local midnight. */
function parseDateish(value: string): Date {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [y, m, d] = value.split("-").map(Number);
    return new Date(y, m - 1, d);
  }
  return new Date(value);
}

/** Today's calendar date (YYYY-MM-DD) in a time zone. */
export function todayIn(timeZone: string, now = new Date()): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  } catch {
    return new Intl.DateTimeFormat("en-CA").format(now);
  }
}

/** Whole days from `from` to `to` (both YYYY-MM-DD). */
export function daysBetween(from: string, to: string): number {
  return Math.round((utcMidnight(to) - utcMidnight(from)) / 86400000);
}

function utcMidnight(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return t.toISOString().slice(0, 10);
}
