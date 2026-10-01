-- AuraFinance: the Vivid palette becomes OLED (pure black, always dark), and each palette's hero color can be
-- changed in Settings › Appearance.

-- ---------------------------------------------------------------------------
-- Vivid → OLED
-- ---------------------------------------------------------------------------

alter table public.profiles drop constraint profiles_color_palette_check;
update public.profiles set color_palette = 'oled' where color_palette = 'vivid';
alter table public.profiles add constraint profiles_color_palette_check
  check (color_palette in ('pastel', 'minimal', 'sea', 'autumn', 'nature', 'oled'));

-- ---------------------------------------------------------------------------
-- Hero colors: { "<palette>": "#rrggbb" }, one per palette, none = the palette's own
-- ---------------------------------------------------------------------------

alter table public.profiles add column palette_accents jsonb not null default '{}'::jsonb;
grant update (palette_accents) on public.profiles to authenticated;

-- Keeps only well-formed entries (known palette, #rrggbb color)
create or replace function private.clean_palette_accents(p jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select coalesce(jsonb_object_agg(e.key, lower(e.value #>> '{}')), '{}'::jsonb)
  from jsonb_each(case when jsonb_typeof(p) = 'object' then p else '{}'::jsonb end) e
  where e.key in ('pastel', 'minimal', 'sea', 'autumn', 'nature', 'oled')
    and jsonb_typeof(e.value) = 'string'
    and (e.value #>> '{}') ~ '^#[0-9a-fA-F]{6}$';
$$;

create or replace function private.guard_palette_accents()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if jsonb_typeof(new.palette_accents) is distinct from 'object'
    or (select count(*) from jsonb_object_keys(new.palette_accents)) <> (select count(*) from jsonb_object_keys(private.clean_palette_accents(new.palette_accents))) then
    raise exception 'Hero colors must be #rrggbb colors for known palettes' using errcode = '22023';
  end if;
  new.palette_accents := private.clean_palette_accents(new.palette_accents);
  return new;
end;
$$;

create trigger profiles_palette_accents_guard before insert or update of palette_accents on public.profiles
  for each row execute function private.guard_palette_accents();

-- ---------------------------------------------------------------------------
-- Restoring a backup also restores the palette (Vivid becomes OLED) and its hero colors
-- ---------------------------------------------------------------------------

alter function public.restore_vault(jsonb) rename to restore_vault_core;
alter function public.restore_vault_core(jsonb) set schema private;
revoke all on function private.restore_vault_core(jsonb) from public, anon, authenticated;

create or replace function public.restore_vault(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
  v_result jsonb;
  v_palette text := p #>> '{profile,color_palette}';
begin
  -- The core restore only knows the old palette names; the palette is set below instead
  v_result := private.restore_vault_core(
    case when jsonb_typeof(p -> 'profile') = 'object' then jsonb_set(p, '{profile,color_palette}', 'null'::jsonb) else p end
  );
  if v_palette = 'vivid' then
    v_palette := 'oled';
  end if;
  update public.profiles set
    color_palette = case when v_palette in ('pastel', 'minimal', 'sea', 'autumn', 'nature', 'oled') then v_palette else color_palette end,
    palette_accents = private.clean_palette_accents(p #> '{profile,palette_accents}')
  where user_id = v_uid;
  return v_result;
end;
$$;

revoke all on function public.restore_vault(jsonb) from public, anon;
grant execute on function public.restore_vault(jsonb) to authenticated;
