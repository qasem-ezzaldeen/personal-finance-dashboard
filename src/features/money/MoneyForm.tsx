import { ArrowRight } from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import { AmountInput, Field, Input, Select, parseAmount } from "@/components/ui/Field";
import { Segmented } from "@/components/ui/misc";
import { useVault, useVaultAction } from "@/features/vault/VaultProvider";
import { logIncome, transferFunds } from "@/lib/api";
import { formatMoney } from "@/lib/format";
import type { Asset } from "@/lib/types";
import { convert } from "@/lib/valuation";

export type MoneyTab = "income" | "hourly" | "transfer";

const round2 = (n: number) => Math.round(n * 100) / 100;

function BeforeAfter({ label, before, after, currency }: { label: string; before: number; after: number; currency: string }) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className="text-ink-soft">{label}</span>
      <span className="flex items-center gap-1.5 font-medium text-ink tabular">
        {formatMoney(before, currency)}
        <ArrowRight className="size-3.5 text-ink-faint" aria-hidden="true" />
        <span className={after < before ? "text-loss-ink" : after > before ? "text-gain-ink" : undefined}>{formatMoney(after, currency)}</span>
      </span>
    </div>
  );
}

export function MoneyForm({
  initialTab = "income",
  initialFromId,
  initialToId,
  onDone,
  submitClassName,
}: {
  initialTab?: MoneyTab;
  initialFromId?: string;
  initialToId?: string;
  onDone?: () => void;
  submitClassName?: string;
}) {
  const { vault, book } = useVault();
  const run = useVaultAction();
  const base = vault.profile.base_currency;

  const accounts = useMemo(
    () =>
      vault.assets
        .filter((a) => (a.kind === "cash" || a.kind === "pending_income") && !a.archived_at)
        .sort((a, b) => (a.kind === "pending_income" ? -1 : b.kind === "pending_income" ? 1 : a.sort_order - b.sort_order)),
    [vault.assets],
  );
  const pending = accounts.find((a) => a.kind === "pending_income");
  const incomeCurrency = pending?.currency ?? vault.profile.income_currency;

  const [tab, setTab] = useState<MoneyTab>(initialTab);
  const [amountRaw, setAmountRaw] = useState("");
  const [description, setDescription] = useState("");
  const [hoursRaw, setHoursRaw] = useState("");
  const [minutesRaw, setMinutesRaw] = useState("");
  const [rateRaw, setRateRaw] = useState("");
  const [fromId, setFromId] = useState(initialFromId ?? pending?.id ?? accounts[0]?.id ?? "");
  const [toId, setToId] = useState(initialToId ?? accounts.find((a) => a.id !== (initialFromId ?? pending?.id))?.id ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const from = accounts.find((a) => a.id === fromId);
  const to = accounts.find((a) => a.id === toId);

  // Amount being logged or moved
  const hours = parseAmount(hoursRaw) ?? 0;
  const minutes = parseAmount(minutesRaw) ?? 0;
  const rate = parseAmount(rateRaw);
  const amount =
    tab === "hourly"
      ? rate !== null && (hours > 0 || minutes > 0)
        ? round2((hours + minutes / 60) * round2(rate))
        : null
      : parseAmount(amountRaw);

  const pendingBalance = Number(pending?.balance ?? 0);
  const currency = tab === "transfer" ? (from?.currency ?? incomeCurrency) : incomeCurrency;
  const converted = tab === "transfer" && amount !== null && from?.currency && to?.currency ? convert(amount, from.currency, to.currency, book) : null;

  const labelFor = (a: Asset) => `${a.name} · ${formatMoney(Number(a.balance), a.currency!)}`;

  const reset = () => {
    setAmountRaw("");
    setDescription("");
    setHoursRaw("");
    setMinutesRaw("");
    setError(null);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (amount === null || amount <= 0) {
      setError(tab === "hourly" ? "Enter the time worked and your hourly rate." : "Enter an amount greater than zero.");
      return;
    }
    if (tab === "transfer") {
      if (!from || !to || from.id === to.id) return setError("Choose two different accounts.");
      if (amount > Number(from.balance) + 1e-9) {
        return setError(`There's only ${formatMoney(Number(from.balance), from.currency!)} in ${from.name}.`);
      }
    }

    setSaving(true);
    const hourlyNote = tab === "hourly" ? `Hourly: ${hours} h ${minutes} min × ${formatMoney(round2(rate ?? 0), incomeCurrency)}/h` : "";
    const ok =
      tab === "transfer"
        ? await run(() => transferFunds(from!.id, to!.id, amount, description), `Moved ${formatMoney(amount, from!.currency!)} to ${to!.name}`)
        : await run(
            () => logIncome(amount, [hourlyNote, description.trim()].filter(Boolean).join(" · ")),
            `Added ${formatMoney(amount, incomeCurrency)} to Upcoming Income`,
          );
    setSaving(false);
    if (ok) {
      reset();
      onDone?.();
    }
  };

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      <Segmented
        label="What are you recording?"
        value={tab}
        onValueChange={(v) => {
          setTab(v);
          setError(null);
        }}
        items={[
          { value: "income", label: "Income" },
          { value: "hourly", label: "Hourly" },
          { value: "transfer", label: "Transfer" },
        ]}
      />

      {/* The fields for the chosen tab fade in when switching */}
      <div key={tab} className="flex animate-fade-in flex-col gap-4">
        {tab === "income" ? (
          <>
            <Field label={`Amount (${incomeCurrency})`}>
              {(p) => <AmountInput {...p} value={amountRaw} onChange={(e) => setAmountRaw(e.target.value)} placeholder="0.00" suffix={incomeCurrency} />}
            </Field>
            <Field label="Description (optional)">
              {(p) => <Input {...p} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. Client project" maxLength={120} />}
            </Field>
          </>
        ) : null}

        {tab === "hourly" ? (
          <>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Hours">
                {(p) => <AmountInput {...p} value={hoursRaw} onChange={(e) => setHoursRaw(e.target.value)} placeholder="0" inputMode="numeric" suffix="h" />}
              </Field>
              <Field label="Minutes">
                {(p) => <AmountInput {...p} value={minutesRaw} onChange={(e) => setMinutesRaw(e.target.value)} placeholder="0" inputMode="numeric" suffix="min" />}
              </Field>
            </div>
            <Field label={`Hourly rate (${incomeCurrency})`}>
              {(p) => (
                <AmountInput
                  {...p}
                  value={rateRaw}
                  onChange={(e) => setRateRaw(e.target.value)}
                  onBlur={() => {
                    const r = parseAmount(rateRaw);
                    if (r !== null) setRateRaw(r.toFixed(2));
                  }}
                  placeholder="0.00"
                  suffix="/ h"
                />
              )}
            </Field>
            <Field label="Description (optional)">
              {(p) => <Input {...p} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. Website redesign" maxLength={80} />}
            </Field>
          </>
        ) : null}

        {tab === "transfer" ? (
          accounts.length < 2 ? (
            <p className="rounded-xl bg-surface-muted p-4 text-sm text-ink-soft">Add a cash account first, then you can move money between it and Upcoming Income.</p>
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="From">
                  {(p) => (
                    <Select
                      {...p}
                      value={fromId}
                      onChange={(e) => {
                        setFromId(e.target.value);
                        if (e.target.value === toId) setToId(accounts.find((a) => a.id !== e.target.value)?.id ?? "");
                      }}
                    >
                      {accounts.map((a) => (
                        <option key={a.id} value={a.id}>
                          {labelFor(a)}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
                <Field label="To">
                  {(p) => (
                    <Select {...p} value={toId} onChange={(e) => setToId(e.target.value)}>
                      {accounts
                        .filter((a) => a.id !== fromId)
                        .map((a) => (
                          <option key={a.id} value={a.id}>
                            {labelFor(a)}
                          </option>
                        ))}
                    </Select>
                  )}
                </Field>
              </div>
              <Field
                label={`Amount (${from?.currency ?? ""})`}
                labelAside={
                  from ? (
                    <button
                      type="button"
                      onClick={() => setAmountRaw(String(Number(from.balance)))}
                      className="text-sm font-medium text-brand-ink underline-offset-4 hover:underline"
                    >
                      Transfer all
                    </button>
                  ) : null
                }
              >
                {(p) => <AmountInput {...p} value={amountRaw} onChange={(e) => setAmountRaw(e.target.value)} placeholder="0.00" suffix={from?.currency ?? ""} />}
              </Field>
              <Field label="Note (optional)">
                {(p) => <Input {...p} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={120} />}
              </Field>
            </>
          )
        ) : null}
      </div>

      {/* Live preview */}
      <div className="flex flex-col gap-2 rounded-2xl bg-surface-muted p-4" aria-live="polite">
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm text-ink-soft">{tab === "transfer" && to?.currency && from?.currency !== to.currency ? `Arrives in ${to.name}` : `In ${base}`}</span>
          <span className="text-lg font-semibold text-ink tabular">
            {tab === "transfer" && to?.currency && from?.currency !== to.currency
              ? formatMoney(converted ?? null, to.currency)
              : formatMoney(amount !== null ? convert(amount, currency, base, book) : 0, base)}
          </span>
        </div>
        {tab === "transfer" && from && to ? (
          <>
            <BeforeAfter label={from.name} before={Number(from.balance)} after={Number(from.balance) - (amount ?? 0)} currency={from.currency!} />
            <BeforeAfter label={to.name} before={Number(to.balance)} after={Number(to.balance) + (converted ?? 0)} currency={to.currency!} />
          </>
        ) : (
          <BeforeAfter label="Upcoming Income" before={pendingBalance} after={pendingBalance + (amount ?? 0)} currency={incomeCurrency} />
        )}
      </div>

      {error ? (
        <p className="text-sm text-loss-ink" role="alert">
          {error}
        </p>
      ) : null}

      <Button type="submit" variant="primary" size="lg" loading={saving} className={submitClassName ?? "w-full"} disabled={tab === "transfer" && accounts.length < 2}>
        {tab === "transfer" ? "Transfer" : "Add income"}
      </Button>
    </form>
  );
}
