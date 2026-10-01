import { Check, Monitor, Moon, Play, RotateCcw, Sun } from "lucide-react";
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Collapse } from "@/components/ui/Collapse";
import { GrowthPill, Notice, ProgressBar, Segmented } from "@/components/ui/misc";
import { useVault, useVaultAction } from "@/features/vault/VaultProvider";
import { updateProfile } from "@/lib/api";
import { applyMotion, useMotionScale } from "@/lib/motion";
import { ACCENT_TOKENS, accentColors } from "@/lib/accent";
import { cn, swatchHex, themeColor } from "@/lib/cn";
import { DARK_ONLY_PALETTES, applyAccents, applyPalette, applyTheme, useAccents, usePalette, useResolvedTheme } from "@/lib/theme";
import type { AnimationSpeed, ColorPalette, ThemeChoice } from "@/lib/types";

const OPTIONS: Array<{ value: AnimationSpeed; label: string; hint: string }> = [
  { value: "system", label: "Device", hint: "Normal speed, or none if your device is set to reduce motion." },
  { value: "off", label: "Off", hint: "No animations: everything changes instantly." },
  { value: "slow", label: "Slow", hint: "Gentle, relaxed transitions." },
  { value: "normal", label: "Normal", hint: "Smooth and quick." },
  { value: "fast", label: "Fast", hint: "Snappy transitions that stay out of your way." },
];

/** A small demo that replays the kinds of motion used across the app. */
function MotionPreview() {
  const [round, setRound] = useState(0);
  const [open, setOpen] = useState(true);
  const motion = useMotionScale();

  const replay = () => {
    setOpen(false);
    window.setTimeout(() => {
      setOpen(true);
      setRound((r) => r + 1);
    }, 250 * motion + 60);
  };

  return (
    <div className="flex flex-col gap-3 rounded-2xl bg-surface-muted p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-medium text-ink">Preview</p>
        <Button size="sm" variant="soft" onClick={replay}>
          <Play className="size-4" aria-hidden="true" /> Replay
        </Button>
      </div>
      <Collapse open={open}>
        <div key={round} className="flex animate-pop-in flex-col gap-3 rounded-xl border border-line bg-surface p-3">
          <div className="flex items-center justify-between gap-3 text-sm">
            <span className="font-medium text-ink">Gold ingots</span>
            <GrowthPill growth={{ cost: 100, value: 124.7, gain: 24.7, pct: 0.247, currency: "EGP", estimated: false }} size="sm" />
          </div>
          <ProgressBar value={open ? 0.62 : 0} color="butter" label="Preview progress" />
        </div>
      </Collapse>
    </div>
  );
}

const THEMES: Array<{ value: ThemeChoice; label: ReactNode; hint: string }> = [
  { value: "light", label: <><Sun className="size-4" aria-hidden="true" /> Light</>, hint: "Light backgrounds in your color palette." },
  { value: "dark", label: <><Moon className="size-4" aria-hidden="true" /> Dark</>, hint: "Easy on the eyes at night." },
  { value: "system", label: <><Monitor className="size-4" aria-hidden="true" /> Device</>, hint: "Follows your phone's or computer's light/dark setting." },
];

function ThemeCard() {
  const { vault, userId } = useVault();
  const run = useVaultAction();
  const current = vault.profile.theme;
  const darkOnly = DARK_ONLY_PALETTES.includes(usePalette());

  return (
    <Card>
      <CardHeader title="Theme" subtitle="Light or dark colors" />
      <CardBody className="flex flex-col gap-3">
        {darkOnly ? (
          <Notice tone="brand">The OLED palette is always dark. Pick another palette to use Light or Device.</Notice>
        ) : (
          <>
            <Segmented
              label="Theme"
              value={current}
              onValueChange={(theme) => {
                applyTheme(theme); // switch right away
                run(() => updateProfile(userId, { theme }));
              }}
              items={THEMES.map(({ value, label }) => ({ value, label }))}
            />
            <p className="text-sm text-ink-soft">{THEMES.find((t) => t.value === current)?.hint}</p>
          </>
        )}
      </CardBody>
    </Card>
  );
}

const PALETTES: Array<{ value: ColorPalette; label: string; hint: string }> = [
  { value: "pastel", label: "Pastel", hint: "Soft and calm, the original look" },
  { value: "minimal", label: "Minimalist", hint: "Quiet grays and graphite" },
  { value: "sea", label: "Sea & Beach", hint: "Sand, sea foam and coral" },
  { value: "autumn", label: "Autumn", hint: "Pumpkin, mustard, brick and olive" },
  { value: "nature", label: "Nature & Greenery", hint: "Leaf, moss, water and wood" },
  { value: "oled", label: "OLED", hint: "Pure black with vivid colors, always dark" },
];

const PREVIEW_SWATCHES = ["sky", "butter", "lavender", "peach", "mint", "rose", "teal", "coral"];

/** A small sample of the app drawn in a palette's own colors (from colors.css, via data-palette-preview). */
function PalettePreview({ palette, hero }: { palette: ColorPalette; hero?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const theme = useResolvedTheme();
  // A picked hero color replaces the palette's brand colors, worked out against its own card color
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    for (const token of ACCENT_TOKENS) el.style.removeProperty(`--color-${token}`);
    if (!hero) return;
    const surface = getComputedStyle(el).getPropertyValue("--color-surface").trim();
    const dark = DARK_ONLY_PALETTES.includes(palette) || theme === "dark";
    for (const [token, value] of Object.entries(accentColors(hero, dark ? "dark" : "light", surface))) el.style.setProperty(`--color-${token}`, value);
  }, [hero, theme, palette]);

  return (
    <div ref={ref} data-palette-preview={palette} className="rounded-xl bg-canvas p-2" aria-hidden="true">
      <div className="flex flex-col gap-2 rounded-lg border border-line bg-surface p-2.5">
        <div className="flex gap-1">
          {PREVIEW_SWATCHES.map((s) => (
            <span key={s} className="size-3.5 rounded-full" style={{ background: `var(--color-swatch-${s})` }} />
          ))}
        </div>
        <div className="flex flex-wrap gap-1 text-[0.65rem] font-semibold">
          <span className="rounded-md bg-cash px-1.5 py-0.5 text-cash-ink">Cash</span>
          <span className="rounded-md bg-gold px-1.5 py-0.5 text-gold-ink">Gold</span>
          <span className="rounded-md bg-stocks px-1.5 py-0.5 text-stocks-ink">Stocks</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="rounded-md bg-brand-strong px-2 py-0.5 text-[0.65rem] font-semibold text-on-brand-strong">Save</span>
          <span className="h-1.5 flex-1 rounded-full bg-surface-sunken">
            <span className="block h-full w-3/5 rounded-full" style={{ background: "var(--color-swatch-mint)" }} />
          </span>
        </div>
      </div>
    </div>
  );
}

function PaletteCard() {
  const { userId } = useVault();
  const run = useVaultAction();
  // What's showing right now (applied as soon as it's picked, then saved)
  const current = usePalette();
  const accents = useAccents();

  return (
    <Card>
      <CardHeader title="Color palette" subtitle="Colors for the whole app" />
      <CardBody>
        <div role="radiogroup" aria-label="Color palette" className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {PALETTES.map(({ value, label, hint }) => {
            const selected = value === current;
            return (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => {
                  if (selected) return;
                  applyPalette(value); // switch right away
                  run(() => updateProfile(userId, { color_palette: value }));
                }}
                className={cn(
                  "flex flex-col gap-2 rounded-2xl border p-2 text-left transition",
                  selected ? "border-transparent ring-2 ring-ink" : "border-line hover:bg-surface-muted",
                )}
              >
                <PalettePreview palette={value} hero={accents[value]} />
                <span className="flex items-start justify-between gap-2 px-1 pb-1">
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-ink">{label}</span>
                    <span className="block text-xs text-ink-soft">{hint}</span>
                  </span>
                  {selected ? <Check className="mt-0.5 size-4 shrink-0 text-ink" aria-hidden="true" /> : null}
                </span>
              </button>
            );
          })}
        </div>
        <HeroColor label={PALETTES.find((p) => p.value === current)?.label ?? "this palette"} />
      </CardBody>
    </Card>
  );
}

const HERO_PRESETS = ["sky", "lavender", "rose", "coral", "peach", "butter", "mint", "teal"];

/** The palette's hero color: buttons, links, the active page and highlights. */
function HeroColor({ label }: { label: string }) {
  const { userId } = useVault();
  const run = useVaultAction();
  const palette = usePalette();
  const accents = useAccents();
  useResolvedTheme(); // the palette's own color is read from the page, which depends on the theme
  const hero = accents[palette];
  const saveTimer = useRef<number | undefined>(undefined);

  const choose = (color: string | null) => {
    const next = { ...accents };
    if (color) next[palette] = color.toLowerCase();
    else delete next[palette];
    applyAccents(next); // see it right away
    // Dragging the color picker sends many changes; save once it settles
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => run(() => updateProfile(userId, { palette_accents: next })), 400);
  };

  return (
    <div className="mt-5 flex flex-col gap-3 border-t border-line pt-4">
      <div>
        <p className="text-sm font-medium text-ink">Hero color</p>
        <p className="text-sm text-ink-soft">
          Buttons, links and highlights in {label}. Text stays readable whatever you pick.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Hero color">
        {HERO_PRESETS.map((name, i) => {
          const value = swatchHex(name);
          return (
            <button
              key={name}
              type="button"
              onClick={() => choose(value)}
              aria-label={`Hero color ${i + 1}`}
              aria-pressed={hero === value}
              className={cn(
                "grid size-9 place-items-center rounded-full ring-offset-2 ring-offset-surface transition",
                hero === value ? "ring-2 ring-ink" : "hover:scale-105",
              )}
              style={{ background: value }}
            >
              {hero === value ? <Check className="size-4 text-ink" aria-hidden="true" /> : null}
            </button>
          );
        })}
        <label
          className={cn(
            "relative flex h-9 cursor-pointer items-center gap-2 overflow-hidden rounded-full border border-line-strong pr-3 pl-1 text-sm text-ink-soft ring-offset-2 ring-offset-surface",
            hero && !HERO_PRESETS.some((n) => swatchHex(n) === hero) && "ring-2 ring-ink",
          )}
        >
          <span className="size-7 rounded-full border border-line" style={{ background: hero ?? themeColor("brand-strong") }} aria-hidden="true" />
          Custom
          <input
            type="color"
            value={hero ?? (themeColor("brand-strong").match(/^#[0-9a-f]{6}$/i) ? themeColor("brand-strong") : "#197478")}
            onChange={(e) => choose(e.target.value)}
            className="absolute inset-0 cursor-pointer opacity-0"
            aria-label="Custom hero color"
          />
        </label>
        {hero ? (
          <Button size="sm" variant="ghost" onClick={() => choose(null)}>
            <RotateCcw className="size-4" aria-hidden="true" /> Use {label}'s own
          </Button>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-3 rounded-xl bg-surface-muted p-3 text-sm" aria-hidden="true">
        <span className="rounded-lg bg-brand-strong px-3 py-1.5 font-semibold text-on-brand-strong">Button</span>
        <span className="rounded-lg bg-brand px-3 py-1.5 font-medium text-brand-ink">Selected</span>
        <span className="font-medium text-brand-ink underline underline-offset-4">Link</span>
      </div>
    </div>
  );
}

export function AppearanceTab() {
  return (
    <div className="flex flex-col gap-5">
      <ThemeCard />
      <PaletteCard />
      <AnimationCard />
    </div>
  );
}

function AnimationCard() {
  const { vault, userId } = useVault();
  const run = useVaultAction();
  const current = vault.profile.animation_speed;
  const hint = OPTIONS.find((o) => o.value === current)?.hint;

  return (
    <Card>
      <CardHeader title="Animations" subtitle="How popups, pages, tabs and lists move" />
      <CardBody className="flex flex-col gap-4">
        <Segmented
          label="Animation speed"
          value={current}
          onValueChange={(speed) => {
            applyMotion(speed); // feel it right away
            run(() => updateProfile(userId, { animation_speed: speed }));
          }}
          items={OPTIONS.map(({ value, label }) => ({ value, label }))}
        />
        <p className="text-sm text-ink-soft">{hint}</p>
        <MotionPreview />
      </CardBody>
    </Card>
  );
}
