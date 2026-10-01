-- AuraFinance: profile cleanup, 0% gold premium and color palettes.

-- ---------------------------------------------------------------------------
-- Unused profile fields
-- ---------------------------------------------------------------------------

alter table public.profiles
  drop column full_name,
  drop column phone,
  drop column country;

-- ---------------------------------------------------------------------------
-- Color palette (Settings › Appearance); applied on top of light/dark
-- ---------------------------------------------------------------------------

alter table public.profiles
  add column color_palette text not null default 'pastel'
    check (color_palette in ('pastel', 'minimal', 'sea', 'autumn', 'nature', 'vivid'));

grant update (color_palette) on public.profiles to authenticated;

-- ---------------------------------------------------------------------------
-- Gold premium: no local premium unless the user sets one, for every account
-- ---------------------------------------------------------------------------

alter table public.pricing_settings alter column gold_premium_pct set default 0;
update public.pricing_settings set gold_premium_pct = 0 where gold_premium_pct <> 0;
