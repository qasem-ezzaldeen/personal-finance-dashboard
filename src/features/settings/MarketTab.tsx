import { Plus, X } from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { AmountInput, Field, Select, parseAmount } from "@/components/ui/Field";
import { Badge, Segmented } from "@/components/ui/misc";
import { useActions } from "@/features/actions/ActionsProvider";
import { useVault, useVaultAction } from "@/features/vault/VaultProvider";
import { removePriceOverride, setPriceOverride, unfollowTicker, updatePricing } from "@/lib/api";
import { currencyOptions } from "@/lib/currencies";
import { formatAge, formatMoney } from "@/lib/format";
import { GOLD_21K_RATIO, goldGramValue, gold24kPerGram, makeContext } from "@/lib/valuation";

const round2 = (n: number) => (Math.round(n * 100) / 100).toString();

export function MarketTab() {
  const { vault, userId, book, now } = useVault();
  const run = useVaultAction();
  const { openFollowTicker } = useActions();
  const pr = vault.pricing;
  const base = vault.profile.base_currency;
  const currencies = useMemo(() => currencyOptions(book.usdRates.keys()), [book.usdRates]);

  const [mode, setMode] = useState<"live" | "manual">(pr.gold_mode);
  const [manual24, setManual24] = useState(pr.manual_gold_24k_price ? String(Number(pr.manual_gold_24k_price)) : "");
  const [manual21, setManual21] = useState(pr.manual_gold_24k_price ? round2(Number(pr.manual_gold_24k_price) * GOLD_21K_RATIO) : "");
  const [manualCurrency, setManualCurrency] = useState(pr.manual_gold_currency);
  const [premium, setPremium] = useState(String(Number(pr.gold_premium_pct)));
  const [adj21, setAdj21] = useState(String(Number(pr.gold_21k_adjustment)));
  const [adj24, setAdj24] = useState(String(Number(pr.gold_24k_adjustment)));
  const [adjCurrency, setAdjCurrency] = useState(pr.gold_adjustment_currency);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  // Live preview of the settings being edited
  const draft = {
    ...pr,
    gold_mode: mode,
    manual_gold_24k_price: parseAmount(manual24),
    manual_gold_currency: manualCurrency,
    gold_premium_pct: parseAmount(premium) ?? 0,
    gold_21k_adjustment: parseAmount(adj21) ?? 0,
    gold_24k_adjustment: parseAmount(adj24) ?? 0,
    gold_adjustment_currency: adjCurrency,
  };
  const previewCtx = makeContext(book, draft, vault.overrides);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    const next: Record<string, string> = {};
    const p = parseAmount(premium);
    if (p === null || p < 0 || p > 100) next.premium = "Use a percentage between 0 and 100";
    if (mode === "manual" && !(parseAmount(manual24)! > 0)) next.manual = "Enter the 24k price per gram";
    if (parseAmount(adj21) === null) next.adj21 = "Enter a number (it can be negative)";
    if (parseAmount(adj24) === null) next.adj24 = "Enter a number (it can be negative)";
    setErrors(next);
    if (Object.keys(next).length) return;
    setSaving(true);
    await run(
      () =>
        updatePricing(userId, {
          gold_mode: mode,
          manual_gold_24k_price: mode === "manual" ? parseAmount(manual24) : pr.manual_gold_24k_price,
          manual_gold_currency: manualCurrency,
          gold_premium_pct: p!,
          gold_21k_adjustment: parseAmount(adj21)!,
          gold_24k_adjustment: parseAmount(adj24)!,
          gold_adjustment_currency: adjCurrency,
        }),
      "Pricing saved",
    );
    setSaving(false);
  };

  // Manual stock prices
  const tickers = [...new Set([...vault.assets.filter((a) => a.kind === "stock" && a.ticker).map((a) => a.ticker!), ...vault.followed.map((f) => f.ticker)])].sort();
  const [overrideTicker, setOverrideTicker] = useState("");
  const [overridePrice, setOverridePrice] = useState("");

  return (
    <div className="flex flex-col gap-5">
      <Card>
        <CardHeader title="Gold pricing" subtitle={book.xau ? `Live spot price updated ${formatAge(book.xau.fetched_at, now.getTime())}` : "Waiting for the first live price"} />
        <CardBody>
          <form onSubmit={save} className="flex flex-col gap-5" noValidate>
            <Segmented
              label="Gold price source"
              value={mode}
              onValueChange={setMode}
              items={[
                { value: "live", label: "Live price" },
                { value: "manual", label: "Set it myself" },
              ]}
            />

            {mode === "manual" ? (
              <div className="grid gap-4 sm:grid-cols-3">
                <Field label="24k per gram" error={errors.manual}>
                  {(f) => (
                    <AmountInput
                      {...f}
                      value={manual24}
                      onChange={(e) => {
                        setManual24(e.target.value);
                        const v = parseAmount(e.target.value);
                        setManual21(v !== null ? round2(v * GOLD_21K_RATIO) : "");
                      }}
                    />
                  )}
                </Field>
                <Field label="21k per gram" hint="Always 87.5% of 24k">
                  {(f) => (
                    <AmountInput
                      {...f}
                      value={manual21}
                      onChange={(e) => {
                        setManual21(e.target.value);
                        const v = parseAmount(e.target.value);
                        setManual24(v !== null ? round2(v / GOLD_21K_RATIO) : "");
                      }}
                    />
                  )}
                </Field>
                <Field label="Currency">
                  {(f) => (
                    <Select {...f} value={manualCurrency} onChange={(e) => setManualCurrency(e.target.value)}>
                      {currencies.map((c) => (
                        <option key={c.code} value={c.code}>
                          {c.code}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
              </div>
            ) : (
              <Field label="Local premium over the global spot price" hint="Added to the live price (default 0%)" error={errors.premium}>
                {(f) => <AmountInput {...f} value={premium} onChange={(e) => setPremium(e.target.value)} suffix="%" className="sm:max-w-48" />}
              </Field>
            )}

            <fieldset className="flex flex-col gap-3 rounded-2xl bg-surface-muted p-4">
              <legend className="sr-only">Per-gram adjustments</legend>
              <p className="text-sm font-medium text-ink">Per-gram adjustments</p>
              <p className="-mt-2 text-sm text-ink-soft">
                What a gram of your gold is really worth compared to the market price, e.g. −30 for selling 21k jewelry, +30 for 24k ingot cashback.
              </p>
              <div className="grid gap-4 sm:grid-cols-3">
                <Field label="21k adjustment" error={errors.adj21}>
                  {(f) => <AmountInput {...f} value={adj21} onChange={(e) => setAdj21(e.target.value)} inputMode="text" />}
                </Field>
                <Field label="24k adjustment" error={errors.adj24}>
                  {(f) => <AmountInput {...f} value={adj24} onChange={(e) => setAdj24(e.target.value)} inputMode="text" />}
                </Field>
                <Field label="In">
                  {(f) => (
                    <Select {...f} value={adjCurrency} onChange={(e) => setAdjCurrency(e.target.value)}>
                      {currencies.map((c) => (
                        <option key={c.code} value={c.code}>
                          {c.code}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
              </div>
            </fieldset>

            <dl className="grid gap-2 rounded-2xl border border-line p-4 text-sm sm:grid-cols-2">
              <div className="flex justify-between gap-2">
                <dt className="text-ink-soft">24k market price</dt>
                <dd className="font-medium text-ink tabular">{formatMoney(gold24kPerGram(previewCtx, base), base)}/g</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-ink-soft">Your 24k gram is worth</dt>
                <dd className="font-medium text-ink tabular">{formatMoney(goldGramValue(24, previewCtx, base), base)}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-ink-soft">21k market price</dt>
                <dd className="font-medium text-ink tabular">
                  {formatMoney((gold24kPerGram(previewCtx, base) ?? NaN) * GOLD_21K_RATIO, base)}/g
                </dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-ink-soft">Your 21k gram is worth</dt>
                <dd className="font-medium text-ink tabular">{formatMoney(goldGramValue(21, previewCtx, base), base)}</dd>
              </div>
            </dl>

            <Button type="submit" variant="primary" loading={saving} className="self-start">
              Save gold pricing
            </Button>
          </form>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Followed stocks"
          subtitle="Shown in the rates bar even if you don't hold them"
          actions={
            <Button size="sm" onClick={openFollowTicker}>
              <Plus className="size-4" aria-hidden="true" /> Follow
            </Button>
          }
        />
        <CardBody>
          {vault.followed.length === 0 ? (
            <p className="text-sm text-ink-soft">You're not following any extra tickers.</p>
          ) : (
            <ul className="flex flex-wrap gap-2">
              {vault.followed.map((f) => (
                <li key={f.ticker} className="flex items-center gap-1 rounded-full border border-line py-1 pr-1 pl-3 text-sm font-medium text-ink">
                  {f.ticker}
                  <button
                    type="button"
                    onClick={() => run(() => unfollowTicker(userId, f.ticker), `Stopped following ${f.ticker}`)}
                    className="grid size-6 place-items-center rounded-full text-ink-soft hover:bg-loss hover:text-loss-ink"
                    aria-label={`Stop following ${f.ticker}`}
                  >
                    <X className="size-3.5" aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Manual stock prices" subtitle="Override the live price for a ticker" />
        <CardBody className="flex flex-col gap-4">
          {vault.overrides.length > 0 ? (
            <ul className="flex flex-col divide-y divide-line">
              {vault.overrides.map((o) => (
                <li key={o.ticker} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <span className="flex items-center gap-2 font-medium text-ink">
                    {o.ticker} <Badge tone="gold">Manual</Badge>
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="tabular">{formatMoney(Number(o.price), o.currency)}</span>
                    <Button size="sm" variant="ghost" onClick={() => run(() => removePriceOverride(userId, o.ticker), `${o.ticker} uses the live price again`)}>
                      Use live price
                    </Button>
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
          {tickers.length > 0 ? (
            <form
              className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
              onSubmit={async (e) => {
                e.preventDefault();
                const price = parseAmount(overridePrice);
                if (!overrideTicker || price === null || price <= 0) return;
                const ok = await run(() => setPriceOverride(userId, overrideTicker, price), `${overrideTicker} price set`);
                if (ok) setOverridePrice("");
              }}
            >
              <Field label="Ticker">
                {(f) => (
                  <Select {...f} value={overrideTicker} onChange={(e) => setOverrideTicker(e.target.value)}>
                    <option value="">Choose…</option>
                    {tickers.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field label="Price per share (USD)">
                {(f) => <AmountInput {...f} value={overridePrice} onChange={(e) => setOverridePrice(e.target.value)} suffix="USD" />}
              </Field>
              <Button type="submit" disabled={!overrideTicker || !(parseAmount(overridePrice)! > 0)}>
                Set price
              </Button>
            </form>
          ) : (
            <p className="text-sm text-ink-soft">Hold or follow a stock to set a manual price for it.</p>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
