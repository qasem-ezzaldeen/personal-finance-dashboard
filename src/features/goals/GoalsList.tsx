import { CheckCircle2, Pencil, Pin } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { DragHandle, SortableList, useLocalOrder, useSortableItem } from "@/components/ui/Sortable";
import { Badge, ProgressBar } from "@/components/ui/misc";
import { useVault, useVaultAction } from "@/features/vault/VaultProvider";
import { reorderGoals } from "@/lib/api";
import { cn } from "@/lib/cn";
import { formatGrams, formatMoney, formatNumber, formatPercent } from "@/lib/format";
import { GOLD_UNIT, type Goal } from "@/lib/types";
import { HAWL_DAYS, NISAB_GRAMS, convert, goalProgress } from "@/lib/valuation";
import { GoalDialog } from "./GoalDialog";
import { HawlEditorDialog, MarkZakatPaidDialog, useZakatBasisText } from "./ZakatDialogs";

function formatUnit(value: number | null, unit: string) {
  return unit === GOLD_UNIT ? formatGrams(value) : formatMoney(value, unit);
}

const UNIT_COLOR: Record<string, string> = { [GOLD_UNIT]: "butter" };

function GoalCard({ goal, onEdit }: { goal: Goal; onEdit: () => void }) {
  const { summary, ctx } = useVault();
  const { setNodeRef, style, handleProps, isDragging } = useSortableItem(goal.id);
  const p = goalProgress(goal, summary, ctx);
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
          <h3 className="truncate font-semibold text-ink">{goal.name}</h3>
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

export function ZakatCard() {
  const { summary } = useVault();
  const [hawlOpen, setHawlOpen] = useState(false);
  const [paidOpen, setPaidOpen] = useState(false);
  const z = summary.zakat;
  const progressToNisab = z.grams === null ? 0 : z.grams / NISAB_GRAMS;

  let status: string;
  if (z.grams === null) status = "Waiting for the gold price";
  else if (z.isDue) status = "Zakat is due";
  else if (z.hawlStart) status = `Day ${formatNumber(z.daysIntoHawl, 0)} of ${HAWL_DAYS} · due in ${z.daysRemaining} ${z.daysRemaining === 1 ? "day" : "days"}`;
  else if (z.aboveNisab) status = "Above the Nisab · Hawl starts at the next daily check";
  else status = `${formatGrams(Math.max(0, NISAB_GRAMS - (z.grams ?? 0)))} below the Nisab`;

  return (
    <div className="rounded-2xl border border-line bg-gold/40 p-4">
      <div className="flex items-start gap-2">
        <Pin className="mt-1 size-4 shrink-0 text-gold-ink" aria-label="Pinned" />
        <span className="text-2xl leading-none" aria-hidden="true">
          🕌
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold text-ink">Zakat threshold</h3>
          <p className="text-sm text-ink-soft">Nisab {formatGrams(NISAB_GRAMS)} of 24k gold</p>
        </div>
        <Button size="sm" variant="secondary" onClick={() => setHawlOpen(true)}>
          Edit Hawl
        </Button>
      </div>
      <div className="mt-3">
        <ProgressBar
          value={z.hawlStart ? z.daysIntoHawl / HAWL_DAYS : progressToNisab}
          color={z.isDue ? "mint" : "butter"}
          label={z.hawlStart ? "Hawl progress" : "Progress to the Nisab"}
        />
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-sm">
        <span className="text-ink-soft tabular">Your wealth: {formatGrams(z.grams)}</span>
        {z.isDue ? <Badge tone="gain">{status}</Badge> : <span className="font-medium text-gold-ink">{status}</span>}
      </div>
      {z.isDue ? (
        <Button variant="primary" size="sm" className="mt-3" onClick={() => setPaidOpen(true)}>
          Mark as paid
        </Button>
      ) : null}
      <HawlEditorDialog open={hawlOpen} onOpenChange={setHawlOpen} />
      <MarkZakatPaidDialog open={paidOpen} onOpenChange={setPaidOpen} />
    </div>
  );
}

/** Zakat pinned first, then the user's goals (drag to reorder). */
export function GoalsList({ limit }: { limit?: number }) {
  const { vault } = useVault();
  const run = useVaultAction();
  const [editing, setEditing] = useState<{ open: boolean; goal?: Goal }>({ open: false });

  const goals = vault.goals.filter((g) => !g.is_system).sort((a, b) => a.sort_order - b.sort_order);
  const [order, setOrder] = useLocalOrder(goals.map((g) => g.id));
  const byId = new Map(goals.map((g) => [g.id, g]));
  const shown = limit ? order.slice(0, limit) : order;

  return (
    <div className="flex flex-col gap-3">
      {vault.profile.zakat_enabled ? <ZakatCard /> : null}
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
            return goal ? <GoalCard key={id} goal={goal} onEdit={() => setEditing({ open: true, goal })} /> : null;
          })}
        </ul>
      </SortableList>
      <GoalDialog open={editing.open} goal={editing.goal} onOpenChange={(open) => setEditing((e) => ({ ...e, open }))} />
    </div>
  );
}

export function ZakatDueBanner() {
  const { vault, summary, book } = useVault();
  const [paidOpen, setPaidOpen] = useState(false);
  const basis = useZakatBasisText();
  if (!vault.profile.zakat_enabled || !summary.zakat.isDue) return null;
  const base = vault.profile.base_currency;
  const secondary = vault.profile.display_currencies.find((c) => c !== base);
  const secondaryAmount = secondary && summary.zakat.dueAmount !== null ? convert(summary.zakat.dueAmount, base, secondary, book) : null;

  return (
    <div className="flex flex-wrap items-center gap-4 rounded-2xl bg-gain px-5 py-4" role="status">
      <span className="text-3xl" aria-hidden="true">
        🕌
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-semibold text-gain-ink">Zakat is due</p>
        <p className="text-sm text-ink">
          Your wealth has stayed above the Nisab for {formatNumber(summary.zakat.daysIntoHawl, 0)} days.
        </p>
        <p className="text-sm text-ink-soft">Amount due: {basis}.</p>
      </div>
      <div className="text-right">
        <p className="text-xs font-medium tracking-wide text-ink-soft uppercase">Zakat due</p>
        <p className="text-xl font-bold text-ink tabular">{formatMoney(summary.zakat.dueAmount, base)}</p>
        {secondary && secondaryAmount !== null ? (
          <p className="text-sm text-ink-soft tabular">{formatMoney(secondaryAmount, secondary)}</p>
        ) : null}
      </div>
      <Button variant="primary" onClick={() => setPaidOpen(true)}>
        Mark as paid
      </Button>
      <MarkZakatPaidDialog open={paidOpen} onOpenChange={setPaidOpen} />
    </div>
  );
}
