-- AuraFinance: Insights. The dashboard's change KPI can be set up (what it measures and over which
-- period), and the server remembers which price histories it has filled in.
-- The daily closes themselves live in public.historical_prices, which already exists.

-- ---------------------------------------------------------------------------
-- Change KPI settings
-- ---------------------------------------------------------------------------

alter table public.profiles
  add column kpi_metric text not null default 'net_worth'
    check (kpi_metric in ('net_worth', 'investments', 'income', 'since_purchase')),
  add column kpi_period text not null default 'month'
    check (kpi_period in ('month', '7d', '30d', '3m', 'ytd', '1y', 'all'));

grant update (kpi_metric, kpi_period) on public.profiles to authenticated;

-- ---------------------------------------------------------------------------
-- Price history backfills: which symbol was filled in from which day, and when. A symbol with no
-- data that far back (e.g. a stock listed later) would otherwise be looked up again on every visit.
-- Only the price-history function (service role) uses it.
-- ---------------------------------------------------------------------------

create table public.price_history_backfills (
  symbol text primary key,
  covered_from date not null,
  succeeded boolean not null,
  attempted_at timestamptz not null default now()
);

alter table public.price_history_backfills enable row level security;
revoke all on public.price_history_backfills from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Restoring a backup also restores the KPI settings
-- ---------------------------------------------------------------------------

alter function public.restore_vault(jsonb) rename to restore_vault_before_insights;
alter function public.restore_vault_before_insights(jsonb) set schema private;
revoke all on function private.restore_vault_before_insights(jsonb) from public, anon, authenticated;

create function public.restore_vault(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
  v_result jsonb;
  v_metric text := p #>> '{profile,kpi_metric}';
  v_period text := p #>> '{profile,kpi_period}';
begin
  v_result := private.restore_vault_before_insights(p);
  -- Older backups don't have them, and unknown values are ignored
  update public.profiles set
    kpi_metric = case when v_metric in ('net_worth', 'investments', 'income', 'since_purchase') then v_metric else kpi_metric end,
    kpi_period = case when v_period in ('month', '7d', '30d', '3m', 'ytd', '1y', 'all') then v_period else kpi_period end
  where user_id = v_uid;
  return v_result;
end;
$$;

revoke all on function public.restore_vault(jsonb) from public, anon;
grant execute on function public.restore_vault(jsonb) to authenticated;
