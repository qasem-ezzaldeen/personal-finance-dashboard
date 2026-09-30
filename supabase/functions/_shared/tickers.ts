// Shared by the web app and the edge functions. Pure TypeScript, no runtime dependencies.

const COMPANY_ALIASES: Record<string, string> = {
  APPLE: "AAPL",
  MICROSOFT: "MSFT",
  GOOGLE: "GOOGL",
  ALPHABET: "GOOGL",
  TESLA: "TSLA",
  AMAZON: "AMZN",
  NVIDIA: "NVDA",
  META: "META",
  FACEBOOK: "META",
  NETFLIX: "NFLX",
};

export const TICKER_PATTERN = /^[A-Z0-9][A-Z0-9.-]{0,14}$/;

/** Uppercases, trims and converts well-known company names to their ticker (Apple -> AAPL). */
export function normalizeTicker(input: string): string {
  const cleaned = input.trim().toUpperCase().replace(/\s+/g, "");
  return COMPANY_ALIASES[cleaned] ?? cleaned;
}

export function isValidTickerFormat(ticker: string): boolean {
  return TICKER_PATTERN.test(ticker);
}

export const SUGGESTED_TICKERS = ["SPUS", "HLAL", "AAPL", "MSFT", "NVDA", "AMZN", "GOOGL", "TSLA"];
