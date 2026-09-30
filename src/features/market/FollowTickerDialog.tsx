import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Dialog, useOpenKey } from "@/components/ui/Dialog";
import { useVault, useVaultAction } from "@/features/vault/VaultProvider";
import { followTicker } from "@/lib/api";
import { TickerField } from "./TickerField";
import { useTickerLookup } from "./useTickerLookup";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function FollowTickerDialog(props: Props) {
  const openKey = useOpenKey(props.open);
  return <FollowTickerContent key={openKey} {...props} />;
}

function FollowTickerContent({ open, onOpenChange }: Props) {
  const { vault, userId } = useVault();
  const run = useVaultAction();
  const [raw, setRaw] = useState("");
  const lookup = useTickerLookup(open ? raw : "");
  const [saving, setSaving] = useState(false);
  const close = onOpenChange;

  const ticker = lookup.state === "found" ? lookup.info.ticker : null;
  const alreadyFollowed = ticker !== null && vault.followed.some((f) => f.ticker === ticker);
  const held = ticker !== null && vault.assets.some((a) => a.kind === "stock" && a.ticker === ticker && !a.archived_at);

  return (
    <Dialog
      open={open}
      onOpenChange={close}
      title="Follow a stock or ETF"
      description="Its live price appears in the rates bar at the top."
      onSubmit={async (e) => {
        e.preventDefault();
        if (!ticker || alreadyFollowed || held) return;
        setSaving(true);
        const ok = await run(() => followTicker(userId, ticker, vault.followed.length), `Following ${ticker}`);
        setSaving(false);
        if (ok) close(false);
      }}
      footer={
        <>
          <Button variant="ghost" onClick={() => close(false)}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={saving} disabled={!ticker || alreadyFollowed || held}>
            Follow
          </Button>
        </>
      }
    >
      <TickerField value={raw} onChange={setRaw} lookup={lookup} />
      {alreadyFollowed ? <p className="mt-2 text-sm text-ink-soft">You already follow {ticker}.</p> : null}
      {held ? <p className="mt-2 text-sm text-ink-soft">{ticker} is already shown because you hold it.</p> : null}
    </Dialog>
  );
}
