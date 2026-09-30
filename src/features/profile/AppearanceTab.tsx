import { Monitor, Moon, Play, Sun } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Collapse } from "@/components/ui/Collapse";
import { GrowthPill, ProgressBar, Segmented } from "@/components/ui/misc";
import { useVault, useVaultAction } from "@/features/vault/VaultProvider";
import { updateProfile } from "@/lib/api";
import { applyMotion, useMotionScale } from "@/lib/motion";
import { applyTheme } from "@/lib/theme";
import type { AnimationSpeed, ThemeChoice } from "@/lib/types";

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
  { value: "light", label: <><Sun className="size-4" aria-hidden="true" /> Light</>, hint: "Soft pastels on a warm cream background." },
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

export function AppearanceTab() {
  return (
    <div className="flex flex-col gap-5">
      <ThemeCard />
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
