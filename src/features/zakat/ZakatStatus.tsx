import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Badge, ProgressBar } from "@/components/ui/misc";
import { useVault } from "@/features/vault/VaultProvider";
import { formatGrams, formatMoney, formatNumber } from "@/lib/format";
import { HAWL_DAYS, NISAB_GRAMS, convert } from "@/lib/valuation";
import { HawlEditorDialog, MarkZakatPaidDialog, useZakatBasisText } from "./ZakatDialogs";

/** Nisab and Hawl progress, with Edit Hawl and (when due) Mark as paid. */
export function ZakatStatusCard() {
  const { vault, summary } = useVault();
  const [hawlOpen, setHawlOpen] = useState(false);
  const [paidOpen, setPaidOpen] = useState(false);
  const z = summary.zakat;
  const base = vault.profile.base_currency;
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
        <span className="text-2xl leading-none" aria-hidden="true">
          🕌
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold text-ink">Nisab & Hawl</h3>
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
      {z.hawlStart ? (
        <p className="mt-1 text-sm text-ink-soft tabular">
          {z.isDue ? "Due now" : "Due at the end of the Hawl"}: {formatMoney(z.dueAmount, base)}
        </p>
      ) : null}
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
