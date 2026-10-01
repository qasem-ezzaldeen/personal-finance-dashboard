import { useMemo } from "react";
import { useVault } from "@/features/vault/VaultProvider";

/** Active cash accounts in their list order: where purchases are paid from and sales are paid into. */
export function useCashAccounts() {
  const { vault } = useVault();
  return useMemo(
    () => vault.assets.filter((a) => a.kind === "cash" && !a.archived_at).sort((a, b) => a.sort_order - b.sort_order),
    [vault.assets],
  );
}
