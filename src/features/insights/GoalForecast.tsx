import { CheckCircle2 } from "lucide-react";
import { Link } from "react-router-dom";
import { useVault } from "@/features/vault/VaultProvider";
import { formatDate, formatMoney } from "@/lib/format";
import { addMonths, averageMonthlyIncome, forecastGoals, type MonthIncome } from "@/lib/history";
import { goalsProgress } from "@/lib/valuation";

/** When each goal would be reached if the average monthly income kept coming in, and none of it were spent. */
export function GoalForecast({ months, today }: { months: MonthIncome[]; today: string }) {
  const { vault, summary, ctx } = useVault();
  const goals = vault.goals.filter((g) => !g.is_system).sort((a, b) => a.sort_order - b.sort_order);
  const average = averageMonthlyIncome(months);

  if (goals.length === 0) {
    return (
      <p className="text-sm text-ink-soft">
        <Link to="/goals" className="font-medium text-brand-ink hover:underline">
          Add a goal
        </Link>{" "}
        to see when you could reach it.
      </p>
    );
  }
  if (average.months === 0) {
    return <p className="text-sm text-ink-soft">Log income for a full month to see when you could reach your goals.</p>;
  }

  const forecast = forecastGoals(goals, goalsProgress(goals, summary, ctx), average.base, summary, ctx);
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-ink-soft">
        If you keep adding your average income of{" "}
        <strong className="font-semibold text-ink tabular">{formatMoney(average.income, vault.profile.income_currency)}</strong> a month (last{" "}
        {average.months === 1 ? "month" : `${average.months} full months`}) and spend none of it:
      </p>
      <ul className="flex flex-col gap-2">
        {goals.map((goal) => {
          const m = forecast.get(goal.id) ?? null;
          const whole = m === null ? null : Math.ceil(m);
          return (
            <li key={goal.id} className="flex items-center gap-3 rounded-xl bg-surface-muted px-3 py-2">
              <span className="text-xl leading-none" aria-hidden="true">
                {goal.emoji}
              </span>
              <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">{goal.name}</span>
              {m === 0 ? (
                <span className="flex items-center gap-1 text-sm font-medium text-gain-ink">
                  <CheckCircle2 className="size-4" aria-hidden="true" /> Reached
                </span>
              ) : whole === null ? (
                <span className="text-sm text-ink-soft">No estimate</span>
              ) : (
                <span className="text-right text-sm tabular">
                  <span className="block font-medium text-ink">{formatDate(addMonths(today, whole), { month: "short", year: "numeric" })}</span>
                  <span className="block text-xs text-ink-soft">{whole <= 1 ? "within a month" : `in about ${whole} months`}</span>
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
