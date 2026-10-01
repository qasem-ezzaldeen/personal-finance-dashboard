// Every call the app makes to Supabase lives here.

import { supabase, toError, unwrap } from "./supabase";
import type {
  Asset,
  AssetGroup,
  AutomationRule,
  FollowedTicker,
  Goal,
  GroupKind,
  MarketPrice,
  PriceOverride,
  PricingSettings,
  Profile,
  Purchase,
  Sale,
  Transaction,
  TransactionChange,
  VaultData,
  ZakatHawl,
  ZakatPayment,
} from "./types";

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

export async function bootstrapVault(): Promise<void> {
  const { error } = await supabase.rpc("bootstrap_vault");
  if (error) throw toError(error);
}

export async function runScheduledTasks(): Promise<void> {
  const { error } = await supabase.rpc("run_scheduled_tasks_for_me");
  if (error) throw toError(error);
}

export async function fetchVault(userId: string): Promise<VaultData> {
  const own = <T>(table: string) => supabase.from(table).select("*").eq("user_id", userId).returns<T>();
  const [profile, pricing, groups, assets, purchases, sales, goals, hawl, zakatPayments, rules, followed, overrides] =
    await Promise.all([
      own<Profile>("profiles").single(),
      own<PricingSettings>("pricing_settings").single(),
      own<AssetGroup[]>("asset_groups"),
      own<Asset[]>("assets"),
      own<Purchase[]>("asset_purchases"),
      own<Sale[]>("asset_sales"),
      own<Goal[]>("goals"),
      own<ZakatHawl>("zakat_hawl").maybeSingle(),
      own<ZakatPayment[]>("zakat_payments"),
      own<AutomationRule[]>("automation_rules"),
      own<FollowedTicker[]>("followed_tickers"),
      own<PriceOverride[]>("price_overrides"),
    ]);

  return {
    profile: unwrap(profile),
    pricing: unwrap(pricing),
    groups: unwrap(groups) ?? [],
    assets: unwrap(assets) ?? [],
    purchases: unwrap(purchases) ?? [],
    sales: unwrap(sales) ?? [],
    goals: unwrap(goals) ?? [],
    hawl: unwrap(hawl),
    zakatPayments: unwrap(zakatPayments) ?? [],
    rules: unwrap(rules) ?? [],
    followed: unwrap(followed) ?? [],
    overrides: unwrap(overrides) ?? [],
  };
}

export async function fetchMarketPrices(): Promise<MarketPrice[]> {
  return unwrap(await supabase.from("market_prices").select("*").returns<MarketPrice[]>()) ?? [];
}

export const ACTIVITY_PAGE_SIZE = 30;

export interface ActivityFilters {
  kind?: Transaction["kind"] | "all";
  assetId?: string | "all";
}

export async function fetchActivityPage(
  userId: string,
  page: number,
  filters: ActivityFilters = {},
): Promise<Transaction[]> {
  let query = supabase
    .from("transactions")
    .select("*")
    .eq("user_id", userId)
    .order("occurred_at", { ascending: false })
    .order("seq", { ascending: false })
    .range(page * ACTIVITY_PAGE_SIZE, page * ACTIVITY_PAGE_SIZE + ACTIVITY_PAGE_SIZE - 1);
  if (filters.kind && filters.kind !== "all") query = query.eq("kind", filters.kind);
  if (filters.assetId && filters.assetId !== "all") {
    query = query.or(`from_asset_id.eq.${filters.assetId},to_asset_id.eq.${filters.assetId}`);
  }
  return unwrap(await query.returns<Transaction[]>()) ?? [];
}

export async function fetchRecentActivity(userId: string, limit = 8): Promise<Transaction[]> {
  return (
    unwrap(
      await supabase
        .from("transactions")
        .select("*")
        .eq("user_id", userId)
        .order("occurred_at", { ascending: false })
        .order("seq", { ascending: false })
        .limit(limit)
        .returns<Transaction[]>(),
    ) ?? []
  );
}

export interface RevertPreview {
  count: number;
  /** Net change per cash account */
  effects: Array<{ assetName: string; delta: number }>;
  /** Net change in grams/shares/units per gold, stock or other asset */
  holdings: Array<{ assetName: string; kind: "gold" | "stock" | "other"; delta: number }>;
}

/** What reverting to `tx` would undo: entries after it and their net effect per account and holding. */
export async function previewRevert(userId: string, tx: Transaction): Promise<RevertPreview> {
  const later = unwrap(
    await supabase
      .from("transactions")
      .select("id, seq, kind, details, from_asset_name, to_asset_name")
      .eq("user_id", userId)
      .gt("seq", tx.seq)
      .returns<Array<Pick<Transaction, "id" | "seq" | "kind" | "details" | "from_asset_name" | "to_asset_name">>>(),
  ) ?? [];
  if (later.length === 0) return { count: 0, effects: [], holdings: [] };

  const changes = unwrap(
    await supabase
      .from("transaction_changes")
      .select("*")
      .in("transaction_id", later.map((t) => t.id))
      .returns<TransactionChange[]>(),
  ) ?? [];
  const byAsset = new Map<string, { assetName: string; delta: number }>();
  for (const c of changes) {
    const key = c.asset_id ?? c.asset_name;
    const current = byAsset.get(key) ?? { assetName: c.asset_name, delta: 0 };
    current.delta += Number(c.delta);
    byAsset.set(key, current);
  }

  // Buys, sells and removals change holdings. Undoing a buy takes the units away; undoing a sale or a
  // deleted purchase brings them back (a deleted purchase whose buy is also undone nets out to nothing).
  const held = new Map<string, { assetName: string; kind: "gold" | "stock" | "other"; delta: number }>();
  for (const t of later) {
    const quantity = Number(t.details?.quantity ?? 0);
    if (!quantity) continue;
    const name = t.kind === "buy" || t.kind === "sale_removed" ? t.to_asset_name : t.from_asset_name;
    const undo = t.kind === "buy" || t.kind === "sale_removed" ? -quantity : t.kind === "sell" || t.kind === "refund" ? quantity : 0;
    if (!name || !undo) continue;
    const current = held.get(name) ?? { assetName: name, kind: t.details?.asset_kind ?? "other", delta: 0 };
    current.delta += undo;
    held.set(name, current);
  }

  return {
    count: later.length,
    // Reverting applies the opposite of what those entries did
    effects: [...byAsset.values()].filter((e) => Math.abs(e.delta) > 1e-9).map((e) => ({ ...e, delta: -e.delta })),
    holdings: [...held.values()].filter((h) => Math.abs(h.delta) > 1e-9),
  };
}

// ---------------------------------------------------------------------------
// Money
// ---------------------------------------------------------------------------

export async function logIncome(amount: number, description: string) {
  unwrap(await supabase.rpc("log_income", { p_amount: amount, p_description: description }));
}

export async function transferFunds(fromId: string, toId: string, amount: number, description: string) {
  unwrap(await supabase.rpc("transfer_funds", { p_from: fromId, p_to: toId, p_amount: amount, p_description: description }));
}

export async function setCashBalance(assetId: string, balance: number, description = "") {
  unwrap(await supabase.rpc("set_cash_balance", { p_asset: assetId, p_balance: balance, p_description: description }));
}

export async function revertToTransaction(txId: string): Promise<number> {
  return unwrap(await supabase.rpc("revert_to_transaction", { p_tx: txId })) as number;
}

// ---------------------------------------------------------------------------
// Profile & settings
// ---------------------------------------------------------------------------

export type ProfileUpdate = Partial<
  Pick<
    Profile,
    | "display_name"
    | "timezone"
    | "avatar_color"
    | "vault_name"
    | "base_currency"
    | "display_currencies"
    | "income_currency"
    | "number_locale"
    | "zakat_enabled"
    | "animation_speed"
    | "theme"
    | "color_palette"
    | "palette_accents"
  >
>;

export async function updateProfile(userId: string, patch: ProfileUpdate) {
  unwrap(await supabase.from("profiles").update(patch).eq("user_id", userId));
}

export type PricingUpdate = Partial<Omit<PricingSettings, "user_id">>;

export async function updatePricing(userId: string, patch: PricingUpdate) {
  unwrap(await supabase.from("pricing_settings").update(patch).eq("user_id", userId));
}

// ---------------------------------------------------------------------------
// Groups, assets & purchases
// ---------------------------------------------------------------------------

export async function updateGroup(userId: string, kind: GroupKind, patch: Partial<Pick<AssetGroup, "name" | "color" | "sort_order">>) {
  unwrap(await supabase.from("asset_groups").update(patch).eq("user_id", userId).eq("kind", kind));
}

export async function reorderGroups(userId: string, kinds: GroupKind[]) {
  await Promise.all(kinds.map((kind, index) => updateGroup(userId, kind, { sort_order: index })));
}

export interface NewAsset {
  kind: GroupKind;
  name: string;
  currency?: string | null;
  karat?: 21 | 24 | null;
  ticker?: string | null;
  manual_unit_price?: number | null;
  color: string;
  note?: string;
  hide_when_empty?: boolean;
  sort_order?: number;
}

export async function createAsset(userId: string, asset: NewAsset): Promise<Asset> {
  return unwrap(await supabase.from("assets").insert({ ...asset, user_id: userId }).select("*").single()) as Asset;
}

export type AssetUpdate = Partial<
  Pick<Asset, "name" | "currency" | "karat" | "ticker" | "manual_unit_price" | "color" | "note" | "sort_order" | "hide_when_empty" | "archived_at">
>;

export async function updateAsset(assetId: string, patch: AssetUpdate) {
  unwrap(await supabase.from("assets").update(patch).eq("id", assetId));
}

export async function deleteAsset(assetId: string) {
  unwrap(await supabase.from("assets").delete().eq("id", assetId));
}

export async function reorderAssets(ids: string[]) {
  await Promise.all(ids.map((id, index) => updateAsset(id, { sort_order: index })));
}

export interface PurchaseInput {
  quantity: number;
  cost_total: number | null;
  cost_currency: string | null;
  acquired_on: string;
  note: string;
}

export async function createPurchase(userId: string, assetId: string, input: PurchaseInput) {
  unwrap(await supabase.from("asset_purchases").insert({ ...input, user_id: userId, asset_id: assetId }));
}

export async function updatePurchase(purchaseId: string, input: Partial<PurchaseInput>) {
  unwrap(await supabase.from("asset_purchases").update(input).eq("id", purchaseId));
}

/** Deletes a purchase. If it was paid from a cash account, the database puts that money back. */
export async function deletePurchase(purchaseId: string) {
  unwrap(await supabase.from("asset_purchases").delete().eq("id", purchaseId));
}

export interface TradeInput {
  assetId: string;
  /** The cash account paid from (buy) or paid into (sell) */
  cashId: string;
  quantity: number;
  /** Paid (buy) or received (sell), in the cash account's currency */
  amount: number;
  date: string;
  note: string;
}

export async function buyAsset(t: TradeInput) {
  unwrap(
    await supabase.rpc("buy_asset", {
      p_asset: t.assetId, p_from: t.cashId, p_quantity: t.quantity, p_amount: t.amount, p_acquired_on: t.date, p_note: t.note,
    }),
  );
}

export async function sellAsset(t: TradeInput) {
  unwrap(
    await supabase.rpc("sell_asset", {
      p_asset: t.assetId, p_to: t.cashId, p_quantity: t.quantity, p_amount: t.amount, p_sold_on: t.date, p_note: t.note,
    }),
  );
}

/** Removes a sale: its money leaves the cash account again and the holding comes back. */
export async function deleteSale(saleId: string) {
  unwrap(await supabase.rpc("delete_sale", { p_sale: saleId }));
}

// ---------------------------------------------------------------------------
// Goals & Zakat
// ---------------------------------------------------------------------------

export type GoalInput = Pick<Goal, "name" | "emoji" | "target_amount" | "target_unit" | "include_upcoming" | "reserve_funds">;

export async function createGoal(userId: string, input: GoalInput, sortOrder: number) {
  unwrap(await supabase.from("goals").insert({ ...input, user_id: userId, sort_order: sortOrder }));
}

export async function updateGoal(goalId: string, input: Partial<GoalInput> & { sort_order?: number }) {
  unwrap(await supabase.from("goals").update(input).eq("id", goalId));
}

export async function deleteGoal(goalId: string) {
  unwrap(await supabase.from("goals").delete().eq("id", goalId));
}

export async function reorderGoals(ids: string[]) {
  await Promise.all(ids.map((id, index) => updateGoal(id, { sort_order: index + 1 })));
}

export interface HawlUpdate {
  hawl_start_date: string | null;
  start_wealth: number | null;
  start_wealth_currency: string | null;
  is_first_hawl: boolean;
}

export async function updateHawl(userId: string, patch: HawlUpdate) {
  unwrap(await supabase.from("zakat_hawl").update(patch).eq("user_id", userId));
}

export async function markZakatPaid(amount: number, currency: string, note: string) {
  unwrap(await supabase.rpc("mark_zakat_paid", { p_amount: amount, p_currency: currency, p_note: note }));
}

// ---------------------------------------------------------------------------
// Automations
// ---------------------------------------------------------------------------

export type RuleInput = Pick<
  AutomationRule,
  "name" | "enabled" | "day_of_month" | "amount_mode" | "fixed_amount" | "from_asset_id" | "to_asset_id"
>;

export async function createRule(userId: string, input: RuleInput) {
  unwrap(await supabase.from("automation_rules").insert({ ...input, user_id: userId }));
}

export async function updateRule(ruleId: string, input: Partial<RuleInput>) {
  unwrap(await supabase.from("automation_rules").update(input).eq("id", ruleId));
}

export async function deleteRule(ruleId: string) {
  unwrap(await supabase.from("automation_rules").delete().eq("id", ruleId));
}

// ---------------------------------------------------------------------------
// Market
// ---------------------------------------------------------------------------

export interface TickerInfo {
  ticker: string;
  name: string | null;
  price: number;
  currency: string;
}

export async function checkTicker(ticker: string): Promise<TickerInfo> {
  const { data, error } = await supabase.functions.invoke<TickerInfo>("check-ticker", { body: { ticker } });
  if (error) {
    // The function returns { error } with a 4xx status; surface its message
    const context = (error as { context?: Response }).context;
    if (context && typeof context.json === "function") {
      const body = await context.json().catch(() => null);
      if (body?.error) throw new Error(body.error);
    }
    throw new Error("Couldn't check that ticker right now. Try again in a moment.");
  }
  return data as TickerInfo;
}

export interface PriceOnDate {
  date: string;
  xau: { price: number; date: string; source: string };
  fx: Record<string, { price: number; date: string; source: string }>;
}

/** Gold spot (USD/oz) and USD exchange rates on a given day (the last trading day on or before it). */
export async function fetchPriceOnDate(date: string, currencies: string[]): Promise<PriceOnDate> {
  const { data, error } = await supabase.functions.invoke<PriceOnDate>("price-on-date", { body: { date, currencies } });
  if (error) {
    const body = await (error as { context?: Response }).context?.json?.().catch(() => null);
    throw new Error(body?.error ?? "Couldn't look up prices for that date right now.");
  }
  return data as PriceOnDate;
}

/** Asks the server to fill in missing purchase prices with the market price on each purchase date. */
export async function estimatePurchaseCosts(): Promise<{ updated: number; failed: number }> {
  const { data, error } = await supabase.functions.invoke<{ updated: number; failed: number }>("estimate-costs", { body: {} });
  if (error) throw new Error("Couldn't look up past prices right now.");
  return data ?? { updated: 0, failed: 0 };
}

export async function requestMarketRefresh(): Promise<void> {
  const { error } = await supabase.functions.invoke("market-refresh", { body: { source: "user" } });
  if (error) throw new Error("Couldn't reach the price service. Showing the last known prices.");
}

export async function followTicker(userId: string, ticker: string, sortOrder: number) {
  unwrap(await supabase.from("followed_tickers").insert({ user_id: userId, ticker, sort_order: sortOrder }));
}

export async function unfollowTicker(userId: string, ticker: string) {
  unwrap(await supabase.from("followed_tickers").delete().eq("user_id", userId).eq("ticker", ticker));
}

export async function setPriceOverride(userId: string, ticker: string, price: number, currency = "USD") {
  unwrap(
    await supabase
      .from("price_overrides")
      .upsert({ user_id: userId, ticker, price, currency }, { onConflict: "user_id,ticker" }),
  );
}

export async function removePriceOverride(userId: string, ticker: string) {
  unwrap(await supabase.from("price_overrides").delete().eq("user_id", userId).eq("ticker", ticker));
}

// ---------------------------------------------------------------------------
// One-time import from the previous version
// ---------------------------------------------------------------------------

export async function fetchPreviousVault(userId: string): Promise<Record<string, unknown> | null> {
  const { data, error } = await supabase.from("dashboards").select("data").eq("user_id", userId).maybeSingle();
  if (error) {
    // The previous version's table doesn't exist on projects that never ran it
    if (error.code === "42P01" || error.code === "PGRST205") return null;
    throw toError(error);
  }
  return (data?.data as Record<string, unknown>) ?? null;
}

export async function importPreviousVault(payload: unknown) {
  return unwrap(await supabase.rpc("import_previous_vault", { p: payload })) as Record<string, number>;
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export async function fetchAllTransactions(userId: string): Promise<Transaction[]> {
  const all: Transaction[] = [];
  for (let page = 0; ; page++) {
    const rows = unwrap(
      await supabase
        .from("transactions")
        .select("*")
        .eq("user_id", userId)
        .order("seq", { ascending: true })
        .range(page * 1000, page * 1000 + 999)
        .returns<Transaction[]>(),
    ) ?? [];
    all.push(...rows);
    if (rows.length < 1000) return all;
  }
}

export async function fetchAllTransactionChanges(userId: string): Promise<TransactionChange[]> {
  const all: TransactionChange[] = [];
  for (let page = 0; ; page++) {
    const rows = unwrap(
      await supabase
        .from("transaction_changes")
        .select("*")
        .eq("user_id", userId)
        .order("id", { ascending: true })
        .range(page * 1000, page * 1000 + 999)
        .returns<TransactionChange[]>(),
    ) ?? [];
    all.push(...rows);
    if (rows.length < 1000) return all;
  }
}

// ---------------------------------------------------------------------------
// Restore from a JSON backup
// ---------------------------------------------------------------------------

/** Replaces everything in this vault with a backup (checked first with readBackup). */
export async function restoreVault(backup: Record<string, unknown>) {
  return unwrap(await supabase.rpc("restore_vault", { p: backup })) as Record<string, number | boolean>;
}
