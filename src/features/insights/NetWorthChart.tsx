import { useState } from "react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Segmented } from "@/components/ui/misc";
import { useVault } from "@/features/vault/VaultProvider";
import { resolvedColor, themeColor } from "@/lib/cn";
import { daysBetween, formatCompactNumber, formatDate, formatMoney } from "@/lib/format";
import type { ChartPoint } from "@/lib/history";
import { useMotionScale } from "@/lib/motion";
import { usePalette, useResolvedTheme } from "@/lib/theme";

type Mode = "total" | "groups";

/** A short date for the axis: "Sep 28", or "Sep '25" for long periods. */
function axisDate(date: string, long: boolean): string {
  return formatDate(date, long ? { month: "short", year: "2-digit" } : { month: "short", day: "numeric" });
}

/** Net worth over the period: the total (with income days marked), or stacked by group. */
export function NetWorthChart({ points, unit }: { points: ChartPoint[]; unit: string }) {
  const { summary } = useVault();
  const motion = useMotionScale();
  // Colors read at render time must refresh when the theme or palette changes
  useResolvedTheme();
  usePalette();
  const [mode, setMode] = useState<Mode>("total");
  // Over about half a year, the axis shows months instead of days
  const long = points.length > 1 && daysBetween(points[0].date, points[points.length - 1].date) > 180;

  const groups = [
    ...summary.groups.filter((g) => points.some((p) => p.groups[g.group.kind] > 0)).map((g) => ({ key: g.group.kind, name: g.group.name, color: resolvedColor(g.group.color) })),
    ...(points.some((p) => p.groups.pending > 0) ? [{ key: "pending" as const, name: "Upcoming Income", color: resolvedColor("slate") }] : []),
  ];
  const data = points.map((p) => ({ ...p, ...p.groups }));
  const values = points.map((p) => p.netWorth);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const pad = Math.max((max - min) * 0.15, Math.abs(max) * 0.01, 1);
  const brand = themeColor("brand-strong");
  const gain = themeColor("gain-ink");
  const tick = { fill: themeColor("ink-soft"), fontSize: 12 };

  return (
    <div className="flex flex-col gap-3">
      <Segmented
        label="Show net worth as"
        value={mode}
        onValueChange={setMode}
        items={[
          { value: "total", label: "Total" },
          { value: "groups", label: "By group" },
        ]}
        className="max-w-60"
      />
      <div className="h-64 w-full sm:h-72" aria-hidden="true">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id="net-worth-fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={brand} stopOpacity={0.35} />
                <stop offset="100%" stopColor={brand} stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} stroke={themeColor("line")} />
            <XAxis dataKey="date" tickFormatter={(d: string) => axisDate(d, long)} tick={tick} tickLine={false} axisLine={false} minTickGap={24} />
            <YAxis
              tickFormatter={formatCompactNumber}
              tick={tick}
              tickLine={false}
              axisLine={false}
              width={48}
              // The total's axis hugs the line; it only reaches below zero for a net worth that does
              domain={mode === "total" ? [min >= 0 ? Math.max(0, min - pad) : min - pad, max + pad] : [0, "auto"]}
            />
            <Tooltip
              cursor={{ stroke: themeColor("line-strong") }}
              content={({ active, payload }) => {
                const p = active ? (payload?.[0]?.payload as ChartPoint | undefined) : undefined;
                if (!p) return null;
                return (
                  <div className="rounded-xl border border-line bg-surface px-3 py-2 text-sm shadow-lifted">
                    <p className="font-medium text-ink">{formatDate(p.date)}</p>
                    <p className="text-ink tabular">{formatMoney(p.netWorth, unit)}</p>
                    {mode === "groups"
                      ? groups.map((g) => (
                          <p key={g.key} className="flex items-center gap-1.5 text-ink-soft tabular">
                            <span className="size-2 rounded-full" style={{ background: g.color }} />
                            {g.name} {formatMoney(p.groups[g.key], unit)}
                          </p>
                        ))
                      : null}
                    {p.incomeSince > 0 ? <p className="text-gain-ink tabular">Income {formatMoney(p.incomeSince, unit, { signed: true })}</p> : null}
                  </div>
                );
              }}
            />
            {mode === "total" ? (
              <Area
                type="monotone"
                dataKey="netWorth"
                stroke={brand}
                strokeWidth={2}
                fill="url(#net-worth-fill)"
                isAnimationActive={motion > 0}
                animationDuration={Math.round(600 * motion)}
                // Days with income logged get a dot
                dot={(props: { cx?: number; cy?: number; index?: number; payload?: ChartPoint }) =>
                  props.payload && props.payload.incomeSince > 0 ? (
                    <circle key={props.index} cx={props.cx} cy={props.cy} r={3.5} fill={gain} stroke={themeColor("surface")} strokeWidth={1.5} />
                  ) : (
                    <g key={props.index} />
                  )
                }
              />
            ) : (
              groups.map((g) => (
                <Area
                  key={g.key}
                  type="monotone"
                  dataKey={g.key}
                  stackId="groups"
                  stroke={g.color}
                  fill={g.color}
                  fillOpacity={0.55}
                  isAnimationActive={motion > 0}
                  animationDuration={Math.round(600 * motion)}
                />
              ))
            )}
          </AreaChart>
        </ResponsiveContainer>
      </div>
      {mode === "groups" ? (
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-ink-soft" aria-label="Groups">
          {groups.map((g) => (
            <li key={g.key} className="flex items-center gap-1.5">
              <span className="size-2.5 rounded-full" style={{ background: g.color }} aria-hidden="true" />
              {g.name}
            </li>
          ))}
        </ul>
      ) : (
        <p className="flex items-center gap-1.5 text-sm text-ink-soft">
          <span className="size-2.5 rounded-full" style={{ background: gain }} aria-hidden="true" /> Days you logged income
        </p>
      )}
    </div>
  );
}
