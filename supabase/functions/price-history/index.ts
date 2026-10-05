// Fills the price history the Insights charts need: every daily close of the given symbols
// (gold spot, exchange rates, stocks) from a date until today. Signed-in users only, and only for
// stocks they hold or follow and currencies the app knows, since fallbacks share a daily API budget.
// The app then reads the closes from public.historical_prices directly.
import { adminClient, identifyCaller } from "../_shared/auth.ts";
import { backfillHistory, type BackfillResult } from "../_shared/history.ts";
import { corsHeaders, json } from "../_shared/http.ts";

const MAX_SYMBOLS = 25;
const SYMBOL = /^(METAL:XAU|FX:[A-Z]{3}|STOCK:[A-Z0-9][A-Z0-9.\-]{0,14})$/;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);

  const admin = adminClient();
  const caller = await identifyCaller(req, admin);
  if (caller.kind !== "user") return json({ error: "Sign in first" }, 401);

  let body: { symbols?: unknown; from?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Send a JSON body like {"symbols": ["METAL:XAU", "FX:EGP"], "from": "2025-01-01"}' }, 400);
  }
  const today = new Date().toISOString().slice(0, 10);
  const from = typeof body.from === "string" ? body.from : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || from < "1990-01-01" || from > today) return json({ error: "Enter a valid start date" }, 400);
  const symbols = [...new Set((Array.isArray(body.symbols) ? body.symbols : []).filter((s): s is string => typeof s === "string" && SYMBOL.test(s)))];
  if (symbols.length === 0) return json({ error: "Name at least one symbol" }, 400);
  if (symbols.length > MAX_SYMBOLS) return json({ error: `Ask for at most ${MAX_SYMBOLS} symbols at a time` }, 400);

  const [assets, followed, currencies] = await Promise.all([
    admin.from("assets").select("ticker").eq("user_id", caller.userId).eq("kind", "stock"),
    admin.from("followed_tickers").select("ticker").eq("user_id", caller.userId),
    admin.from("market_prices").select("symbol").eq("kind", "fx"),
  ]);
  const allowed = new Set<string>(["METAL:XAU"]);
  for (const r of [...(assets.data ?? []), ...(followed.data ?? [])]) if (r.ticker) allowed.add(`STOCK:${r.ticker}`);
  for (const r of currencies.data ?? []) allowed.add(r.symbol as string);

  const results: Record<string, BackfillResult | "not allowed"> = {};
  await Promise.all(
    symbols.map(async (symbol) => {
      if (!allowed.has(symbol)) {
        results[symbol] = "not allowed";
        return;
      }
      try {
        results[symbol] = await backfillHistory(admin, symbol, from);
      } catch (err) {
        console.warn(`[price-history] ${symbol}:`, err instanceof Error ? err.message : err);
        results[symbol] = "failed";
      }
    }),
  );
  return json({ from, results });
});
