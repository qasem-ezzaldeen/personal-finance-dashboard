import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import type { Quote } from "./providers.ts";

export type PriceRow = {
  symbol: string;
  kind: "fx" | "metal" | "stock";
  price: number;
  previous_price: number | null;
  currency: string;
  display_name: string | null;
  source: string;
  fetched_at: string;
  changed_at: string;
};

export async function loadPrices(admin: SupabaseClient): Promise<Map<string, PriceRow>> {
  const { data, error } = await admin.from("market_prices").select("*");
  if (error) throw error;
  return new Map((data as PriceRow[]).map((row) => [row.symbol, row]));
}

export function ageInMinutes(row: PriceRow | undefined, now: Date): number {
  return row ? (now.getTime() - Date.parse(row.fetched_at)) / 60000 : Number.POSITIVE_INFINITY;
}

/** Builds the next row, keeping the previous price only when the price actually changed. */
export function nextRow(
  existing: PriceRow | undefined,
  symbol: string,
  kind: PriceRow["kind"],
  quote: Quote,
  now: Date,
): PriceRow {
  const changed = !existing || Number(existing.price) !== quote.price;
  return {
    symbol,
    kind,
    price: quote.price,
    previous_price: existing ? (changed ? Number(existing.price) : existing.previous_price) : null,
    currency: quote.currency,
    display_name: quote.name ?? existing?.display_name ?? null,
    source: quote.source,
    fetched_at: now.toISOString(),
    changed_at: changed ? now.toISOString() : existing!.changed_at,
  };
}

export async function savePrices(admin: SupabaseClient, rows: PriceRow[]): Promise<void> {
  if (rows.length === 0) return;
  const { error } = await admin.from("market_prices").upsert(rows, { onConflict: "symbol" });
  if (error) throw error;
}

export async function consumeBudget(admin: SupabaseClient, provider: string, calls: number, dailyLimit: number) {
  const { data, error } = await admin.rpc("consume_api_budget", {
    p_provider: provider,
    p_calls: calls,
    p_daily_limit: dailyLimit,
  });
  if (error) throw error;
  return data === true;
}
