import * as DM from "@radix-ui/react-dropdown-menu";
import { useQueryClient } from "@tanstack/react-query";
import { Check, SlidersHorizontal, TrendingDown, TrendingUp } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { GrowthPill, KpiIcon, PercentPill, Skeleton } from "@/components/ui/misc";
import { useToast } from "@/components/ui/Toast";
import { queryKeys, useVault } from "@/features/vault/VaultProvider";
import { updateProfile, type ProfileUpdate } from "@/lib/api";
import { cn, signTone } from "@/lib/cn";
import { formatMoney } from "@/lib/format";
import { PERIODS, incomeBetween, periodLabel, summarizePeriod } from "@/lib/history";
import type { KpiMetric, PeriodKey } from "@/lib/types";
import { useVaultHistory } from "./useHistory";

const KPI_METRICS: Array<{ key: KpiMetric; label: string; hint: string }> = [
  { key: "net_worth", label: "Net worth change", hint: "Income, price and currency moves" },
  { key: "investments", label: "Investment gain", hint: "Price changes of gold and stocks" },
  { key: "income", label: "Income", hint: "Income logged" },
  { key: "since_purchase", label: "Growth since purchase", hint: "Value now vs price paid" },
];

const itemClass =
  "flex cursor-pointer items-center gap-2 rounded-xl px-3 py-2 text-sm text-ink outline-none data-[highlighted]:bg-surface-muted";

function KpiMenu({ metric, period }: { metric: KpiMetric; period: PeriodKey }) {
  const { userId } = useVault();
  const queryClient = useQueryClient();
  const toast = useToast();
  // Only the profile changes, so Activity (and the history built from it) isn't fetched again
  const save = async (patch: ProfileUpdate) => {
    try {
      await updateProfile(userId, patch);
      await queryClient.invalidateQueries({ queryKey: queryKeys.vault(userId) });
    } catch (err) {
      toast.error(err);
    }
  };
  return (
    <DM.Root>
      <DM.Trigger
        className="pointer-events-auto relative z-10 -my-1 -mr-1 ml-auto grid size-8 shrink-0 place-items-center rounded-lg text-ink-soft hover:bg-surface-sunken hover:text-ink"
        aria-label="Choose what this card shows"
      >
        <SlidersHorizontal className="size-4" aria-hidden="true" />
      </DM.Trigger>
      <DM.Portal>
        <DM.Content
          align="end"
          sideOffset={6}
          // Stays clear of the phone's bottom bar, and scrolls when the screen is short
          collisionPadding={{ top: 8, bottom: 88, left: 8, right: 8 }}
          className="z-50 max-h-[var(--radix-dropdown-menu-content-available-height)] min-w-60 overflow-y-auto rounded-2xl border border-line bg-surface p-1.5 shadow-lifted animate-pop-in"
        >
          <DM.Label className="px-3 pt-1.5 pb-1 text-xs font-semibold tracking-wide text-ink-soft uppercase">Show</DM.Label>
          <DM.RadioGroup value={metric} onValueChange={(v) => save({ kpi_metric: v as KpiMetric })}>
            {KPI_METRICS.map((m) => (
              <DM.RadioItem key={m.key} value={m.key} className={itemClass}>
                <span className="grid size-4 place-items-center">
                  <DM.ItemIndicator>
                    <Check className="size-4 text-brand-ink" aria-hidden="true" />
                  </DM.ItemIndicator>
                </span>
                <span>
                  <span className="block">{m.label}</span>
                  <span className="block text-xs text-ink-soft">{m.hint}</span>
                </span>
              </DM.RadioItem>
            ))}
          </DM.RadioGroup>
          {metric !== "since_purchase" ? (
            <>
              <DM.Separator className="my-1 h-px bg-line" />
              <DM.Label className="px-3 pt-1.5 pb-1 text-xs font-semibold tracking-wide text-ink-soft uppercase">Period</DM.Label>
              <DM.RadioGroup value={period} onValueChange={(v) => save({ kpi_period: v as PeriodKey })}>
                {PERIODS.map((p) => (
                  <DM.RadioItem key={p.key} value={p.key} className={itemClass}>
                    <span className="grid size-4 place-items-center">
                      <DM.ItemIndicator>
                        <Check className="size-4 text-brand-ink" aria-hidden="true" />
                      </DM.ItemIndicator>
                    </span>
                    {p.label}
                  </DM.RadioItem>
                ))}
              </DM.RadioGroup>
            </>
          ) : null}
        </DM.Content>
      </DM.Portal>
    </DM.Root>
  );
}

/** A "+EGP 1.2K" style amount for the small print. */
function part(amount: number, currency: string): string {
  return formatMoney(amount, currency, { compact: true, signed: true, decimals: 1 });
}

/** The card's number and small print, and whether it went up (null: no direction). */
function useKpiBody(metric: KpiMetric, period: PeriodKey): { up: boolean | null; body: ReactNode } {
  const { vault, summary, book } = useVault();
  const base = vault.profile.base_currency;
  // Growth since purchase doesn't need any history
  const state = useVaultHistory(period, { enabled: metric !== "since_purchase" });

  if (metric === "since_purchase") {
    const growth = summary.totalGrowth;
    return {
      up: growth ? growth.gain >= 0 : null,
      body: growth ? (
        <>
          <GrowthPill growth={growth} />
          <p className="mt-1 text-sm text-ink-soft tabular">{formatMoney(growth.gain, base, { signed: true })}</p>
        </>
      ) : (
        <p className="text-sm text-ink-soft">Add purchase prices to your assets to see growth.</p>
      ),
    };
  }
  if (state.status === "error") return { up: null, body: <p className="text-sm text-ink-soft">Couldn't load your history.</p> };
  if (state.status === "loading") {
    return {
      up: null,
      body: (
        <div aria-busy="true" aria-label="Loading">
          <Skeleton className="h-7 w-32" />
          <Skeleton className="mt-2 h-4 w-40" />
        </div>
      ),
    };
  }
  const p = summarizePeriod(state.history, state.baseline);
  if (!p) return { up: null, body: <p className="text-sm text-ink-soft">Nothing recorded yet.</p> };

  if (metric === "income") {
    const income = incomeBetween(vault, state.ledger, book, p.baseline, p.end);
    const currency = vault.profile.income_currency;
    return {
      up: null,
      body: (
        <>
          <p className="text-xl font-semibold text-ink tabular">{formatMoney(income.income, currency)}</p>
          <p className="mt-1 text-sm text-ink-soft tabular">
            {currency !== base ? `${formatMoney(income.base, base)} · ` : ""}
            {income.entries} {income.entries === 1 ? "entry" : "entries"}
          </p>
        </>
      ),
    };
  }

  const amount = metric === "investments" ? p.investments : p.change;
  const pct = metric === "investments" ? p.investmentsPct : p.changePct;
  const details =
    metric === "investments"
      ? [`Gold ${part(p.parts.gold, base)}`, `Stocks ${part(p.parts.stock, base)}`]
      : [`Income ${part(p.parts.income, base)}`, `Markets ${part(p.investments, base)}`, `Currency ${part(p.parts.currency, base)}`];
  return {
    up: amount >= 0,
    body: (
      <>
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className={cn("text-xl font-semibold tabular", signTone(amount))}>{formatMoney(amount, base, { signed: true })}</span>
          <PercentPill pct={pct} label={periodLabel(period).toLowerCase()} size="sm" />
        </p>
        <p className="mt-1 flex flex-wrap gap-x-2 text-xs text-ink-soft tabular">
          {details.map((d) => (
            <span key={d} className="whitespace-nowrap">
              {d}
            </span>
          ))}
        </p>
      </>
    ),
  };
}

/**
 * The dashboard's change KPI: the change in net worth (or investment gain, income, or growth since
 * purchase) over a period the user picks. Selecting it opens Insights for the same period.
 */
export function ChangeKpi({ className }: { className?: string }) {
  const { vault } = useVault();
  const metric = vault.profile.kpi_metric ?? "net_worth";
  const period = vault.profile.kpi_period ?? "month";
  const { up, body } = useKpiBody(metric, period);
  const label = KPI_METRICS.find((m) => m.key === metric)!.label;

  return (
    <section className={cn("group relative rounded-[var(--radius-card)] border border-line bg-surface p-4 shadow-soft transition hover:bg-surface-muted", className)}>
      <Link
        to={`/insights?period=${period}`}
        className="absolute inset-0 rounded-[var(--radius-card)]"
        aria-label={`${label}${metric === "since_purchase" ? "" : `, ${periodLabel(period).toLowerCase()}`}. Open Insights`}
      />
      <div className="pointer-events-none relative">
        <div className="flex items-center gap-2 text-sm text-ink-soft">
          {up === false ? (
            <KpiIcon tone="bg-loss text-loss-ink">
              <TrendingDown className="size-4" />
            </KpiIcon>
          ) : (
            <KpiIcon tone="bg-gain text-gain-ink">
              <TrendingUp className="size-4" />
            </KpiIcon>
          )}
          <span className="min-w-0">
            <span className="block truncate">{label}</span>
            {metric !== "since_purchase" ? <span className="block truncate text-xs text-ink-faint">{periodLabel(period)}</span> : null}
          </span>
          <KpiMenu metric={metric} period={period} />
        </div>
        <div className="mt-2">{body}</div>
      </div>
    </section>
  );
}
