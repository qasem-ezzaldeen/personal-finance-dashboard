import { Plus } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card, CardBody } from "@/components/ui/Card";
import { GrowthPill } from "@/components/ui/misc";
import { useActions } from "@/features/actions/ActionsProvider";
import { useVault } from "@/features/vault/VaultProvider";
import { formatMoney, formatPercent, formatUnitTotal } from "@/lib/format";
import { visibleUnitTotals } from "@/lib/valuation";
import { AssetGroups } from "./AssetGroups";
import { LazyWealthDonut } from "./LazyWealthDonut";

export function AssetsPage() {
  const { vault, summary } = useVault();
  const { openAsset } = useActions();
  const base = vault.profile.base_currency;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-ink">Assets</h1>
          <p className="text-ink-soft">Tap an asset to see its purchases and how each has grown.</p>
        </div>
        <Button variant="primary" onClick={() => openAsset()}>
          <Plus className="size-4" aria-hidden="true" /> Add asset
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <AssetGroups variant="full" />

        <Card className="h-fit lg:sticky lg:top-24">
          <CardBody className="flex flex-col gap-4 pt-5">
            <LazyWealthDonut className="max-w-[10.5rem]" />
            <dl className="flex flex-col gap-2 text-sm">
              {summary.groups
                .filter((g) => g.value > 0)
                .map((g) => {
                  const units = visibleUnitTotals(g.units, [base]);
                  return (
                    <div key={g.group.kind} className="flex items-start justify-between gap-2">
                      <dt className="text-ink-soft">
                        {g.group.name}
                        {units.length > 0 ? (
                          <span className="flex flex-wrap gap-x-2 text-xs tabular">
                            {units.map((u) => (
                              <span key={u.unit === "gold" ? `gold:${u.karat}` : `money:${u.currency}`} className="whitespace-nowrap">
                                {formatUnitTotal(u)}
                              </span>
                            ))}
                          </span>
                        ) : null}
                      </dt>
                      <dd className="shrink-0 font-medium whitespace-nowrap text-ink tabular">
                        {formatMoney(g.value, base, { compact: true, decimals: 2 })} · {formatPercent(g.share, { decimals: 2 })}
                      </dd>
                    </div>
                  );
                })}
            </dl>
            {summary.totalGrowth ? (
              <div className="flex items-center justify-between gap-2 border-t border-line pt-3 text-sm">
                <span className="text-ink-soft">Growth since purchase</span>
                <GrowthPill growth={summary.totalGrowth} showAmount />
              </div>
            ) : null}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
