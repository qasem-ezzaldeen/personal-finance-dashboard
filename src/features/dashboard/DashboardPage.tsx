import { useQuery } from "@tanstack/react-query";
import { ArrowRight, HandCoins, ReceiptText, Target, TrendingUp, Wallet } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { ResizableColumns } from "@/components/layout/ResizableColumns";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { EmptyState, GrowthPill, ProgressBar, Skeleton } from "@/components/ui/misc";
import { ActivityItem } from "@/features/activity/ActivityItem";
import { RevertDialog } from "@/features/activity/RevertDialog";
import { AssetGroups } from "@/features/assets/AssetGroups";
import { LazyWealthDonut } from "@/features/assets/LazyWealthDonut";
import { GoalsList, ZakatDueBanner } from "@/features/goals/GoalsList";
import { MoneyForm } from "@/features/money/MoneyForm";
import { queryKeys, useVault } from "@/features/vault/VaultProvider";
import { fetchRecentActivity } from "@/lib/api";
import { formatGrams, formatMoney, formatNumber } from "@/lib/format";
import type { Transaction } from "@/lib/types";
import { HAWL_DAYS, NISAB_GRAMS, convert } from "@/lib/valuation";

function StatCard({ label, children, icon }: { label: string; children: ReactNode; icon: ReactNode }) {
  return (
    <Card className="p-4">
      <div className="flex items-center gap-2 text-sm text-ink-soft">
        <span aria-hidden="true">{icon}</span>
        {label}
      </div>
      <div className="mt-2">{children}</div>
    </Card>
  );
}

function SummaryCards() {
  const { vault, summary, book } = useVault();
  const base = vault.profile.base_currency;
  const others = vault.profile.display_currencies.filter((c) => c !== base).slice(0, 2);
  const pending = summary.pending;
  const z = summary.zakat;

  return (
    <div className="grid grid-cols-2 gap-3 md:gap-4 xl:grid-cols-4">
      <Card className="col-span-2 p-4 xl:col-span-1">
        <div className="flex items-center gap-2 text-sm text-ink-soft">
          <Wallet className="size-4" aria-hidden="true" /> Net worth
        </div>
        <p className="mt-2 text-2xl font-bold text-ink tabular md:text-3xl">{formatMoney(summary.netWorth, base)}</p>
        <p className="mt-0.5 flex flex-wrap gap-x-3 text-sm text-ink-soft tabular">
          {others.map((c) => (
            <span key={c}>{formatMoney(convert(summary.netWorth, base, c, book), c)}</span>
          ))}
        </p>
      </Card>

      <StatCard label="Upcoming income" icon={<HandCoins className="size-4" />}>
        <p className="text-xl font-semibold text-ink tabular">{formatMoney(pending?.quantity ?? 0, pending?.asset.currency ?? base)}</p>
        {pending && pending.asset.currency !== base ? (
          <p className="text-sm text-ink-soft tabular">{formatMoney(pending.value, base)}</p>
        ) : null}
      </StatCard>

      <StatCard label="Total gain" icon={<TrendingUp className="size-4" />}>
        {summary.totalGrowth ? (
          <>
            <GrowthPill growth={summary.totalGrowth} />
            <p className="mt-1 text-sm text-ink-soft tabular">{formatMoney(summary.totalGrowth.gain, base, { signed: true })}</p>
          </>
        ) : (
          <p className="text-sm text-ink-soft">Add purchase prices to your assets to see growth.</p>
        )}
      </StatCard>

      {vault.profile.zakat_enabled ? (
        <Card className="col-span-2 p-4 xl:col-span-1">
          <div className="flex items-center gap-2 text-sm text-ink-soft">
            <span aria-hidden="true">🕌</span> Zakat
          </div>
          {z.isDue ? (
            <p className="mt-2 text-lg font-semibold text-gain-ink">Due now · {formatMoney(z.dueAmount, base)}</p>
          ) : z.hawlStart ? (
            <>
              <p className="mt-2 text-lg font-semibold text-ink tabular">
                {formatNumber(z.daysIntoHawl, 0)} / {HAWL_DAYS} days
              </p>
              <div className="mt-2">
                <ProgressBar value={z.daysIntoHawl / HAWL_DAYS} color="butter" label="Hawl progress" />
              </div>
            </>
          ) : (
            <>
              <p className="mt-2 text-lg font-semibold text-ink tabular">
                {formatGrams(z.grams)} <span className="text-sm font-normal text-ink-soft">of {NISAB_GRAMS} g</span>
              </p>
              <div className="mt-2">
                <ProgressBar value={(z.grams ?? 0) / NISAB_GRAMS} color="butter" label="Progress to the Nisab" />
              </div>
            </>
          )}
        </Card>
      ) : null}
    </div>
  );
}

function RecentActivity() {
  const { userId } = useVault();
  const [reverting, setReverting] = useState<Transaction | null>(null);
  const recent = useQuery({
    queryKey: [...queryKeys.activity(userId), "recent"],
    queryFn: () => fetchRecentActivity(userId, 8),
  });

  return (
    <Card>
      <CardHeader
        title="Recent activity"
        icon={<ReceiptText className="size-5" />}
        actions={
          <Link to="/activity" className="flex items-center gap-1 rounded-lg px-2 py-1 text-sm font-medium text-brand-ink hover:bg-surface-muted">
            View all <ArrowRight className="size-4" aria-hidden="true" />
          </Link>
        }
      />
      <CardBody className="px-1.5 sm:px-2">
        {recent.isLoading ? (
          <div className="flex flex-col gap-2 px-2">
            <Skeleton className="h-14" />
            <Skeleton className="h-14" />
          </div>
        ) : recent.data && recent.data.length > 0 ? (
          <ul>
            {recent.data.map((tx) => (
              <li key={tx.id}>
                <ActivityItem tx={tx} onSelect={setReverting} />
              </li>
            ))}
          </ul>
        ) : (
          <div className="px-2">
            <EmptyState title="No activity yet">Log income or move money and it shows up here.</EmptyState>
          </div>
        )}
      </CardBody>
      <RevertDialog tx={reverting} onClose={() => setReverting(null)} />
    </Card>
  );
}

export function DashboardPage() {
  const { vault } = useVault();
  return (
    <div className="flex flex-col gap-5">
      <h1 className="sr-only">Dashboard · {vault.profile.vault_name}</h1>
      <ZakatDueBanner />
      <SummaryCards />
      <ResizableColumns
        leftClassName="hidden md:flex"
        left={
          <>
            <Card className="hidden md:block">
              <CardHeader title="Quick actions" icon={<HandCoins className="size-5" />} />
              <CardBody>
                <MoneyForm />
              </CardBody>
            </Card>
            <div className="hidden md:block">
              <RecentActivity />
            </div>
          </>
        }
        right={
          <>
            <Card>
              <CardHeader
                title="Wealth distribution"
                icon={<Wallet className="size-5" />}
                actions={
                  <Link to="/assets" className="flex items-center gap-1 rounded-lg px-2 py-1 text-sm font-medium text-brand-ink hover:bg-surface-muted">
                    Details <ArrowRight className="size-4" aria-hidden="true" />
                  </Link>
                }
              />
              <CardBody className="flex flex-col gap-4">
                <div className="hidden sm:block">
                  <LazyWealthDonut size={190} />
                </div>
                <AssetGroups variant="compact" />
              </CardBody>
            </Card>
            <Card>
              <CardHeader
                title="Goals"
                icon={<Target className="size-5" />}
                actions={
                  <Link to="/goals" className="flex items-center gap-1 rounded-lg px-2 py-1 text-sm font-medium text-brand-ink hover:bg-surface-muted">
                    View all <ArrowRight className="size-4" aria-hidden="true" />
                  </Link>
                }
              />
              <CardBody>
                <GoalsList limit={3} />
              </CardBody>
            </Card>
          </>
        }
      />
      {/* On phones, recent activity comes after wealth and goals */}
      <div className="md:hidden">
        <RecentActivity />
      </div>
    </div>
  );
}
