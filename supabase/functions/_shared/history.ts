// Daily closing prices on a past date, cached in public.historical_prices.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { fetchJson } from "./http.ts";
import { consumeBudget } from "./prices.ts";

export interface HistoricalPrice {
  price: number;
  currency: string;
  date: string; // the trading day actually used (the last one on or before the requested date)
  source: string;
}

type Row = { symbol: string; price_date: string; price: number; currency: string; source: string };

const DAY = 86400;

/** Yahoo symbols: gold futures track spot closely; "EGP=X" is EGP per USD. */
function yahooSymbol(symbol: string): string {
  if (symbol === "METAL:XAU") return "GC=F";
  if (symbol.startsWith("FX:")) return `${symbol.slice(3)}=X`;
  return symbol.replace(/^STOCK:/, "");
}

function shiftDate(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

async function fromCache(admin: SupabaseClient, symbol: string, date: string): Promise<HistoricalPrice | null> {
  // The last cached trading day within a week before the date (weekends and holidays have no close)
  const { data } = await admin
    .from("historical_prices")
    .select("*")
    .eq("symbol", symbol)
    .lte("price_date", date)
    .gte("price_date", shiftDate(date, -7))
    .order("price_date", { ascending: false })
    .limit(1);
  const row = (data as Row[] | null)?.[0];
  return row ? { price: Number(row.price), currency: row.currency, date: row.price_date, source: `${row.source} (cached)` } : null;
}

async function fromYahoo(symbol: string, date: string): Promise<Row[]> {
  const end = Math.floor(Date.parse(`${date}T00:00:00Z`) / 1000) + 2 * DAY;
  return yahooRange(symbol, end - 12 * DAY, end);
}

/** Daily closes between two Unix times (seconds), one request however long the range. */
async function yahooRange(symbol: string, start: number, end: number): Promise<Row[]> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol(symbol))}?period1=${start}&period2=${end}&interval=1d`;
  const data = (await fetchJson(url, { headers: { "User-Agent": "Mozilla/5.0 AuraFinance" } }, 20000)) as {
    chart?: { result?: Array<{ meta?: { currency?: string; gmtoffset?: number }; timestamp?: number[]; indicators?: { quote?: Array<{ close?: Array<number | null> }> } }> };
  };
  const result = data.chart?.result?.[0];
  const closes = result?.indicators?.quote?.[0]?.close ?? [];
  const offset = result?.meta?.gmtoffset ?? 0;
  const currency = symbol.startsWith("FX:") ? "USD" : /^[A-Z]{3}$/.test(result?.meta?.currency ?? "") ? result!.meta!.currency! : "USD";
  // One row per day: today's live bar can repeat the last close's date
  const byDate = new Map<string, Row>();
  (result?.timestamp ?? []).forEach((ts, i) => {
    const close = closes[i];
    if (typeof close !== "number" || !(close > 0)) return;
    const price_date = new Date((ts + offset) * 1000).toISOString().slice(0, 10);
    byDate.set(price_date, { symbol, price_date, price: close, currency, source: "yahoo" });
  });
  return [...byDate.values()];
}

async function fromGoldApiIo(date: string, key: string): Promise<Row[]> {
  const data = (await fetchJson(`https://www.goldapi.io/api/XAU/USD/${date.replaceAll("-", "")}`, {
    headers: { "x-access-token": key },
  })) as { price?: number };
  return data.price && data.price > 1000 && data.price < 10000
    ? [{ symbol: "METAL:XAU", price_date: date, price: data.price, currency: "USD", source: "goldapi.io" }]
    : [];
}

async function fromTwelveData(symbol: string, date: string, key: string): Promise<Row[]> {
  return twelveDataRange(symbol, shiftDate(date, -10), shiftDate(date, 1), key);
}

async function twelveDataRange(symbol: string, startDate: string, endDate: string, key: string): Promise<Row[]> {
  const ticker = symbol.replace(/^STOCK:/, "");
  const url = `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(ticker)}&interval=1day&start_date=${startDate}&end_date=${endDate}&outputsize=5000&apikey=${encodeURIComponent(key)}`;
  const data = (await fetchJson(url)) as { values?: Array<{ datetime: string; close: string }>; meta?: { currency?: string } };
  return (data.values ?? []).flatMap((v) => {
    const close = Number(v.close);
    return close > 0 ? [{ symbol, price_date: v.datetime.slice(0, 10), price: close, currency: data.meta?.currency ?? "USD", source: "twelvedata" }] : [];
  });
}

/** Closing price for `symbol` on `date` (or the last trading day before it). Null when no source has it. */
export async function historicalPrice(admin: SupabaseClient, symbol: string, date: string): Promise<HistoricalPrice | null> {
  const cached = await fromCache(admin, symbol, date);
  if (cached && cached.date >= shiftDate(date, -4)) return cached;

  let rows: Row[] = [];
  try {
    rows = await fromYahoo(symbol, date);
  } catch (err) {
    console.warn(`[history] Yahoo failed for ${symbol} on ${date}:`, err instanceof Error ? err.message : err);
    rows = [];
  }
  const hasDay = () => rows.some((r) => r.price_date <= date && r.price_date >= shiftDate(date, -7));
  if (!hasDay() && symbol === "METAL:XAU") {
    const key = Deno.env.get("GOLDAPI_IO_KEY");
    if (key && (await consumeBudget(admin, "goldapi.io", 1, 3))) rows = await fromGoldApiIo(date, key).catch(() => []);
  }
  if (!hasDay() && symbol.startsWith("STOCK:")) {
    const key = Deno.env.get("TWELVE_DATA_API_KEY");
    if (key && (await consumeBudget(admin, "twelvedata", 1, 780))) rows = await fromTwelveData(symbol, date, key).catch(() => []);
  }

  if (rows.length) await admin.from("historical_prices").upsert(rows, { onConflict: "symbol,price_date" });
  const best = rows.filter((r) => r.price_date <= date).sort((a, b) => b.price_date.localeCompare(a.price_date))[0];
  if (!best || best.price_date < shiftDate(date, -7)) return cached;
  return { price: best.price, currency: best.currency, date: best.price_date, source: best.source };
}

// ---------------------------------------------------------------------------
// Whole ranges, for the Insights charts
// ---------------------------------------------------------------------------

export type BackfillResult = "cached" | `filled ${number}` | "failed";

function weekdaysBetween(from: string, to: string): number {
  let count = 0;
  for (let d = from; d <= to; d = shiftDate(d, 1)) {
    const day = new Date(`${d}T00:00:00Z`).getUTCDay();
    if (day !== 0 && day !== 6) count++;
  }
  return count;
}

const RETRY_AFTER_SUCCESS_HOURS = 12;
const RETRY_AFTER_FAILURE_HOURS = 1;

type Backfill = { symbol: string; covered_from: string; succeeded: boolean; attempted_at: string };

/** A recent backfill from `from` or earlier: there's nothing more to find for now, even where days are missing. */
function triedRecently(last: Backfill | null, from: string): boolean {
  if (!last || last.covered_from > from) return false;
  const hours = (Date.now() - Date.parse(last.attempted_at)) / 3600_000;
  return hours < (last.succeeded ? RETRY_AFTER_SUCCESS_HOURS : RETRY_AFTER_FAILURE_HOURS);
}

/** True when the cache already has closes from `from` to (nearly) today without big gaps. */
async function rangeIsCached(admin: SupabaseClient, symbol: string, from: string, today: string): Promise<boolean> {
  const [first, last, count] = await Promise.all([
    admin.from("historical_prices").select("price_date").eq("symbol", symbol).gte("price_date", shiftDate(from, -7)).order("price_date").limit(1),
    admin.from("historical_prices").select("price_date").eq("symbol", symbol).order("price_date", { ascending: false }).limit(1),
    admin.from("historical_prices").select("*", { count: "exact", head: true }).eq("symbol", symbol).gte("price_date", from),
  ]);
  const earliest = (first.data as Array<{ price_date: string }> | null)?.[0]?.price_date;
  const latest = (last.data as Array<{ price_date: string }> | null)?.[0]?.price_date;
  if (!earliest || !latest || earliest > shiftDate(from, 4) || latest < shiftDate(today, -4)) return false;
  // Markets close on weekends and holidays: expect most weekdays to have a close
  return (count.count ?? 0) >= weekdaysBetween(from, today) * 0.8 - 3;
}

/** Makes sure the cache has every daily close of `symbol` from `from` to today (Yahoo, then Twelve Data for stocks). */
export async function backfillHistory(admin: SupabaseClient, symbol: string, from: string): Promise<BackfillResult> {
  const today = new Date().toISOString().slice(0, 10);
  const { data: last } = await admin.from("price_history_backfills").select("*").eq("symbol", symbol).maybeSingle();
  if (triedRecently(last as Backfill | null, from) || (await rangeIsCached(admin, symbol, from, today))) return "cached";
  const remember = (succeeded: boolean) =>
    admin
      .from("price_history_backfills")
      .upsert({ symbol, covered_from: from, succeeded, attempted_at: new Date().toISOString() }, { onConflict: "symbol" });

  let rows: Row[] = [];
  try {
    const start = Math.floor(Date.parse(`${shiftDate(from, -10)}T00:00:00Z`) / 1000);
    rows = await yahooRange(symbol, start, Math.floor(Date.now() / 1000) + DAY);
  } catch (err) {
    console.warn(`[history] Yahoo range failed for ${symbol} from ${from}:`, err instanceof Error ? err.message : err);
  }
  if (rows.length === 0 && symbol.startsWith("STOCK:")) {
    const key = Deno.env.get("TWELVE_DATA_API_KEY");
    if (key && (await consumeBudget(admin, "twelvedata", 1, 780))) {
      rows = await twelveDataRange(symbol, shiftDate(from, -10), shiftDate(today, 1), key).catch(() => []);
    }
  }
  if (rows.length === 0) {
    await remember(false);
    return "failed";
  }

  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await admin.from("historical_prices").upsert(rows.slice(i, i + 500), { onConflict: "symbol,price_date" });
    if (error) throw error;
  }
  await remember(true);
  return `filled ${rows.length}`;
}
