import { CheckCircle2 } from "lucide-react";
import { SUGGESTED_TICKERS } from "@shared/tickers";
import { Field, Input } from "@/components/ui/Field";
import { Spinner } from "@/components/ui/Spinner";
import { cn } from "@/lib/cn";
import { formatMoney } from "@/lib/format";
import type { TickerLookup } from "./useTickerLookup";

/** Ticker input with quick picks and the live lookup result underneath. */
export function TickerField({
  value,
  onChange,
  lookup,
  label = "Ticker symbol",
}: {
  value: string;
  onChange: (value: string) => void;
  lookup: TickerLookup;
  label?: string;
}) {
  return (
    <div className="flex flex-col gap-2">
      <Field label={label} error={lookup.state === "error" ? lookup.message : undefined}>
        {(p) => (
          <Input
            {...p}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder="e.g. SPUS, AAPL or Apple"
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
            className="uppercase"
          />
        )}
      </Field>
      <div className="flex flex-wrap gap-1.5" aria-label="Suggestions">
        {SUGGESTED_TICKERS.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => onChange(t)}
            className={cn(
              "rounded-full border border-line px-2.5 py-1 text-xs font-medium text-ink-soft hover:bg-surface-muted",
              value.toUpperCase() === t && "border-transparent bg-brand text-brand-ink",
            )}
          >
            {t}
          </button>
        ))}
      </div>
      <div aria-live="polite" className="min-h-6 text-sm">
        {lookup.state === "checking" ? (
          <span className="flex items-center gap-2 text-ink-soft">
            <Spinner className="size-4" /> Checking {lookup.ticker}…
          </span>
        ) : lookup.state === "found" ? (
          <span className="flex items-center gap-2 text-gain-ink">
            <CheckCircle2 className="size-4 shrink-0" aria-hidden="true" />
            <span className="truncate">
              <strong>{lookup.info.ticker}</strong>
              {lookup.info.name ? ` · ${lookup.info.name}` : ""} · {formatMoney(lookup.info.price, lookup.info.currency)}
            </span>
          </span>
        ) : null}
      </div>
    </div>
  );
}
