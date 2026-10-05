import { useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Segmented } from "@/components/ui/misc";
import { useVault } from "@/features/vault/VaultProvider";
import { themeColor } from "@/lib/cn";
import { formatCompactNumber, formatDate, formatMoney } from "@/lib/format";
import { averageMonthlyIncome, type MonthIncome } from "@/lib/history";
import { useMotionScale } from "@/lib/motion";
import { usePalette, useResolvedTheme } from "@/lib/theme";

const monthName = (month: string, opts: Intl.DateTimeFormatOptions) => formatDate(`${month}-01`, opts);

/** Income per month for the last 12 months, with the average of recent full months. */
export function IncomeChart({ months }: { months: MonthIncome[] }) {
  const { vault } = useVault();
  const motion = useMotionScale();
  useResolvedTheme();
  usePalette();
  const base = vault.profile.base_currency;
  const incomeCurrency = vault.profile.income_currency;
  const [currency, setCurrency] = useState(incomeCurrency);
  const pick = (m: MonthIncome) => (currency === base ? m.base : m.income);

  const data = months.map((m) => ({ ...m, amount: pick(m) }));
  const thisMonth = data[data.length - 1];
  const lastMonth = data[data.length - 2];
  const recent = averageMonthlyIncome(months);
  const average = currency === base ? recent.base : recent.income;
  const tick = { fill: themeColor("ink-soft"), fontSize: 12 };
  const bar = themeColor("brand-strong");

  if (months.every((m) => m.entries === 0)) {
    return <p className="text-sm text-ink-soft">No income logged in the last 12 months. Log income from the Dashboard or ➕ to see it here.</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <dl className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
          <div>
            <dt className="text-ink-soft">This month so far</dt>
            <dd className="font-semibold text-ink tabular">{formatMoney(thisMonth.amount, currency)}</dd>
          </div>
          {lastMonth ? (
            <div>
              <dt className="text-ink-soft">Last month</dt>
              <dd className="font-semibold text-ink tabular">{formatMoney(lastMonth.amount, currency)}</dd>
            </div>
          ) : null}
          {recent.months > 0 ? (
            <div>
              <dt className="text-ink-soft">{recent.months === 1 ? "Previous month" : `${recent.months}-month average`}</dt>
              <dd className="font-semibold text-ink tabular">{formatMoney(average, currency)}</dd>
            </div>
          ) : null}
        </dl>
        {incomeCurrency !== base ? (
          <Segmented
            label="Show income in"
            value={currency}
            onValueChange={setCurrency}
            items={[
              { value: incomeCurrency, label: incomeCurrency },
              { value: base, label: base },
            ]}
            className="w-40"
          />
        ) : null}
      </div>
      <div className="h-56 w-full" aria-hidden="true">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} stroke={themeColor("line")} />
            <XAxis dataKey="month" tickFormatter={(m: string) => monthName(m, { month: "short" })} tick={tick} tickLine={false} axisLine={false} interval="preserveStartEnd" />
            <YAxis tickFormatter={formatCompactNumber} tick={tick} tickLine={false} axisLine={false} width={44} />
            <Tooltip
              cursor={{ fill: themeColor("surface-muted") }}
              content={({ active, payload }) => {
                const m = active ? (payload?.[0]?.payload as (MonthIncome & { amount: number }) | undefined) : undefined;
                if (!m) return null;
                return (
                  <div className="rounded-xl border border-line bg-surface px-3 py-2 text-sm shadow-lifted">
                    <p className="font-medium text-ink">{monthName(m.month, { month: "long", year: "numeric" })}</p>
                    <p className="text-ink tabular">{formatMoney(m.amount, currency)}</p>
                    <p className="text-ink-soft">
                      {m.entries} {m.entries === 1 ? "entry" : "entries"}
                    </p>
                  </div>
                );
              }}
            />
            {recent.months > 1 && average > 0 ? <ReferenceLine y={average} stroke={themeColor("ink-faint")} strokeDasharray="4 4" /> : null}
            <Bar dataKey="amount" radius={[6, 6, 0, 0]} isAnimationActive={motion > 0} animationDuration={Math.round(600 * motion)}>
              {data.map((m, i) => (
                // This month is still running, so it's lighter
                <Cell key={m.month} fill={bar} fillOpacity={i === data.length - 1 ? 0.45 : 0.85} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <p className="text-xs text-ink-soft">
        {recent.months > 1 ? `The dashed line is the average of the last ${recent.months} full months. ` : ""}The lighter bar is this month so far.
      </p>
    </div>
  );
}
