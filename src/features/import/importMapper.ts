// Maps a vault from the previous AuraFinance (the JSON in public.dashboards.data) to the import payload.
// Pure and unit-tested; the database function import_previous_vault() writes the result atomically.

import { isValidTickerFormat, normalizeTicker } from "@shared/tickers";
import { addDays } from "@/lib/format";
import { GOLD_UNIT } from "@/lib/types";

// ---- The previous version's shapes (only the fields we read) --------------

export interface PreviousAsset {
  id?: string;
  name?: string;
  category?: string;
  holdings?: number | string;
  currency?: string;
  color?: string;
  ticker?: string;
  stockPrice?: number;
}

export interface PreviousVault {
  assets?: PreviousAsset[];
  usdSavings?: number;
  goldGrams?: number;
  upcomingIncome?: number | string;
  goldPremium?: number | string;
  isManualGold?: boolean;
  manualGold24kEgp?: number | string | null;
  manualSpusPrice?: number | string | null;
  followedStockKpis?: string[];
  lastResetMonth?: string;
  lastNsaveTransferMonth?: string;
  zakatConsecutiveDays?: number | string;
  goals?: Array<{ id?: string; name?: string; currency?: string; target?: number | string; emoji?: string }>;
  transactions?: Array<{
    id?: string;
    amountUsd?: number | string;
    amountEgp?: number | string;
    rateUsdEgp?: number | string;
    timestamp?: number | string;
    beforeIncome?: number | string;
    afterIncome?: number | string;
    description?: string;
  }>;
}

// ---- Import payload -------------------------------------------------------

export interface MappedAsset {
  ref: string;
  kind: "cash" | "gold" | "stock";
  name: string;
  currency: string | null;
  karat: 21 | 24 | null;
  ticker: string | null;
  color: string;
  sort_order: number;
  balance: number;
  quantity: number;
  hide_when_empty: boolean;
  /** The original record, for the preview */
  source: PreviousAsset | null;
}

export interface ImportPayload {
  profile: { base_currency: string; display_currencies: string[]; income_currency: string };
  pricing: { gold_mode: "live" | "manual"; manual_gold_24k_price: number | null; manual_gold_currency: string; gold_premium_pct: number };
  pending_balance: number;
  assets: MappedAsset[];
  goals: Array<{ name: string; emoji: string; target_amount: number; target_unit: string; include_upcoming: boolean; sort_order: number }>;
  transactions: Array<{
    occurred_at: string;
    description: string;
    amount: number;
    currency: string;
    rate_to_base: number | null;
    pending_before: number | null;
    pending_after: number | null;
    import_details: Record<string, unknown>;
  }>;
  followed_tickers: string[];
  price_overrides: Array<{ ticker: string; price: number; currency: string }>;
  hawl_start_date: string | null;
  automation_rules: Array<{
    name: string;
    day_of_month: number;
    amount_mode: "all";
    from_ref: string;
    to_ref: string;
    last_run_period: string | null;
  }>;
  zakat_enabled: boolean;
  warnings: string[];
}

const num = (v: unknown): number | null => {
  const n = typeof v === "string" ? Number.parseFloat(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? n : null;
};

const DEFAULT_COLORS = { cash: "sky", gold: "butter", stock: "lavender" } as const;
const PERIOD = /^\d{4}-\d{2}$/;

function isNamed(asset: PreviousAsset, key: string) {
  return asset.id === key || (asset.name ?? "").trim().toLowerCase() === key;
}

/** Converts a vault from the previous version. `today` is the owner's calendar date (YYYY-MM-DD). */
export function mapPreviousVault(data: PreviousVault, today: string): ImportPayload {
  const warnings: string[] = [];

  // The earliest version stored just two numbers, before "assets" existed
  const previousAssets: PreviousAsset[] = Array.isArray(data.assets)
    ? data.assets
    : [
        ...(num(data.usdSavings) ? [{ id: "qnb_bebasata", name: "QNB Bebasata", holdings: data.usdSavings, currency: "USD" }] : []),
        ...(num(data.goldGrams) ? [{ id: "gold", name: "Gold Savings (21k)", holdings: data.goldGrams, currency: "Gold (Grams)" }] : []),
      ];

  const assets: MappedAsset[] = [];
  previousAssets.forEach((a, i) => {
    const holdings = Math.max(0, num(a.holdings) ?? 0);
    const name = (a.name ?? "").trim().slice(0, 80) || `Asset ${i + 1}`;
    const color = /^#[0-9a-fA-F]{6}$/.test(a.color ?? "") ? a.color! : null;
    const base = { ref: `a${i}`, name, sort_order: i, source: a, hide_when_empty: isNamed(a, "paypal"), karat: null, ticker: null, currency: null, balance: 0, quantity: 0 };

    switch (a.currency) {
      case "USD":
      case "EGP":
      case "AUD":
        assets.push({ ...base, kind: "cash", currency: a.currency, balance: holdings, color: color ?? DEFAULT_COLORS.cash });
        break;
      case "Gold (Grams)":
        assets.push({ ...base, kind: "gold", karat: 21, quantity: holdings, color: color ?? DEFAULT_COLORS.gold });
        break;
      case "Gold 24k (Grams)":
        assets.push({ ...base, kind: "gold", karat: 24, quantity: holdings, color: color ?? DEFAULT_COLORS.gold });
        break;
      case "Stock": {
        const ticker = normalizeTicker(a.ticker || "SPUS");
        if (!isValidTickerFormat(ticker)) {
          warnings.push(`Skipped "${name}": "${a.ticker}" isn't a valid ticker.`);
          return;
        }
        if (a.ticker && ticker !== a.ticker.trim().toUpperCase()) {
          warnings.push(`"${name}" was saved as ${a.ticker.trim().toUpperCase()}; it now uses ${ticker}, so its value is correct.`);
        }
        assets.push({ ...base, kind: "stock", ticker, quantity: holdings, color: color ?? DEFAULT_COLORS.stock });
        break;
      }
      default:
        warnings.push(`Skipped "${name}": unknown holding type "${a.currency}".`);
    }
  });

  // The previous version's automations moved money through PayPal and nsave; keep those accounts so the rules work.
  const findRef = (key: string) => assets.find((m) => m.source && isNamed(m.source, key))?.ref;
  let paypalRef = findRef("paypal");
  if (!paypalRef) {
    paypalRef = "paypal";
    assets.push({ ref: paypalRef, kind: "cash", name: "PayPal", currency: "USD", karat: null, ticker: null, color: "#3b82f6", sort_order: assets.length, balance: 0, quantity: 0, hide_when_empty: true, source: null });
  }
  let nsaveRef = findRef("nsave");
  if (!nsaveRef) {
    nsaveRef = "nsave";
    assets.push({ ref: nsaveRef, kind: "cash", name: "nsave", currency: "USD", karat: null, ticker: null, color: "#ef4444", sort_order: assets.length, balance: 0, quantity: 0, hide_when_empty: false, source: null });
  }

  const goals = (data.goals ?? [])
    .filter((g) => g.id !== "goal_zakat" && g.id !== "goal_migration")
    .flatMap((g, i) => {
      const target = num(g.target);
      const unit = g.currency === "Gold" ? GOLD_UNIT : g.currency;
      if (!target || target <= 0 || !unit || (unit !== GOLD_UNIT && !/^[A-Z]{3}$/.test(unit))) {
        warnings.push(`Skipped goal "${g.name}": missing target or currency.`);
        return [];
      }
      return [{
        name: (g.name ?? "Goal").trim().slice(0, 60) || "Goal",
        emoji: (g.emoji ?? "🎯").slice(0, 16) || "🎯",
        target_amount: target,
        target_unit: unit,
        include_upcoming: unit !== GOLD_UNIT,
        sort_order: i + 1,
      }];
    });

  const transactions = (data.transactions ?? []).flatMap((t) => {
    const ts = num(t.timestamp);
    const amount = num(t.amountUsd);
    if (ts === null || amount === null) {
      warnings.push("Skipped a history entry without a date or amount.");
      return [];
    }
    return [{
      occurred_at: new Date(ts).toISOString(),
      description: (t.description ?? "").slice(0, 200),
      amount: Math.abs(amount),
      currency: "USD",
      rate_to_base: num(t.rateUsdEgp),
      pending_before: num(t.beforeIncome),
      pending_after: num(t.afterIncome),
      import_details: { id: t.id, amountUsd: amount, amountEgp: num(t.amountEgp), rateUsdEgp: num(t.rateUsdEgp) },
    }];
  });

  const followed = [...new Set((data.followedStockKpis ?? []).map(normalizeTicker))].filter(isValidTickerFormat);
  const manualSpus = num(data.manualSpusPrice);
  const manualGold = num(data.manualGold24kEgp);
  const streak = Math.floor(num(data.zakatConsecutiveDays) ?? 0);
  const hasAud = assets.some((a) => a.currency === "AUD") || goals.some((g) => g.target_unit === "AUD");

  return {
    profile: { base_currency: "EGP", display_currencies: hasAud ? ["USD", "AUD"] : ["USD"], income_currency: "USD" },
    pricing: {
      gold_mode: data.isManualGold && manualGold && manualGold > 0 ? "manual" : "live",
      manual_gold_24k_price: manualGold && manualGold > 0 ? manualGold : null,
      manual_gold_currency: "EGP",
      gold_premium_pct: num(data.goldPremium) ?? 2.5,
    },
    pending_balance: Math.max(0, num(data.upcomingIncome) ?? 0),
    assets,
    goals,
    transactions,
    followed_tickers: followed,
    price_overrides: manualSpus && manualSpus > 0 ? [{ ticker: "SPUS", price: manualSpus, currency: "USD" }] : [],
    hawl_start_date: streak > 0 ? addDays(today, -(streak - 1)) : null,
    automation_rules: [
      {
        name: "Payday sweep",
        day_of_month: 24,
        amount_mode: "all",
        from_ref: "pending",
        to_ref: paypalRef,
        last_run_period: PERIOD.test(data.lastResetMonth ?? "") ? data.lastResetMonth! : null,
      },
      {
        name: "PayPal consolidation",
        day_of_month: 1,
        amount_mode: "all",
        from_ref: paypalRef,
        to_ref: nsaveRef,
        last_run_period: PERIOD.test(data.lastNsaveTransferMonth ?? "") ? data.lastNsaveTransferMonth! : null,
      },
    ],
    zakat_enabled: true,
    warnings,
  };
}

/** Strips preview-only fields before sending the payload to the database. */
export function toDatabasePayload(payload: ImportPayload) {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { warnings, ...rest } = payload;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  return { ...rest, assets: payload.assets.map(({ source, ...asset }) => asset) };
}
