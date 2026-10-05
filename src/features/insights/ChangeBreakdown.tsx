import { cn, signTone } from "@/lib/cn";
import { formatAmount, formatDate } from "@/lib/format";
import type { PeriodSummary } from "@/lib/history";
import { GOLD_UNIT } from "@/lib/types";

interface Row {
  key: string;
  label: string;
  hint?: string;
  /** Totals are drawn from the axis; steps from the running total */
  total?: number;
  delta?: number;
}

/**
 * Where the period's change came from, as a waterfall: the starting net worth, each cause going up
 * or down from the running total, and where it ended. Rows that didn't move are left out.
 */
export function ChangeBreakdown({ period, unit }: { period: PeriodSummary; unit: string }) {
  const { parts } = period;
  // Relative, so it works for grams of gold as well as for money
  const moved = (x: number) => Math.abs(x) > Math.max(Math.abs(period.startValue), Math.abs(period.endValue), 1) * 1e-6;
  const inGold = unit === GOLD_UNIT;

  const rows: Row[] = [
    { key: "start", label: `On ${formatDate(period.baseline, { month: "short", day: "numeric" })}`, total: period.startValue },
    { key: "income", label: "Income", hint: "Income you logged", delta: parts.income },
    ...(moved(parts.gold)
      ? [{ key: "gold", label: "Gold prices", hint: inGold ? "Your gold's price, before gold's own move" : "Gold's price per gram in your base currency", delta: parts.gold }]
      : []),
    ...(moved(parts.stock) ? [{ key: "stock", label: "Stock prices", hint: "Share prices, in the currency each stock trades in", delta: parts.stock }] : []),
    ...(moved(parts.other) ? [{ key: "other-assets", label: "Other assets", delta: parts.other }] : []),
    ...(moved(parts.currency)
      ? [{ key: "currency", label: "Exchange rates", hint: "Cash and stocks in other currencies, as rates moved", delta: parts.currency }]
      : []),
    ...(moved(parts.measure)
      ? [{ key: "measure", label: "Gold's own price", hint: "Measuring in gold: when gold rises, everything else is worth fewer grams", delta: parts.measure }]
      : []),
    ...(moved(parts.unexplained)
      ? [{ key: "unexplained", label: "Other changes", hint: "Balance edits, assets added without paying from cash, money spent or moved out", delta: parts.unexplained }]
      : []),
    { key: "end", label: "Today", total: period.endValue },
  ];

  // The axis spans the running totals, not zero, so small changes on a large net worth stay visible
  let running = 0;
  const spans = rows.map((row) => {
    if (row.total !== undefined) {
      running = row.total;
      return { row, from: null as number | null, to: row.total };
    }
    const from = running;
    running += row.delta!;
    return { row, from, to: running };
  });
  const levels = spans.flatMap((s) => (s.from === null ? [s.to] : [s.from, s.to]));
  const min = Math.min(...levels);
  const max = Math.max(...levels);
  const range = max - min || Math.max(Math.abs(max), 1);
  const lo = min - range * 0.25;
  const hi = max + range * 0.05;
  const at = (value: number) => ((value - lo) / (hi - lo)) * 100;

  return (
    <div className="flex flex-col gap-1">
      <ol className="flex flex-col gap-1.5" aria-label="What changed">
        {spans.map(({ row, from, to }) => {
          const isTotal = from === null;
          const left = isTotal ? 0 : at(Math.min(from, to));
          const width = isTotal ? at(to) : Math.max(at(Math.max(from, to)) - left, 0.6);
          const amount = isTotal ? to : row.delta!;
          return (
            <li key={row.key} className="grid grid-cols-[minmax(0,7.5rem)_minmax(0,1fr)_auto] items-center gap-x-3 sm:grid-cols-[minmax(0,10rem)_minmax(0,1fr)_auto]">
              <span className={cn("min-w-0 text-sm", isTotal ? "font-medium text-ink" : "text-ink-soft")} title={row.hint}>
                {row.label}
              </span>
              <span className="relative h-6 rounded-md bg-surface-muted" aria-hidden="true">
                <span
                  className={cn(
                    "absolute inset-y-0.5 rounded",
                    isTotal ? "bg-brand-strong/70" : amount >= 0 ? "bg-gain-ink/70" : "bg-loss-ink/70",
                  )}
                  style={{ left: `${left}%`, width: `${width}%` }}
                />
              </span>
              <span className={cn("text-right text-sm font-medium tabular", isTotal ? "text-ink" : signTone(amount))}>
                {formatAmount(amount, unit, isTotal ? {} : { signed: true })}
              </span>
            </li>
          );
        })}
      </ol>
      <dl className="mt-3 grid gap-x-4 gap-y-1 text-xs text-ink-soft sm:grid-cols-2">
        {rows
          .filter((r) => r.hint)
          .map((r) => (
            <div key={r.key}>
              <dt className="inline font-medium text-ink">{r.label}: </dt>
              <dd className="inline">{r.hint}</dd>
            </div>
          ))}
      </dl>
    </div>
  );
}
