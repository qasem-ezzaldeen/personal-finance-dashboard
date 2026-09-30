import { useInfiniteQuery } from "@tanstack/react-query";
import { ReceiptText } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Field, Select } from "@/components/ui/Field";
import { EmptyState, Skeleton } from "@/components/ui/misc";
import { queryKeys, useVault } from "@/features/vault/VaultProvider";
import { ACTIVITY_PAGE_SIZE, fetchActivityPage, type ActivityFilters } from "@/lib/api";
import type { Transaction } from "@/lib/types";
import { ActivityItem } from "./ActivityItem";
import { RevertDialog } from "./RevertDialog";

function monthLabel(iso: string, timeZone: string) {
  return new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric", timeZone }).format(new Date(iso));
}

export function ActivityPage() {
  const { userId, vault } = useVault();
  const [filters, setFilters] = useState<Required<ActivityFilters>>({ kind: "all", assetId: "all" });
  const [reverting, setReverting] = useState<Transaction | null>(null);

  const query = useInfiniteQuery({
    queryKey: [...queryKeys.activity(userId), "page", filters],
    queryFn: ({ pageParam }) => fetchActivityPage(userId, pageParam, filters),
    initialPageParam: 0,
    getNextPageParam: (last, pages) => (last.length === ACTIVITY_PAGE_SIZE ? pages.length : undefined),
  });

  const items = query.data?.pages.flat() ?? [];
  const months = new Map<string, Transaction[]>();
  for (const tx of items) {
    const label = monthLabel(tx.occurred_at, vault.profile.timezone);
    months.set(label, [...(months.get(label) ?? []), tx]);
  }
  const accounts = vault.assets.filter((a) => a.kind === "cash" || a.kind === "pending_income");

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-2xl font-semibold text-ink">Activity</h1>
        <p className="text-ink-soft">Every income, transfer and change. Tap an entry to revert to that point.</p>
      </div>

      <div className="grid gap-3 sm:max-w-xl sm:grid-cols-2">
        <Field label="Type">
          {(p) => (
            <Select {...p} value={filters.kind} onChange={(e) => setFilters((f) => ({ ...f, kind: e.target.value as typeof f.kind }))}>
              <option value="all">Everything</option>
              <option value="income">Income</option>
              <option value="transfer">Transfers</option>
              <option value="automation">Automations</option>
              <option value="adjustment">Balance changes</option>
              <option value="imported">Imported history</option>
            </Select>
          )}
        </Field>
        <Field label="Account">
          {(p) => (
            <Select {...p} value={filters.assetId} onChange={(e) => setFilters((f) => ({ ...f, assetId: e.target.value }))}>
              <option value="all">All accounts</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>

      {query.isLoading ? (
        <div className="flex flex-col gap-2">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-16" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <EmptyState icon={<ReceiptText className="size-8" />} title="Nothing here yet">
          Income you log, transfers and automatic moves will appear here.
        </EmptyState>
      ) : (
        <div className="flex flex-col gap-4">
          {[...months.entries()].map(([label, txs]) => (
            <Card key={label}>
              <h2 className="sticky top-[7.5rem] z-10 rounded-t-[var(--radius-card)] border-b border-line bg-surface px-4 py-3 text-sm font-semibold text-ink-soft md:top-16">
                {label}
              </h2>
              <ul className="flex flex-col p-1.5">
                {txs.map((tx) => (
                  <li key={tx.id}>
                    <ActivityItem tx={tx} onSelect={setReverting} />
                  </li>
                ))}
              </ul>
            </Card>
          ))}
          {query.hasNextPage ? (
            <Button onClick={() => query.fetchNextPage()} loading={query.isFetchingNextPage} className="self-center">
              Load more
            </Button>
          ) : null}
        </div>
      )}

      <RevertDialog tx={reverting} onClose={() => setReverting(null)} />
    </div>
  );
}
