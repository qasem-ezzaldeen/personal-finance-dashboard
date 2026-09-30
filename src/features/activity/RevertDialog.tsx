import { useQuery } from "@tanstack/react-query";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Skeleton } from "@/components/ui/misc";
import { useVault, useVaultAction } from "@/features/vault/VaultProvider";
import { previewRevert, revertToTransaction } from "@/lib/api";
import { formatDateTime, formatNumber } from "@/lib/format";
import type { Transaction } from "@/lib/types";
import { describeTransaction } from "./ActivityItem";

export function RevertDialog({ tx, onClose }: { tx: Transaction | null; onClose: () => void }) {
  const { userId, vault } = useVault();
  const run = useVaultAction();
  const preview = useQuery({
    queryKey: ["revert-preview", tx?.id],
    queryFn: () => previewRevert(userId, tx!),
    enabled: Boolean(tx),
    staleTime: 0,
    gcTime: 0,
  });

  if (!tx) return null;
  const currencyOf = (name: string) => vault.assets.find((a) => a.name === name)?.currency ?? "";

  return (
    <ConfirmDialog
      open={Boolean(tx)}
      onOpenChange={(open) => !open && onClose()}
      title="Revert to this point?"
      confirmLabel={preview.data?.count ? `Revert ${preview.data.count} ${preview.data.count === 1 ? "entry" : "entries"}` : "Nothing to revert"}
      tone="danger"
      onConfirm={async () => {
        if (!preview.data?.count) return;
        await run(() => revertToTransaction(tx.id), "History reverted");
      }}
    >
      <p>
        Everything after <strong className="text-ink">{describeTransaction(tx).title}</strong> ({formatDateTime(tx.occurred_at, vault.profile.timezone)})
        will be undone and removed.
      </p>
      {preview.isLoading ? (
        <Skeleton className="h-16" />
      ) : preview.data && preview.data.count > 0 ? (
        <div className="rounded-xl bg-surface-muted p-3">
          <p className="mb-2 font-medium text-ink">These balances will change back:</p>
          <ul className="flex flex-col gap-1">
            {preview.data.effects.map((e) => (
              <li key={e.assetName} className="flex justify-between gap-3 tabular">
                <span>{e.assetName}</span>
                <span className={e.delta > 0 ? "text-gain-ink" : "text-loss-ink"}>
                  {e.delta > 0 ? "+" : "−"}
                  {formatNumber(Math.abs(e.delta), 2, 2)} {currencyOf(e.assetName)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p>This is already the latest entry, so there's nothing to revert.</p>
      )}
      <p className="text-loss-ink">This can't be undone.</p>
    </ConfirmDialog>
  );
}
