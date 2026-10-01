import { FileUp, RotateCcw } from "lucide-react";
import { useRef, useState, type ChangeEvent } from "react";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Notice } from "@/components/ui/misc";
import { useToast } from "@/components/ui/Toast";
import { useVault, useVaultAction } from "@/features/vault/VaultProvider";
import { restoreVault } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { BackupError, MAX_BACKUP_BYTES, readBackup, type BackupSummary } from "./backup";
import { useDownloadBackup } from "./useDownloadBackup";

/** Replaces this vault with a JSON backup downloaded from Settings › Data (from this or another account). */
export function RestorePanel() {
  const { vault } = useVault();
  const run = useVaultAction();
  const toast = useToast();
  const downloadBackup = useDownloadBackup();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<{ name: string; data: Record<string, unknown>; summary: BackupSummary } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);

  const choose = async (e: ChangeEvent<HTMLInputElement>) => {
    const picked = e.target.files?.[0];
    e.target.value = ""; // choosing the same file again still triggers a change
    setFile(null);
    setError(null);
    if (!picked) return;
    if (picked.size > MAX_BACKUP_BYTES) return setError("This file is too large to be an AuraFinance backup.");
    try {
      const { data, summary } = readBackup(await picked.text());
      setFile({ name: picked.name, data, summary });
    } catch (err) {
      setError(err instanceof BackupError ? err.message : "Couldn't read this file.");
    }
  };

  const s = file?.summary;

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-ink-soft">
        Choose a full backup (JSON) downloaded from Settings › Data, from this vault or another one. Restoring replaces everything in this vault
        with what's in the file.
      </p>
      <input ref={input} type="file" accept="application/json,.json" className="sr-only" onChange={choose} aria-label="Backup file" tabIndex={-1} />
      <Button className="self-start" onClick={() => input.current?.click()}>
        <FileUp className="size-4" aria-hidden="true" /> Choose backup file
      </Button>

      {error ? <Notice tone="loss">{error}</Notice> : null}

      {s ? (
        <div className="flex flex-col gap-3 rounded-2xl border border-line p-4">
          <div>
            <p className="font-medium text-ink">{s.vaultName}</p>
            <p className="text-sm text-ink-soft">
              {file!.name}
              {s.exportedAt ? ` · saved ${formatDateTime(s.exportedAt, vault.profile.timezone)}` : ""}
            </p>
          </div>
          <ul className="grid gap-1 text-sm text-ink-soft sm:grid-cols-2">
            <li>{s.assets} assets and accounts</li>
            <li>
              {s.purchases} purchases, {s.sales} sales
            </li>
            <li>{s.goals} goals</li>
            <li>{s.rules} automatic transfers</li>
            <li>
              {s.transactions} history entries{s.revertable ? "" : " (read-only)"}
            </li>
            <li>Settings, Zakat Hawl and payments</li>
          </ul>
          <Notice tone="warning">
            Everything in this vault is replaced: assets, balances, history, goals, Zakat and settings. Your display name, email and password
            stay. A backup of this vault downloads first, just in case.
          </Notice>
          <Button variant="primary" className="self-start" onClick={() => setConfirm(true)}>
            <RotateCcw className="size-4" aria-hidden="true" /> Restore this backup
          </Button>
        </div>
      ) : null}

      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title="Replace this vault with the backup?"
        confirmLabel="Restore"
        onConfirm={async () => {
          try {
            await downloadBackup();
          } catch (err) {
            // Don't replace anything without the safety copy
            toast.error(err);
            return;
          }
          const ok = await run(() => restoreVault(file!.data), "Backup restored");
          if (ok) setFile(null);
        }}
      >
        <p>
          <strong className="text-ink">{vault.profile.vault_name}</strong> will be replaced by <strong className="text-ink">{s?.vaultName}</strong>. A
          copy of your current vault downloads first.
        </p>
        <p>Automatic transfers restart from their next date, so restoring never moves money by itself.</p>
      </ConfirmDialog>
    </div>
  );
}
