// Fills in the price paid for purchases saved with a date but no price, using the market price
// on that date. Results are marked as estimates; typing the real price replaces them.
import { adminClient, identifyCaller } from "../_shared/auth.ts";
import { historicalPrice } from "../_shared/history.ts";
import { corsHeaders, json } from "../_shared/http.ts";
import { estimateGoldGram, type GoldSettings } from "../_shared/estimates.ts";

const MAX_PER_CALL = 30;
const RETRY_AFTER_HOURS = 12;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const admin = adminClient();
  const caller = await identifyCaller(req, admin);
  if (caller.kind !== "user") return json({ error: "Sign in first" }, 401);
  const userId = caller.userId;

  const retryBefore = new Date(Date.now() - RETRY_AFTER_HOURS * 3600_000).toISOString();
  const [{ data: purchases, error }, { data: profile }, { data: pricing }, { data: market }] = await Promise.all([
    admin
      .from("asset_purchases")
      .select("id, quantity, acquired_on, cost_estimate_attempted_at, assets!inner(kind, karat, ticker)")
      .eq("user_id", userId)
      .is("cost_total", null)
      .in("assets.kind", ["gold", "stock"])
      .or(`cost_estimate_attempted_at.is.null,cost_estimate_attempted_at.lt.${retryBefore}`)
      .limit(MAX_PER_CALL),
    admin.from("profiles").select("base_currency, timezone").eq("user_id", userId).single(),
    admin.from("pricing_settings").select("*").eq("user_id", userId).single(),
    admin.from("market_prices").select("symbol, price, currency"),
  ]);
  if (error) return json({ error: error.message }, 500);
  if (!profile || !pricing) return json({ error: "Vault not set up" }, 400);

  const base = profile.base_currency as string;
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: profile.timezone }).format(new Date());
  const latest = new Map((market ?? []).map((m) => [m.symbol as string, { price: Number(m.price), currency: m.currency as string }]));

  // Today's (or a future) date uses the live price; past dates use that day's close
  const priceOn = async (symbol: string, date: string) => {
    if (date >= today) {
      const live = latest.get(symbol);
      return live ? { price: live.price, currency: live.currency } : null;
    }
    return historicalPrice(admin, symbol, date);
  };
  const usdRateOn = async (currency: string, date: string) =>
    currency === "USD" ? 1 : ((await priceOn(`FX:${currency}`, date))?.price ?? null);

  let updated = 0;
  let failed = 0;
  for (const p of purchases ?? []) {
    const asset = (p as unknown as { assets: { kind: string; karat: 21 | 24 | null; ticker: string | null } }).assets;
    const date = p.acquired_on as string;
    let cost: number | null = null;
    let currency: string | null = null;

    try {
      if (asset.kind === "gold" && asset.karat) {
        const [xau, baseRate, adjRate] = await Promise.all([
          priceOn("METAL:XAU", date),
          usdRateOn(base, date),
          usdRateOn(pricing.gold_adjustment_currency, date),
        ]);
        if (xau && baseRate && adjRate) {
          const gram = estimateGoldGram(asset.karat, xau.price, baseRate, adjRate, pricing as GoldSettings);
          cost = Number(p.quantity) * gram;
          currency = base;
        } else {
          console.warn(`[estimate-costs] no gold inputs for ${date}: xau=${xau?.price} ${base}=${baseRate} adj=${adjRate}`);
        }
      } else if (asset.kind === "stock" && asset.ticker) {
        const quote = await priceOn(`STOCK:${asset.ticker}`, date);
        if (quote) {
          cost = Number(p.quantity) * quote.price;
          currency = quote.currency;
        }
      }
    } catch (err) {
      console.warn(`[estimate-costs] purchase ${p.id}:`, err instanceof Error ? err.message : err);
      cost = null;
    }

    const patch = cost !== null && currency
      ? { cost_total: Math.round(cost * 100) / 100, cost_currency: currency, cost_is_estimated: true, cost_estimate_attempted_at: new Date().toISOString() }
      : { cost_estimate_attempted_at: new Date().toISOString() };
    await admin.from("asset_purchases").update(patch).eq("id", p.id).eq("user_id", userId);
    if (cost !== null) updated++;
    else failed++;
  }

  return json({ updated, failed });
});
