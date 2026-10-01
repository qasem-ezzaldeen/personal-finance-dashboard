import { useVault } from "@/features/vault/VaultProvider";
import { fetchAllTransactionChanges, fetchAllTransactions } from "@/lib/api";
import { downloadFile } from "@/lib/exporters";
import { buildBackup } from "./backup";

/** Downloads a full JSON backup of the current vault (everything needed to restore it, here or in another account). */
export function useDownloadBackup() {
  const { vault, userId, summary } = useVault();
  return async () => {
    const [transactions, changes] = await Promise.all([fetchAllTransactions(userId), fetchAllTransactionChanges(userId)]);
    downloadFile(`aurafinance-${summary.today}.json`, JSON.stringify(buildBackup(vault, transactions, changes), null, 2), "application/json");
  };
}
