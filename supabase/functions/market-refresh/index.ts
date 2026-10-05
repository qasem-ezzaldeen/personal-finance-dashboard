// Refreshes exchange rates, gold and stock prices.
// Called every 15 minutes by pg_cron (service role) and on demand by signed-in users (the ⟳ button).
import { adminClient, identifyCaller } from "../_shared/auth.ts";
import { corsHeaders, json } from "../_shared/http.ts";
import { ageInMinutes, consumeBudget, loadPrices, nextRow, savePrices, type PriceRow } from "../_shared/prices.ts";
import {
  fetchFxRates,
  fetchGoldFromGoldApiCom,
  fetchGoldFromGoldApiIo,
  fetchTwelveDataPrices,
  fetchYahooQuote,
  isUsMarketOpen,
  type Quote,
} from "../_shared/providers.ts";

const TWELVE_DATA_DAILY_LIMIT = 780; // free plan: 800/day, keep a margin
const TWELVE_DATA_PER_RUN = 8; // free plan: 8 credits/minute
const GOLDAPI_IO_DAILY_LIMIT = 3; // free plan: 100/month
const YAHOO_PER_RUN = 40;

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const admin = adminClient();
  const caller = await identifyCaller(req, admin);
  if (caller.kind === "anonymous") return json({ error: "Sign in to refresh prices" }, 401);

  const byUser = caller.kind === "user";
  const now = new Date();
  const report: Record<string, unknown> = {};
  const prices = await loadPrices(admin);
  const rows: PriceRow[] = [];

  // Exchange rates
  if (ageInMinutes(prices.get("FX:EGP"), now) >= (byUser ? 10 : 55)) {
    try {
      const { rates, source } = await fetchFxRates();
      for (const [code, rate] of Object.entries(rates)) {
        rows.push(nextRow(prices.get(`FX:${code}`), `FX:${code}`, "fx", { price: rate, currency: "USD", source }, now));
      }
      report.fx = `updated ${Object.keys(rates).length} rates from ${source}`;
    } catch (err) {
      report.fx = `failed: ${errorMessage(err)}`;
    }
  } else {
    report.fx = "fresh";
  }

  // Gold
  if (ageInMinutes(prices.get("METAL:XAU"), now) >= (byUser ? 10 : 55)) {
    let quote: Quote | null = null;
    try {
      quote = await fetchGoldFromGoldApiCom();
    } catch (primaryErr) {
      const key = Deno.env.get("GOLDAPI_IO_KEY");
      if (key && (await consumeBudget(admin, "goldapi.io", 1, GOLDAPI_IO_DAILY_LIMIT))) {
        try {
          quote = await fetchGoldFromGoldApiIo(key);
        } catch (fallbackErr) {
          report.gold = `failed: ${errorMessage(primaryErr)}; ${errorMessage(fallbackErr)}`;
        }
      } else {
        report.gold = `failed: ${errorMessage(primaryErr)}`;
      }
    }
    if (quote) {
      rows.push(nextRow(prices.get("METAL:XAU"), "METAL:XAU", "metal", { ...quote, name: "Gold spot (troy ounce)" }, now));
      report.gold = `updated from ${quote.source}`;
    }
  } else {
    report.gold = "fresh";
  }

  // Stocks: everything anyone holds or follows, plus SPUS for empty vaults
  const [{ data: held }, { data: followed }] = await Promise.all([
    admin.from("assets").select("ticker").eq("kind", "stock").is("archived_at", null),
    admin.from("followed_tickers").select("ticker"),
  ]);
  const tickers = new Set<string>(["SPUS"]);
  for (const r of [...(held ?? []), ...(followed ?? [])]) if (r.ticker) tickers.add(r.ticker);

  const marketOpen = isUsMarketOpen(now);
  const maxAge = byUser ? 10 : marketOpen ? 14 : 360;
  const due = [...tickers]
    .filter((t) => ageInMinutes(prices.get(`STOCK:${t}`), now) >= maxAge)
    .sort((a, b) => ageInMinutes(prices.get(`STOCK:${b}`), now) - ageInMinutes(prices.get(`STOCK:${a}`), now));

  const quotes: Record<string, Quote> = {};
  const tdKey = Deno.env.get("TWELVE_DATA_API_KEY");
  const tdBatch = due.slice(0, TWELVE_DATA_PER_RUN);
  if (tdKey && tdBatch.length > 0 && (await consumeBudget(admin, "twelvedata", tdBatch.length, TWELVE_DATA_DAILY_LIMIT))) {
    try {
      Object.assign(quotes, await fetchTwelveDataPrices(tdBatch, tdKey));
    } catch (err) {
      report.twelvedata = `failed: ${errorMessage(err)}`;
    }
  }
  const remaining = due.filter((t) => !quotes[t]).slice(0, YAHOO_PER_RUN);
  await Promise.all(
    remaining.map(async (t) => {
      try {
        const q = await fetchYahooQuote(t);
        if (q) quotes[t] = q;
      } catch {
        // keep the last known price
      }
    }),
  );
  for (const [ticker, quote] of Object.entries(quotes)) {
    rows.push(nextRow(prices.get(`STOCK:${ticker}`), `STOCK:${ticker}`, "stock", quote, now));
  }
  report.stocks = { due: due.length, updated: Object.keys(quotes).length, marketOpen };

  await savePrices(admin, rows);

  // Today's prices also go into the daily history (the day's last refresh becomes its close)
  if (rows.length > 0) {
    const day = now.toISOString().slice(0, 10);
    const { error } = await admin.from("historical_prices").upsert(
      rows.map((r) => ({ symbol: r.symbol, price_date: day, price: r.price, currency: r.currency, source: `${r.source} (live)` })),
      { onConflict: "symbol,price_date" },
    );
    report.history = error ? `failed: ${error.message}` : `saved ${rows.length} closes for ${day}`;
  }
  return json(report);
});
