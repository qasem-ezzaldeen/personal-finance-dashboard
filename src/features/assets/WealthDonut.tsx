import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { useVault } from "@/features/vault/VaultProvider";
import { cn, resolvedColor, themeColor } from "@/lib/cn";
import { useMotionScale } from "@/lib/motion";
import { useResolvedTheme } from "@/lib/theme";
import { formatMoney, formatPercent } from "@/lib/format";
import { expandItem } from "./useCollapsed";

interface Slice {
  key: string;
  name: string;
  value: number;
  color: string;
}

/**
 * Donut of net worth by group. Decorative for screen readers; the group list carries the same numbers.
 * It fills the width it's given (square), so it grows and shrinks with its section.
 */
export function WealthDonut({ className }: { className?: string }) {
  const { vault, summary } = useVault();
  const motion = useMotionScale();
  useResolvedTheme(); // colors read at render time must refresh when the theme changes
  const base = vault.profile.base_currency;

  const slices: Slice[] = summary.groups
    .filter((g) => g.value > 0)
    .map((g) => ({ key: g.group.kind, name: g.group.name, value: g.value, color: resolvedColor(g.group.color) }));
  if (summary.pending && (summary.pending.value ?? 0) > 0) {
    slices.push({ key: "pending", name: "Upcoming Income", value: summary.pending.value!, color: resolvedColor("slate") });
  }
  const total = slices.reduce((s, x) => s + x.value, 0);

  return (
    <div className={cn("@container relative mx-auto aspect-square w-full", className)} aria-hidden="true">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={total > 0 ? slices : [{ key: "empty", name: "Nothing yet", value: 1, color: themeColor("surface-sunken") }]}
            dataKey="value"
            nameKey="name"
            innerRadius="72%"
            outerRadius="100%"
            paddingAngle={total > 0 && slices.length > 1 ? 2 : 0}
            cornerRadius={6}
            stroke="none"
            isAnimationActive={motion > 0}
            animationDuration={Math.round(700 * motion)}
            animationEasing="ease-out"
            onClick={(entry: { payload?: Slice }) => {
              const key = entry?.payload?.key;
              if (key && key !== "pending" && key !== "empty") expandItem(`group:${key}`);
            }}
          >
            {(total > 0 ? slices : [{ key: "empty", color: themeColor("surface-sunken") }]).map((s) => (
              <Cell key={s.key} fill={s.color} className="cursor-pointer outline-none" />
            ))}
          </Pie>
          {total > 0 ? (
            <Tooltip
              cursor={false}
              content={({ active, payload }) => {
                const item = active ? (payload?.[0]?.payload as Slice | undefined) : undefined;
                if (!item) return null;
                return (
                  <div className="rounded-xl border border-line bg-surface px-3 py-2 text-sm shadow-lifted">
                    <p className="font-medium text-ink">{item.name}</p>
                    <p className="text-ink-soft tabular">
                      {formatMoney(item.value, base)} · {formatPercent(item.value / total, { decimals: 2 })}
                    </p>
                  </div>
                );
              }}
            />
          ) : null}
        </PieChart>
      </ResponsiveContainer>
      <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
        <div>
          <p className="text-[clamp(0.75rem,5cqw,1.125rem)] text-ink-soft">Net worth</p>
          <p className="text-[clamp(1rem,9cqw,2.25rem)] leading-tight font-bold text-ink tabular">{formatMoney(summary.netWorth, base, { compact: true, decimals: 2 })}</p>
        </div>
      </div>
    </div>
  );
}
