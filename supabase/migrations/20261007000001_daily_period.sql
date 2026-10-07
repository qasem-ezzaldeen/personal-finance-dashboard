-- AuraFinance: the change KPI and Insights can show today's change, since yesterday's close ('1d').

alter table public.profiles drop constraint profiles_kpi_period_check;
alter table public.profiles add constraint profiles_kpi_period_check
  check (kpi_period in ('1d', 'month', '7d', '30d', '3m', 'ytd', '1y', 'all'));

-- ---------------------------------------------------------------------------
-- Restoring a backup also restores a daily KPI period
-- ---------------------------------------------------------------------------

alter function public.restore_vault(jsonb) rename to restore_vault_before_daily_period;
alter function public.restore_vault_before_daily_period(jsonb) set schema private;
revoke all on function private.restore_vault_before_daily_period(jsonb) from public, anon, authenticated;

create function public.restore_vault(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
  v_result jsonb;
begin
  v_result := private.restore_vault_before_daily_period(p);
  -- The earlier step ignores periods it doesn't know
  if p #>> '{profile,kpi_period}' = '1d' then
    update public.profiles set kpi_period = '1d' where user_id = v_uid;
  end if;
  return v_result;
end;
$$;

revoke all on function public.restore_vault(jsonb) from public, anon;
grant execute on function public.restore_vault(jsonb) to authenticated;
