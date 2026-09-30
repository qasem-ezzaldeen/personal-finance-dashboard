-- AuraFinance: scheduled jobs and API call budgets.
-- The market refresh job needs two Vault secrets (see docs/SETUP.md):
--   aurafinance_project_url        e.g. https://<project-ref>.supabase.co
--   aurafinance_service_role_key   the project's service role key
-- Without them the job does nothing; everything else still runs.

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

create or replace function private.invoke_market_refresh()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text;
  v_key text;
begin
  select s.decrypted_secret into v_url from vault.decrypted_secrets s where s.name = 'aurafinance_project_url';
  select s.decrypted_secret into v_key from vault.decrypted_secrets s where s.name = 'aurafinance_service_role_key';
  if v_url is null or v_key is null then
    raise notice 'Market refresh skipped: Vault secrets are not configured';
    return;
  end if;

  perform net.http_post(
    url := rtrim(v_url, '/') || '/functions/v1/market-refresh',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_key
    ),
    body := jsonb_build_object('source', 'cron'),
    timeout_milliseconds := 30000
  );
end;
$$;

revoke all on function private.invoke_market_refresh() from public, anon, authenticated;

-- Re-running this migration replaces the jobs (cron.schedule upserts by name)
select cron.schedule('aurafinance-market-refresh', '*/15 * * * *', $$select private.invoke_market_refresh()$$);
select cron.schedule('aurafinance-automations', '5 * * * *', $$select private.run_due_automations()$$);
select cron.schedule('aurafinance-zakat-daily', '20 * * * *', $$select private.run_zakat_daily()$$);

-- Daily API call budgets for the price functions (service role only)
create or replace function public.consume_api_budget(p_provider text, p_calls integer, p_daily_limit integer)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_used integer;
begin
  insert into private.api_usage (provider, usage_date, calls)
  values (p_provider, (now() at time zone 'UTC')::date, 0)
  on conflict (provider, usage_date) do nothing;

  select calls into v_used from private.api_usage
    where provider = p_provider and usage_date = (now() at time zone 'UTC')::date
    for update;

  if v_used + p_calls > p_daily_limit then
    return false;
  end if;

  update private.api_usage set calls = calls + p_calls
    where provider = p_provider and usage_date = (now() at time zone 'UTC')::date;
  return true;
end;
$$;

revoke all on function public.consume_api_budget(text, integer, integer) from public, anon, authenticated;
grant execute on function public.consume_api_budget(text, integer, integer) to service_role;
