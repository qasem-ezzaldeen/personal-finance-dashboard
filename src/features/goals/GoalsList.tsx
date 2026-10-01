import { CheckCircle2, Lock, Pencil, Target } from "lucide-react";
import { useState } from "react";
import { DragHandle, SortableList, useLocalOrder, useSortableItem } from "@/components/ui/Sortable";
import { Badge, EmptyState, ProgressBar } from "@/components/ui/misc";
import { useVault, useVaultAction } from "@/features/vault/VaultProvider";
import { reorderGoals } from "@/lib/api";
import { cn } from "@/lib/cn";
import { formatGrams, formatMoney, formatPercent } from "@/lib/format";
import { GOLD_UNIT, type Goal } from "@/lib/types";
import { goalsProgress, type GoalProgress } from "@/lib/valuation";
import { GoalDialog } from "./GoalDialog";

function formatUnit(value: number | null, unit: string) {
  return unit === GOLD_UNIT ? formatGrams(value) : formatMoney(value, unit);
}

const UNIT_COLOR: Record<string, string> = { [GOLD_UNIT]: "butter" };

function GoalCard({ goal, progress: p, onEdit }: { goal: Goal; progress: GoalProgress; onEdit: () => void }) {
  const { summary } = useVault();
  const { setNodeRef, style, handleProps, isDragging } = useSortableItem(goal.id);
  const color = UNIT_COLOR[goal.target_unit] ?? (goal.target_unit === summary.base ? "mint" : "lavender");

  return (
    <li
      ref={setNodeRef}
      style={style}
      className={cn(
        "rounded-2xl border border-line bg-surface p-4 transition md:hover:-translate-y-0.5 md:hover:shadow-soft",
        isDragging && "shadow-lifted",
      )}
    >
      <div className="flex items-start gap-2">
        <DragHandle label={`Reorder ${goal.name}`} className="-ml-2" {...handleProps} />
        <span className="text-2xl leading-none" aria-hidden="true">
          {goal.emoji}
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="flex min-w-0 items-center gap-2 font-semibold text-ink">
            <span className="truncate">{goal.name}</span>
            {goal.reserve_funds ? (
              <Badge tone="brand" className="shrink-0">
                <Lock className="size-3" aria-hidden="true" /> Reserved
              </Badge>
            ) : null}
          </h3>
          <p className="text-sm text-ink-soft">Target {formatUnit(p.target, goal.target_unit)}</p>
        </div>
        <span className="text-lg font-bold text-ink tabular">{p.progress === null ? "—" : formatPercent(p.progress, { decimals: 0 })}</span>
        <button
          type="button"
          onClick={onEdit}
          className="-mr-1 grid size-9 place-items-center rounded-lg text-ink-soft hover:bg-surface-muted hover:text-ink"
          aria-label={`Edit ${goal.name}`}
        >
          <Pencil className="size-4" aria-hidden="true" />
        </button>
      </div>
      <div className="mt-3">
        <ProgressBar value={p.progress ?? 0} color={color} label={`${goal.name} progress`} />
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-sm">
        <span className="text-ink-soft tabular">Now {formatUnit(p.current, goal.target_unit)}</span>
        {p.reached ? (
          <span className="flex items-center gap-1 font-medium text-gain-ink">
            <CheckCircle2 className="size-4" aria-hidden="true" /> Goal reached
          </span>
        ) : (
          <span className="text-ink-soft tabular">Remaining {formatUnit(p.remaining, goal.target_unit)}</span>
        )}
      </div>
    </li>
  );
}

/** The user's goals, in their chosen order (drag to reorder). */
export function GoalsList({ limit }: { limit?: number }) {
  const { vault, summary, ctx } = useVault();
  const run = useVaultAction();
  const [editing, setEditing] = useState<{ open: boolean; goal?: Goal }>({ open: false });

  const goals = vault.goals.filter((g) => !g.is_system).sort((a, b) => a.sort_order - b.sort_order);
  const [order, setOrder] = useLocalOrder(goals.map((g) => g.id));
  const byId = new Map(goals.map((g) => [g.id, g]));
  const shown = limit ? order.slice(0, limit) : order;
  // Reserved goals claim money in list order, so progress is worked out for the whole list at once
  const progress = goalsProgress(order.map((id) => byId.get(id)).filter((g): g is Goal => Boolean(g)), summary, ctx);

  if (goals.length === 0) {
    return (
      <>
        <EmptyState icon={<Target className="size-6" />} title="No goals yet">
          Set a target in any currency or in grams of gold and watch your progress.
        </EmptyState>
        <GoalDialog open={editing.open} goal={editing.goal} onOpenChange={(open) => setEditing((e) => ({ ...e, open }))} />
      </>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <SortableList
        ids={shown}
        onReorder={(ids) => {
          const next = limit ? [...ids, ...order.slice(limit)] : ids;
          setOrder(next);
          run(() => reorderGoals(next));
        }}
      >
        <ul className="flex flex-col gap-3">
          {shown.map((id) => {
            const goal = byId.get(id);
            const p = progress.get(id);
            return goal && p ? <GoalCard key={id} goal={goal} progress={p} onEdit={() => setEditing({ open: true, goal })} /> : null;
          })}
        </ul>
      </SortableList>
      <GoalDialog open={editing.open} goal={editing.goal} onOpenChange={(open) => setEditing((e) => ({ ...e, open }))} />
    </div>
  );
}
