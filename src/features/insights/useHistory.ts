import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { queryKeys, useVault } from "@/features/vault/VaultProvider";
import { ensurePriceHistory, fetchAllTransactionChanges, fetchAllTransactions, fetchMarketPrices, fetchPriceHistory } from "@/lib/api";
import { addDays, todayIn } from "@/lib/format";
import { buildHistory, firstRecordDay, historySymbols, periodBaseline, type Ledger, type VaultHistory } from "@/lib/history";
import type { HistoricalPrice, PeriodKey } from "@/lib/types";

const SYMBOLS_PER_CALL = 25;

/** Every Activity entry and the balance changes it made. Refetched whenever Activity changes. */
export function useLedger(enabled = true) {
  const { userId } = useVault();
  return useQuery({
    enabled,
    // Under the Activity key, so everything that refreshes Activity refreshes this too
    queryKey: [...queryKeys.activity(userId), "ledger"],
    queryFn: async (): Promise<Ledger> => {
      const [transactions, changes] = await Promise.all([fetchAllTransactions(userId), fetchAllTransactionChanges(userId)]);
      return { transactions, changes };
    },
    staleTime: 60_000,
  });
}

export type HistoryState =
  | { status: "loading" }
  | { status: "error"; error: unknown }
  | {
      status: "ready";
      history: VaultHistory;
      ledger: Ledger;
      /** The day the period is measured from */
      baseline: string;
      /** Past prices couldn't be loaded: values use today's prices throughout */
      pricesUnavailable: boolean;
      /** Symbols with no close near the start of the period: earlier days use their first known price */
      missingHistory: string[];
      /** Showing the previous period while the one asked for loads */
      updating: boolean;
    };

/** Symbols whose first close comes more than a week after `baseline` (or that have none). */
function missingAt(symbols: string[], rows: HistoricalPrice[], baseline: string): string[] {
  const first = new Map<string, string>();
  for (const r of rows) if (!first.has(r.symbol) || r.price_date < first.get(r.symbol)!) first.set(r.symbol, r.price_date);
  const limit = addDays(baseline, 7);
  return symbols.filter((s) => !first.has(s) || first.get(s)! > limit);
}

/**
 * Net worth for every day of a period (and a few days before it), with where each change came from.
 * Pass `enabled: false` to load nothing (e.g. when the numbers aren't shown).
 */
export function useVaultHistory(period: PeriodKey, { enabled = true }: { enabled?: boolean } = {}): HistoryState {
  const { vault, now } = useVault();
  const ledger = useLedger(enabled);
  // Already loaded by the vault; shared through the cache
  const live = useQuery({ queryKey: queryKeys.prices, queryFn: fetchMarketPrices });

  const today = todayIn(vault.profile.timezone, now);
  const baseline = ledger.data ? periodBaseline(period, today, firstRecordDay(vault, ledger.data, today)) : null;
  const symbols = useMemo(() => (live.data ? historySymbols(vault, live.data) : []), [vault, live.data]);

  const prices = useQuery({
    queryKey: ["price-history", symbols.join(","), baseline],
    enabled: enabled && baseline !== null && live.data !== undefined,
    staleTime: 30 * 60_000,
    // While another period loads, the previous one stays on screen (with the baseline it was built for)
    placeholderData: keepPreviousData,
    queryFn: async () => {
      if (symbols.length === 0) return { baseline: baseline!, rows: [] as HistoricalPrice[] };
      // The server only looks up what it doesn't have yet; reading still works if it can't
      for (let i = 0; i < symbols.length; i += SYMBOLS_PER_CALL) {
        await ensurePriceHistory(symbols.slice(i, i + SYMBOLS_PER_CALL), baseline!).catch((err) =>
          console.warn("Filling in past prices failed", err),
        );
      }
      // A few days earlier, so the first day has a close even after a weekend
      return { baseline: baseline!, rows: await fetchPriceHistory(symbols, addDays(baseline!, -10)) };
    },
  });

  // Past prices that failed to load still give a history, valued at today's prices
  const loaded = useMemo(
    () => prices.data ?? (prices.isError && baseline !== null ? { baseline, rows: [] as HistoricalPrice[] } : null),
    [prices.data, prices.isError, baseline],
  );
  const history = useMemo(() => {
    if (!ledger.data || !live.data || !loaded) return null;
    return buildHistory({ vault, ledger: ledger.data, prices: loaded.rows, live: live.data, today, from: loaded.baseline });
  }, [vault, ledger.data, live.data, loaded, today]);

  // The same object while nothing changed, so pages can memoize what they work out from it
  return useMemo((): HistoryState => {
    if (ledger.error) return { status: "error", error: ledger.error };
    if (!history || !ledger.data || !loaded) return { status: "loading" };
    return {
      status: "ready",
      history,
      ledger: ledger.data,
      baseline: loaded.baseline,
      pricesUnavailable: prices.isError,
      missingHistory: prices.isError ? [] : missingAt(symbols, loaded.rows, loaded.baseline),
      updating: prices.isPlaceholderData,
    };
  }, [ledger.error, ledger.data, history, loaded, prices.isError, prices.isPlaceholderData, symbols]);
}
