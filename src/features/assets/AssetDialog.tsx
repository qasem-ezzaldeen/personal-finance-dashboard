import { Coins, Landmark, LineChart, Package } from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";
import { normalizeTicker } from "@shared/tickers";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Dialog, useOpenKey } from "@/components/ui/Dialog";
import { AmountInput, Field, Input, Select, Textarea, parseAmount } from "@/components/ui/Field";
import { Segmented, Switch } from "@/components/ui/misc";
import { ColorPicker } from "@/components/ui/pickers";
import { TickerField } from "@/features/market/TickerField";
import { useTickerLookup } from "@/features/market/useTickerLookup";
import { useVault, useVaultAction } from "@/features/vault/VaultProvider";
import { createAsset, createPurchase, deleteAsset, setCashBalance, updateAsset } from "@/lib/api";
import { cn } from "@/lib/cn";
import { currencyOptions } from "@/lib/currencies";
import { todayIn } from "@/lib/format";
import type { Asset, GroupKind } from "@/lib/types";

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
  const { vault, userId, book, summary } = useVault();
  const run = useVaultAction();
  const editing = Boolean(asset);
  const base = vault.profile.base_currency;
  const today = todayIn(vault.profile.timezone);
  const currencies = useMemo(() => currencyOptions(book.usdRates.keys()), [book.usdRates]);
  const startKind: GroupKind = (asset?.kind === "pending_income" ? "cash" : asset?.kind) ?? initialKind ?? "cash";

  const [kind, setKind] = useState<GroupKind>(startKind);
  const [name, setName] = useState(asset?.name ?? "");
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
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const tickerChanged = kind === "stock" && normalizeTicker(tickerRaw) !== (asset?.ticker ?? "");
  const lookup = useTickerLookup(open && tickerChanged ? tickerRaw : "");

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const nextErrors: Record<string, string> = {};
    if (!name.trim()) nextErrors.name = "Give this asset a name";

    const balance = balanceRaw.trim() ? parseAmount(balanceRaw) : 0;
    if (kind === "cash" && (balance === null || balance < 0)) nextErrors.balance = "Enter a balance of zero or more";

    const unitPrice = parseAmount(unitPriceRaw);
    if (kind === "other" && (unitPrice === null || unitPrice < 0)) nextErrors.unitPrice = "Enter what one unit is worth today";

    let ticker = asset?.ticker ?? null;
    if (kind === "stock") {
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
      if (paidRaw.trim() && (paid === null || paid < 0)) nextErrors.paid = "Enter what you paid, or leave it empty";
      if (paid !== null && quantity === null) nextErrors.quantity = "Enter how much you bought";
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

    const ok = await run(async () => {
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
        await createPurchase(userId, created.id, {
          quantity,
          cost_total: paid,
          cost_currency: paid !== null ? paidCurrency : null,
          acquired_on: acquiredOn,
          note: "",
        });
      }
    }, editing ? "Saved" : `Added ${name.trim()}`);
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
              {editing ? "Save" : "Add asset"}
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

          <Field label="Name" error={errors.name}>
            {(p) => (
              <Input
                {...p}
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={80}
                placeholder={kind === "cash" ? "e.g. QNB Savings" : kind === "gold" ? "e.g. Gold ingots" : kind === "stock" ? "e.g. SPUS ETF" : "e.g. Bitcoin"}
              />
            )}
          </Field>

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

          {kind === "gold" ? (
            <div>
              <p className="mb-2 text-sm font-medium text-ink">Karat</p>
              <Segmented
                label="Karat"
                value={karat}
                onValueChange={setKarat}
                items={[
                  { value: "24", label: "24k ingots" },
                  { value: "21", label: "21k jewelry" },
                ]}
              />
            </div>
          ) : null}

          {kind === "stock" ? <TickerField value={tickerRaw} onChange={setTickerRaw} lookup={tickerChanged ? lookup : { state: "idle" }} /> : null}
          {kind === "stock" && errors.ticker ? <p className="-mt-3 text-sm text-loss-ink">{errors.ticker}</p> : null}

          {kind === "other" ? (
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
            <fieldset className="rounded-2xl bg-surface-muted p-4">
              <legend className="sr-only">First purchase</legend>
              <p className="text-sm font-medium text-ink">What you own now (optional)</p>
              <p className="mb-3 text-sm text-ink-soft">
                {kind === "other"
                  ? "Add the price you paid to see how much it has grown. You can add more purchases later."
                  : "Set the date you bought it. If you leave the price empty, we'll use that day's market price to track its growth."}
              </p>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={quantityLabel} error={errors.quantity}>
                  {(p) => <AmountInput {...p} value={quantityRaw} onChange={(e) => setQuantityRaw(e.target.value)} placeholder="0" />}
                </Field>
                <Field label="Date bought">
                  {(p) => <Input {...p} type="date" value={acquiredOn} max={today} onChange={(e) => setAcquiredOn(e.target.value)} />}
                </Field>
                <Field label="Total price paid" error={errors.paid}>
                  {(p) => <AmountInput {...p} value={paidRaw} onChange={(e) => setPaidRaw(e.target.value)} placeholder="Optional" />}
                </Field>
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
              </div>
            </fieldset>
          ) : null}

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
          <p>This removes the asset and all its purchases. History entries stay, but can no longer restore this asset's balance.</p>
          {asset.kind === "cash" && Number(asset.balance) > 0 ? (
            <p className="font-medium text-loss-ink">It still holds money. Consider moving it to another account first.</p>
          ) : null}
        </ConfirmDialog>
      ) : null}
    </>
  );
}
