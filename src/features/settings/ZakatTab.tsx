import { ArrowRight } from "lucide-react";
import { Link } from "react-router-dom";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Switch } from "@/components/ui/misc";
import { useVault, useVaultAction } from "@/features/vault/VaultProvider";
import { ZakatStatusCard } from "@/features/zakat/ZakatStatus";
import { updateProfile } from "@/lib/api";
import { formatDate, formatMoney, formatPercent } from "@/lib/format";

/** Everything about Zakat in one place: tracking, Nisab & Hawl, payments and the gold price it uses. */
export function ZakatTab() {
  const { vault, userId } = useVault();
  const run = useVaultAction();
  const enabled = vault.profile.zakat_enabled;
  const payments = [...vault.zakatPayments].sort((a, b) => b.paid_on.localeCompare(a.paid_on));
  const pricing = vault.pricing;

  return (
    <div className="flex flex-col gap-5">
      <Card>
        <CardHeader title="Zakat tracking" />
        <CardBody className="flex flex-col gap-4">
          <Switch
            checked={enabled}
            onCheckedChange={(on) => run(() => updateProfile(userId, { zakat_enabled: on }), on ? "Zakat tracking on" : "Zakat tracking off")}
            label="Track Zakat"
            description="Shows the Nisab, your Hawl and when Zakat is due. Your wealth is checked once a day on the server."
          />
          <p className="text-sm text-ink-soft">
            Nisab: 85 g of 24k gold, priced with your gold settings. Hawl: 354 days (one lunar year) at or above the Nisab. Upcoming Income isn't counted.
          </p>
        </CardBody>
      </Card>

      {enabled ? (
        <>
          <ZakatStatusCard />

          <Card>
            <CardHeader title="Gold price used for the Nisab" />
            <CardBody className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-ink-soft">
                {pricing.gold_mode === "manual" && pricing.manual_gold_24k_price
                  ? `Your manual 24k price: ${formatMoney(Number(pricing.manual_gold_24k_price), pricing.manual_gold_currency)} per gram.`
                  : `The live price, plus a ${formatPercent(Number(pricing.gold_premium_pct) / 100, { decimals: 1 })} local premium.`}
              </p>
              <Link
                to="/settings?tab=market"
                className="flex items-center gap-1 rounded-lg px-2 py-1 text-sm font-medium text-brand-ink hover:bg-surface-muted"
              >
                Gold settings <ArrowRight className="size-4" aria-hidden="true" />
              </Link>
            </CardBody>
          </Card>

          <Card>
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
        </>
      ) : null}
    </div>
  );
}
