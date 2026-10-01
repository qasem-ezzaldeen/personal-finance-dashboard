import { ArrowRight } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import { Dialog, useOpenKey } from "@/components/ui/Dialog";
import { AmountInput, Field, Input, Select, parseAmount } from "@/components/ui/Field";
import { BeforeAfter } from "@/features/money/MoneyForm";
import { useVault, useVaultAction } from "@/features/vault/VaultProvider";
import { sellAsset } from "@/lib/api";
import { formatMoney, formatQuantity } from "@/lib/format";
import type { Asset } from "@/lib/types";
import { convert, unitValue, type AssetSummary } from "@/lib/valuation";
import { useCashAccounts } from "./useCashAccounts";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  summary: AssetSummary;
}

type HoldingKind = "gold" | "stock" | "other";

function unitLabel(asset: Asset) {
  return asset.kind === "gold" ? "Grams" : asset.kind === "stock" ? "Shares" : "Quantity";
}

/** Before → after for the holding itself (grams, shares or units). */
export function HoldingBeforeAfter({ asset, before, after }: { asset: Asset; before: number; after: number }) {
  const kind = asset.kind as HoldingKind;
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className="text-ink-soft">{asset.name}</span>
      <span className="flex items-center gap-1.5 font-medium text-ink tabular">
        {formatQuantity(kind, before)}
        <ArrowRight className="size-3.5 text-ink-faint" aria-hidden="true" />
        <span className={after < before ? "text-loss-ink" : after > before ? "text-gain-ink" : undefined}>{formatQuantity(kind, after)}</span>
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sell
// ---------------------------------------------------------------------------

export function SellDialog(props: Props) {
  const openKey = useOpenKey(props.open);
  return <SellDialogContent key={openKey} {...props} />;
}

function SellDialogContent({ open, onOpenChange, summary }: Props) {
  const { vault, ctx, book, summary: vaultSummary } = useVault();
  const run = useVaultAction();
  const asset = summary.asset;
  const kind = asset.kind as HoldingKind;
  const base = vault.profile.base_currency;
  const cash = useCashAccounts();

  const [quantityRaw, setQuantityRaw] = useState("");
  const [toId, setToId] = useState(cash[0]?.id ?? "");
  const [amountRaw, setAmountRaw] = useState("");
  const [date, setDate] = useState(vaultSummary.today);
  const [note, setNote] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const account = cash.find((a) => a.id === toId) ?? null;
  const currency = account?.currency ?? base;
  const held = summary.quantity;
  const quantity = parseAmount(quantityRaw);
  const amount = parseAmount(amountRaw);
  const unit = unitValue(asset, ctx, currency);
  const marketPrice = quantity !== null && quantity > 0 && unit !== null ? Math.round(quantity * unit * 100) / 100 : null;
  const balance = Number(account?.balance ?? 0);

  // Average cost of what's held (in the base currency), to show the gain on this sale
  const averageCost = summary.growth && held > 0 ? summary.growth.cost / held : null;
  const costOfSold = averageCost !== null && quantity ? convert(averageCost * quantity, summary.growth!.currency, currency, book) : null;
  const gain = costOfSold !== null && amount !== null ? amount - costOfSold : null;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const next: Record<string, string> = {};
    if (quantity === null || quantity <= 0) next.quantity = "Enter an amount greater than zero";
    else if (quantity > held + 1e-9) next.quantity = `You have ${formatQuantity(kind, held)}`;
    if (amount === null || amount <= 0) next.amount = "Enter what you received";
    if (!account) next.account = "Choose the account the money goes to";
    if (date > vaultSummary.today) next.date = "The date can't be in the future";
    setErrors(next);
    if (Object.keys(next).length) return;

    setSaving(true);
    const ok = await run(
      () => sellAsset({ assetId: asset.id, cashId: account!.id, quantity: quantity!, amount: amount!, date, note: note.trim() }),
      `Sold ${formatQuantity(kind, quantity!)} of ${asset.name} for ${formatMoney(amount!, currency)}`,
    );
    setSaving(false);
    if (ok) onOpenChange(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Sell · ${asset.name}`}
      onSubmit={submit}
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={saving} disabled={cash.length === 0}>
            Sell
          </Button>
        </>
      }
    >
      {cash.length === 0 ? (
        <p className="rounded-xl bg-surface-muted p-4 text-sm text-ink-soft">Add a cash account first so the money from the sale has somewhere to go.</p>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label={unitLabel(asset)}
              error={errors.quantity}
              labelAside={
                <button
                  type="button"
                  onClick={() => setQuantityRaw(String(held))}
                  className="text-sm font-medium text-brand-ink underline-offset-4 hover:underline"
                >
                  Sell all
                </button>
              }
              hint={`You have ${formatQuantity(kind, held)}`}
            >
              {(p) => <AmountInput {...p} value={quantityRaw} onChange={(e) => setQuantityRaw(e.target.value)} placeholder="0" autoFocus />}
            </Field>
            <Field label="Money goes to" error={errors.account}>
              {(p) => (
                <Select {...p} value={toId} onChange={(e) => setToId(e.target.value)}>
                  {cash.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name} · {formatMoney(Number(a.balance), a.currency!)}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </div>

          <Field
            label={`Total received (${currency})`}
            error={errors.amount}
            labelAside={
              marketPrice !== null ? (
                <button
                  type="button"
                  onClick={() => setAmountRaw(marketPrice.toFixed(2))}
                  className="text-sm font-medium text-brand-ink underline-offset-4 hover:underline"
                >
                  Use market price
                </button>
              ) : null
            }
            hint={marketPrice !== null ? `At today's price: ≈ ${formatMoney(marketPrice, currency)}` : undefined}
          >
            {(p) => <AmountInput {...p} value={amountRaw} onChange={(e) => setAmountRaw(e.target.value)} placeholder="0.00" suffix={currency} />}
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Date sold" error={errors.date}>
              {(p) => <Input {...p} type="date" value={date} max={vaultSummary.today} onChange={(e) => setDate(e.target.value)} />}
            </Field>
            <Field label="Note (optional)">
              {(p) => <Input {...p} value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} />}
            </Field>
          </div>

          <div className="flex flex-col gap-2 rounded-2xl bg-surface-muted p-4" aria-live="polite">
            <HoldingBeforeAfter asset={asset} before={held} after={Math.max(0, held - (quantity ?? 0))} />
            {account ? <BeforeAfter label={account.name} before={balance} after={balance + (amount ?? 0)} currency={account.currency!} /> : null}
            {gain !== null ? (
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="text-ink-soft">Gain vs. what you paid</span>
                <span className={gain > 0 ? "font-medium text-gain-ink tabular" : gain < 0 ? "font-medium text-loss-ink tabular" : "font-medium text-ink tabular"}>
                  {formatMoney(gain, currency, { signed: true })}
                </span>
              </div>
            ) : null}
          </div>
        </div>
      )}
    </Dialog>
  );
}
