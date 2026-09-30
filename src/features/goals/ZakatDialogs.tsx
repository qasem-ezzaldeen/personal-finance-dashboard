import { useQuery } from "@tanstack/react-query";
import { useMemo, useState, type FormEvent } from "react";
import { gold24kGramOn } from "@shared/estimates";
import { Button } from "@/components/ui/Button";
import { Dialog, useOpenKey } from "@/components/ui/Dialog";
import { AmountInput, Field, Input, Select, parseAmount } from "@/components/ui/Field";
import { Notice, ProgressBar } from "@/components/ui/misc";
import { useVault, useVaultAction } from "@/features/vault/VaultProvider";
import { fetchPriceOnDate, markZakatPaid, updateHawl } from "@/lib/api";
import { currencyOptions } from "@/lib/currencies";
import { addDays, daysBetween, formatDate, formatGrams, formatMoney, formatNumber } from "@/lib/format";
import { HAWL_DAYS, NISAB_GRAMS, ZAKAT_RATE, convert } from "@/lib/valuation";

const PRESETS = [
  { days: 1, label: "Just started" },
  { days: 90, label: "90 days" },
  { days: 177, label: "Half a year" },
  { days: HAWL_DAYS, label: "Full Hawl" },
];

interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function HawlEditorDialog(props: DialogProps) {
  const openKey = useOpenKey(props.open);
  return <HawlEditorContent key={openKey} {...props} />;
}

function HawlEditorContent({ open, onOpenChange }: DialogProps) {
  const { vault, summary, userId, book } = useVault();
  const run = useVaultAction();
  const today = summary.today;
  const base = vault.profile.base_currency;
  const hawl = vault.hawl;
  const currencies = useMemo(() => currencyOptions(book.usdRates.keys()), [book.usdRates]);

  const [daysRaw, setDaysRaw] = useState(String(Math.max(1, summary.zakat.daysIntoHawl)));
  const [start, setStart] = useState(summary.zakat.hawlStart ?? today);
  const [wealthRaw, setWealthRaw] = useState(hawl?.start_wealth !== null && hawl?.start_wealth !== undefined ? String(Number(hawl.start_wealth)) : "");
  const [wealthCurrency, setWealthCurrency] = useState(hawl?.start_wealth_currency ?? base);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const days = Math.max(0, Math.floor(parseAmount(daysRaw) ?? 0));
  const setDays = (d: number) => {
    setDaysRaw(String(d));
    if (d >= 1) setStart(addDays(today, -(d - 1)));
  };

  const [firstHawl, setFirstHawl] = useState(hawl?.is_first_hawl ?? false);

  // First Hawl: Zakat is based on the value of 85 g of 24k gold on the day the Hawl started
  const nisabOnStart = useQuery({
    queryKey: ["price-on-date", start, base],
    queryFn: () => fetchPriceOnDate(start, base === "USD" ? [] : [base]),
    enabled: open && firstHawl && Boolean(start),
    staleTime: Number.POSITIVE_INFINITY,
    retry: 1,
  });
  const gramOnStart = nisabOnStart.data
    ? gold24kGramOn(nisabOnStart.data.xau.price, base === "USD" ? 1 : nisabOnStart.data.fx[base].price, vault.pricing.gold_premium_pct)
    : null;
  const nisabValue = gramOnStart !== null ? Math.round(gramOnStart * NISAB_GRAMS * 100) / 100 : null;

  const typedWealth = wealthRaw.trim() ? parseAmount(wealthRaw) : null;
  const wealth = firstHawl ? nisabValue : typedWealth;
  const effectiveCurrency = firstHawl ? base : wealthCurrency;
  const wealthInBase = wealth !== null ? convert(wealth, effectiveCurrency, base, book) : null;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (days < 1) return;
    if (firstHawl && nisabValue === null) return setError("We need the gold price on the start date first. Try again in a moment.");
    if (!firstHawl && wealthRaw.trim() && (typedWealth === null || typedWealth < 0)) {
      return setError("Enter your wealth as a number, or leave it empty");
    }
    setSaving(true);
    const ok = await run(
      () =>
        updateHawl(userId, {
          hawl_start_date: start,
          start_wealth: wealth,
          start_wealth_currency: wealth !== null ? effectiveCurrency : null,
          is_first_hawl: firstHawl,
        }),
      "Hawl updated",
    );
    setSaving(false);
    if (ok) onOpenChange(false);
  };

  const pct = Math.min(1, days / HAWL_DAYS);

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Edit your Hawl"
      description="Zakat is due once your wealth stays at or above the Nisab (85 g of 24k gold) for one lunar year (354 days)."
      onSubmit={submit}
      footer={
        <>
          {summary.zakat.hawlStart ? (
            <Button
              variant="ghost"
              className="mr-auto"
              onClick={async () => {
                const ok = await run(
                  () => updateHawl(userId, { hawl_start_date: null, start_wealth: null, start_wealth_currency: null, is_first_hawl: false }),
                  "Hawl cleared",
                );
                if (ok) onOpenChange(false);
              }}
            >
              Clear
            </Button>
          ) : null}
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={saving} disabled={days < 1}>
            Save
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-3 rounded-2xl bg-surface-muted p-4">
          <div>
            <p className="text-xs font-medium tracking-wide text-ink-soft uppercase">Your wealth</p>
            <p className="text-lg font-semibold text-gold-ink tabular">{formatGrams(summary.zakat.grams)}</p>
            <p className="text-xs text-ink-soft">of 24k gold</p>
          </div>
          <div className="text-right">
            <p className="text-xs font-medium tracking-wide text-ink-soft uppercase">Nisab</p>
            <p className="text-lg font-semibold text-ink tabular">{formatGrams(NISAB_GRAMS)}</p>
          </div>
        </div>
        {summary.zakat.aboveNisab === false ? (
          <Notice tone="warning">Your wealth is below the Nisab right now. A Hawl only counts while you're at or above it.</Notice>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Days at or above the Nisab">
            {(p) => <AmountInput {...p} inputMode="numeric" value={daysRaw} onChange={(e) => setDays(Math.floor(parseAmount(e.target.value) ?? 0))} suffix="days" />}
          </Field>
          <Field label="Hawl start date">
            {(p) => (
              <Input
                {...p}
                type="date"
                value={start}
                max={today}
                onChange={(e) => {
                  if (!e.target.value) return;
                  setStart(e.target.value);
                  setDaysRaw(String(Math.max(1, daysBetween(e.target.value, today) + 1)));
                }}
              />
            )}
          </Field>
        </div>

        <div className="flex flex-wrap gap-2">
          {PRESETS.map((p) => (
            <Button key={p.days} size="sm" variant={days === p.days ? "soft" : "secondary"} onClick={() => setDays(p.days)}>
              {p.label}
            </Button>
          ))}
        </div>

        <fieldset className="flex flex-col gap-3 rounded-2xl border border-line p-4">
          <legend className="px-1 text-sm font-medium text-ink">Wealth at the start of the Hawl</legend>

          <label className="flex cursor-pointer items-start gap-3 rounded-xl bg-surface-muted p-3">
            <input
              type="checkbox"
              checked={firstHawl}
              onChange={(e) => {
                setFirstHawl(e.target.checked);
                setError(null);
              }}
              className="mt-0.5 size-5 shrink-0 cursor-pointer accent-brand-strong"
            />
            <span>
              <span className="block text-sm font-medium text-ink">This is my first year above the Nisab</span>
              <span className="block text-sm text-ink-soft">
                Zakat is then based on the value of 85 g of 24k gold on the day the Hawl started.
              </span>
            </span>
          </label>

          {firstHawl ? (
            <div className="flex flex-col gap-1 text-sm" aria-live="polite">
              {nisabOnStart.isFetching ? (
                <span className="text-ink-soft">Looking up the gold price on {formatDate(start)}…</span>
              ) : nisabOnStart.error ? (
                <span className="text-loss-ink">{(nisabOnStart.error as Error).message}</span>
              ) : gramOnStart !== null && nisabValue !== null ? (
                <>
                  <span className="text-ink-soft tabular">
                    85 g × {formatMoney(gramOnStart, base)}/g (24k on {formatDate(nisabOnStart.data!.xau.date)})
                  </span>
                  <span className="text-ink tabular">
                    Nisab value: <strong>{formatMoney(nisabValue, base)}</strong>
                  </span>
                </>
              ) : null}
              {error ? <span className="text-loss-ink">{error}</span> : null}
            </div>
          ) : (
            <>
              <p className="-mt-1 text-sm text-ink-soft">
                When the Hawl completes, Zakat is 2.5% of this amount. Leave it empty to use your wealth on the day it's due.
              </p>
              <div className="grid gap-3 sm:grid-cols-[1fr_9rem]">
                <Field label={`Wealth on ${formatDate(start)}`} error={error ?? undefined}>
                  {(p) => (
                    <AmountInput
                      {...p}
                      value={wealthRaw}
                      onChange={(e) => {
                        setWealthRaw(e.target.value);
                        setError(null);
                      }}
                      placeholder="Not recorded"
                    />
                  )}
                </Field>
                <Field label="Currency">
                  {(p) => (
                    <Select {...p} value={wealthCurrency} onChange={(e) => setWealthCurrency(e.target.value)}>
                      {currencies.map((c) => (
                        <option key={c.code} value={c.code}>
                          {c.code}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
              </div>
              <Button
                size="sm"
                variant="soft"
                className="self-start"
                onClick={() => {
                  setWealthRaw((Math.round(summary.zakatable * 100) / 100).toFixed(2));
                  setWealthCurrency(base);
                }}
              >
                Use today's wealth ({formatMoney(summary.zakatable, base)})
              </Button>
            </>
          )}

          {wealthInBase !== null ? (
            <span className="text-sm text-ink-soft tabular">
              Zakat when due: <strong className="text-ink">{formatMoney(wealthInBase * ZAKAT_RATE, base)}</strong>
            </span>
          ) : null}
        </fieldset>

        <div className="flex flex-col gap-2">
          <div className="flex justify-between text-sm">
            <span className="text-ink-soft">Lunar year</span>
            <span className="font-medium text-ink tabular">
              {formatNumber(days, 0)} / {HAWL_DAYS} days
            </span>
          </div>
          <ProgressBar value={pct} color={pct >= 1 ? "mint" : "butter"} label="Hawl progress" />
          <p className="text-sm text-ink-soft">
            {days >= HAWL_DAYS ? "A full Hawl: Zakat is due now." : `${HAWL_DAYS - days} days until Zakat is due.`}
          </p>
        </div>
      </div>
    </Dialog>
  );
}

/** One sentence explaining what the due amount is based on. */
export function useZakatBasisText(): string {
  const { vault, summary } = useVault();
  const base = vault.profile.base_currency;
  const z = summary.zakat;
  if (z.dueBasis === "nisab" && z.hawlStart) {
    return `2.5% of the Nisab value, 85 g of 24k gold on ${formatDate(z.hawlStart)} (${formatMoney(z.startWealth, base)}), since this is your first Hawl`;
  }
  if (z.dueBasis === "start" && z.hawlStart) {
    return `2.5% of your wealth when the Hawl started (${formatMoney(z.startWealth, base)} on ${formatDate(z.hawlStart)})`;
  }
  return "2.5% of your wealth today (no start-of-Hawl wealth recorded)";
}

export function MarkZakatPaidDialog(props: DialogProps) {
  const openKey = useOpenKey(props.open);
  return <MarkZakatPaidContent key={openKey} {...props} />;
}

function MarkZakatPaidContent({ open, onOpenChange }: DialogProps) {
  const { vault, summary } = useVault();
  const run = useVaultAction();
  const basis = useZakatBasisText();
  const base = vault.profile.base_currency;
  const [amountRaw, setAmountRaw] = useState(summary.zakat.dueAmount ? summary.zakat.dueAmount.toFixed(2) : "");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  const amount = parseAmount(amountRaw);

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Mark Zakat as paid"
      description="This records the payment and starts a new Hawl, with today's wealth, if you're still above the Nisab."
      onSubmit={async (e) => {
        e.preventDefault();
        if (amount === null || amount < 0) return;
        setSaving(true);
        const ok = await run(() => markZakatPaid(amount, base, note.trim()), "Zakat payment recorded. May it be accepted.");
        setSaving(false);
        if (ok) onOpenChange(false);
      }}
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={saving} disabled={amount === null || amount < 0}>
            Record payment
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="text-sm text-ink-soft">
          Due: <strong className="text-ink">{formatMoney(summary.zakat.dueAmount, base)}</strong>, {basis}.
        </p>
        <Field label={`Amount paid (${base})`}>
          {(p) => <AmountInput {...p} value={amountRaw} onChange={(e) => setAmountRaw(e.target.value)} suffix={base} />}
        </Field>
        <Field label="Note (optional)">
          {(p) => <Input {...p} value={note} onChange={(e) => setNote(e.target.value)} maxLength={280} />}
        </Field>
      </div>
    </Dialog>
  );
}
