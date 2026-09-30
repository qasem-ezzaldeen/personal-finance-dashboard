import { Check } from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Field, Input, Select } from "@/components/ui/Field";
import { useVault, useVaultAction } from "@/features/vault/VaultProvider";
import { updateProfile } from "@/lib/api";
import { cn } from "@/lib/cn";
import { currencyOptions } from "@/lib/currencies";
import { formatMoney } from "@/lib/format";

const LOCALES = [
  { value: "en-US", label: "1,234.56 (English, US)" },
  { value: "en-GB", label: "1,234.56 (English, UK)" },
  { value: "en-EG", label: "1,234.56 (English, Egypt)" },
  { value: "de-DE", label: "1.234,56 (German)" },
  { value: "fr-FR", label: "1 234,56 (French)" },
  { value: "ar-EG", label: "١٬٢٣٤٫٥٦ (Arabic, Egypt)" },
];

export function VaultTab() {
  const { vault, userId, book, summary } = useVault();
  const run = useVaultAction();
  const p = vault.profile;
  const options = useMemo(() => currencyOptions(book.usdRates.keys()), [book.usdRates]);

  const [vaultName, setVaultName] = useState(p.vault_name);
  const [base, setBase] = useState(p.base_currency);
  const [display, setDisplay] = useState<string[]>(p.display_currencies);
  const [income, setIncome] = useState(p.income_currency);
  const [locale, setLocale] = useState(p.number_locale);
  const [saving, setSaving] = useState(false);
  const pendingBalance = summary.pending?.quantity ?? 0;

  const toggle = (code: string) =>
    setDisplay((list) => (list.includes(code) ? list.filter((c) => c !== code) : list.length >= 6 ? list : [...list, code]));

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!vaultName.trim()) return;
    setSaving(true);
    await run(
      () =>
        updateProfile(userId, {
          vault_name: vaultName.trim(),
          base_currency: base,
          display_currencies: display.filter((c) => c !== base),
          income_currency: income,
          number_locale: locale,
        }),
      "Vault settings saved",
    );
    setSaving(false);
  };

  return (
    <Card>
      <CardHeader title="Vault" subtitle="Name and currencies" />
      <CardBody>
        <form onSubmit={save} className="flex flex-col gap-5" noValidate>
          <Field label="Vault name" hint="Shown at the top of the app" error={vaultName.trim() ? undefined : "Give your vault a name"}>
            {(f) => <Input {...f} value={vaultName} onChange={(e) => setVaultName(e.target.value)} maxLength={60} />}
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Base currency" hint="Totals, net worth and Zakat are shown in this currency">
              {(f) => (
                <Select {...f} value={base} onChange={(e) => setBase(e.target.value)}>
                  {options.map((o) => (
                    <option key={o.code} value={o.code}>
                      {o.label}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field
              label="Income currency"
              hint={pendingBalance > 0 ? `Move or clear your Upcoming Income (${formatMoney(pendingBalance, p.income_currency)}) to change this` : "Income you log is recorded in this currency"}
            >
              {(f) => (
                <Select {...f} value={income} onChange={(e) => setIncome(e.target.value)} disabled={pendingBalance > 0}>
                  {options.map((o) => (
                    <option key={o.code} value={o.code}>
                      {o.label}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </div>

          <fieldset>
            <legend className="text-sm font-medium text-ink">Also show totals in</legend>
            <p className="mb-2 text-sm text-ink-soft">Pick up to 6. The first one appears next to your totals.</p>
            <div className="flex flex-wrap gap-2">
              {options.slice(0, 40).filter((o) => o.code !== base).map((o) => {
                const on = display.includes(o.code);
                return (
                  <button
                    key={o.code}
                    type="button"
                    onClick={() => toggle(o.code)}
                    aria-pressed={on}
                    title={o.label}
                    className={cn(
                      "flex items-center gap-1 rounded-full border px-3 py-1.5 text-sm font-medium transition",
                      on ? "border-transparent bg-brand text-brand-ink" : "border-line text-ink-soft hover:bg-surface-muted",
                    )}
                  >
                    {on ? <Check className="size-3.5" aria-hidden="true" /> : null}
                    {o.code}
                  </button>
                );
              })}
            </div>
          </fieldset>

          <Field label="Number format">
            {(f) => (
              <Select {...f} value={locale} onChange={(e) => setLocale(e.target.value)}>
                {LOCALES.map((l) => (
                  <option key={l.value} value={l.value}>
                    {l.label}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          <Button type="submit" variant="primary" loading={saving} className="self-start">
            Save vault settings
          </Button>
        </form>
      </CardBody>
    </Card>
  );
}
