import { ChartCandlestick, ChartLine, Coins, Flag, HandCoins, Layers, Table2, TrendingUp } from "lucide-react";
import { useMemo, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { KpiIcon, Notice, PercentPill, Segmented, Skeleton } from "@/components/ui/misc";
import { useVault } from "@/features/vault/VaultProvider";
import { cn, signTone } from "@/lib/cn";
import { addDays, formatAmount, formatDate, formatMoney, unitName } from "@/lib/format";
import {
  PERIODS,
  assetPerformance,
  chartPoints,
  incomeBetween,
  isPeriodKey,
  measureHistory,
  measureUnits,
  monthlyIncome,
  periodLabel,
  summarizePeriod,
  type PeriodSummary,
} from "@/lib/history";
import { GOLD_UNIT, type PeriodKey } from "@/lib/types";
import { AssetTable } from "./AssetTable";
import { ChangeBreakdown } from "./ChangeBreakdown";
import { GoalForecast } from "./GoalForecast";
import { IncomeChart } from "./IncomeChart";
import { NetWorthChart } from "./NetWorthChart";
import { PriceChart } from "./PriceChart";
import { useVaultHistory, type HistoryState } from "./useHistory";

function Tile({ label, icon, children }: { label: string; icon: ReactNode; children: ReactNode }) {
  return (
    <Card className="p-4">
      <div className="flex items-center gap-2 text-sm text-ink-soft">
        {icon}
        {label}
      </div>
      <div className="mt-2">{children}</div>
    </Card>
  );
}

function Signed({ amount, unit }: { amount: number; unit: string }) {
  return <p className={cn("text-xl font-semibold tabular", signTone(amount))}>{formatAmount(amount, unit, { signed: true })}</p>;
}

function Tiles({
  period,
  state,
  periodKey,
  unit,
}: {
  period: PeriodSummary;
  state: Extract<HistoryState, { status: "ready" }>;
  periodKey: PeriodKey;
  unit: string;
}) {
  const { vault, book } = useVault();
  const base = vault.profile.base_currency;
  const income = incomeBetween(vault, state.ledger, book, period.baseline, period.end);
  const incomeCurrency = vault.profile.income_currency;
  const when = periodLabel(periodKey).toLowerCase();
  const short = (x: number) => formatAmount(x, unit, { compact: true, decimals: 1 });
  const inGold = unit === GOLD_UNIT;

  return (
    <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 md:gap-4 xl:grid-cols-4">
      <Tile label="Net worth change" icon={<KpiIcon tone="bg-brand text-brand-ink"><ChartLine className="size-4" /></KpiIcon>}>
        <div className="flex flex-wrap items-center gap-2">
          <Signed amount={period.change} unit={unit} />
          <PercentPill pct={period.changePct} label={when} size="sm" />
        </div>
        <p className="mt-1 text-sm text-ink-soft tabular">
          {short(period.startValue)} → {short(period.endValue)}
        </p>
      </Tile>
      <Tile label="Income" icon={<KpiIcon tone="bg-cash text-cash-ink"><HandCoins className="size-4" /></KpiIcon>}>
        <p className="text-xl font-semibold text-ink tabular">{formatMoney(income.income, incomeCurrency)}</p>
        <p className="mt-1 text-sm text-ink-soft tabular">
          {incomeCurrency !== base ? `${formatMoney(income.base, base)} · ` : ""}
          {income.entries} {income.entries === 1 ? "entry" : "entries"}
        </p>
      </Tile>
      <Tile label="Investment gain" icon={<KpiIcon tone="bg-gain text-gain-ink"><TrendingUp className="size-4" /></KpiIcon>}>
        <div className="flex flex-wrap items-center gap-2">
          <Signed amount={period.investments} unit={unit} />
          <PercentPill pct={period.investmentsPct} label={when} size="sm" />
        </div>
        <p className="mt-1 text-sm text-ink-soft">Gold and stock prices</p>
      </Tile>
      {inGold ? (
        <Tile label="Gold's own price" icon={<KpiIcon tone="bg-gold text-gold-ink"><Coins className="size-4" /></KpiIcon>}>
          <Signed amount={period.parts.measure} unit={unit} />
          <p className="mt-1 text-sm text-ink-soft">Everything that isn't gold, against gold</p>
        </Tile>
      ) : (
        <Tile label="Exchange rates" icon={<KpiIcon tone="bg-stocks text-stocks-ink"><Layers className="size-4" /></KpiIcon>}>
          <Signed amount={period.parts.currency} unit={unit} />
          <p className="mt-1 text-sm text-ink-soft">{unit === base ? "On money held in other currencies" : `On money not held in ${unit}`}</p>
        </Tile>
      )}
    </div>
  );
}

function Loading() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true" aria-label="Loading your history">
      <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-28 rounded-[var(--radius-card)]" />
        ))}
      </div>
      <Skeleton className="h-80 rounded-[var(--radius-card)]" />
    </div>
  );
}

/** A price symbol as people know it: "SPUS", "gold", "the EGP exchange rate". */
function symbolName(symbol: string): string {
  const [kind, code] = symbol.split(":");
  if (kind === "STOCK") return code;
  if (kind === "METAL") return "gold";
  return `the ${code} exchange rate`;
}

/** The unit asked for in the address, when it's one of the vault's; otherwise the base currency (the first). */
function pickUnit(units: string[], asked: string | null): string {
  return asked && units.includes(asked) ? asked : units[0];
}

/** How net worth changed over a period and why, how each asset did, and income month by month. */
export function InsightsPage() {
  const { vault, book } = useVault();
  const [params, setParams] = useSearchParams();
  const asked = params.get("period");
  const periodKey: PeriodKey = isPeriodKey(asked) ? asked : (vault.profile.kpi_period ?? "month");
  const unit = pickUnit(measureUnits(vault), params.get("in"));
  const state = useVaultHistory(periodKey);

  const set = (key: string, value: string) =>
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        next.set(key, value);
        return next;
      },
      { replace: true },
    );

  const view = useMemo(() => {
    if (state.status !== "ready") return null;
    const measured = measureHistory(state.history, unit);
    const history = measured ?? state.history;
    return {
      history,
      unit: measured ? unit : state.history.base,
      unitUnavailable: measured === null,
      period: summarizePeriod(history, state.baseline),
      assets: assetPerformance(history, state.baseline, vault),
      points: chartPoints(history.points.filter((p) => p.date >= state.baseline)),
      // Prices stay in their own currency whatever the unit
      pricePoints: chartPoints(state.history.points.filter((p) => p.date >= state.baseline)),
      months: monthlyIncome(vault, state.ledger, book, state.history.today, 12),
    };
  }, [state, unit, vault, book]);
  const period = view?.period ?? null;
  const updating = state.status === "ready" && state.updating;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-ink">Insights</h1>
          <p className="text-ink-soft" aria-live="polite">
            {updating
              ? `Loading ${periodLabel(periodKey).toLowerCase()}…`
              : period
                ? `${periodLabel(periodKey)}: ${formatDate(addDays(period.baseline, 1))} to today`
                : "How your net worth changed, and why."}
          </p>
        </div>
        <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
          <Segmented
            label="Period"
            value={periodKey}
            onValueChange={(p) => set("period", p)}
            items={PERIODS.map((p) => ({ value: p.key, label: <span title={p.label}>{p.short}</span> }))}
            className="w-full max-w-xl"
          />
          <div className="flex items-center gap-2">
            <span className="text-sm text-ink-soft" id="measure-label">
              Measure in
            </span>
            <Segmented
              label="Measure in"
              value={unit}
              onValueChange={(u) => set("in", u)}
              items={measureUnits(vault).map((u) => ({ value: u, label: unitName(u) }))}
              className="min-w-0 flex-1 lg:w-64 lg:flex-none"
            />
          </div>
        </div>
      </div>

      {state.status === "error" ? (
        <Notice tone="loss">Couldn't load your history. Check your connection and try again.</Notice>
      ) : !view || !period ? (
        <Loading />
      ) : (
        <div
          className={cn("flex flex-col gap-5 transition-opacity", updating && "opacity-60")}
          aria-busy={updating}
        >
          {state.status === "ready" && state.pricesUnavailable ? (
            <Notice>Past prices couldn't be loaded, so this uses today's prices for every day.</Notice>
          ) : null}
          {view.unitUnavailable ? (
            <Notice>
              There's no {unit === GOLD_UNIT ? "gold price" : `${unit} exchange rate`} for every day of this period, so it's shown in{" "}
              {view.history.base}.
            </Notice>
          ) : null}
          {state.status === "ready" && state.missingHistory.length > 0 ? (
            <Notice>
              No past prices were found for {state.missingHistory.map(symbolName).join(", ")} at the start of this period, so days before
              the first known price use that price.
            </Notice>
          ) : null}
          {period.beforeTracking ? (
            <Notice tone="brand">
              Your vault was created on {formatDate(view.history.trackedSince)}. Cash before then is shown at the balance you started with, so
              money that moved earlier shows up under Other changes.
            </Notice>
          ) : null}

          {state.status === "ready" ? <Tiles period={period} state={state} periodKey={periodKey} unit={view.unit} /> : null}

          <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
            <Card>
              <CardHeader title="Net worth over time" icon={<ChartLine className="size-5" />} subtitle={view.unit === GOLD_UNIT ? "In grams of 24k gold" : `In ${view.unit}`} />
              <CardBody>
                <NetWorthChart points={view.points} unit={view.unit} />
              </CardBody>
            </Card>
            <Card>
              <CardHeader title="What changed" icon={<Layers className="size-5" />} subtitle={periodLabel(periodKey)} />
              <CardBody>
                <ChangeBreakdown period={period} unit={view.unit} />
              </CardBody>
            </Card>
          </div>

          <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
            <Card>
              <CardHeader title="Prices of what you own" icon={<ChartCandlestick className="size-5" />} subtitle={periodLabel(periodKey)} />
              <CardBody>
                <PriceChart instruments={view.history.instruments} points={view.pricePoints} baseline={period.baseline} />
              </CardBody>
            </Card>
            <Card>
              <CardHeader title="How each asset did" icon={<Table2 className="size-5" />} subtitle={periodLabel(periodKey)} />
              <CardBody>
                <AssetTable rows={view.assets} unit={view.unit} />
              </CardBody>
            </Card>
          </div>

          <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
            <Card>
              <CardHeader title="Monthly income" icon={<HandCoins className="size-5" />} subtitle="Last 12 months" />
              <CardBody>
                {/* A new income currency starts the toggle over */}
                <IncomeChart key={vault.profile.income_currency} months={view.months} />
              </CardBody>
            </Card>
            <Card>
              <CardHeader title="Goal forecast" icon={<Flag className="size-5" />} subtitle="At your average income" />
              <CardBody>
                <GoalForecast months={view.months} today={view.history.today} />
              </CardBody>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
