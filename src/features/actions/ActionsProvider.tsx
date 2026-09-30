import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { AssetDialog } from "@/features/assets/AssetDialog";
import { FollowTickerDialog } from "@/features/market/FollowTickerDialog";
import { MoneyDialog, type MoneyTab } from "@/features/money/MoneyDialog";
import type { Asset, GroupKind } from "@/lib/types";

interface ActionsContextValue {
  openMoney: (tab?: MoneyTab, options?: { fromId?: string; toId?: string }) => void;
  openAsset: (options?: { asset?: Asset; kind?: GroupKind }) => void;
  openFollowTicker: () => void;
}

const ActionsContext = createContext<ActionsContextValue | null>(null);

/** Hosts dialogs that can be opened from anywhere (the ➕ button, the dashboard, the assets page…). */
export function ActionsProvider({ children }: { children: ReactNode }) {
  const [money, setMoney] = useState<{ open: boolean; tab: MoneyTab; fromId?: string; toId?: string }>({ open: false, tab: "income" });
  const [asset, setAsset] = useState<{ open: boolean; asset?: Asset; kind?: GroupKind }>({ open: false });
  const [follow, setFollow] = useState(false);

  const openMoney = useCallback<ActionsContextValue["openMoney"]>(
    (tab = "income", options = {}) => setMoney({ open: true, tab, ...options }),
    [],
  );
  const openAsset = useCallback<ActionsContextValue["openAsset"]>((options = {}) => setAsset({ open: true, ...options }), []);
  const openFollowTicker = useCallback(() => setFollow(true), []);

  const value = useMemo(() => ({ openMoney, openAsset, openFollowTicker }), [openMoney, openAsset, openFollowTicker]);

  return (
    <ActionsContext.Provider value={value}>
      {children}
      <MoneyDialog
        open={money.open}
        initialTab={money.tab}
        initialFromId={money.fromId}
        initialToId={money.toId}
        onOpenChange={(open) => setMoney((m) => ({ ...m, open }))}
      />
      <AssetDialog
        open={asset.open}
        asset={asset.asset}
        initialKind={asset.kind}
        onOpenChange={(open) => setAsset((a) => ({ ...a, open }))}
      />
      <FollowTickerDialog open={follow} onOpenChange={setFollow} />
    </ActionsContext.Provider>
  );
}

export function useActions(): ActionsContextValue {
  const ctx = useContext(ActionsContext);
  if (!ctx) throw new Error("useActions must be used inside ActionsProvider");
  return ctx;
}
