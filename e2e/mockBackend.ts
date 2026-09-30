// Answers the app's Supabase calls with fixture data so the UI can be tested without a database.
import type { Page, Route } from "@playwright/test";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const NOW = Date.now();
const iso = (daysAgo: number) => new Date(NOW - daysAgo * 86400000).toISOString();
const day = (daysAgo: number) => iso(daysAgo).slice(0, 10);

const asset = (id: string, kind: string, name: string, extra: Record<string, unknown> = {}) => ({
  id, user_id: USER_ID, kind, name, currency: null, karat: null, ticker: null, manual_unit_price: null, balance: 0,
  color: "mint", note: "", sort_order: 0, hide_when_empty: false, archived_at: null, created_at: iso(300), ...extra,
});
const purchase = (id: string, assetId: string, quantity: number, cost: number | null, costCurrency: string | null, daysAgo: number, opening = false, estimated = false) => ({
  id, user_id: USER_ID, asset_id: assetId, quantity, cost_total: cost, cost_currency: costCurrency,
  acquired_on: day(daysAgo), note: "", is_opening_balance: opening, cost_is_estimated: estimated,
  cost_estimate_attempted_at: estimated ? iso(1) : null, created_at: iso(daysAgo),
});
const price = (symbol: string, kind: string, value: number, previous: number, name: string | null = null) => ({
  symbol, kind, price: value, previous_price: previous, currency: "USD", display_name: name, source: "fixture", fetched_at: iso(0.01), changed_at: iso(0.01),
});

export const FIXTURES: Record<string, unknown[]> = {
  profiles: [{
    user_id: USER_ID, full_name: "Qasem", display_name: "qasem", phone: "", country: "Egypt", timezone: "Africa/Cairo",
    avatar_color: "lilac", vault_name: "Qasem's Vault", base_currency: "EGP", display_currencies: ["USD", "AUD"],
    income_currency: "USD", number_locale: "en-US", zakat_enabled: true, animation_speed: "normal", theme: "light", imported_at: iso(1), created_at: iso(2), updated_at: iso(1),
  }],
  pricing_settings: [{
    user_id: USER_ID, gold_mode: "live", manual_gold_24k_price: null, manual_gold_currency: "EGP", gold_premium_pct: 2.5,
    gold_21k_adjustment: -30, gold_24k_adjustment: 30, gold_adjustment_currency: "EGP",
  }],
  asset_groups: [
    { user_id: USER_ID, kind: "cash", name: "Cash", color: "sky", sort_order: 0 },
    { user_id: USER_ID, kind: "gold", name: "Gold", color: "butter", sort_order: 1 },
    { user_id: USER_ID, kind: "stock", name: "Stocks & ETFs", color: "lavender", sort_order: 2 },
    { user_id: USER_ID, kind: "other", name: "Other", color: "peach", sort_order: 3 },
  ],
  assets: [
    asset("pending", "pending_income", "Upcoming Income", { currency: "USD", balance: 1250, color: "slate" }),
    asset("qnb", "cash", "QNB Bebasata", { currency: "USD", balance: 3200, color: "#0ea5e9", sort_order: 0 }),
    asset("nsave", "cash", "nsave", { currency: "USD", balance: 1500.5, color: "#ef4444", sort_order: 1 }),
    asset("cib", "cash", "CIB Savings", { currency: "EGP", balance: 45000, color: "#22c55e", sort_order: 2 }),
    asset("paypal", "cash", "PayPal", { currency: "USD", balance: 0, color: "#3b82f6", sort_order: 3, hide_when_empty: true }),
    asset("ingots", "gold", "Gold ingots", { karat: 24, color: "butter", sort_order: 0 }),
    asset("jewelry", "gold", "Gold jewelry", { karat: 21, color: "sand", sort_order: 1 }),
    asset("spus", "stock", "SPUS ETF", { ticker: "SPUS", color: "lavender", sort_order: 0 }),
    asset("aapl", "stock", "Apple", { ticker: "AAPL", color: "sky", sort_order: 1 }),
  ],
  asset_purchases: [
    purchase("p1", "ingots", 2, 9200, "EGP", 400),
    purchase("p2", "ingots", 10, 52000, "EGP", 120, false, true),
    purchase("p3", "ingots", 2, 11200, "EGP", 2),
    purchase("p4", "jewelry", 40, null, null, 30, true),
    purchase("p5", "spus", 12, 610, "USD", 200),
    purchase("p6", "aapl", 3, 690, "USD", 90),
  ],
  goals: [
    { id: "zakat", user_id: USER_ID, name: "Zakat threshold", emoji: "🕌", target_amount: 85, target_unit: "GOLD_24K_G", include_upcoming: false, sort_order: 0, is_system: true },
    { id: "g1", user_id: USER_ID, name: "Emergency fund", emoji: "💰", target_amount: 10000, target_unit: "USD", include_upcoming: true, sort_order: 1, is_system: false },
    { id: "g2", user_id: USER_ID, name: "Move to Australia", emoji: "🇦🇺", target_amount: 40000, target_unit: "AUD", include_upcoming: true, sort_order: 2, is_system: false },
    { id: "g3", user_id: USER_ID, name: "Gold savings", emoji: "🪙", target_amount: 200, target_unit: "GOLD_24K_G", include_upcoming: false, sort_order: 3, is_system: false },
  ],
  zakat_hawl: [{ user_id: USER_ID, hawl_start_date: day(211), last_checked_on: day(0), start_wealth: 450000, start_wealth_currency: "EGP", is_first_hawl: false }],
  zakat_payments: [],
  automation_rules: [
    { id: "r1", user_id: USER_ID, name: "Payday sweep", enabled: true, day_of_month: 24, amount_mode: "all", fixed_amount: null, from_asset_id: "pending", to_asset_id: "paypal", last_run_period: "2026-09", last_run_at: iso(6), last_error: null, created_at: iso(10) },
    { id: "r2", user_id: USER_ID, name: "PayPal consolidation", enabled: true, day_of_month: 1, amount_mode: "all", fixed_amount: null, from_asset_id: "paypal", to_asset_id: "nsave", last_run_period: "2026-09", last_run_at: iso(29), last_error: null, created_at: iso(10) },
  ],
  followed_tickers: [{ user_id: USER_ID, ticker: "NVDA", sort_order: 0 }],
  price_overrides: [],
  market_prices: [
    price("FX:EGP", "fx", 49.93, 49.85, "Egyptian Pound"),
    price("FX:AUD", "fx", 1.5, 1.51, "Australian Dollar"),
    price("FX:EUR", "fx", 0.92, 0.92),
    price("METAL:XAU", "metal", 4226.1, 4210),
    price("STOCK:SPUS", "stock", 59.09, 58.7, "SP Funds S&P 500 Sharia ETF"),
    price("STOCK:AAPL", "stock", 224.23, 226.1, "Apple Inc."),
    price("STOCK:NVDA", "stock", 119.37, 121, "NVIDIA Corporation"),
  ],
  transactions: [
    { id: "t4", seq: 4, user_id: USER_ID, kind: "income", description: "Client project", amount: 500, currency: "USD", rate_to_base: 49.93, base_currency: "EGP", from_asset_id: null, from_asset_name: null, to_asset_id: "pending", to_asset_name: "Upcoming Income", converted_amount: null, converted_currency: null, fx_rate: null, pending_before: 750, pending_after: 1250, automation_rule_id: null, is_imported: false, occurred_at: iso(0.2) },
    { id: "t3", seq: 3, user_id: USER_ID, kind: "income", description: "Hourly: 5 h 0 min × $50.00/h", amount: 250, currency: "USD", rate_to_base: 49.93, base_currency: "EGP", from_asset_id: null, from_asset_name: null, to_asset_id: "pending", to_asset_name: "Upcoming Income", converted_amount: null, converted_currency: null, fx_rate: null, pending_before: 500, pending_after: 750, automation_rule_id: null, is_imported: false, occurred_at: iso(3) },
    { id: "t2", seq: 2, user_id: USER_ID, kind: "automation", description: "Payday sweep", amount: 800, currency: "USD", rate_to_base: 49.9, base_currency: "EGP", from_asset_id: "pending", from_asset_name: "Upcoming Income", to_asset_id: "paypal", to_asset_name: "PayPal", converted_amount: null, converted_currency: null, fx_rate: null, pending_before: 800, pending_after: 0, automation_rule_id: "r1", is_imported: false, occurred_at: iso(6) },
    { id: "t1", seq: 1, user_id: USER_ID, kind: "imported", description: "", amount: 500, currency: "USD", rate_to_base: 49.93, base_currency: "EGP", from_asset_id: null, from_asset_name: null, to_asset_id: null, to_asset_name: null, converted_amount: null, converted_currency: null, fx_rate: null, pending_before: 0, pending_after: 500, automation_rule_id: null, is_imported: true, occurred_at: iso(40) },
  ],
  transaction_changes: [
    { id: 1, transaction_id: "t3", asset_id: "pending", asset_name: "Upcoming Income", delta: 250 },
    { id: 2, transaction_id: "t4", asset_id: "pending", asset_name: "Upcoming Income", delta: 500 },
  ],
  dashboards: [],
};

function b64url(value: object) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function fakeSession() {
  const exp = Math.floor(NOW / 1000) + 3600 * 24;
  const token = `${b64url({ alg: "HS256", typ: "JWT" })}.${b64url({ sub: USER_ID, role: "authenticated", exp, aud: "authenticated", email: "qasem@example.test" })}.sig`;
  return {
    access_token: token,
    token_type: "bearer",
    expires_in: 86400,
    expires_at: exp,
    refresh_token: "fixture-refresh",
    user: { id: USER_ID, aud: "authenticated", role: "authenticated", email: "qasem@example.test", app_metadata: {}, user_metadata: {}, created_at: iso(300) },
  };
}

export interface MockOptions {
  signedIn?: boolean;
  /** Fields to override on the profile row, e.g. { animation_speed: "off" } */
  profile?: Record<string, unknown>;
  /** Called for every write so tests can assert what the app sent */
  onWrite?: (entry: { method: string; path: string; body: unknown }) => void;
}

/** Installs the fake backend on a page. Call before navigating. */
export async function mockBackend(page: Page, { signedIn = true, onWrite, profile }: MockOptions = {}) {
  const fixtures: Record<string, unknown[]> = {
    ...FIXTURES,
    profiles: [{ ...(FIXTURES.profiles[0] as object), ...profile }],
  };
  if (signedIn) {
    await page.addInitScript((session) => {
      localStorage.setItem("sb-127-auth-token", JSON.stringify(session));
    }, fakeSession());
  }

  await page.route(/127\.0\.0\.1:54321\/rest\/v1\//, async (route: Route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace("/rest/v1/", "");
    if (request.method() !== "GET") {
      onWrite?.({ method: request.method(), path, body: request.postDataJSON?.() ?? null });
      return route.fulfill({ status: 200, contentType: "application/json", body: path.startsWith("rpc/") ? "null" : "[]" });
    }
    let rows = [...(fixtures[path] ?? [])] as Array<Record<string, unknown>>;
    // Minimal filter support for the queries the app makes
    for (const [key, raw] of url.searchParams) {
      if (["select", "order", "limit", "offset", "or"].includes(key)) continue;
      const [op, value] = [raw.slice(0, raw.indexOf(".")), raw.slice(raw.indexOf(".") + 1)];
      if (op === "eq") rows = rows.filter((r) => String(r[key]) === value);
      if (op === "gt") rows = rows.filter((r) => Number(r[key]) > Number(value));
      if (op === "in") {
        const set = new Set(value.replace(/^\(|\)$/g, "").split(","));
        rows = rows.filter((r) => set.has(String(r[key])));
      }
    }
    const offset = Number(url.searchParams.get("offset") ?? 0);
    const limit = url.searchParams.has("limit") ? Number(url.searchParams.get("limit")) : rows.length;
    rows = rows.slice(offset, offset + limit);
    const single = (request.headers()["accept"] ?? "").includes("vnd.pgrst.object");
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(single ? (rows[0] ?? null) : rows),
    });
  });

  await page.route(/127\.0\.0\.1:54321\/functions\/v1\//, (route) => {
    const fn = new URL(route.request().url()).pathname.split("/").pop();
    const bodies: Record<string, unknown> = {
      "check-ticker": { ticker: "MSFT", name: "Microsoft Corporation", price: 417.88, currency: "USD" },
      "estimate-costs": { updated: 0, failed: 0 },
      // Real closing prices on 3 March 2025
      "price-on-date": {
        date: "2025-03-03",
        xau: { price: 2901.1, date: "2025-03-03", source: "fixture" },
        fx: { EGP: { price: 50.4413, date: "2025-03-03", source: "fixture" } },
      },
    };
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(bodies[fn ?? ""] ?? {}) });
  });
  await page.route(/127\.0\.0\.1:54321\/auth\/v1\//, (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(signedIn ? fakeSession().user : {}) }),
  );
  // Realtime isn't needed for these tests
  await page.route(/127\.0\.0\.1:54321\/realtime\//, (route) => route.abort());
}
