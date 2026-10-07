import * as RS from "@radix-ui/react-switch";
import * as RT from "@radix-ui/react-tabs";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { cn, colorValue } from "@/lib/cn";
import { formatMoney, formatPercent } from "@/lib/format";
import type { Growth } from "@/lib/valuation";

// ---------------------------------------------------------------------------
// Segmented tabs
// ---------------------------------------------------------------------------

export function Segmented<T extends string>({
  value,
  onValueChange,
  items,
  label,
  className,
  dense = false,
}: {
  value: T;
  onValueChange: (value: T) => void;
  items: Array<{ value: T; label: ReactNode }>;
  label: string;
  className?: string;
  /** Narrower options on small screens, for many short labels */
  dense?: boolean;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const [indicator, setIndicator] = useState<{ left: number; width: number } | null>(null);

  // A white pill slides under the chosen option
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const measure = () => {
      const active = list.querySelector<HTMLElement>('[data-state="active"]');
      if (active) setIndicator({ left: active.offsetLeft, width: active.offsetWidth });
    };
    const frame = requestAnimationFrame(measure);
    const observer = new ResizeObserver(measure);
    observer.observe(list);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [value, items.length]);

  return (
    <RT.Root value={value} onValueChange={(v) => onValueChange(v as T)} className={className}>
      <RT.List ref={listRef} aria-label={label} className="relative flex gap-1 rounded-xl bg-surface-muted p-1">
        {indicator ? (
          <span
            aria-hidden="true"
            className="absolute top-1 bottom-1 left-0 rounded-lg bg-surface shadow-soft"
            style={{
              width: indicator.width,
              transform: `translateX(${indicator.left}px)`,
              transition: "transform var(--duration-base) var(--ease-out-soft), width var(--duration-base) var(--ease-out-soft)",
            }}
          />
        ) : null}
        {items.map((item) => (
          <RT.Trigger
            key={item.value}
            value={item.value}
            className={cn(
              "relative flex h-9 flex-1 items-center justify-center gap-1.5 rounded-lg text-sm font-medium text-ink-soft transition",
              dense ? "px-2 sm:px-3" : "px-3",
              "hover:text-ink data-[state=active]:text-ink",
              !indicator && "data-[state=active]:bg-surface data-[state=active]:shadow-soft",
            )}
          >
            {item.label}
          </RT.Trigger>
        ))}
      </RT.List>
    </RT.Root>
  );
}

// ---------------------------------------------------------------------------
// Switch
// ---------------------------------------------------------------------------

export function Switch({
  checked,
  onCheckedChange,
  label,
  description,
  disabled,
}: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
}) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-4 py-1">
      <span className="min-w-0">
        <span className="block text-sm font-medium text-ink">{label}</span>
        {description ? <span className="block text-sm text-ink-soft">{description}</span> : null}
      </span>
      <RS.Root
        checked={checked}
        onCheckedChange={onCheckedChange}
        disabled={disabled}
        className="relative mt-0.5 h-7 w-12 shrink-0 rounded-full bg-surface-sunken transition data-[state=checked]:bg-brand-strong disabled:opacity-50"
      >
        <RS.Thumb className="block size-6 translate-x-0.5 rounded-full bg-surface shadow-soft transition data-[state=checked]:translate-x-[1.375rem]" />
      </RS.Root>
    </label>
  );
}

// ---------------------------------------------------------------------------
// Growth pill & trend arrow
// ---------------------------------------------------------------------------

export function GrowthPill({ growth, size = "md", showAmount = false }: { growth: Growth | null; size?: "sm" | "md"; showAmount?: boolean }) {
  if (!growth || growth.pct === null) return null;
  const direction = Math.abs(growth.pct) < 0.0005 ? 0 : Math.sign(growth.pct);
  const tone = direction > 0 ? "bg-gain text-gain-ink" : direction < 0 ? "bg-loss text-loss-ink" : "bg-neutral text-neutral-ink";
  const Icon = direction > 0 ? ArrowUpRight : direction < 0 ? ArrowDownRight : Minus;
  const verb = direction > 0 ? "Up" : direction < 0 ? "Down" : "Unchanged";
  const detail =
    `${growth.estimated ? "Estimated from market prices on the purchase dates. " : ""}` +
    `Paid ${formatMoney(growth.cost, growth.currency)}, worth ${formatMoney(growth.value, growth.currency)} now (${formatMoney(growth.gain, growth.currency, { signed: true })})`;
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-0.5 rounded-full font-semibold tabular",
        size === "sm" ? "px-1.5 py-0.5 text-xs" : "px-2 py-0.5 text-sm",
        tone,
      )}
      title={detail}
      aria-label={`${verb} ${formatPercent(Math.abs(growth.pct))} since purchase. ${detail}`}
    >
      <Icon className={size === "sm" ? "size-3" : "size-3.5"} aria-hidden="true" />
      {growth.estimated ? "≈" : ""}
      {formatPercent(Math.abs(growth.pct))}
      {showAmount ? <span className="ml-1 font-medium opacity-80">{formatMoney(growth.gain, growth.currency, { signed: true })}</span> : null}
    </span>
  );
}

/** A small colored square behind a KPI's icon; tones come from the color palette. */
export function KpiIcon({ tone, children }: { tone: string; children: ReactNode }) {
  return (
    <span className={cn("grid size-7 shrink-0 place-items-center rounded-lg", tone)} aria-hidden="true">
      {children}
    </span>
  );
}

/** A signed percentage in a green, red or gray pill, e.g. the change in net worth over a period. */
export function PercentPill({ pct, label, size = "md" }: { pct: number | null; label: string; size?: "sm" | "md" }) {
  if (pct === null || !Number.isFinite(pct)) return null;
  const direction = Math.abs(pct) < 0.0005 ? 0 : Math.sign(pct);
  const tone = direction > 0 ? "bg-gain text-gain-ink" : direction < 0 ? "bg-loss text-loss-ink" : "bg-neutral text-neutral-ink";
  const Icon = direction > 0 ? ArrowUpRight : direction < 0 ? ArrowDownRight : Minus;
  const verb = direction > 0 ? "Up" : direction < 0 ? "Down" : "Unchanged";
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-0.5 rounded-full font-semibold tabular",
        size === "sm" ? "px-1.5 py-0.5 text-xs" : "px-2 py-0.5 text-sm",
        tone,
      )}
      aria-label={`${verb} ${formatPercent(Math.abs(pct))} ${label}`}
    >
      <Icon className={size === "sm" ? "size-3" : "size-3.5"} aria-hidden="true" />
      {formatPercent(Math.abs(pct))}
    </span>
  );
}

export function TrendArrow({ trend }: { trend: number }) {
  if (trend > 0) {
    return (
      <span className="text-gain-ink" aria-label="up">
        ▲
      </span>
    );
  }
  if (trend < 0) {
    return (
      <span className="text-loss-ink" aria-label="down">
        ▼
      </span>
    );
  }
  return null;
}

// ---------------------------------------------------------------------------
// Small pieces
// ---------------------------------------------------------------------------

export function ProgressBar({ value, color, label }: { value: number; color?: string; label: string }) {
  const pct = Math.max(0, Math.min(1, value));
  return (
    <div
      className="h-2.5 w-full overflow-hidden rounded-full bg-surface-sunken"
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(pct * 100)}
    >
      <div
        className="h-full rounded-full transition-[width] duration-500"
        style={{ width: `${pct * 100}%`, background: colorValue(color ?? "lavender") }}
      />
    </div>
  );
}

export function ColorDot({ color, className }: { color: string; className?: string }) {
  return (
    <span
      className={cn("inline-block size-3 shrink-0 rounded-full ring-2 ring-surface", className)}
      style={{ background: colorValue(color) }}
      aria-hidden="true"
    />
  );
}

export function Badge({ children, tone = "neutral", className }: { children: ReactNode; tone?: "neutral" | "brand" | "gain" | "loss" | "warning" | "gold"; className?: string }) {
  const tones = {
    neutral: "bg-neutral text-neutral-ink",
    brand: "bg-brand text-brand-ink",
    gain: "bg-gain text-gain-ink",
    loss: "bg-loss text-loss-ink",
    warning: "bg-warning text-warning-ink",
    gold: "bg-gold text-gold-ink",
  } as const;
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold", tones[tone], className)}>
      {children}
    </span>
  );
}

export function EmptyState({ icon, title, children, action }: { icon?: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-line-strong px-6 py-8 text-center">
      {icon ? <div className="text-ink-faint" aria-hidden="true">{icon}</div> : null}
      <p className="font-medium text-ink">{title}</p>
      {children ? <p className="max-w-sm text-sm text-ink-soft">{children}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

export function Skeleton({ className, style }: { className?: string; style?: CSSProperties }) {
  return <div className={cn("animate-pulse rounded-xl bg-surface-sunken", className)} style={style} aria-hidden="true" />;
}

export function Notice({ tone = "warning", children, action }: { tone?: "warning" | "loss" | "brand" | "gain"; children: ReactNode; action?: ReactNode }) {
  const tones = {
    warning: "bg-warning text-warning-ink",
    loss: "bg-loss text-loss-ink",
    brand: "bg-brand text-brand-ink",
    gain: "bg-gain text-gain-ink",
  } as const;
  return (
    <div className={cn("flex flex-wrap items-center justify-between gap-3 rounded-xl px-4 py-3 text-sm", tones[tone])} role="status">
      <div className="min-w-0">{children}</div>
      {action}
    </div>
  );
}
