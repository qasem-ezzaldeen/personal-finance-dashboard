import { useMemo, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Dialog, useOpenKey } from "@/components/ui/Dialog";
import { AmountInput, Field, Input, Select, parseAmount } from "@/components/ui/Field";
import { useVault, useVaultAction } from "@/features/vault/VaultProvider";
import { createPurchase, deletePurchase, updatePurchase } from "@/lib/api";
import { currencyOptions } from "@/lib/currencies";
import { formatMoney, todayIn } from "@/lib/format";
import type { Asset, Purchase } from "@/lib/types";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  asset: Asset;
  purchase?: Purchase;
}

export function PurchaseDialog(props: Props) {
  const openKey = useOpenKey(props.open);
  return <PurchaseDialogContent key={`${openKey}-${props.purchase?.id ?? "new"}`} {...props} />;
}

function PurchaseDialogContent({ open, onOpenChange, asset, purchase }: Props) {
  const { vault, userId, book } = useVault();
  const run = useVaultAction();
  const today = todayIn(vault.profile.timezone);
  const currencies = useMemo(() => currencyOptions(book.usdRates.keys()), [book.usdRates]);

  const [quantityRaw, setQuantityRaw] = useState(purchase ? String(Number(purchase.quantity)) : "");
  const estimated = Boolean(purchase?.cost_is_estimated);
  const trackable = asset.kind === "gold" || asset.kind === "stock";
  // An estimate is shown as a hint, not pre-filled as if the user had typed it
  const [paidRaw, setPaidRaw] = useState(
    purchase?.cost_total !== null && purchase?.cost_total !== undefined && !estimated ? String(Number(purchase.cost_total)) : "",
  );
  const [paidCurrency, setPaidCurrency] = useState(purchase?.cost_currency ?? vault.profile.base_currency);
  const [acquiredOn, setAcquiredOn] = useState(purchase?.acquired_on ?? today);
  const [note, setNote] = useState(purchase?.note ?? "");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const unit = asset.kind === "gold" ? "Grams" : asset.kind === "stock" ? "Shares" : "Quantity";

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const quantity = parseAmount(quantityRaw);
    const paid = paidRaw.trim() ? parseAmount(paidRaw) : null;
    const next: Record<string, string> = {};
    if (quantity === null || quantity <= 0) next.quantity = "Enter an amount greater than zero";
    if (paidRaw.trim() && (paid === null || paid < 0)) next.paid = "Enter what you paid, or leave it empty";
    if (acquiredOn > today) next.date = "The date can't be in the future";
    setErrors(next);
    if (Object.keys(next).length) return;

    const details = { quantity: quantity!, acquired_on: acquiredOn, note: note.trim() };
    const cost = { cost_total: paid, cost_currency: paid !== null ? paidCurrency : null };
    setSaving(true);
    const ok = await run(
      () =>
        purchase
          ? // Keep an existing estimate unless a real price was typed (the database re-estimates if the date or amount changed)
            updatePurchase(purchase.id, estimated && paid === null ? details : { ...details, ...cost })
          : createPurchase(userId, asset.id, { ...details, ...cost }),
      purchase ? "Purchase updated" : "Purchase added",
    );
    setSaving(false);
    if (ok) onOpenChange(false);
  };

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={onOpenChange}
        title={purchase ? "Edit purchase" : `Add a purchase · ${asset.name}`}
        description={
          purchase?.is_opening_balance
            ? "Imported opening balance. Set the date you bought it to track its growth from that day's market price, or enter what you paid."
            : undefined
        }
        onSubmit={submit}
        footer={
          <>
            {purchase ? (
              <Button variant="danger" className="mr-auto" onClick={() => setConfirmDelete(true)}>
                Delete
              </Button>
            ) : null}
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" loading={saving}>
              Save
            </Button>
          </>
        }
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={unit} error={errors.quantity}>
            {(p) => <AmountInput {...p} value={quantityRaw} onChange={(e) => setQuantityRaw(e.target.value)} placeholder="0" autoFocus />}
          </Field>
          <Field label="Date bought" error={errors.date}>
            {(p) => <Input {...p} type="date" value={acquiredOn} max={today} onChange={(e) => setAcquiredOn(e.target.value)} />}
          </Field>
          <Field
            label="Total price paid"
            error={errors.paid}
            hint={
              estimated && purchase?.cost_total !== null
                ? `Now using the market price on that date: ≈ ${formatMoney(Number(purchase!.cost_total), purchase!.cost_currency!)}. Type the real price if you know it.`
                : trackable
                  ? "Leave empty to use the market price on that date"
                  : "Leave empty if you don't know"
            }
          >
            {(p) => <AmountInput {...p} value={paidRaw} onChange={(e) => setPaidRaw(e.target.value)} placeholder={estimated ? "Estimated" : "Optional"} />}
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
          <Field label="Note (optional)" className="sm:col-span-2">
            {(p) => <Input {...p} value={note} onChange={(e) => setNote(e.target.value)} maxLength={280} />}
          </Field>
        </div>
      </Dialog>
      {purchase ? (
        <ConfirmDialog
          open={confirmDelete}
          onOpenChange={setConfirmDelete}
          title="Delete this purchase?"
          confirmLabel="Delete"
          onConfirm={async () => {
            const ok = await run(() => deletePurchase(purchase.id), "Purchase deleted");
            if (ok) onOpenChange(false);
          }}
        >
          <p>The asset's total goes down by this purchase's amount.</p>
        </ConfirmDialog>
      ) : null}
    </>
  );
}
