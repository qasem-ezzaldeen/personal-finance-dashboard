// Full JSON backups (Settings › Data): what the app downloads, and checking a file before it's restored.
// The database function restore_vault() does the actual restore, in one step.

import { z } from "zod";
import type { Transaction, TransactionChange, VaultData } from "@/lib/types";

export const BACKUP_FORMAT = "aurafinance-backup";
export const BACKUP_VERSION = 2;
/** Larger files are almost certainly not a backup from this app */
export const MAX_BACKUP_BYTES = 25 * 1024 * 1024;

export function buildBackup(vault: VaultData, transactions: Transaction[], changes: TransactionChange[]) {
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exported_at: new Date().toISOString(),
    app: "AuraFinance",
    ...vault,
    transactions,
    // Lets a restored vault revert its history exactly
    transaction_changes: changes,
  };
}

const row = z.object({ id: z.string() }).passthrough();
const list = z.array(row).optional();

const backupSchema = z
  .object({
    app: z.literal("AuraFinance"),
    exported_at: z.string().optional(),
    profile: z.object({ vault_name: z.string().optional(), base_currency: z.string().optional() }).passthrough(),
    assets: z.array(row.extend({ kind: z.enum(["cash", "gold", "stock", "other", "pending_income"]), name: z.string() })),
    purchases: list,
    sales: list,
    goals: list,
    rules: list,
    transactions: list,
    transaction_changes: z.array(z.object({ transaction_id: z.string() }).passthrough()).optional(),
  })
  .passthrough();

export interface BackupSummary {
  exportedAt: string | null;
  vaultName: string;
  baseCurrency: string | null;
  assets: number;
  purchases: number;
  sales: number;
  goals: number;
  transactions: number;
  rules: number;
  /** Backups made after buy/sell was added can restore history that can be reverted */
  revertable: boolean;
}

export class BackupError extends Error {}

/** Parses and checks a backup file. Throws a BackupError with a message for the user. */
export function readBackup(text: string): { data: Record<string, unknown>; summary: BackupSummary } {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new BackupError("This file isn't valid JSON. Choose a backup downloaded from Settings › Data.");
  }
  const parsed = backupSchema.safeParse(json);
  if (!parsed.success) {
    throw new BackupError("This file isn't an AuraFinance backup. Choose a backup downloaded from Settings › Data (Full backup).");
  }
  const d = parsed.data;
  return {
    data: d as Record<string, unknown>,
    summary: {
      exportedAt: d.exported_at ?? null,
      vaultName: d.profile.vault_name ?? "Vault",
      baseCurrency: d.profile.base_currency ?? null,
      assets: d.assets.filter((a) => a.kind !== "pending_income").length,
      purchases: d.purchases?.length ?? 0,
      sales: d.sales?.length ?? 0,
      // The old pinned Zakat goal isn't restored as a goal
      goals: (d.goals ?? []).filter((g) => !(g as { is_system?: boolean }).is_system).length,
      transactions: d.transactions?.length ?? 0,
      rules: d.rules?.length ?? 0,
      revertable: Array.isArray(d.transaction_changes),
    },
  };
}
