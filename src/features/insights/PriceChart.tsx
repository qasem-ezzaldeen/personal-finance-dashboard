import { useState } from "react";
import { CartesianGrid, Line, LineChart, ReferenceDot, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { PercentPill } from "@/components/ui/misc";
import { useVault } from "@/features/vault/VaultProvider";
import { cn, themeColor } from "@/lib/cn";
import { daysBetween, formatCompactNumber, formatDate, formatMoney, formatQuantity } from "@/lib/format";
import { averageCost, tradesFor, type ChartPoint, type Instrument } from "@/lib/history";
import { useMotionScale } from "@/lib/motion";
import { usePalette, useResolvedTheme } from "@/lib/theme";

const MAX_TRADES = 5;

/** "/g" after a gold price, nothing after a share price or an exchange rate. */
function per(instrument: Instrument): string {
  return instrument.kind === "gold" ? "/g" : "";
}

/**
 * The price of one thing you hold over the period (gold per gram, a stock, or an exchange rate),
 * with your purchases and sales marked and a dashed line at what you paid on average.
 */
export function PriceChart({ instruments, points, baseline }: { instruments: Instrument[]; points: ChartPoint[]; baseline: string }) {
  const { vault, book } = useVault();
  const motion = useMotionScale();
  useResolvedTheme();
  usePalette();
  const [picked, setPicked] = useState(instruments[0]?.key ?? "");
  const instrument = instruments.find((i) => i.key === picked) ?? instruments[0];
  if (!instrument) return <p className="text-sm text-ink-soft">Add gold, stocks or money in another currency to see their prices here.</p>;

  const data = points.map((p) => ({ date: p.date, price: p.prices[instrument.key] ?? null }));
  const known = data.filter((d) => d.price !== null) as Array<{ date: string; price: number }>;
  const first = known[0]?.price ?? null;
  const last = known[known.length - 1]?.price ?? null;
  const cost = instrument.kind === "fx" ? null : averageCost(vault, instrument.assetIds, instrument.currency, book);
  const trades = instrument.kind === "fx" ? [] : tradesFor(vault, instrument.assetIds, baseline);
  // A trade is marked on the first chart point on or after its day
  const markers = trades.flatMap((t) => {
    const at = known.find((d) => d.date >= t.date) ?? known[known.length - 1];
    return at ? [{ ...t, x: at.date, y: at.price }] : [];
  });

  const picker =
    instruments.length > 1 ? (
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Price to show">
        {instruments.map((i) => (
          <button
            key={i.key}
            type="button"
            onClick={() => setPicked(i.key)}
            aria-pressed={i.key === instrument.key}
            className={cn(
              "rounded-full border px-3 py-1 text-sm font-medium transition",
              i.key === instrument.key ? "border-brand-strong bg-brand text-brand-ink" : "border-line text-ink-soft hover:bg-surface-muted hover:text-ink",
            )}
          >
            {i.label}
          </button>
        ))}
      </div>
    ) : null;

  const values = [...known.map((d) => d.price), ...(cost !== null ? [cost] : [])];
  if (values.length === 0) {
    return (
      <div className="flex flex-col gap-3">
        {picker}
        <p className="text-sm text-ink-soft">No prices yet for {instrument.label}.</p>
      </div>
    );
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  const pad = Math.max((max - min) * 0.15, Math.abs(max) * 0.005, 0.0001);
  const long = data.length > 1 && daysBetween(data[0].date, data[data.length - 1].date) > 180;
  const tick = { fill: themeColor("ink-soft"), fontSize: 12 };
  const line = themeColor("brand-strong");
  const quantityKind = instrument.kind === "gold" ? "gold" : "stock";

  return (
    <div className="flex flex-col gap-3">
      {picker}

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <p className="text-xl font-semibold text-ink tabular">
          {formatMoney(last, instrument.currency)}
          <span className="text-sm font-normal text-ink-soft">{per(instrument)}</span>
        </p>
        {first !== null && last !== null && first > 0 ? <PercentPill pct={(last - first) / first} label="over the period" size="sm" /> : null}
        {cost !== null ? (
          <p className="text-sm text-ink-soft tabular">
            You paid {formatMoney(cost, instrument.currency)}
            {per(instrument)} on average
          </p>
        ) : null}
      </div>

      <div className="h-56 w-full" aria-hidden="true">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} stroke={themeColor("line")} />
            <XAxis
              dataKey="date"
              tickFormatter={(d: string) => formatDate(d, long ? { month: "short", year: "2-digit" } : { month: "short", day: "numeric" })}
              tick={tick}
              tickLine={false}
              axisLine={false}
              minTickGap={24}
            />
            <YAxis tickFormatter={formatCompactNumber} tick={tick} tickLine={false} axisLine={false} width={48} domain={[min - pad, max + pad]} />
            <Tooltip
              cursor={{ stroke: themeColor("line-strong") }}
              content={({ active, payload }) => {
                const d = active ? (payload?.[0]?.payload as { date: string; price: number | null } | undefined) : undefined;
                if (!d) return null;
                const here = markers.filter((m) => m.x === d.date);
                return (
                  <div className="rounded-xl border border-line bg-surface px-3 py-2 text-sm shadow-lifted">
                    <p className="font-medium text-ink">{formatDate(d.date)}</p>
                    <p className="text-ink tabular">
                      {formatMoney(d.price, instrument.currency)}
                      {per(instrument)}
                    </p>
                    {here.map((m, i) => (
                      <p key={i} className={cn("tabular", m.kind === "buy" ? "text-gain-ink" : "text-loss-ink")}>
                        {m.kind === "buy" ? "Bought" : "Sold"} {formatQuantity(quantityKind, m.quantity)}
                      </p>
                    ))}
                  </div>
                );
              }}
            />
            {cost !== null ? <ReferenceLine y={cost} stroke={themeColor("ink-faint")} strokeDasharray="4 4" /> : null}
            <Line
              type="monotone"
              dataKey="price"
              stroke={line}
              strokeWidth={2}
              dot={false}
              connectNulls
              isAnimationActive={motion > 0}
              animationDuration={Math.round(600 * motion)}
            />
            {markers.map((m, i) => (
              <ReferenceDot
                key={i}
                x={m.x}
                y={m.y}
                r={4.5}
                fill={themeColor(m.kind === "buy" ? "gain-ink" : "loss-ink")}
                stroke={themeColor("surface")}
                strokeWidth={1.5}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-ink-soft">
        {cost !== null ? (
          <span className="flex items-center gap-1.5">
            <span className="w-4 border-t-2 border-dashed border-ink-faint" aria-hidden="true" /> Your average cost
          </span>
        ) : null}
        {trades.length > 0 ? (
          <>
            <span className="flex items-center gap-1.5">
              <span className="size-2.5 rounded-full bg-gain-ink" aria-hidden="true" /> Bought
            </span>
            <span className="flex items-center gap-1.5">
              <span className="size-2.5 rounded-full bg-loss-ink" aria-hidden="true" /> Sold
            </span>
          </>
        ) : null}
      </div>

      {trades.length > 0 ? (
        <ul className="flex flex-col gap-1 text-sm" aria-label={`${instrument.label} purchases and sales in this period`}>
          {trades
            .slice(-MAX_TRADES)
            .reverse()
            .map((t, i) => (
              <li key={i} className="flex flex-wrap justify-between gap-x-3 text-ink-soft tabular">
                <span>
                  <span className="text-ink">{formatDate(t.date, { month: "short", day: "numeric" })}</span> · {t.kind === "buy" ? "Bought" : "Sold"}{" "}
                  {formatQuantity(quantityKind, t.quantity)} of {t.assetName}
                </span>
                {t.amount !== null && t.currency ? <span>{formatMoney(t.amount, t.currency)}</span> : null}
              </li>
            ))}
          {trades.length > MAX_TRADES ? <li className="text-xs text-ink-faint">and {trades.length - MAX_TRADES} earlier</li> : null}
        </ul>
      ) : null}
    </div>
  );
}
