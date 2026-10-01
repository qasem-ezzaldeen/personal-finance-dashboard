import type { Asset, AssetGroup, MarketPrice, PricingSettings, Profile, Purchase, VaultData } from "@/lib/types";

const NOW = "2026-09-30T10:00:00.000Z";

export function price(symbol: string, value: number, kind: MarketPrice["kind"], previous: number | null = null): MarketPrice {
  return {
    symbol,
    kind,
    price: value,
    previous_price: previous,
    currency: "USD",
    display_name: null,
    source: "test",
    fetched_at: NOW,
    changed_at: NOW,
  };
}

export const MARKET: MarketPrice[] = [
  price("FX:EGP", 50, "fx", 49),
  price("FX:AUD", 1.5, "fx"),
  price("METAL:XAU", 3110.34768, "metal", 3000), // exactly $100 per gram
  price("STOCK:SPUS", 60, "stock", 55),
  price("STOCK:AAPL", 200, "stock"),
];

export const PRICING: PricingSettings = {
  user_id: "u1",
  gold_mode: "live",
  manual_gold_24k_price: null,
  manual_gold_currency: "EGP",
  gold_premium_pct: 0,
  gold_21k_adjustment: -30,
  gold_24k_adjustment: 30,
  gold_adjustment_currency: "EGP",
};

export const PROFILE: Profile = {
  user_id: "u1",
  display_name: "tester",
  timezone: "Africa/Cairo",
  avatar_color: "lilac",
  vault_name: "My Vault",
  base_currency: "EGP",
  display_currencies: ["USD"],
  income_currency: "USD",
  number_locale: "en-US",
  zakat_enabled: true,
  animation_speed: "normal",
  theme: "light",
  color_palette: "pastel",
  imported_at: null,
  created_at: NOW,
  updated_at: NOW,
};

export const GROUPS: AssetGroup[] = [
  { user_id: "u1", kind: "cash", name: "Cash", color: "sky", sort_order: 0 },
  { user_id: "u1", kind: "gold", name: "Gold", color: "butter", sort_order: 1 },
  { user_id: "u1", kind: "stock", name: "Stocks & ETFs", color: "lavender", sort_order: 2 },
  { user_id: "u1", kind: "other", name: "Other", color: "peach", sort_order: 3 },
];

let seq = 0;
export function asset(partial: Partial<Asset> & Pick<Asset, "kind" | "name">): Asset {
  seq += 1;
  return {
    id: partial.id ?? `asset-${seq}`,
    user_id: "u1",
    currency: null,
    karat: null,
    ticker: null,
    manual_unit_price: null,
    balance: 0,
    color: "mint",
    note: "",
    sort_order: seq,
    hide_when_empty: false,
    archived_at: null,
    created_at: NOW,
    ...partial,
  };
}

export function purchase(partial: Partial<Purchase> & Pick<Purchase, "asset_id" | "quantity">): Purchase {
  seq += 1;
  return {
    id: `purchase-${seq}`,
    user_id: "u1",
    cost_total: null,
    cost_currency: null,
    acquired_on: "2026-09-28",
    note: "",
    is_opening_balance: false,
    cost_is_estimated: false,
    cost_estimate_attempted_at: null,
    created_at: NOW,
    ...partial,
  };
}

export function vault(partial: Partial<VaultData> = {}): VaultData {
  return {
    profile: PROFILE,
    pricing: PRICING,
    groups: GROUPS,
    assets: [],
    purchases: [],
    goals: [],
    hawl: { user_id: "u1", hawl_start_date: null, last_checked_on: null, start_wealth: null, start_wealth_currency: null, is_first_hawl: false },
    zakatPayments: [],
    rules: [],
    followed: [],
    overrides: [],
    ...partial,
  };
}
