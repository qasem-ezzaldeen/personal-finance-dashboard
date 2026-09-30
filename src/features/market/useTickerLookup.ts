import { useEffect, useState } from "react";
import { isValidTickerFormat, normalizeTicker } from "@shared/tickers";
import { checkTicker, type TickerInfo } from "@/lib/api";

export type TickerLookup =
  | { state: "idle" }
  | { state: "checking"; ticker: string }
  | { state: "found"; info: TickerInfo }
  | { state: "error"; ticker: string; message: string };

type Settled = { ticker: string; result: Extract<TickerLookup, { state: "found" | "error" }> };

/** Checks a typed ticker with the server after the user stops typing (one request, not one per key). */
export function useTickerLookup(raw: string, delayMs = 600): TickerLookup {
  const ticker = normalizeTicker(raw);
  const valid = ticker !== "" && isValidTickerFormat(ticker);
  const [settled, setSettled] = useState<Settled | null>(null);

  useEffect(() => {
    if (!valid) return;
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      try {
        const info = await checkTicker(ticker);
        if (!cancelled) setSettled({ ticker, result: { state: "found", info } });
      } catch (err) {
        if (!cancelled) {
          setSettled({ ticker, result: { state: "error", ticker, message: err instanceof Error ? err.message : "Lookup failed" } });
        }
      }
    }, delayMs);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [ticker, valid, delayMs]);

  if (!ticker) return { state: "idle" };
  if (!valid) return { state: "error", ticker, message: "Use letters and numbers only, like AAPL or SPUS." };
  if (settled?.ticker === ticker) return settled.result;
  return { state: "checking", ticker };
}
