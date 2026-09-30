import type { Transaction, VaultData } from "./types";

export function downloadFile(filename: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Quotes a CSV cell and neutralizes spreadsheet formulas (=, +, -, @) in text. */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  let text = String(value);
  if (typeof value === "string" && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(rows: unknown[][]): string {
  return rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
}

export function transactionsCsv(transactions: Transaction[]): string {
  return toCsv([
    ["Date", "Type", "Description", "Amount", "Currency", "From", "To", "Arrived amount", "Arrived currency", "Upcoming before", "Upcoming after"],
    ...transactions.map((t) => [
      t.occurred_at,
      t.kind,
      t.description,
      Number(t.amount),
      t.currency,
      t.from_asset_name,
      t.to_asset_name,
      t.converted_amount,
      t.converted_currency,
      t.pending_before,
      t.pending_after,
    ]),
  ]);
}

export function assetsCsv(vault: VaultData): string {
  const rows: unknown[][] = [["Asset", "Type", "Currency / karat / ticker", "Balance", "Purchase date", "Quantity", "Price paid", "Paid in", "Archived"]];
  for (const a of vault.assets) {
    const detail = a.currency ?? (a.karat ? `${a.karat}k` : a.ticker);
    const purchases = vault.purchases.filter((p) => p.asset_id === a.id);
    if (purchases.length === 0) {
      rows.push([a.name, a.kind, detail, Number(a.balance), "", "", "", "", a.archived_at ? "yes" : ""]);
    }
    for (const p of purchases) {
      rows.push([a.name, a.kind, detail, "", p.acquired_on, Number(p.quantity), p.cost_total, p.cost_currency, a.archived_at ? "yes" : ""]);
    }
  }
  return toCsv(rows);
}
