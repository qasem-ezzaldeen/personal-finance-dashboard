import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Field, Input } from "@/components/ui/Field";
import { useVault, useVaultAction } from "@/features/vault/VaultProvider";
import { updateProfile } from "@/lib/api";
import { addDays, formatDate, todayIn } from "@/lib/format";
import { addMonths, incomeMonthOf, incomeMonthStart } from "@/lib/history";

const MAX_OFFSET = 27;

/** A whole number of days from 0 to 27, or null. */
function parseOffset(raw: string): number | null {
  const trimmed = raw.trim();
  if (!/^\d{1,2}$/.test(trimmed)) return null;
  const days = Number(trimmed);
  return days <= MAX_OFFSET ? days : null;
}

/** What an offset means for the income month `today` is in: "Income logged from Sep 24 to Oct 23 counts toward October." */
function describeCurrentMonth(today: string, offset: number): string {
  const month = incomeMonthOf(today, offset);
  const next = addMonths(`${month}-01`, 1).slice(0, 7);
  const start = incomeMonthStart(month, offset);
  const end = addDays(incomeMonthStart(next, offset), -1);
  const short = { month: "short", day: "numeric" } as const;
  return `Income logged from ${formatDate(start, short)} to ${formatDate(end, short)} counts toward ${formatDate(`${month}-01`, { month: "long" })}.`;
}

/** Settings for the Insights page: when income months start. */
export function InsightsTab() {
  const { vault, userId, now } = useVault();
  const run = useVaultAction();
  const saved = vault.profile.income_month_offset ?? 0;
  const [raw, setRaw] = useState(String(saved));
  const [saving, setSaving] = useState(false);
  const offset = parseOffset(raw);

  const example = offset === null ? null : describeCurrentMonth(todayIn(vault.profile.timezone, now), offset);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (offset === null) return;
    setSaving(true);
    await run(() => updateProfile(userId, { income_month_offset: offset }), "Insights settings saved");
    setSaving(false);
  };

  return (
    <Card>
      <CardHeader title="Income months" subtitle="How monthly income is grouped on the Insights page" />
      <CardBody>
        <form onSubmit={save} className="flex flex-col gap-5" noValidate>
          <p className="text-sm text-ink-soft">
            If you're paid for a month in its last days, start income months a few days before the 1st, so that pay counts toward the month it's for.
            The monthly income chart, its averages and the goal forecast use these months. Use 0 to follow the calendar.
          </p>
          <Field
            label="Income months start"
            hint={example ?? undefined}
            error={offset === null ? `Enter a whole number of days from 0 to ${MAX_OFFSET}` : undefined}
            className="max-w-sm"
          >
            {(f) => (
              <Input
                {...f}
                value={raw}
                onChange={(e) => setRaw(e.target.value)}
                inputMode="numeric"
                maxLength={2}
                suffix="days before the 1st"
              />
            )}
          </Field>
          <Button type="submit" variant="primary" loading={saving} disabled={offset === null || offset === saved} className="self-start">
            Save Insights settings
          </Button>
        </form>
      </CardBody>
    </Card>
  );
}
