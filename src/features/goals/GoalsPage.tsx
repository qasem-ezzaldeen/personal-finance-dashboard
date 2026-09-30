import { Plus } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { useVault } from "@/features/vault/VaultProvider";
import { formatDate, formatMoney } from "@/lib/format";
import { GoalDialog } from "./GoalDialog";
import { GoalsList, ZakatDueBanner } from "./GoalsList";

export function GoalsPage() {
  const { vault } = useVault();
  const [adding, setAdding] = useState(false);
  const payments = [...vault.zakatPayments].sort((a, b) => b.paid_on.localeCompare(a.paid_on));

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-ink">Goals</h1>
          <p className="text-ink-soft">Drag goals to reorder them. The Zakat threshold always stays on top.</p>
        </div>
        <Button variant="primary" onClick={() => setAdding(true)}>
          <Plus className="size-4" aria-hidden="true" /> New goal
        </Button>
      </div>

      <ZakatDueBanner />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <GoalsList />
        {vault.profile.zakat_enabled ? (
          <Card className="h-fit">
            <CardHeader title="Zakat payments" subtitle="Recorded with “Mark as paid”" />
            <CardBody>
              {payments.length === 0 ? (
                <p className="text-sm text-ink-soft">No payments recorded yet.</p>
              ) : (
                <ul className="flex flex-col divide-y divide-line">
                  {payments.map((p) => (
                    <li key={p.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                      <span>
                        <span className="block font-medium text-ink">{formatDate(p.paid_on)}</span>
                        {p.note ? <span className="block text-ink-soft">{p.note}</span> : null}
                      </span>
                      <span className="font-semibold text-ink tabular">{formatMoney(Number(p.amount), p.currency)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
        ) : null}
      </div>
      <GoalDialog open={adding} onOpenChange={setAdding} />
    </div>
  );
}
