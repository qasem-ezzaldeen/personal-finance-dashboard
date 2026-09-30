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
  const start = end - 12 * DAY;
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol(symbol))}?period1=${start}&period2=${end}&interval=1d`;
  const data = (await fetchJson(url, { headers: { "User-Agent": "Mozilla/5.0 AuraFinance" } })) as {
    chart?: { result?: Array<{ meta?: { currency?: string; gmtoffset?: number }; timestamp?: number[]; indicators?: { quote?: Array<{ close?: Array<number | null> }> } }> };
  };
  const result = data.chart?.result?.[0];
  const closes = result?.indicators?.quote?.[0]?.close ?? [];
  const offset = result?.meta?.gmtoffset ?? 0;
  const currency = symbol.startsWith("FX:") ? "USD" : /^[A-Z]{3}$/.test(result?.meta?.currency ?? "") ? result!.meta!.currency! : "USD";
  return (result?.timestamp ?? []).flatMap((ts, i) => {
    const close = closes[i];
    if (typeof close !== "number" || !(close > 0)) return [];
    return [{ symbol, price_date: new Date((ts + offset) * 1000).toISOString().slice(0, 10), price: close, currency, source: "yahoo" }];
  });
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
  const ticker = symbol.replace(/^STOCK:/, "");
  const url = `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(ticker)}&interval=1day&start_date=${shiftDate(date, -10)}&end_date=${shiftDate(date, 1)}&apikey=${encodeURIComponent(key)}`;
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
