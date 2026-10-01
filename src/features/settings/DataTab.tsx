import { Download } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { useToast } from "@/components/ui/Toast";
import { RestorePanel } from "@/features/backup/RestorePanel";
import { useDownloadBackup } from "@/features/backup/useDownloadBackup";
import { ImportPanel } from "@/features/import/ImportPanel";
import { useVault } from "@/features/vault/VaultProvider";
import { fetchAllTransactions } from "@/lib/api";
import { assetsCsv, downloadFile, transactionsCsv } from "@/lib/exporters";

export function DataTab() {
  const { vault, userId, summary } = useVault();
  const toast = useToast();
  const downloadBackup = useDownloadBackup();
  const [busy, setBusy] = useState<string | null>(null);
  const stamp = summary.today;

  const exportJson = async () => {
    setBusy("json");
    try {
      await downloadBackup();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(null);
    }
  };

  const exportCsv = async () => {
    setBusy("csv");
    try {
      const transactions = await fetchAllTransactions(userId);
      downloadFile(`aurafinance-activity-${stamp}.csv`, transactionsCsv(transactions), "text/csv;charset=utf-8");
      downloadFile(`aurafinance-assets-${stamp}.csv`, assetsCsv(vault), "text/csv;charset=utf-8");
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <Card>
        <CardHeader title="Export your data" subtitle="Download everything in your vault" />
        <CardBody className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-2">
            <Button onClick={exportJson} loading={busy === "json"}>
              <Download className="size-4" aria-hidden="true" /> Full backup (JSON)
            </Button>
            <Button onClick={exportCsv} loading={busy === "csv"}>
              <Download className="size-4" aria-hidden="true" /> Spreadsheets (CSV)
            </Button>
          </div>
          <p className="text-sm text-ink-soft">The full backup can be restored below, in this vault or another one. Spreadsheets are for reading only.</p>
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Restore from a backup" subtitle="Replace this vault with a full backup (JSON)" />
        <CardBody>
          <RestorePanel />
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Import from the previous AuraFinance" subtitle="Bring over your data from the previous version" />
        <CardBody>
          <ImportPanel />
        </CardBody>
      </Card>
    </div>
  );
}
