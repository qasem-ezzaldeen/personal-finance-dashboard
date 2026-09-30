// Validates a stock/ETF symbol before the app saves it, and stores its current price.
import { adminClient, identifyCaller } from "../_shared/auth.ts";
import { corsHeaders, json } from "../_shared/http.ts";
import { ageInMinutes, consumeBudget, loadPrices, nextRow, savePrices } from "../_shared/prices.ts";
import { fetchTwelveDataQuote, fetchYahooQuote, type Quote } from "../_shared/providers.ts";
import { isValidTickerFormat, normalizeTicker } from "../_shared/tickers.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);

  const admin = adminClient();
  const caller = await identifyCaller(req, admin);
  if (caller.kind !== "user") return json({ error: "Sign in to look up tickers" }, 401);

  let body: { ticker?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Send a JSON body like {\"ticker\": \"AAPL\"}" }, 400);
  }
  const ticker = normalizeTicker(typeof body.ticker === "string" ? body.ticker : "");
  if (!isValidTickerFormat(ticker)) {
    return json({ error: "Enter a ticker like AAPL or SPUS" }, 400);
  }

  const now = new Date();
  const prices = await loadPrices(admin);
  const existing = prices.get(`STOCK:${ticker}`);
  if (existing && ageInMinutes(existing, now) < 24 * 60) {
    return json({ ticker, name: existing.display_name, price: Number(existing.price), currency: existing.currency });
  }

  let quote: Quote | null = null;
  const tdKey = Deno.env.get("TWELVE_DATA_API_KEY");
  if (tdKey && (await consumeBudget(admin, "twelvedata", 1, 780))) {
    try {
      quote = await fetchTwelveDataQuote(ticker, tdKey);
    } catch {
      quote = null;
    }
  }
  if (!quote) {
    try {
      quote = await fetchYahooQuote(ticker);
    } catch {
      quote = null;
    }
  }
  if (!quote) {
    return json({ error: `We couldn't find "${ticker}". Check the symbol and try again.` }, 404);
  }

  await savePrices(admin, [nextRow(existing, `STOCK:${ticker}`, "stock", quote, now)]);
  return json({ ticker, name: quote.name ?? null, price: quote.price, currency: quote.currency });
});
