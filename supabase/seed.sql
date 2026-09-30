-- LOCAL DEVELOPMENT ONLY (runs on `supabase db reset`, never on the hosted project).
--
-- Test accounts (local Supabase only):
--   demo@aurafinance.test   / aura-demo-2026   -> has data from the previous version ready to import
--   second@aurafinance.test / aura-demo-2026   -> empty; used to test that vaults are isolated

-- The previous version's table already exists on the hosted project; recreate it locally.
create table if not exists public.dashboards (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  data jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.dashboards enable row level security;
create policy "own dashboard: select" on public.dashboards for select to authenticated using (user_id = auth.uid());
create policy "own dashboard: insert" on public.dashboards for insert to authenticated with check (user_id = auth.uid());
create policy "own dashboard: update" on public.dashboards for update to authenticated using (user_id = auth.uid());

-- Test users
do $$
declare
  v_demo uuid := '11111111-1111-4111-8111-111111111111';
  v_second uuid := '22222222-2222-4222-8222-222222222222';
  v_user record;
begin
  for v_user in select * from (values
    (v_demo, 'demo@aurafinance.test'),
    (v_second, 'second@aurafinance.test')
  ) as t(id, email) loop
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, recovery_token, email_change_token_new, email_change
    ) values (
      '00000000-0000-0000-0000-000000000000', v_user.id, 'authenticated', 'authenticated', v_user.email,
      extensions.crypt('aura-demo-2026', extensions.gen_salt('bf')), now(),
      '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', ''
    );
    insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    values (gen_random_uuid(), v_user.id, v_user.id::text,
      jsonb_build_object('sub', v_user.id::text, 'email', v_user.email, 'email_verified', true),
      'email', now(), now(), now());
  end loop;
end;
$$;

-- A vault shaped exactly like the previous app's JSON document
insert into public.dashboards (id, user_id, data) values (
  '11111111-1111-4111-8111-111111111111',
  '11111111-1111-4111-8111-111111111111',
  $json${
    "assets": [
      {"id": "qnb_bebasata", "name": "QNB Bebasata", "category": "Cash Savings", "holdings": 3200, "currency": "USD", "color": "#0ea5e9"},
      {"id": "nsave", "name": "nsave", "category": "nsave Savings", "holdings": 1500.5, "currency": "USD", "color": "#ef4444"},
      {"id": "asset_1", "name": "CIB Savings", "category": "Cash Savings", "holdings": 45000, "currency": "EGP", "color": "#22c55e"},
      {"id": "gold", "name": "Gold Savings (21k)", "category": "Gold Savings", "holdings": 40, "currency": "Gold (Grams)", "color": "#eab308"},
      {"id": "asset_2", "name": "Gold Ingots", "category": "Gold Savings", "holdings": 25, "currency": "Gold 24k (Grams)", "color": "#f97316"},
      {"id": "asset_3", "name": "SPUS ETF", "category": "Stocks", "holdings": 12, "currency": "Stock", "color": "#a855f7", "ticker": "SPUS", "stockPrice": 59.09},
      {"id": "asset_4", "name": "Apple", "category": "Stocks", "holdings": 3, "currency": "Stock", "color": "#3b82f6", "ticker": "APPLE", "stockPrice": 58.62}
    ],
    "upcomingIncome": 750,
    "goldPremium": 2.5,
    "isManualGold": false,
    "manualGold24kEgp": null,
    "manualSpusPrice": null,
    "followedStockKpis": ["NVDA"],
    "stockPrices": {"SPUS": 59.09, "AAPL": 224.23},
    "cachedUsdEgp": 49.93,
    "cachedGold24kUsd": 135.88,
    "lastResetMonth": "2026-09",
    "lastNsaveTransferMonth": "2026-09",
    "zakatConsecutiveDays": 212,
    "lastZakatCheckDate": "2026-09-29",
    "goals": [
      {"id": "goal_zakat", "name": "Zakat Threshold", "currency": "Gold", "target": 85, "emoji": "🕌"},
      {"id": "goal_1", "name": "Emergency Fund", "currency": "USD", "target": 10000, "emoji": "💰"},
      {"id": "goal_2", "name": "Move to Australia", "currency": "AUD", "target": 40000, "emoji": "🇦🇺"}
    ],
    "transactions": [
      {"id": "tx_1", "amountUsd": 500, "amountEgp": 24965, "rateUsdEgp": 49.93, "timestamp": 1790000000000, "beforeIncome": 0, "afterIncome": 500},
      {"id": "tx_2", "amountUsd": 250, "amountEgp": 12482.5, "rateUsdEgp": 49.93, "timestamp": 1790500000000, "beforeIncome": 500, "afterIncome": 750, "description": "Logged via Aura Assistant"}
    ]
  }$json$::jsonb
);

-- Sample prices so the app works offline locally (the market-refresh function overwrites these)
insert into public.market_prices (symbol, kind, price, previous_price, currency, display_name, source) values
  ('FX:EGP', 'fx', 49.93, 49.85, 'USD', 'Egyptian Pound', 'seed'),
  ('FX:AUD', 'fx', 1.50, 1.51, 'USD', 'Australian Dollar', 'seed'),
  ('FX:EUR', 'fx', 0.92, 0.92, 'USD', 'Euro', 'seed'),
  ('FX:GBP', 'fx', 0.79, 0.78, 'USD', 'British Pound', 'seed'),
  ('FX:SAR', 'fx', 3.75, 3.75, 'USD', 'Saudi Riyal', 'seed'),
  ('FX:AED', 'fx', 3.6725, 3.6725, 'USD', 'UAE Dirham', 'seed'),
  ('FX:KWD', 'fx', 0.307, 0.307, 'USD', 'Kuwaiti Dinar', 'seed'),
  ('FX:CAD', 'fx', 1.36, 1.37, 'USD', 'Canadian Dollar', 'seed'),
  ('METAL:XAU', 'metal', 4226.10, 4210.00, 'USD', 'Gold spot (troy ounce)', 'seed'),
  ('STOCK:SPUS', 'stock', 59.09, 58.70, 'USD', 'SP Funds S&P 500 Sharia Industry Exclusions ETF', 'seed'),
  ('STOCK:HLAL', 'stock', 47.85, 47.90, 'USD', 'Wahed FTSE USA Shariah ETF', 'seed'),
  ('STOCK:AAPL', 'stock', 224.23, 222.10, 'USD', 'Apple Inc.', 'seed'),
  ('STOCK:NVDA', 'stock', 119.37, 121.00, 'USD', 'NVIDIA Corporation', 'seed'),
  ('STOCK:MSFT', 'stock', 417.88, 415.00, 'USD', 'Microsoft Corporation', 'seed');
