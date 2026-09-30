// Gold spot price and exchange rates on a given day, e.g. to value the Nisab when a Hawl started.
import { adminClient, identifyCaller } from "../_shared/auth.ts";
import { historicalPrice } from "../_shared/history.ts";
import { corsHeaders, json } from "../_shared/http.ts";

type Point = { price: number; date: string; source: string };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);

  const admin = adminClient();
  const caller = await identifyCaller(req, admin);
  if (caller.kind !== "user") return json({ error: "Sign in first" }, 401);

  let body: { date?: unknown; currencies?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Send a JSON body like {"date": "2025-03-03", "currencies": ["EGP"]}' }, 400);
  }
  const date = typeof body.date === "string" ? body.date : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date < "1990-01-01") return json({ error: "Enter a valid date" }, 400);
  const currencies = (Array.isArray(body.currencies) ? body.currencies : [])
    .filter((c): c is string => typeof c === "string" && /^[A-Z]{3}$/.test(c) && c !== "USD")
    .slice(0, 5);

  // Today or later: the latest live prices
  const today = new Date().toISOString().slice(0, 10);
  const priceOn = async (symbol: string): Promise<Point | null> => {
    if (date >= today) {
      const { data } = await admin.from("market_prices").select("price, fetched_at, source").eq("symbol", symbol).maybeSingle();
      return data ? { price: Number(data.price), date: (data.fetched_at as string).slice(0, 10), source: data.source as string } : null;
    }
    const h = await historicalPrice(admin, symbol, date);
    return h ? { price: h.price, date: h.date, source: h.source } : null;
  };

  const [xau, ...rates] = await Promise.all([priceOn("METAL:XAU"), ...currencies.map((c) => priceOn(`FX:${c}`))]);
  if (!xau) return json({ error: "No gold price is available for that date" }, 404);

  const fx: Record<string, Point> = {};
  for (const [i, code] of currencies.entries()) {
    const point = rates[i];
    if (!point) return json({ error: `No ${code} exchange rate is available for that date` }, 404);
    fx[code] = point;
  }
  return json({ date, xau, fx });
});
