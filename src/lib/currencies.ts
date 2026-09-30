const PREFERRED = ["EGP", "USD", "EUR", "GBP", "AUD", "CAD", "SAR", "AED", "KWD", "QAR", "TRY", "CHF", "JPY"];

let names: Intl.DisplayNames | null = null;
function displayNames(): Intl.DisplayNames | null {
  if (names) return names;
  try {
    names = new Intl.DisplayNames(["en"], { type: "currency" });
  } catch {
    names = null;
  }
  return names;
}

export function currencyName(code: string): string {
  return displayNames()?.of(code) ?? code;
}

/** Currencies to offer: common ones first, then every code we have a live rate for. */
export function currencyOptions(availableCodes: Iterable<string>): Array<{ code: string; label: string }> {
  const all = new Set<string>(["USD", ...availableCodes]);
  const rest = [...all].filter((c) => !PREFERRED.includes(c)).sort();
  return [...PREFERRED.filter((c) => all.has(c)), ...rest].map((code) => ({
    code,
    label: `${code} · ${currencyName(code)}`,
  }));
}

export function timeZoneOptions(): string[] {
  try {
    return Intl.supportedValuesOf("timeZone");
  } catch {
    return ["Africa/Cairo", "UTC", "Europe/London", "America/New_York", "Australia/Sydney", "Asia/Dubai", "Asia/Riyadh"];
  }
}

export function guessTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "Africa/Cairo";
}
