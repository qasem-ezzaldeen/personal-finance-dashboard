import { useMemo, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Dialog, useOpenKey } from "@/components/ui/Dialog";
import { AmountInput, Field, Input, Select, parseAmount } from "@/components/ui/Field";
import { Switch } from "@/components/ui/misc";
import { EmojiPicker } from "@/components/ui/pickers";
import { useVault, useVaultAction } from "@/features/vault/VaultProvider";
import { createGoal, deleteGoal, updateGoal } from "@/lib/api";
import { currencyName } from "@/lib/currencies";
import { GOLD_UNIT, type Goal } from "@/lib/types";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  goal?: Goal;
}

export function GoalDialog(props: Props) {
  const openKey = useOpenKey(props.open);
  return <GoalDialogContent key={`${openKey}-${props.goal?.id ?? "new"}`} {...props} />;
}

function GoalDialogContent({ open, onOpenChange, goal }: Props) {
  const { vault, userId } = useVault();
  const run = useVaultAction();
  const base = vault.profile.base_currency;

  const units = useMemo(() => {
    const codes = new Set<string>([base, ...vault.profile.display_currencies]);
    for (const a of vault.assets) if (a.currency) codes.add(a.currency);
    if (goal && goal.target_unit !== GOLD_UNIT) codes.add(goal.target_unit);
    return [
      { value: GOLD_UNIT, label: "Grams of 24k gold" },
      ...[...codes].map((c) => ({ value: c, label: `${c} · ${currencyName(c)}` })),
    ];
  }, [base, vault.profile.display_currencies, vault.assets, goal]);

  const [name, setName] = useState(goal?.name ?? "");
  const [emoji, setEmoji] = useState(goal?.emoji ?? "🎯");
  const [unit, setUnit] = useState(goal?.target_unit ?? base);
  const [targetRaw, setTargetRaw] = useState(goal ? String(Number(goal.target_amount)) : "");
  const [includeUpcoming, setIncludeUpcoming] = useState(goal?.include_upcoming ?? true);
  const [reserve, setReserve] = useState(goal?.reserve_funds ?? false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const target = parseAmount(targetRaw);
    const next: Record<string, string> = {};
    if (!name.trim()) next.name = "Give your goal a name";
    if (target === null || target <= 0) next.target = "Enter a target greater than zero";
    if (!emoji.trim()) next.emoji = "Pick an emoji";
    setErrors(next);
    if (Object.keys(next).length) return;

    const input = { name: name.trim(), emoji: emoji.trim(), target_amount: target!, target_unit: unit, include_upcoming: includeUpcoming, reserve_funds: reserve };
    setSaving(true);
    const ok = await run(
      () => (goal ? updateGoal(goal.id, input) : createGoal(userId, input, vault.goals.length + 1)),
      goal ? "Goal saved" : `Added "${input.name}"`,
    );
    setSaving(false);
    if (ok) onOpenChange(false);
  };

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={onOpenChange}
        title={goal ? "Edit goal" : "New goal"}
        onSubmit={submit}
        footer={
          <>
            {goal ? (
              <Button variant="danger" className="mr-auto" onClick={() => setConfirmDelete(true)}>
                Delete
              </Button>
            ) : null}
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" loading={saving}>
              Save goal
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <Field label="Name" error={errors.name}>
            {(p) => <Input {...p} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Emergency fund" maxLength={60} />}
          </Field>
          <Field label="Emoji" error={errors.emoji}>
            {(p) => <EmojiPicker id={p.id} value={emoji} onChange={setEmoji} />}
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Measured in">
              {(p) => (
                <Select
                  {...p}
                  value={unit}
                  onChange={(e) => {
                    setUnit(e.target.value);
                    if (!goal) setIncludeUpcoming(e.target.value !== GOLD_UNIT);
                  }}
                >
                  {units.map((u) => (
                    <option key={u.value} value={u.value}>
                      {u.label}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Target" error={errors.target}>
              {(p) => (
                <AmountInput
                  {...p}
                  value={targetRaw}
                  onChange={(e) => setTargetRaw(e.target.value)}
                  placeholder="0"
                  suffix={unit === GOLD_UNIT ? "g" : unit}
                />
              )}
            </Field>
          </div>
          <Switch
            checked={includeUpcoming}
            onCheckedChange={setIncludeUpcoming}
            label="Count Upcoming Income"
            description="Include income you've logged but not received yet."
          />
          <label className="flex cursor-pointer items-start gap-3 rounded-xl bg-surface-muted p-3">
            <input
              type="checkbox"
              checked={reserve}
              onChange={(e) => setReserve(e.target.checked)}
              className="mt-0.5 size-5 shrink-0 cursor-pointer accent-brand-strong"
            />
            <span>
              <span className="block text-sm font-medium text-ink">Reserve money for this goal</span>
              <span className="block text-sm text-ink-soft">
                Money counted here isn't counted again for other reserved goals. Reserved goals are filled in the order of your list.
                Leave it off for milestones, like reaching a net worth.
              </span>
            </span>
          </label>
        </div>
      </Dialog>
      {goal ? (
        <ConfirmDialog
          open={confirmDelete}
          onOpenChange={setConfirmDelete}
          title={`Delete "${goal.name}"?`}
          confirmLabel="Delete goal"
          onConfirm={async () => {
            const ok = await run(() => deleteGoal(goal.id), "Goal deleted");
            if (ok) onOpenChange(false);
          }}
        />
      ) : null}
    </>
  );
}
