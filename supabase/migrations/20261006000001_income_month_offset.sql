-- AuraFinance: income months can start a few days before the 1st, so income logged in the last days
-- of a month counts toward the next one (Settings › Insights). 7 days unless changed; 0 is the calendar.
-- Up to 27 days, so every income month still has days of its own, even next to February.

alter table public.profiles
  add column income_month_offset integer not null default 7
    check (income_month_offset between 0 and 27);

grant update (income_month_offset) on public.profiles to authenticated;

-- ---------------------------------------------------------------------------
-- Restoring a backup also restores when income months start
-- ---------------------------------------------------------------------------

alter function public.restore_vault(jsonb) rename to restore_vault_before_income_month;
alter function public.restore_vault_before_income_month(jsonb) set schema private;
revoke all on function private.restore_vault_before_income_month(jsonb) from public, anon, authenticated;

create function public.restore_vault(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
  v_result jsonb;
  v_offset text := p #>> '{profile,income_month_offset}';
begin
  v_result := private.restore_vault_before_income_month(p);
  -- Older backups don't have it, and values out of range are ignored
  if v_offset ~ '^\d{1,2}$' and v_offset::integer between 0 and 27 then
    update public.profiles set income_month_offset = v_offset::integer where user_id = v_uid;
  end if;
  return v_result;
end;
$$;

revoke all on function public.restore_vault(jsonb) from public, anon;
grant execute on function public.restore_vault(jsonb) to authenticated;
