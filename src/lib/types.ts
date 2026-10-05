// Row shapes of the Supabase tables (see supabase/migrations).

export type GroupKind = "cash" | "gold" | "stock" | "other";
export type AssetKind = GroupKind | "pending_income";

export type ThemeChoice = "light" | "dark" | "system";

export type ColorPalette = "pastel" | "minimal" | "sea" | "autumn" | "nature" | "oled";

export type AnimationSpeed = "system" | "off" | "slow" | "normal" | "fast";

/** What the dashboard's change KPI measures */
export type KpiMetric = "net_worth" | "investments" | "income" | "since_purchase";

/** A period ending today: since the 1st of the month, the last 7/30 days, 3 months, since 1 January, 12 months, or everything */
export type PeriodKey = "month" | "7d" | "30d" | "3m" | "ytd" | "1y" | "all";

export interface Profile {
  user_id: string;
  display_name: string;
  timezone: string;
  avatar_color: string;
  vault_name: string;
  base_currency: string;
  display_currencies: string[];
  income_currency: string;
  number_locale: string;
  zakat_enabled: boolean;
  animation_speed: AnimationSpeed;
  theme: ThemeChoice;
  color_palette: ColorPalette;
  /** Hero (accent) color picked per palette, e.g. { sea: "#0b5fa5" } */
  palette_accents: Partial<Record<ColorPalette, string>>;
  kpi_metric: KpiMetric;
  kpi_period: PeriodKey;
  /** Income months start this many days before the 1st (0–27), so pay logged in a month's last days counts toward the next */
  income_month_offset: number;
  imported_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface PricingSettings {
  user_id: string;
  gold_mode: "live" | "manual";
  manual_gold_24k_price: number | null;
  manual_gold_currency: string;
  gold_premium_pct: number;
  gold_21k_adjustment: number;
  gold_24k_adjustment: number;
  gold_adjustment_currency: string;
}

export interface AssetGroup {
  user_id: string;
  kind: GroupKind;
  name: string;
  color: string;
  sort_order: number;
}

export interface Asset {
  id: string;
  user_id: string;
  kind: AssetKind;
  name: string;
  currency: string | null;
  karat: 21 | 24 | null;
  ticker: string | null;
  manual_unit_price: number | null;
  balance: number;
  color: string;
  note: string;
  sort_order: number;
  hide_when_empty: boolean;
  archived_at: string | null;
  created_at: string;
}

export interface Purchase {
  id: string;
  user_id: string;
  asset_id: string;
  quantity: number;
  cost_total: number | null;
  cost_currency: string | null;
  acquired_on: string;
  note: string;
  is_opening_balance: boolean;
  /** True when the cost is the market price on acquired_on, filled in automatically */
  cost_is_estimated: boolean;
  cost_estimate_attempted_at: string | null;
  /** Set when bought with money from a cash account: deleting the purchase gives paid_amount back */
  paid_from_asset_id: string | null;
  paid_amount: number | null;
  paid_currency: string | null;
  /** The "buy" history entry (reverting it removes the purchase) */
  transaction_id: string | null;
  created_at: string;
}

export interface Sale {
  id: string;
  user_id: string;
  asset_id: string;
  quantity: number;
  /** What was received, in the cash account's currency */
  proceeds: number;
  proceeds_currency: string;
  sold_on: string;
  to_asset_id: string | null;
  transaction_id: string;
  note: string;
  created_at: string;
}

export type TransactionKind =
  | "income"
  | "transfer"
  | "automation"
  | "adjustment"
  | "imported"
  | "buy"
  | "sell"
  | "refund"
  | "sale_removed";

/** What a buy/sell/refund entry moved: how much of which kind of asset */
export interface TransactionDetails {
  quantity?: number;
  asset_kind?: "gold" | "stock" | "other";
  restore?: unknown;
}

export interface Transaction {
  id: string;
  seq: number;
  user_id: string;
  kind: TransactionKind;
  description: string;
  amount: number;
  currency: string;
  rate_to_base: number | null;
  base_currency: string | null;
  from_asset_id: string | null;
  from_asset_name: string | null;
  to_asset_id: string | null;
  to_asset_name: string | null;
  converted_amount: number | null;
  converted_currency: string | null;
  fx_rate: number | null;
  pending_before: number | null;
  pending_after: number | null;
  automation_rule_id: string | null;
  is_imported: boolean;
  details: TransactionDetails | null;
  occurred_at: string;
}

export interface TransactionChange {
  id: number;
  transaction_id: string;
  asset_id: string | null;
  asset_name: string;
  delta: number;
}

export type GoalUnit = string; // currency code or GOLD_24K_G
export const GOLD_UNIT = "GOLD_24K_G";

export interface Goal {
  id: string;
  user_id: string;
  name: string;
  emoji: string;
  target_amount: number;
  target_unit: GoalUnit;
  include_upcoming: boolean;
  /** Money counted toward this goal isn't counted toward goals below it (list order decides who's first) */
  reserve_funds: boolean;
  sort_order: number;
  is_system: boolean;
}

export interface ZakatHawl {
  user_id: string;
  hawl_start_date: string | null;
  last_checked_on: string | null;
  /** Wealth when the Hawl started; 2.5% of it is due when the Hawl completes */
  start_wealth: number | null;
  start_wealth_currency: string | null;
  /** First Hawl: start_wealth is the value of the Nisab (85 g of 24k gold) on hawl_start_date */
  is_first_hawl: boolean;
}

export interface ZakatPayment {
  id: string;
  paid_on: string;
  amount: number;
  currency: string;
  hawl_start_date: string | null;
  note: string;
}

export interface AutomationRule {
  id: string;
  user_id: string;
  name: string;
  enabled: boolean;
  day_of_month: number;
  amount_mode: "all" | "fixed";
  fixed_amount: number | null;
  from_asset_id: string | null;
  to_asset_id: string | null;
  last_run_period: string | null;
  last_run_at: string | null;
  last_error: string | null;
  created_at: string;
}

export interface FollowedTicker {
  user_id: string;
  ticker: string;
  sort_order: number;
}

export interface PriceOverride {
  user_id: string;
  ticker: string;
  price: number;
  currency: string;
}

/** A daily close, cached by the server (FX: units per USD; METAL:XAU: USD per troy ounce) */
export interface HistoricalPrice {
  symbol: string;
  price_date: string;
  price: number;
  currency: string;
}

export interface MarketPrice {
  symbol: string;
  kind: "fx" | "metal" | "stock";
  price: number;
  previous_price: number | null;
  currency: string;
  display_name: string | null;
  source: string;
  fetched_at: string;
  changed_at: string;
}

/** Everything the app loads for the signed-in user (except history, which is paginated). */
export interface VaultData {
  profile: Profile;
  pricing: PricingSettings;
  groups: AssetGroup[];
  assets: Asset[];
  purchases: Purchase[];
  sales: Sale[];
  goals: Goal[];
  hawl: ZakatHawl | null;
  zakatPayments: ZakatPayment[];
  rules: AutomationRule[];
  followed: FollowedTicker[];
  overrides: PriceOverride[];
}
