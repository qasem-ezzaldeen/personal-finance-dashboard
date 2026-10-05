import { Badge, ColorDot } from "@/components/ui/misc";
import { cn, signTone } from "@/lib/cn";
import { formatAmount, formatPercent } from "@/lib/format";
import type { AssetPerformance } from "@/lib/history";
import { GOLD_UNIT } from "@/lib/types";

/** How each gold, stock and other asset did over the period: what moved its value, and by how much. */
export function AssetTable({ rows, unit }: { rows: AssetPerformance[]; unit: string }) {
  if (rows.length === 0) return <p className="text-sm text-ink-soft">No gold, stocks or other assets in this period.</p>;

  const withPct = rows.filter((r) => r.pct !== null);
  // Only an asset that gained can be the best, and only one that lost the worst (more than 0.05%, not rounding)
  const top = withPct.length > 1 ? withPct.reduce((a, b) => (b.pct! > a.pct! ? b : a)) : null;
  const bottom = withPct.length > 1 ? withPct.reduce((a, b) => (b.pct! < a.pct! ? b : a)) : null;
  const best = top && top.pct! > 0.0005 ? top : null;
  const worst = bottom && bottom.pct! < -0.0005 ? bottom : null;
  const showMeasure = unit === GOLD_UNIT && rows.some((r) => Math.abs(r.measure) > 1e-9);
  const amount = (x: number) => formatAmount(x, unit, { signed: true });

  return (
    // The price and exchange-rate columns appear when the card is wide enough for them
    <div className="@container -mx-1 overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-ink-soft">
            <th scope="col" className="px-1 py-2 font-medium">
              Asset
            </th>
            <th scope="col" className="px-1 py-2 text-right font-medium">
              Now
            </th>
            <th scope="col" className="hidden px-1 py-2 text-right font-medium @xl:table-cell">
              Price
            </th>
            <th scope="col" className="hidden px-1 py-2 text-right font-medium @xl:table-cell">
              Exchange rate
            </th>
            {showMeasure ? (
              <th scope="col" className="hidden px-1 py-2 text-right font-medium @xl:table-cell">
                Gold&apos;s price
              </th>
            ) : null}
            <th scope="col" className="px-1 py-2 text-right font-medium">
              Change
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.asset.id} className="border-t border-line">
              <th scope="row" className="px-1 py-2 text-left font-normal">
                <span className="flex min-w-0 items-center gap-2">
                  <ColorDot color={r.asset.color} />
                  <span className="truncate text-ink">{r.asset.name}</span>
                  {r === best ? <Badge tone="gain">Best</Badge> : r === worst ? <Badge tone="loss">Worst</Badge> : null}
                </span>
              </th>
              <td className="px-1 py-2 text-right whitespace-nowrap text-ink tabular">{formatAmount(r.endValue, unit, { compact: true, decimals: 1 })}</td>
              <td className={cn("hidden px-1 py-2 text-right tabular @xl:table-cell", signTone(r.price))}>{amount(r.price)}</td>
              <td className={cn("hidden px-1 py-2 text-right tabular @xl:table-cell", signTone(r.currency))}>{amount(r.currency)}</td>
              {showMeasure ? <td className={cn("hidden px-1 py-2 text-right tabular @xl:table-cell", signTone(r.measure))}>{amount(r.measure)}</td> : null}
              <td className="px-1 py-2 text-right whitespace-nowrap tabular">
                <span className={cn("block font-medium", signTone(r.gain))}>{amount(r.gain)}</span>
                {r.pct !== null ? <span className={cn("block text-xs", signTone(r.pct))}>{formatPercent(r.pct, { signed: true })}</span> : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
