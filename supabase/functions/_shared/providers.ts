import { fetchJson } from "./http.ts";

export type DividendFrequency = "monthly" | "quarterly" | "semi_annual" | "annual" | "irregular" | "none";

export type DividendInfo = {
  amount: number;
  annual: number;
  frequency: DividendFrequency;
  lastDate: string | null;
};

export type Quote = { price: number; currency?: string; name?: string; source: string; dividends?: DividendInfo };

const SUB_UNIT_CURRENCIES: Record<string, { currency: string; factor: number }> = {
  GBp: { currency: "GBP", factor: 100 },
  ZAc: { currency: "ZAR", factor: 100 },
  ILA: { currency: "ILS", factor: 100 },
};

export function normalizeQuoteCurrency(price: number, rawCurrency: string | undefined): { price: number; currency: string } {
  const sub = rawCurrency ? SUB_UNIT_CURRENCIES[rawCurrency] : undefined;
  if (sub) return { price: price / sub.factor, currency: sub.currency };
  return { price, currency: /^[A-Z]{3}$/.test(rawCurrency ?? "") ? rawCurrency! : "USD" };
}

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
  if (data.status === "error") {
    throw new Error(typeof data.message === "string" ? data.message : "Twelve Data returned an error");
  }
  const result: Record<string, Quote> = {};

  const read = (symbol: string, entry: unknown) => {
    const price = positiveNumber((entry as { price?: unknown } | null)?.price);
    // Twelve Data /price returns no currency; leave undefined so existing currency is preserved
    if (price !== null) result[symbol] = { price, source: "twelvedata" };
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

type YahooDividendsMap = Record<string, { amount?: unknown; date?: unknown }>;

export function parseYahooDividends(raw: YahooDividendsMap | undefined, now = new Date(), divisor = 1): DividendInfo {
  const entries = Object.values(raw ?? {})
    .map((d) => ({
      amount: (typeof d.amount === "number" ? d.amount : Number(d.amount)) / divisor,
      ts: typeof d.date === "number" ? d.date : Number(d.date),
    }))
    .filter((d) => Number.isFinite(d.amount) && d.amount > 0 && Number.isFinite(d.ts) && d.ts > 0)
    .sort((a, b) => a.ts - b.ts);

  if (entries.length === 0) {
    return { amount: 0, annual: 0, frequency: "none", lastDate: null };
  }

  const latest = entries[entries.length - 1];
  const lastDate = new Date(latest.ts * 1000).toISOString().slice(0, 10);
  const cutoff = now.getTime() / 1000 - 365 * 86400;
  const recent = entries.filter((e) => e.ts >= cutoff);
  const annualSum = +recent.reduce((sum, e) => sum + e.amount, 0).toFixed(4);

  let frequency: DividendFrequency = "irregular";
  if (entries.length >= 2) {
    const gaps: number[] = [];
    for (let i = Math.max(1, entries.length - 5); i < entries.length; i++) {
      gaps.push((entries[i].ts - entries[i - 1].ts) / 86400);
    }
    gaps.sort((a, b) => a - b);
    const median = gaps[Math.floor(gaps.length / 2)];
    if (median < 45) frequency = "monthly";
    else if (median <= 135) frequency = "quarterly";
    else if (median <= 240) frequency = "semi_annual";
    else if (median <= 420) frequency = "annual";
  } else {
    frequency = "annual";
  }

  return {
    amount: +latest.amount.toFixed(6),
    annual: annualSum,
    frequency,
    lastDate,
  };
}

export async function fetchYahooQuote(symbol: string): Promise<Quote | null> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1mo&range=2y&events=div`;
  const data = (await fetchJson(url, { headers: { "User-Agent": "Mozilla/5.0 AuraFinance" } })) as {
    chart?: {
      result?: Array<{
        meta?: { regularMarketPrice?: unknown; currency?: string; longName?: string; shortName?: string };
        events?: { dividends?: YahooDividendsMap };
      }>;
    };
  };
  const result = data.chart?.result?.[0];
  const meta = result?.meta;
  const price = positiveNumber(meta?.regularMarketPrice);
  if (!meta || price === null) return null;
  const normalized = normalizeQuoteCurrency(price, meta.currency);
  const divisor = normalized.price === price ? 1 : Math.round(price / normalized.price);
  return {
    price: normalized.price,
    currency: normalized.currency,
    name: meta.longName ?? meta.shortName,
    source: "yahoo",
    dividends: parseYahooDividends(result?.events?.dividends, new Date(), divisor),
  };
}

export async function fetchYahooDividends(symbol: string): Promise<DividendInfo | null> {
  const q = await fetchYahooQuote(symbol);
  return q?.dividends ?? null;
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
