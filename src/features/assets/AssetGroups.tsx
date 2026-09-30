import { ChevronRight, Pencil, Plus } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Collapse } from "@/components/ui/Collapse";
import { DragHandle, SortableList, useLocalOrder, useSortableItem } from "@/components/ui/Sortable";
import { Badge, ColorDot, GrowthPill } from "@/components/ui/misc";
import { useActions } from "@/features/actions/ActionsProvider";
import { useVault, useVaultAction } from "@/features/vault/VaultProvider";
import { reorderAssets, reorderGroups } from "@/lib/api";
import { cn } from "@/lib/cn";
import { purchasePriceState } from "@/lib/estimates";
import { formatDate, formatMoney, formatPercent, formatQuantity } from "@/lib/format";
import type { Asset, GroupKind, Purchase } from "@/lib/types";
import { convert, stockPrice, type AssetSummary, type GroupSummary } from "@/lib/valuation";
import { PurchaseDialog } from "./PurchaseDialog";
import { useExpanded } from "./useCollapsed";

type Variant = "compact" | "full";

const GROUP_TONES: Record<GroupKind, string> = {
  cash: "bg-cash text-cash-ink",
  gold: "bg-gold text-gold-ink",
  stock: "bg-stocks text-stocks-ink",
  other: "bg-other text-other-ink",
};

function useSecondary() {
  const { vault, book } = useVault();
  const base = vault.profile.base_currency;
  const secondary = vault.profile.display_currencies.find((c) => c !== base) ?? null;
  return (amount: number | null) =>
    secondary && amount !== null ? formatMoney(convert(amount, base, secondary, book), secondary) : null;
}

function describeHolding(a: AssetSummary, base: string, ctx: ReturnType<typeof useVault>["ctx"]): string {
  const { asset, quantity } = a;
  if (asset.kind === "cash" || asset.kind === "pending_income") {
    return asset.currency === base ? "" : formatMoney(quantity, asset.currency!);
  }
  if (asset.kind === "gold") return `${formatQuantity("gold", quantity)} · ${asset.karat}k`;
  if (asset.kind === "stock") {
    const q = stockPrice(asset.ticker!, ctx);
    return `${formatQuantity("stock", quantity)} · ${asset.ticker}${q ? ` @ ${formatMoney(q.price, q.currency)}` : ""}`;
  }
  return `${formatQuantity("other", quantity)} @ ${formatMoney(Number(asset.manual_unit_price), asset.currency!)}`;
}

// ---------------------------------------------------------------------------

function PurchaseRow({ asset, purchase, value, growth, onEdit }: {
  asset: Asset;
  purchase: Purchase;
  value: number | null;
  growth: AssetSummary["purchases"][number]["growth"];
  onEdit: () => void;
}) {
  const { vault, now } = useVault();
  const base = vault.profile.base_currency;
  const state = purchasePriceState(purchase, asset, now.getTime());

  let detail: ReactNode;
  if (growth) {
    detail = (
      <>
        {growth.estimated ? "≈ " : ""}paid {formatMoney(growth.cost, growth.currency)} → now {formatMoney(growth.value, growth.currency)}
        {growth.estimated ? (
          <Badge tone="neutral" className="ml-1.5 align-middle">
            est.
          </Badge>
        ) : null}
      </>
    );
  } else if (state === "looking-up") {
    detail = <>now {formatMoney(value, base)} · looking up the price on that date…</>;
  } else if (state === "not-found") {
    detail = (
      <>
        now {formatMoney(value, base)} · <span className="text-warning-ink">no market price found for that date, add the price paid</span>
      </>
    );
  } else {
    detail = (
      <>
        now {formatMoney(value, base)} · <span className="text-brand-ink">add price paid</span>
      </>
    );
  }

  return (
    <li>
      <button
        type="button"
        onClick={onEdit}
        className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 rounded-xl px-3 py-2 text-left text-sm hover:bg-surface-muted"
        title={growth?.estimated ? `Estimated from the market price on ${formatDate(purchase.acquired_on)}. Tap to enter the real price.` : undefined}
      >
        <span className="w-24 shrink-0 text-ink-soft tabular">
          {formatDate(purchase.acquired_on)}
          {purchase.is_opening_balance ? <span className="block text-xs">opening</span> : null}
        </span>
        <span className="font-medium text-ink tabular">{formatQuantity(asset.kind as "gold" | "stock" | "other", Number(purchase.quantity))}</span>
        <span className="min-w-0 flex-1 text-ink-soft tabular">{detail}</span>
        <GrowthPill growth={growth} size="sm" />
      </button>
    </li>
  );
}

function AssetRow({ summary, variant }: { summary: AssetSummary; variant: Variant }) {
  const { vault, ctx } = useVault();
  const { openAsset } = useActions();
  const base = vault.profile.base_currency;
  const secondary = useSecondary();
  const { setNodeRef, style, handleProps, isDragging } = useSortableItem(summary.asset.id);
  const hasPurchases = summary.asset.kind !== "cash";
  const [expanded, toggle] = useExpanded(`asset:${summary.asset.id}`, false);
  const [purchaseDialog, setPurchaseDialog] = useState<{ open: boolean; purchase?: Purchase }>({ open: false });
  const detail = describeHolding(summary, base, ctx);

  return (
    <li ref={setNodeRef} style={style} className={cn("rounded-xl", isDragging && "bg-surface shadow-lifted")}>
      <div className="flex items-center gap-1.5">
        <DragHandle label={`Reorder ${summary.asset.name}`} {...handleProps} />
        <button
          type="button"
          onClick={() => (variant === "full" && hasPurchases ? toggle() : openAsset({ asset: summary.asset }))}
          aria-expanded={variant === "full" && hasPurchases ? expanded : undefined}
          className="flex min-w-0 flex-1 items-center gap-3 rounded-xl py-2 pr-2 text-left hover:bg-surface-muted"
        >
          <ColorDot color={summary.asset.color} />
          <span className="min-w-0 flex-1">
            <span className="block truncate font-medium text-ink">{summary.asset.name}</span>
            {detail ? <span className="block truncate text-sm text-ink-soft tabular">{detail}</span> : null}
          </span>
          <span className="flex shrink-0 flex-col items-end gap-0.5">
            <span className="font-semibold text-ink tabular">{summary.value === null ? "Price unavailable" : formatMoney(summary.value, base)}</span>
            <span className="flex items-center gap-1.5">
              {secondary(summary.value) ? <span className="hidden text-xs text-ink-soft tabular sm:inline">{secondary(summary.value)}</span> : null}
              <GrowthPill growth={summary.growth} size="sm" />
            </span>
          </span>
          {variant === "full" && hasPurchases ? (
            <ChevronRight className={cn("size-4 shrink-0 text-ink-faint transition", expanded && "rotate-90")} aria-hidden="true" />
          ) : null}
        </button>
        {variant === "full" ? (
          <button
            type="button"
            onClick={() => openAsset({ asset: summary.asset })}
            className="grid size-9 shrink-0 place-items-center rounded-lg text-ink-soft hover:bg-surface-muted hover:text-ink"
            aria-label={`Edit ${summary.asset.name}`}
          >
            <Pencil className="size-4" aria-hidden="true" />
          </button>
        ) : null}
      </div>

      {variant === "full" && hasPurchases ? (
        <Collapse open={expanded}>
          <div className="mb-2 ml-9 border-l-2 border-line pl-2">
            <ul className="flex flex-col">
              {summary.purchases.map((p) => (
                <PurchaseRow
                  key={p.purchase.id}
                  asset={summary.asset}
                  purchase={p.purchase}
                  value={p.value}
                  growth={p.growth}
                  onEdit={() => setPurchaseDialog({ open: true, purchase: p.purchase })}
                />
              ))}
            </ul>
            <button
              type="button"
              onClick={() => setPurchaseDialog({ open: true })}
              className="mt-1 flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-medium text-brand-ink hover:bg-surface-muted"
            >
              <Plus className="size-4" aria-hidden="true" /> Add purchase
            </button>
            {summary.purchases.length > 0 && summary.unitValue !== null ? (
              <p className="px-3 pb-1 text-xs text-ink-soft tabular">
                {summary.asset.kind === "gold" ? "Per gram" : summary.asset.kind === "stock" ? "Per share" : "Per unit"}: {formatMoney(summary.unitValue, base)}
              </p>
            ) : null}
          </div>
        </Collapse>
      ) : null}

      {hasPurchases ? (
        <PurchaseDialog
          open={purchaseDialog.open}
          onOpenChange={(open) => setPurchaseDialog((d) => ({ ...d, open }))}
          asset={summary.asset}
          purchase={purchaseDialog.purchase}
        />
      ) : null}
    </li>
  );
}

function GroupSection({ group, variant }: { group: GroupSummary; variant: Variant }) {
  const { vault } = useVault();
  const run = useVaultAction();
  const { openAsset } = useActions();
  const base = vault.profile.base_currency;
  const secondary = useSecondary();
  const { setNodeRef, style, handleProps, isDragging } = useSortableItem(`group:${group.group.kind}`);
  const [expanded, toggle] = useExpanded(`group:${group.group.kind}`, variant === "full");
  const [showHidden, setShowHidden] = useState(false);

  const visible = group.assets.filter((a) => showHidden || !a.hidden);
  const hiddenCount = group.assets.length - group.assets.filter((a) => !a.hidden).length;
  const [order, setOrder] = useLocalOrder(visible.map((a) => a.asset.id));
  const byId = new Map(visible.map((a) => [a.asset.id, a]));
  const panelId = `group-panel-${group.group.kind}`;

  return (
    <li ref={setNodeRef} style={style} className={cn("rounded-2xl border border-line bg-surface", isDragging && "shadow-lifted")}>
      <div className="flex items-center gap-1 p-1.5">
        <DragHandle label={`Reorder ${group.group.name}`} {...handleProps} />
        <button
          type="button"
          onClick={toggle}
          aria-expanded={expanded}
          aria-controls={panelId}
          className="flex min-w-0 flex-1 items-center gap-3 rounded-xl px-2 py-2 text-left hover:bg-surface-muted"
        >
          <ChevronRight className={cn("size-4 shrink-0 text-ink-soft transition", expanded && "rotate-90")} aria-hidden="true" />
          <span className={cn("min-w-0 truncate rounded-lg px-2 py-0.5 text-sm font-semibold", GROUP_TONES[group.group.kind])}>
            {group.group.name}
          </span>
          <span className="hidden shrink-0 text-sm text-ink-soft sm:inline">
            {group.assets.length} {group.assets.length === 1 ? "item" : "items"}
          </span>
          <span className="ml-auto flex shrink-0 flex-col items-end gap-0.5">
            <span className="font-semibold text-ink tabular">{formatMoney(group.value, base)}</span>
            <span className="flex items-center gap-1.5 text-xs text-ink-soft tabular">
              {secondary(group.value) ? <span className="hidden sm:inline">{secondary(group.value)} ·</span> : null}
              {formatPercent(group.share)}
              {/* On phones the growth pill sits under the total instead of in its own column */}
              <span className="sm:hidden">
                <GrowthPill growth={group.growth} size="sm" />
              </span>
            </span>
          </span>
          <span className="hidden w-16 shrink-0 text-right sm:block">
            <GrowthPill growth={group.growth} size="sm" />
          </span>
        </button>
      </div>
      <Collapse open={expanded} id={panelId}>
        <div className="px-1.5 pb-2">
          <SortableList
            ids={order}
            onReorder={(ids) => {
              setOrder(ids);
              run(() => reorderAssets(ids));
            }}
          >
            <ul className="flex flex-col gap-0.5">
              {order.map((id) => {
                const a = byId.get(id);
                return a ? <AssetRow key={id} summary={a} variant={variant} /> : null;
              })}
            </ul>
          </SortableList>
          <div className="flex flex-wrap items-center gap-2 px-2 pt-1">
            <button
              type="button"
              onClick={() => openAsset({ kind: group.group.kind })}
              className="flex items-center gap-1.5 rounded-xl px-2 py-1.5 text-sm font-medium text-brand-ink hover:bg-surface-muted"
            >
              <Plus className="size-4" aria-hidden="true" /> Add to {group.group.name}
            </button>
            {hiddenCount > 0 ? (
              <button
                type="button"
                onClick={() => setShowHidden((s) => !s)}
                className="rounded-xl px-2 py-1.5 text-sm text-ink-soft hover:bg-surface-muted"
              >
                {showHidden ? "Hide empty" : `Show ${hiddenCount} empty`}
              </button>
            ) : null}
          </div>
        </div>
      </Collapse>
    </li>
  );
}

/** Collapsible groups (Cash, Gold, Stocks, Other), then Upcoming Income and the total. */
export function AssetGroups({ variant }: { variant: Variant }) {
  const { vault, summary, userId } = useVault();
  const run = useVaultAction();
  const { openMoney } = useActions();
  const base = vault.profile.base_currency;
  const secondary = useSecondary();

  const groups = summary.groups.filter((g) => g.assets.length > 0);
  const [order, setOrder] = useLocalOrder(groups.map((g) => `group:${g.group.kind}`));
  const byId = new Map(groups.map((g) => [`group:${g.group.kind}`, g]));

  return (
    <div className="flex flex-col gap-2">
      <SortableList
        ids={order}
        onReorder={(ids) => {
          setOrder(ids);
          const kinds = ids.map((id) => id.replace("group:", "") as GroupKind);
          const missing = summary.groups.map((g) => g.group.kind).filter((k) => !kinds.includes(k));
          run(() => reorderGroups(userId, [...kinds, ...missing]));
        }}
      >
        <ul className="flex flex-col gap-2" aria-label="Asset groups">
          {order.map((id) => {
            const g = byId.get(id);
            return g ? <GroupSection key={id} group={g} variant={variant} /> : null;
          })}
        </ul>
      </SortableList>

      {summary.pending ? (
        <button
          type="button"
          onClick={() => openMoney(summary.pending!.quantity > 0 ? "transfer" : "income", { fromId: summary.pending!.asset.id })}
          className="flex items-center gap-3 rounded-2xl bg-pending px-4 py-3 text-left hover:brightness-[0.98]"
        >
          <span className="min-w-0 flex-1">
            <span className="block font-medium text-pending-ink">Upcoming Income</span>
            <span className="block text-sm text-pending-ink opacity-80">Not counted for Zakat</span>
          </span>
          <span className="flex flex-col items-end">
            <span className="font-semibold text-ink tabular">{formatMoney(summary.pending.value, base)}</span>
            {summary.pending.asset.currency !== base ? (
              <span className="text-xs text-ink-soft tabular">{formatMoney(summary.pending.quantity, summary.pending.asset.currency!)}</span>
            ) : null}
          </span>
        </button>
      ) : null}

      <div className="flex items-center justify-between gap-3 rounded-2xl bg-brand px-4 py-3">
        <span className="font-semibold text-brand-ink">Total net worth</span>
        <span className="flex flex-col items-end">
          <span className="text-lg font-bold text-ink tabular">{formatMoney(summary.netWorth, base)}</span>
          {secondary(summary.netWorth) ? <span className="text-sm text-ink-soft tabular">{secondary(summary.netWorth)}</span> : null}
        </span>
      </div>

      {summary.incomplete ? (
        <p className="px-1 text-sm text-warning-ink">
          No price yet for {summary.missingPrices.join(", ")}. {summary.missingPrices.length === 1 ? "It isn't" : "They aren't"} counted until one arrives.
        </p>
      ) : null}
      {groups.length === 0 ? (
        <p className="px-1 text-sm text-ink-soft">No assets yet. Add your first one to see your wealth here.</p>
      ) : null}
    </div>
  );
}
