import { ArrowDownLeft, ArrowLeftRight, Bot, History, SlidersHorizontal } from "lucide-react";
import { Badge } from "@/components/ui/misc";
import { useVault } from "@/features/vault/VaultProvider";
import { cn } from "@/lib/cn";
import { formatDateTime, formatMoney } from "@/lib/format";
import type { Transaction } from "@/lib/types";

const ICONS = {
  income: { icon: ArrowDownLeft, tone: "bg-gain text-gain-ink" },
  transfer: { icon: ArrowLeftRight, tone: "bg-cash text-cash-ink" },
  automation: { icon: Bot, tone: "bg-brand text-brand-ink" },
  adjustment: { icon: SlidersHorizontal, tone: "bg-warning text-warning-ink" },
  imported: { icon: History, tone: "bg-neutral text-neutral-ink" },
} as const;

export function describeTransaction(tx: Transaction): { title: string; subtitle: string | null; sign: 1 | -1 | 0 } {
  const route = tx.from_asset_name && tx.to_asset_name ? `${tx.from_asset_name} → ${tx.to_asset_name}` : null;
  switch (tx.kind) {
    case "income":
      return { title: tx.description || "Income", subtitle: "Upcoming Income", sign: 1 };
    case "transfer":
      return { title: route ?? "Transfer", subtitle: tx.description || null, sign: 0 };
    case "automation":
      return { title: tx.description || "Automation", subtitle: route, sign: 0 };
    case "adjustment":
      return {
        title: tx.description || "Balance updated",
        subtitle: tx.to_asset_name ?? tx.from_asset_name,
        sign: tx.to_asset_id || tx.to_asset_name ? 1 : -1,
      };
    case "imported": {
      const up = tx.pending_after !== null && tx.pending_before !== null ? Number(tx.pending_after) >= Number(tx.pending_before) : true;
      return { title: tx.description || (up ? "Income" : "Transfer"), subtitle: null, sign: up ? 1 : -1 };
    }
  }
}

export function ActivityItem({ tx, onSelect }: { tx: Transaction; onSelect?: (tx: Transaction) => void }) {
  const { vault } = useVault();
  const base = vault.profile.base_currency;
  const { title, subtitle, sign } = describeTransaction(tx);
  const { icon: Icon, tone } = ICONS[tx.kind];
  const amountInBase = tx.rate_to_base !== null && tx.currency !== base ? Number(tx.amount) * Number(tx.rate_to_base) : null;
  const clickable = Boolean(onSelect) && !tx.is_imported;
  // Before/after values are stored in Upcoming Income's currency (imported entries: the entry's currency)
  const pendingCurrency = tx.is_imported
    ? tx.currency
    : (vault.assets.find((a) => a.kind === "pending_income")?.currency ?? tx.currency);

  const body = (
    <>
      <span className={cn("grid size-10 shrink-0 place-items-center rounded-xl", tone)} aria-hidden="true">
        <Icon className="size-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="truncate font-medium text-ink">{title}</span>
          {tx.kind === "automation" ? <Badge tone="brand">Automatic</Badge> : null}
          {tx.is_imported ? <Badge>Imported</Badge> : null}
        </span>
        <span className="block truncate text-sm text-ink-soft">
          {[subtitle, formatDateTime(tx.occurred_at, vault.profile.timezone)].filter(Boolean).join(" · ")}
        </span>
        {tx.pending_before !== null && tx.pending_after !== null && tx.kind !== "income" ? (
          <span className="block text-xs text-ink-soft tabular">
            Upcoming {formatMoney(Number(tx.pending_before), pendingCurrency)} → {formatMoney(Number(tx.pending_after), pendingCurrency)}
          </span>
        ) : null}
      </span>
      <span className="flex shrink-0 flex-col items-end">
        <span className={cn("font-semibold tabular", sign > 0 ? "text-gain-ink" : sign < 0 ? "text-loss-ink" : "text-ink")}>
          {sign > 0 ? "+" : sign < 0 ? "−" : ""}
          {formatMoney(Number(tx.amount), tx.currency)}
        </span>
        {tx.converted_amount !== null && tx.converted_currency ? (
          <span className="text-xs text-ink-soft tabular">→ {formatMoney(Number(tx.converted_amount), tx.converted_currency)}</span>
        ) : amountInBase !== null ? (
          <span className="text-xs text-ink-soft tabular">{formatMoney(amountInBase, base)}</span>
        ) : null}
      </span>
    </>
  );

  if (!clickable) return <div className="flex items-center gap-3 px-3 py-2.5">{body}</div>;
  return (
    <button
      type="button"
      onClick={() => onSelect!(tx)}
      className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left hover:bg-surface-muted"
      title="Revert to this point"
    >
      {body}
    </button>
  );
}
