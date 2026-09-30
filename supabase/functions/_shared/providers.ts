import { fetchJson } from "./http.ts";

export type Quote = { price: number; currency: string; name?: string; source: string };

const TROY_OUNCE_MIN_USD = 1000;
const TROY_OUNCE_MAX_USD = 10000;

function positiveNumber(value: unknown): number | null {
  const n = typeof value === "string" ? Number.parseFloat(value) : typeof value === "number" ? value : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

// ---------------------------------------------------------------------------
// Exchange rates: units of each currency per 1 USD
// ---------------------------------------------------------------------------

export async function fetchFxRates(): Promise<{ rates: Record<string, number>; source: string }> {
  const sources: Array<[string, string]> = [
    ["open.er-api.com", "https://open.er-api.com/v6/latest/USD"],
    ["exchangerate-api.com", "https://api.exchangerate-api.com/v4/latest/USD"],
  ];
  let lastError: unknown;
  for (const [source, url] of sources) {
    try {
      const data = (await fetchJson(url)) as { rates?: Record<string, unknown> };
      const rates: Record<string, number> = {};
      for (const [code, value] of Object.entries(data.rates ?? {})) {
        const n = positiveNumber(value);
        if (n !== null && /^[A-Z]{3}$/.test(code) && code !== "USD") rates[code] = n;
      }
      if (rates.EGP) return { rates, source };
      throw new Error(`${source} returned no EGP rate`);
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("All exchange-rate sources failed");
}

// ---------------------------------------------------------------------------
// Gold spot (USD per troy ounce)
// ---------------------------------------------------------------------------

function checkGoldBounds(price: number | null, source: string): number {
  if (price === null || price < TROY_OUNCE_MIN_USD || price > TROY_OUNCE_MAX_USD) {
    throw new Error(`${source} returned an out-of-range gold price: ${price}`);
  }
  return price;
}

export async function fetchGoldFromGoldApiCom(): Promise<Quote> {
  const data = (await fetchJson("https://api.gold-api.com/price/XAU")) as { price?: unknown };
  return { price: checkGoldBounds(positiveNumber(data.price), "gold-api.com"), currency: "USD", source: "gold-api.com" };
}

export async function fetchGoldFromGoldApiIo(apiKey: string): Promise<Quote> {
  const data = (await fetchJson("https://www.goldapi.io/api/XAU/USD", {
    headers: { "x-access-token": apiKey, "Content-Type": "application/json" },
  })) as { price?: unknown };
  return { price: checkGoldBounds(positiveNumber(data.price), "goldapi.io"), currency: "USD", source: "goldapi.io" };
}

// ---------------------------------------------------------------------------
// Stocks
// ---------------------------------------------------------------------------

/** Batch price lookup. Twelve Data's free plan allows 8 symbols per minute. */
export async function fetchTwelveDataPrices(symbols: string[], apiKey: string): Promise<Record<string, Quote>> {
  if (symbols.length === 0) return {};
  const url = `https://api.twelvedata.com/price?symbol=${encodeURIComponent(symbols.join(","))}&apikey=${encodeURIComponent(apiKey)}`;
  const data = (await fetchJson(url)) as Record<string, unknown>;
  const result: Record<string, Quote> = {};

  const read = (symbol: string, entry: unknown) => {
    const price = positiveNumber((entry as { price?: unknown } | null)?.price);
    if (price !== null) result[symbol] = { price, currency: "USD", source: "twelvedata" };
  };

  if (symbols.length === 1) {
    read(symbols[0], data);
  } else {
    for (const symbol of symbols) read(symbol, data[symbol]);
  }
  return result;
}

export async function fetchTwelveDataQuote(symbol: string, apiKey: string): Promise<Quote | null> {
  const url = `https://api.twelvedata.com/quote?symbol=${encodeURIComponent(symbol)}&apikey=${encodeURIComponent(apiKey)}`;
  const data = (await fetchJson(url)) as { status?: string; close?: unknown; name?: string; currency?: string };
  if (data.status === "error") return null;
  const price = positiveNumber(data.close);
  if (price === null) return null;
  return {
    price,
    currency: /^[A-Z]{3}$/.test(data.currency ?? "") ? data.currency! : "USD",
    name: data.name,
    source: "twelvedata",
  };
}

export async function fetchYahooQuote(symbol: string): Promise<Quote | null> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1d`;
  const data = (await fetchJson(url, { headers: { "User-Agent": "Mozilla/5.0 AuraFinance" } })) as {
    chart?: { result?: Array<{ meta?: { regularMarketPrice?: unknown; currency?: string; longName?: string; shortName?: string } }> };
  };
  const meta = data.chart?.result?.[0]?.meta;
  const price = positiveNumber(meta?.regularMarketPrice);
  if (!meta || price === null) return null;
  return {
    price,
    currency: /^[A-Z]{3}$/.test(meta.currency ?? "") ? meta.currency! : "USD",
    name: meta.longName ?? meta.shortName,
    source: "yahoo",
  };
}

// ---------------------------------------------------------------------------
// US market hours (New York time)
// ---------------------------------------------------------------------------

export function isUsMarketOpen(now = new Date()): boolean {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const weekday = get("weekday");
  if (weekday === "Sat" || weekday === "Sun") return false;
  const minutes = Number(get("hour")) * 60 + Number(get("minute"));
  // 09:30 to 16:30 (includes a short grace period to capture the closing price)
  return minutes >= 9 * 60 + 30 && minutes <= 16 * 60 + 30;
}
