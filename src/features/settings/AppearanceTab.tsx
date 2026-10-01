import { Check, Monitor, Moon, Play, Sun } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Collapse } from "@/components/ui/Collapse";
import { GrowthPill, ProgressBar, Segmented } from "@/components/ui/misc";
import { useVault, useVaultAction } from "@/features/vault/VaultProvider";
import { updateProfile } from "@/lib/api";
import { applyMotion, useMotionScale } from "@/lib/motion";
import { cn } from "@/lib/cn";
import { applyPalette, applyTheme } from "@/lib/theme";
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

  return (
    <Card>
      <CardHeader title="Theme" subtitle="Light or dark colors" />
      <CardBody className="flex flex-col gap-3">
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
  { value: "vivid", label: "Vivid", hint: "Bright, saturated and bold" },
];

const PREVIEW_SWATCHES = ["sky", "butter", "lavender", "peach", "mint", "rose", "teal", "coral"];

/** A small sample of the app drawn in a palette's own colors (from colors.css, via data-palette-preview). */
function PalettePreview({ palette }: { palette: ColorPalette }) {
  return (
    <div data-palette-preview={palette} className="rounded-xl bg-canvas p-2" aria-hidden="true">
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
  const { vault, userId } = useVault();
  const run = useVaultAction();
  const current = vault.profile.color_palette;

  return (
    <Card>
      <CardHeader title="Color palette" subtitle="Colors for the whole app, in light and dark" />
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
                <PalettePreview palette={value} />
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
      </CardBody>
    </Card>
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
