import { Coins, Landmark, LineChart, Package } from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";
import { normalizeTicker } from "@shared/tickers";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Dialog, useOpenKey } from "@/components/ui/Dialog";
import { AmountInput, Field, Input, Select, Textarea, parseAmount } from "@/components/ui/Field";
import { Notice, Segmented, Switch } from "@/components/ui/misc";
import { ColorPicker } from "@/components/ui/pickers";
import { TickerField } from "@/features/market/TickerField";
import { useTickerLookup } from "@/features/market/useTickerLookup";
import { BeforeAfter } from "@/features/money/MoneyForm";
import { useVault, useVaultAction } from "@/features/vault/VaultProvider";
import { buyAsset, createAsset, createPurchase, deleteAsset, setCashBalance, updateAsset } from "@/lib/api";
import { cn } from "@/lib/cn";
import { currencyOptions } from "@/lib/currencies";
import { formatMoney, formatQuantity, todayIn } from "@/lib/format";
import type { Asset, GroupKind } from "@/lib/types";
import { convert, goldGramValue, unitValue } from "@/lib/valuation";
import { HoldingBeforeAfter } from "./TradeDialogs";
import { useCashAccounts } from "./useCashAccounts";

const NOT_FROM_CASH = "none";
const NEW_ASSET = "new";
/** Names a new gold asset gets until you type your own */
const GOLD_NAMES = { "24": "Ingots", "21": "Scrap Gold" } as const;

const KINDS: Array<{ kind: GroupKind; label: string; hint: string; icon: typeof Landmark; color: string }> = [
  { kind: "cash", label: "Cash", hint: "Bank, wallet, savings", icon: Landmark, color: "sky" },
  { kind: "gold", label: "Gold", hint: "21k or 24k, in grams", icon: Coins, color: "butter" },
  { kind: "stock", label: "Stock / ETF", hint: "Shares, live prices", icon: LineChart, color: "lavender" },
  { kind: "other", label: "Other", hint: "Crypto, car, anything", icon: Package, color: "peach" },
];

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  asset?: Asset;
  initialKind?: GroupKind;
}

/** The form starts fresh each time the dialog opens, from the asset's current values. */
export function AssetDialog(props: Props) {
  const openKey = useOpenKey(props.open);
  return <AssetDialogContent key={`${openKey}-${props.asset?.id ?? props.initialKind ?? "new"}`} {...props} />;
}

function AssetDialogContent({ open, onOpenChange, asset, initialKind }: Props) {
  const { vault, userId, book, summary, ctx } = useVault();
  const run = useVaultAction();
  const editing = Boolean(asset);
  const base = vault.profile.base_currency;
  const today = todayIn(vault.profile.timezone);
  const currencies = useMemo(() => currencyOptions(book.usdRates.keys()), [book.usdRates]);
  const startKind: GroupKind = (asset?.kind === "pending_income" ? "cash" : asset?.kind) ?? initialKind ?? "cash";

  const [kind, setKind] = useState<GroupKind>(startKind);
  const [name, setName] = useState(asset?.name ?? (startKind === "gold" ? GOLD_NAMES["24"] : ""));
  const [nameTouched, setNameTouched] = useState(Boolean(asset));
  const [currency, setCurrency] = useState(asset?.currency ?? base);
  const [karat, setKarat] = useState<"21" | "24">(asset?.karat === 21 ? "21" : "24");
  const [tickerRaw, setTickerRaw] = useState(asset?.ticker ?? "");
  const [unitPriceRaw, setUnitPriceRaw] = useState(
    asset?.manual_unit_price !== null && asset?.manual_unit_price !== undefined ? String(asset.manual_unit_price) : "",
  );
  const [balanceRaw, setBalanceRaw] = useState(asset?.kind === "cash" ? String(Number(asset.balance)) : "");
  const [quantityRaw, setQuantityRaw] = useState("");
  const [paidRaw, setPaidRaw] = useState("");
  const [paidCurrency, setPaidCurrency] = useState(base);
  const [acquiredOn, setAcquiredOn] = useState(today);
  const [color, setColor] = useState(asset?.color ?? KINDS.find((x) => x.kind === startKind)!.color);
  const [note, setNote] = useState(asset?.note ?? "");
  const [hideWhenEmpty, setHideWhenEmpty] = useState(asset?.hide_when_empty ?? false);
  // Buying more of something you have adds to it: "auto" picks the match (same ticker, or gold of that karat)
  const [targetChoice, setTargetChoice] = useState<string>("auto");
  const cash = useCashAccounts();
  const [source, setSource] = useState(NOT_FROM_CASH);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  // Deleting a gold/stock/other asset gives back what its cash-paid purchases took, per account
  const refunds = useMemo(() => {
    const totals = new Map<string, { account: string; currency: string; amount: number }>();
    for (const p of vault.purchases) {
      if (!asset || p.asset_id !== asset.id || !p.paid_from_asset_id || p.paid_amount === null || !p.paid_currency) continue;
      const account = vault.assets.find((a) => a.id === p.paid_from_asset_id);
      if (!account) continue;
      const key = `${account.id}|${p.paid_currency}`;
      const t = totals.get(key) ?? { account: account.name, currency: p.paid_currency, amount: 0 };
      t.amount += Number(p.paid_amount);
      totals.set(key, t);
    }
    return [...totals.values()];
  }, [vault.purchases, vault.assets, asset]);

  const tickerChanged = kind === "stock" && normalizeTicker(tickerRaw) !== (asset?.ticker ?? "");
  const lookup = useTickerLookup(open && tickerChanged ? tickerRaw : "");

  // ---- Adding to an asset you already have ----------------------------------
  const existing = useMemo(
    () =>
      editing || kind === "cash"
        ? []
        : vault.assets.filter((a) => a.kind === kind && !a.archived_at).sort((a, b) => a.sort_order - b.sort_order),
    [editing, kind, vault.assets],
  );
  const held = useMemo(() => new Map(summary.groups.flatMap((g) => g.assets).map((a) => [a.asset.id, a.quantity])), [summary.groups]);
  const typedTicker = lookup.state === "found" ? lookup.info.ticker : normalizeTicker(tickerRaw);
  const autoTarget =
    kind === "gold"
      ? (existing.find((a) => a.karat === Number(karat)) ?? null)
      : kind === "stock" && typedTicker
        ? (existing.find((a) => a.ticker === typedTicker) ?? null)
        : null;
  const pickedTarget = targetChoice !== "auto" && targetChoice !== NEW_ASSET;
  const target: Asset | null =
    targetChoice === "auto" ? autoTarget : targetChoice === NEW_ASSET ? null : (existing.find((a) => a.id === targetChoice) ?? null);
  const describeExisting = (a: Asset) => {
    const q = held.get(a.id) ?? 0;
    const amount = formatQuantity(a.kind as "gold" | "stock" | "other", q);
    return a.kind === "gold" ? `${amount} · ${a.karat}k` : amount;
  };

  // ---- Paid from a cash account ---------------------------------------------
  const account = cash.find((a) => a.id === source) ?? null;
  const accountBalance = Number(account?.balance ?? 0);
  const payCurrency = account?.currency ?? paidCurrency;
  /** Today's value of one gram/share/unit, for "Use market price" */
  const unitIn = (cur: string): number | null => {
    if (target) return unitValue(target, ctx, cur);
    if (kind === "gold") return goldGramValue(Number(karat) as 21 | 24, ctx, cur);
    if (kind === "stock") return lookup.state === "found" ? convert(lookup.info.price, lookup.info.currency, cur, book) : null;
    if (kind === "other") {
      const unit = parseAmount(unitPriceRaw);
      return unit === null ? null : convert(unit, currency, cur, book);
    }
    return null;
  };
  const quantityNow = quantityRaw.trim() ? parseAmount(quantityRaw) : null;
  const unitNow = unitIn(payCurrency);
  const marketPrice = quantityNow !== null && quantityNow > 0 && unitNow !== null ? Math.round(quantityNow * unitNow * 100) / 100 : null;
  const paidNow = paidRaw.trim() ? parseAmount(paidRaw) : null;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const nextErrors: Record<string, string> = {};
    if (!target && !name.trim()) nextErrors.name = "Give this asset a name";

    const balance = balanceRaw.trim() ? parseAmount(balanceRaw) : 0;
    if (kind === "cash" && (balance === null || balance < 0)) nextErrors.balance = "Enter a balance of zero or more";

    const unitPrice = parseAmount(unitPriceRaw);
    if (kind === "other" && !target && (unitPrice === null || unitPrice < 0)) nextErrors.unitPrice = "Enter what one unit is worth today";

    let ticker = asset?.ticker ?? null;
    if (kind === "stock" && !pickedTarget) {
      if (tickerChanged) {
        if (lookup.state !== "found") nextErrors.ticker = lookup.state === "checking" ? "Still checking the ticker…" : "Enter a ticker we can find";
        else ticker = lookup.info.ticker;
      }
      if (!ticker && !nextErrors.ticker) nextErrors.ticker = "Enter a ticker";
    }

    const quantity = quantityRaw.trim() ? parseAmount(quantityRaw) : null;
    const paid = paidRaw.trim() ? parseAmount(paidRaw) : null;
    if (!editing && kind !== "cash") {
      if (quantityRaw.trim() && (quantity === null || quantity <= 0)) nextErrors.quantity = "Enter an amount greater than zero";
      else if (quantity === null && (paid !== null || account || target)) nextErrors.quantity = "Enter how much you bought";
      if (account) {
        if (paid === null || paid <= 0) nextErrors.paid = `Enter what you paid from ${account.name}`;
        else if (paid > accountBalance + 1e-9) nextErrors.paid = `There's only ${formatMoney(accountBalance, account.currency!)} in ${account.name}`;
      } else if (paidRaw.trim() && (paid === null || paid < 0)) {
        nextErrors.paid = "Enter what you paid, or leave it empty";
      }
      if (acquiredOn > today) nextErrors.date = "The date can't be in the future";
    }

    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    setSaving(true);
    const fields = {
      name: name.trim(),
      currency: kind === "cash" || kind === "other" ? currency : null,
      karat: kind === "gold" ? (Number(karat) as 21 | 24) : null,
      ticker: kind === "stock" ? ticker : null,
      manual_unit_price: kind === "other" ? unitPrice : null,
      color,
      note: note.trim(),
      hide_when_empty: hideWhenEmpty,
    };

    // The purchase: paid from a cash account (the money leaves it), or just recorded
    const recordPurchase = (assetId: string) =>
      account
        ? buyAsset({ assetId, cashId: account.id, quantity: quantity!, amount: paid!, date: acquiredOn, note: "" })
        : createPurchase(userId, assetId, {
            quantity: quantity!,
            cost_total: paid,
            cost_currency: paid !== null ? paidCurrency : null,
            acquired_on: acquiredOn,
            note: "",
          });
    const kindLabel = kind as "gold" | "stock" | "other";
    const success = editing
      ? "Saved"
      : target
        ? `Added ${formatQuantity(kindLabel, quantity!)} to ${target.name}${account ? `, paid from ${account.name}` : ""}`
        : `Added ${name.trim()}${account && quantity ? `, paid from ${account.name}` : ""}`;

    const ok = await run(async () => {
      if (target) {
        await recordPurchase(target.id);
        return;
      }
      if (asset) {
        await updateAsset(asset.id, fields);
        if (asset.kind === "cash" && balance !== null && balance !== Number(asset.balance)) {
          await setCashBalance(asset.id, balance, "Balance updated");
        }
        return;
      }
      const created = await createAsset(userId, {
        kind,
        ...fields,
        sort_order: summary.groups.find((g) => g.group.kind === kind)?.assets.length ?? 0,
      });
      if (kind === "cash" && balance) await setCashBalance(created.id, balance, "Opening balance");
      if (kind !== "cash" && quantity) {
        try {
          await recordPurchase(created.id);
        } catch (err) {
          // Don't leave an empty new asset behind if paying for it failed
          await deleteAsset(created.id).catch(() => undefined);
          throw err;
        }
      }
    }, success);
    setSaving(false);
    if (ok) onOpenChange(false);
  };

  const quantityLabel = kind === "gold" ? "Grams" : kind === "stock" ? "Shares" : "Quantity";

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={onOpenChange}
        title={editing ? `Edit ${asset!.name}` : "Add an asset"}
        description={editing ? undefined : "Record something you own or just bought. Pay from a cash account and it's taken from that balance."}
        onSubmit={submit}
        size="lg"
        footer={
          <>
            {editing ? (
              <Button variant="danger" className="mr-auto" onClick={() => setConfirmDelete(true)}>
                Delete
              </Button>
            ) : null}
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" loading={saving}>
              {editing ? "Save" : target ? `Add to ${target.name}` : "Add asset"}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-5">
          {!editing ? (
            <fieldset>
              <legend className="mb-2 text-sm font-medium text-ink">Type</legend>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {KINDS.map(({ kind: k, label, hint, icon: Icon, color: c }) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => {
                      setKind(k);
                      setColor(c);
                      setTargetChoice("auto");
                      if (!nameTouched) setName(k === "gold" ? GOLD_NAMES[karat] : "");
                    }}
                    aria-pressed={kind === k}
                    className={cn(
                      "flex flex-col items-start gap-1 rounded-2xl border p-3 text-left transition",
                      kind === k ? "border-brand-strong bg-brand" : "border-line hover:bg-surface-muted",
                    )}
                  >
                    <Icon className="size-5 text-ink-soft" aria-hidden="true" />
                    <span className="font-medium text-ink">{label}</span>
                    <span className="text-xs text-ink-soft">{hint}</span>
                  </button>
                ))}
              </div>
            </fieldset>
          ) : null}

          {existing.length > 0 ? (
            <Field label="Add to" hint="Buying more of something you already have adds it there">
              {(p) => (
                <Select {...p} value={target?.id ?? NEW_ASSET} onChange={(e) => setTargetChoice(e.target.value)}>
                  <option value={NEW_ASSET}>A new asset</option>
                  {existing.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name} · {describeExisting(a)}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          ) : null}

          {kind === "gold" && !pickedTarget && !editing ? (
            <div>
              <p className="mb-2 text-sm font-medium text-ink">Karat</p>
              <Segmented
                label="Karat"
                value={karat}
                onValueChange={(k) => {
                  setKarat(k);
                  if (!nameTouched) setName(GOLD_NAMES[k]);
                }}
                items={[
                  { value: "24", label: "24k · Ingots" },
                  { value: "21", label: "21k · Scrap gold" },
                ]}
              />
            </div>
          ) : null}

          {kind === "stock" && !pickedTarget ? (
            <TickerField value={tickerRaw} onChange={setTickerRaw} lookup={tickerChanged ? lookup : { state: "idle" }} />
          ) : null}
          {kind === "stock" && !pickedTarget && errors.ticker ? <p className="-mt-3 text-sm text-loss-ink">{errors.ticker}</p> : null}

          {target ? (
            <Notice tone="brand">
              This adds to <strong>{target.name}</strong> ({describeExisting(target)} now).
              {targetChoice === "auto" ? " Choose “A new asset” above to keep it separate." : ""}
            </Notice>
          ) : null}

          {!target ? (
            <Field label="Name" error={errors.name}>
              {(p) => (
                <Input
                  {...p}
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value);
                    setNameTouched(true);
                  }}
                  maxLength={80}
                  placeholder={kind === "cash" ? "e.g. QNB Savings" : kind === "gold" ? "e.g. Ingots" : kind === "stock" ? "e.g. SPUS ETF" : "e.g. Bitcoin"}
                />
              )}
            </Field>
          ) : null}

          {kind === "cash" ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Currency" hint={editing && Number(asset?.balance) !== 0 ? "Empty the account to change its currency" : undefined}>
                {(p) => (
                  <Select {...p} value={currency} onChange={(e) => setCurrency(e.target.value)} disabled={editing && Number(asset?.balance) !== 0}>
                    {currencies.map((c) => (
                      <option key={c.code} value={c.code}>
                        {c.label}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field label={editing ? "Current balance" : "Balance now"} error={errors.balance} hint={editing ? "Changes are recorded in Activity" : undefined}>
                {(p) => <AmountInput {...p} value={balanceRaw} onChange={(e) => setBalanceRaw(e.target.value)} placeholder="0.00" suffix={currency} />}
              </Field>
            </div>
          ) : null}

          {kind === "gold" && editing ? (
            <div>
              <p className="mb-2 text-sm font-medium text-ink">Karat</p>
              <Segmented
                label="Karat"
                value={karat}
                onValueChange={setKarat}
                items={[
                  { value: "24", label: "24k · Ingots" },
                  { value: "21", label: "21k · Scrap gold" },
                ]}
              />
            </div>
          ) : null}

          {kind === "other" && !target ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Value of one unit today" error={errors.unitPrice} hint="Update it whenever the value changes">
                {(p) => <AmountInput {...p} value={unitPriceRaw} onChange={(e) => setUnitPriceRaw(e.target.value)} placeholder="0.00" />}
              </Field>
              <Field label="Currency">
                {(p) => (
                  <Select {...p} value={currency} onChange={(e) => setCurrency(e.target.value)}>
                    {currencies.map((c) => (
                      <option key={c.code} value={c.code}>
                        {c.label}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            </div>
          ) : null}

          {!editing && kind !== "cash" ? (
            <fieldset className="flex flex-col gap-4 rounded-2xl bg-surface-muted p-4">
              <legend className="sr-only">Purchase</legend>
              <div>
                <p className="text-sm font-medium text-ink">{target ? `What you bought` : "What you own now (optional)"}</p>
                <p className="text-sm text-ink-soft">
                  {account
                    ? `${formatMoney(accountBalance, account.currency!)} available in ${account.name}. What you paid is taken from it.`
                    : kind === "other"
                      ? "Add the price you paid to see how much it has grown."
                      : "Set the date you bought it. If you leave the price empty, we'll use that day's market price to track its growth."}
                </p>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Paid from" className="sm:col-span-2">
                  {(p) => (
                    <Select {...p} value={source} onChange={(e) => setSource(e.target.value)}>
                      <option value={NOT_FROM_CASH}>Not from my cash accounts (already owned, a gift…)</option>
                      {cash.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name} · {formatMoney(Number(a.balance), a.currency!)}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
                <Field label={quantityLabel} error={errors.quantity}>
                  {(p) => <AmountInput {...p} value={quantityRaw} onChange={(e) => setQuantityRaw(e.target.value)} placeholder="0" />}
                </Field>
                <Field label="Date bought" error={errors.date}>
                  {(p) => <Input {...p} type="date" value={acquiredOn} max={today} onChange={(e) => setAcquiredOn(e.target.value)} />}
                </Field>
                <Field
                  label={account ? `Total paid (${account.currency})` : "Total price paid"}
                  error={errors.paid}
                  className={account ? "sm:col-span-2" : undefined}
                  labelAside={
                    marketPrice !== null ? (
                      <button
                        type="button"
                        onClick={() => setPaidRaw(marketPrice.toFixed(2))}
                        className="text-sm font-medium text-brand-ink underline-offset-4 hover:underline"
                      >
                        Use market price
                      </button>
                    ) : null
                  }
                  hint={marketPrice !== null ? `At today's price: ≈ ${formatMoney(marketPrice, payCurrency)}` : undefined}
                >
                  {(p) => (
                    <AmountInput
                      {...p}
                      value={paidRaw}
                      onChange={(e) => setPaidRaw(e.target.value)}
                      placeholder={account ? "0.00" : "Optional"}
                      suffix={account ? account.currency! : undefined}
                    />
                  )}
                </Field>
                {account ? null : (
                  <Field label="Paid in">
                    {(p) => (
                      <Select {...p} value={paidCurrency} onChange={(e) => setPaidCurrency(e.target.value)}>
                        {currencies.map((c) => (
                          <option key={c.code} value={c.code}>
                            {c.label}
                          </option>
                        ))}
                      </Select>
                    )}
                  </Field>
                )}
              </div>
              {account || target ? (
                <div className="flex flex-col gap-2 rounded-xl bg-surface p-3" aria-live="polite">
                  <HoldingBeforeAfter
                    asset={target ?? ({ kind, name: name.trim() || "New asset" } as Asset)}
                    before={target ? (held.get(target.id) ?? 0) : 0}
                    after={(target ? (held.get(target.id) ?? 0) : 0) + (quantityNow ?? 0)}
                  />
                  {account ? (
                    <BeforeAfter label={account.name} before={accountBalance} after={accountBalance - (paidNow ?? 0)} currency={account.currency!} />
                  ) : null}
                </div>
              ) : null}
            </fieldset>
          ) : null}

          {!target ? (
            <>
              <ColorPicker value={color} onChange={setColor} />

              <Field label="Note (optional)">
                {(p) => <Textarea {...p} value={note} onChange={(e) => setNote(e.target.value)} maxLength={280} rows={2} />}
              </Field>

              <Switch
                checked={hideWhenEmpty}
                onCheckedChange={setHideWhenEmpty}
                label="Hide when empty"
                description="Keep it out of the list while its balance is zero."
              />
            </>
          ) : null}
        </div>
      </Dialog>

      {asset ? (
        <ConfirmDialog
          open={confirmDelete}
          onOpenChange={setConfirmDelete}
          title={`Delete ${asset.name}?`}
          confirmLabel="Delete"
          onConfirm={async () => {
            const ok = await run(() => deleteAsset(asset.id), `Deleted ${asset.name}`);
            if (ok) onOpenChange(false);
          }}
        >
          <p>This removes the asset and all its purchases and sales. History entries stay, but can no longer restore this asset.</p>
          {refunds.length > 0 ? (
            <p>
              What you paid from your cash accounts goes back:{" "}
              <strong className="text-ink">{refunds.map((r) => `${formatMoney(r.amount, r.currency)} to ${r.account}`).join(", ")}</strong>.
            </p>
          ) : null}
          {asset.kind === "cash" && Number(asset.balance) > 0 ? (
            <p className="font-medium text-loss-ink">It still holds money. Consider moving it to another account first.</p>
          ) : null}
        </ConfirmDialog>
      ) : null}
    </>
  );
}
