import { AlertTriangle, ArrowRight, Bot, Plus } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Dialog, useOpenKey } from "@/components/ui/Dialog";
import { AmountInput, Field, Input, Select, parseAmount } from "@/components/ui/Field";
import { EmptyState, Segmented, Switch } from "@/components/ui/misc";
import { useVault, useVaultAction } from "@/features/vault/VaultProvider";
import { createRule, deleteRule, updateRule } from "@/lib/api";
import { formatDateTime, formatMoney } from "@/lib/format";
import type { AutomationRule } from "@/lib/types";

const LAST_DAY = 31;

function ordinal(n: number) {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

function describeSchedule(day: number) {
  return day === LAST_DAY ? "On the last day of every month" : `On the ${ordinal(day)} of every month`;
}

interface RuleDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rule?: AutomationRule;
}

function RuleDialog(props: RuleDialogProps) {
  const openKey = useOpenKey(props.open);
  return <RuleDialogContent key={`${openKey}-${props.rule?.id ?? "new"}`} {...props} />;
}

function RuleDialogContent({ open, onOpenChange, rule }: RuleDialogProps) {
  const { vault, userId } = useVault();
  const run = useVaultAction();
  const accounts = vault.assets.filter((a) => (a.kind === "cash" || a.kind === "pending_income") && !a.archived_at);

  const [name, setName] = useState(rule?.name ?? "");
  const [day, setDay] = useState(rule?.day_of_month ?? 1);
  const [mode, setMode] = useState<"all" | "fixed">(rule?.amount_mode ?? "all");
  const [amountRaw, setAmountRaw] = useState(rule?.fixed_amount ? String(Number(rule.fixed_amount)) : "");
  const [fromId, setFromId] = useState(rule?.from_asset_id ?? accounts[0]?.id ?? "");
  const [toId, setToId] = useState(rule?.to_asset_id ?? accounts[1]?.id ?? "");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const from = accounts.find((a) => a.id === fromId);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const amount = parseAmount(amountRaw);
    const next: Record<string, string> = {};
    if (!name.trim()) next.name = "Give the rule a name";
    if (!fromId || !toId || fromId === toId) next.accounts = "Choose two different accounts";
    if (mode === "fixed" && (amount === null || amount <= 0)) next.amount = "Enter an amount greater than zero";
    setErrors(next);
    if (Object.keys(next).length) return;

    const input = {
      name: name.trim(),
      enabled: rule?.enabled ?? true,
      day_of_month: day,
      amount_mode: mode,
      fixed_amount: mode === "fixed" ? amount : null,
      from_asset_id: fromId,
      to_asset_id: toId,
    };
    setSaving(true);
    const ok = await run(() => (rule ? updateRule(rule.id, input) : createRule(userId, input)), rule ? "Rule saved" : "Rule created");
    setSaving(false);
    if (ok) onOpenChange(false);
  };

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={onOpenChange}
        title={rule ? "Edit automatic transfer" : "New automatic transfer"}
        description="Runs on the server, even when the app is closed. New or rescheduled rules start from their next date."
        onSubmit={submit}
        footer={
          <>
            {rule ? (
              <Button variant="danger" className="mr-auto" onClick={() => setConfirmDelete(true)}>
                Delete
              </Button>
            ) : null}
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" loading={saving}>
              Save rule
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <Field label="Name" error={errors.name}>
            {(f) => <Input {...f} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Payday sweep" maxLength={60} />}
          </Field>
          <Field label="When">
            {(f) => (
              <Select {...f} value={day} onChange={(e) => setDay(Number(e.target.value))}>
                {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
                  <option key={d} value={d}>
                    {describeSchedule(d)}
                  </option>
                ))}
                <option value={LAST_DAY}>{describeSchedule(LAST_DAY)}</option>
              </Select>
            )}
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="From" error={errors.accounts}>
              {(f) => (
                <Select {...f} value={fromId} onChange={(e) => setFromId(e.target.value)}>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name} ({a.currency})
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="To">
              {(f) => (
                <Select {...f} value={toId} onChange={(e) => setToId(e.target.value)}>
                  {accounts
                    .filter((a) => a.id !== fromId)
                    .map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name} ({a.currency})
                      </option>
                    ))}
                </Select>
              )}
            </Field>
          </div>
          <div className="flex flex-col gap-2">
            <p className="text-sm font-medium text-ink">How much</p>
            <Segmented
              label="How much"
              value={mode}
              onValueChange={setMode}
              items={[
                { value: "all", label: "Everything in it" },
                { value: "fixed", label: "A fixed amount" },
              ]}
            />
          </div>
          {mode === "fixed" ? (
            <Field label={`Amount (${from?.currency ?? ""})`} error={errors.amount}>
              {(f) => <AmountInput {...f} value={amountRaw} onChange={(e) => setAmountRaw(e.target.value)} suffix={from?.currency ?? ""} />}
            </Field>
          ) : null}
        </div>
      </Dialog>
      {rule ? (
        <ConfirmDialog
          open={confirmDelete}
          onOpenChange={setConfirmDelete}
          title={`Delete "${rule.name}"?`}
          confirmLabel="Delete rule"
          onConfirm={async () => {
            const ok = await run(() => deleteRule(rule.id), "Rule deleted");
            if (ok) onOpenChange(false);
          }}
        >
          <p>Past transfers it made stay in your Activity.</p>
        </ConfirmDialog>
      ) : null}
    </>
  );
}

export function AutomationsTab() {
  const { vault } = useVault();
  const run = useVaultAction();
  const [editing, setEditing] = useState<{ open: boolean; rule?: AutomationRule }>({ open: false });
  const nameOf = (id: string | null) => vault.assets.find((a) => a.id === id)?.name ?? "(deleted account)";
  const currencyOf = (id: string | null) => vault.assets.find((a) => a.id === id)?.currency ?? "";
  const rules = [...vault.rules].sort((a, b) => a.day_of_month - b.day_of_month || a.created_at.localeCompare(b.created_at));
  const cashAccounts = vault.assets.filter((a) => (a.kind === "cash" || a.kind === "pending_income") && !a.archived_at);

  return (
    <Card>
      <CardHeader
        title="Automatic transfers"
        subtitle="Move money between your accounts on a monthly schedule"
        actions={
          <Button size="sm" variant="primary" onClick={() => setEditing({ open: true })} disabled={cashAccounts.length < 2}>
            <Plus className="size-4" aria-hidden="true" /> New rule
          </Button>
        }
      />
      <CardBody>
        {rules.length === 0 ? (
          <EmptyState icon={<Bot className="size-8" />} title="No automatic transfers">
            {cashAccounts.length < 2 ? "Add a cash account first." : "For example: move all Upcoming Income to your bank on payday."}
          </EmptyState>
        ) : (
          <ul className="flex flex-col gap-3">
            {rules.map((r) => (
              <li key={r.id} className="rounded-2xl border border-line p-4">
                <div className="flex flex-wrap items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-ink">{r.name}</p>
                    <p className="text-sm text-ink-soft">{describeSchedule(r.day_of_month)}</p>
                    <p className="mt-1 flex flex-wrap items-center gap-1.5 text-sm text-ink">
                      <span>{r.amount_mode === "all" ? "Everything in" : `${formatMoney(Number(r.fixed_amount), currencyOf(r.from_asset_id))} from`}</span>
                      <strong>{nameOf(r.from_asset_id)}</strong>
                      <ArrowRight className="size-4 text-ink-soft" aria-hidden="true" />
                      <strong>{nameOf(r.to_asset_id)}</strong>
                    </p>
                  </div>
                  <div className="w-40 shrink-0">
                    <Switch
                      checked={r.enabled}
                      onCheckedChange={(enabled) => run(() => updateRule(r.id, { enabled }), enabled ? "Rule turned on" : "Rule paused")}
                      label={r.enabled ? "On" : "Paused"}
                    />
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm">
                  <span className="text-ink-soft">{r.last_run_at ? `Last ran ${formatDateTime(r.last_run_at, vault.profile.timezone)}` : "Hasn't run yet"}</span>
                  <Button size="sm" variant="ghost" onClick={() => setEditing({ open: true, rule: r })}>
                    Edit
                  </Button>
                </div>
                {r.last_error ? (
                  <p className="mt-2 flex items-start gap-2 rounded-xl bg-warning px-3 py-2 text-sm text-warning-ink">
                    <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" /> Last run didn't complete: {r.last_error}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </CardBody>
      <RuleDialog open={editing.open} rule={editing.rule} onOpenChange={(open) => setEditing((e) => ({ ...e, open }))} />
    </Card>
  );
}
