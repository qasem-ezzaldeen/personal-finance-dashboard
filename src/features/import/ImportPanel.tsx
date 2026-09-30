import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Notice, Skeleton } from "@/components/ui/misc";
import { useVault, useVaultAction } from "@/features/vault/VaultProvider";
import { fetchPreviousVault, importPreviousVault } from "@/lib/api";
import { formatDate, formatMoney, formatQuantity } from "@/lib/format";
import type { Asset } from "@/lib/types";
import { assetValue, convert, makeContext, type ValuationContext } from "@/lib/valuation";
import { mapPreviousVault, toDatabasePayload, type ImportPayload, type MappedAsset } from "./importMapper";

const COMPARE_IN = "EGP";

function asAsset(m: MappedAsset): Asset {
  return {
    id: m.ref,
    user_id: "",
    kind: m.kind,
    name: m.name,
    currency: m.currency,
    karat: m.karat,
    ticker: m.ticker,
    manual_unit_price: null,
    balance: m.balance,
    color: m.color,
    note: "",
    sort_order: m.sort_order,
    hide_when_empty: m.hide_when_empty,
    archived_at: null,
    created_at: "",
  };
}

/** What the previous app would show for this holding at today's prices (including its ticker bug). */
function oldValue(m: MappedAsset, ctx: ValuationContext): number | null {
  if (m.kind === "stock" && m.source?.ticker) {
    const raw = m.source.ticker.trim().toUpperCase();
    const market = ctx.book.stocks.get(raw);
    const price = market ? market.price : (m.source.stockPrice ?? 58.62);
    return convert(m.quantity * price, "USD", COMPARE_IN, ctx.book);
  }
  return newValue(m, ctx);
}

function newValue(m: MappedAsset, ctx: ValuationContext): number | null {
  const asset = asAsset(m);
  return assetValue(asset, m.kind === "cash" ? m.balance : m.quantity, ctx, COMPARE_IN);
}

function previewContext(payload: ImportPayload, base: ValuationContext): ValuationContext {
  return makeContext(
    base.book,
    {
      ...base.pricing,
      ...payload.pricing,
      gold_21k_adjustment: -30,
      gold_24k_adjustment: 30,
      gold_adjustment_currency: "EGP",
    },
    payload.price_overrides.map((o) => ({ user_id: "", ...o })),
  );
}

export function ImportPanel() {
  const { vault, userId, summary, ctx } = useVault();
  const run = useVaultAction();
  const [confirm, setConfirm] = useState(false);
  const previous = useQuery({ queryKey: ["previous-vault", userId], queryFn: () => fetchPreviousVault(userId), staleTime: Number.POSITIVE_INFINITY });

  const payload = useMemo(() => (previous.data ? mapPreviousVault(previous.data, summary.today) : null), [previous.data, summary.today]);
  const preview = useMemo(() => {
    if (!payload) return null;
    const pctx = previewContext(payload, ctx);
    const rows = payload.assets.map((m) => ({ m, oldV: oldValue(m, pctx), newV: newValue(m, pctx) }));
    const pending = convert(payload.pending_balance, "USD", COMPARE_IN, pctx.book);
    const sum = (key: "oldV" | "newV") => rows.reduce((s, r) => s + (r[key] ?? 0), 0) + (pending ?? 0);
    return { rows, pending, oldTotal: sum("oldV"), newTotal: sum("newV") };
  }, [payload, ctx]);

  if (vault.profile.imported_at) {
    return <Notice tone="gain">Your data from the previous AuraFinance was imported on {formatDate(vault.profile.imported_at)}.</Notice>;
  }
  if (previous.isLoading) return <Skeleton className="h-24" />;
  if (previous.error) return <Notice tone="loss">Couldn't read your old data: {(previous.error as Error).message}</Notice>;
  if (!payload || !preview) return <p className="text-sm text-ink-soft">No data from the previous AuraFinance was found for this account.</p>;

  const vaultIsEmpty =
    !vault.assets.some((a) => a.kind !== "pending_income" || Number(a.balance) !== 0) && !vault.goals.some((g) => !g.is_system);

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-ink-soft">
        We found your data from the previous version. Check the numbers below: <strong className="text-ink">your old data isn't changed</strong>, and nothing is imported until you confirm.
      </p>

      <div className="overflow-x-auto rounded-2xl border border-line">
        <table className="w-full min-w-[34rem] text-sm">
          <thead className="bg-surface-muted text-left text-ink-soft">
            <tr>
              <th className="px-3 py-2 font-medium">Asset</th>
              <th className="px-3 py-2 font-medium">Holding</th>
              <th className="px-3 py-2 text-right font-medium">Old app (today's prices)</th>
              <th className="px-3 py-2 text-right font-medium">New app</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {preview.rows.map(({ m, oldV, newV }) => (
              <tr key={m.ref}>
                <td className="px-3 py-2 font-medium text-ink">
                  {m.name}
                  {!m.source ? <span className="ml-1 text-xs text-ink-soft">(new, for automations)</span> : null}
                </td>
                <td className="px-3 py-2 text-ink-soft tabular">
                  {m.kind === "cash" ? formatMoney(m.balance, m.currency!) : `${formatQuantity(m.kind, m.quantity)}${m.karat ? ` · ${m.karat}k` : ""}${m.ticker ? ` · ${m.ticker}` : ""}`}
                </td>
                <td className="px-3 py-2 text-right tabular">{formatMoney(oldV, COMPARE_IN)}</td>
                <td className={`px-3 py-2 text-right tabular ${oldV !== null && newV !== null && Math.abs(oldV - newV) > 0.01 ? "font-semibold text-gain-ink" : ""}`}>
                  {formatMoney(newV, COMPARE_IN)}
                </td>
              </tr>
            ))}
            <tr>
              <td className="px-3 py-2 font-medium text-ink">Upcoming Income</td>
              <td className="px-3 py-2 text-ink-soft tabular">{formatMoney(payload.pending_balance, "USD")}</td>
              <td className="px-3 py-2 text-right tabular">{formatMoney(preview.pending, COMPARE_IN)}</td>
              <td className="px-3 py-2 text-right tabular">{formatMoney(preview.pending, COMPARE_IN)}</td>
            </tr>
          </tbody>
          <tfoot className="bg-brand font-semibold text-ink">
            <tr>
              <td className="px-3 py-2" colSpan={2}>
                Net worth
              </td>
              <td className="px-3 py-2 text-right tabular">{formatMoney(preview.oldTotal, COMPARE_IN)}</td>
              <td className="px-3 py-2 text-right tabular">{formatMoney(preview.newTotal, COMPARE_IN)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      <ul className="grid gap-1 text-sm text-ink-soft sm:grid-cols-2">
        <li>{payload.goals.length} goals</li>
        <li>{payload.transactions.length} history entries (read-only)</li>
        <li>{payload.automation_rules.length} automatic transfers (24th and 1st of the month)</li>
        <li>Zakat Hawl: {payload.hawl_start_date ? `started ${formatDate(payload.hawl_start_date)}` : "not started"}</li>
        <li>Gold, stocks: each becomes an "Opening balance" purchase. Add the price you paid to see growth.</li>
      </ul>

      {payload.warnings.length ? (
        <Notice tone="warning">
          <ul className="list-disc pl-4">
            {payload.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </Notice>
      ) : null}

      {!vaultIsEmpty ? (
        <Notice tone="loss">Your new vault already has data. Import only works into an empty vault, so remove what you added first.</Notice>
      ) : null}

      <Button variant="primary" className="self-start" disabled={!vaultIsEmpty} onClick={() => setConfirm(true)}>
        Import my data
      </Button>

      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title="Import your data from the previous AuraFinance?"
        confirmLabel="Import"
        tone="primary"
        onConfirm={() => run(() => importPreviousVault(toDatabasePayload(payload)), "Your data was imported")}
      >
        <p>This copies everything shown above into your new vault. It can only be done once. Your old data stays untouched.</p>
      </ConfirmDialog>
    </div>
  );
}
