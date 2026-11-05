import * as DM from "@radix-ui/react-dropdown-menu";
import { Check, ChevronDown, Coins, Search } from "lucide-react";
import { useId, useMemo, useState } from "react";
import { useVault, useVaultAction } from "@/features/vault/VaultProvider";
import { updateProfile } from "@/lib/api";
import { cn } from "@/lib/cn";
import { currencyName, currencyOptions } from "@/lib/currencies";

interface CurrencyPickerProps {
  className?: string;
}

export function CurrencyPicker({ className }: CurrencyPickerProps) {
  const { vault, userId, book } = useVault();
  const run = useVaultAction();
  const [search, setSearch] = useState("");
  const searchId = useId();

  const currentBase = vault.profile.base_currency;
  const options = useMemo(() => currencyOptions(book.usdRates.keys()), [book.usdRates]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => o.code.toLowerCase().includes(q) || o.label.toLowerCase().includes(q));
  }, [options, search]);

  const handleSelect = async (code: string) => {
    if (code === currentBase) return;
    await run(
      () =>
        updateProfile(userId, {
          base_currency: code,
          display_currencies: vault.profile.display_currencies.filter((c) => c !== code),
        }),
      `Dashboard currency changed to ${code}`,
    );
  };

  return (
    <DM.Root onOpenChange={(open) => !open && setSearch("")}>
      <DM.Trigger asChild>
        <button
          type="button"
          className={cn(
            "flex items-center gap-1.5 rounded-full border border-line bg-surface/80 px-2.5 py-1.5 text-xs font-semibold text-ink shadow-xs transition hover:border-line-strong hover:bg-surface-muted active:scale-95 focus:outline-none focus:ring-2 focus:ring-brand",
            className,
          )}
          aria-label={`Change dashboard currency. Currently ${currentBase}`}
          title={`Dashboard currency: ${currentBase} (${currencyName(currentBase)})`}
        >
          <Coins className="size-3.5 text-brand-ink shrink-0" aria-hidden="true" />
          <span className="font-bold">{currentBase}</span>
          <ChevronDown className="size-3 text-ink-soft opacity-70 shrink-0" aria-hidden="true" />
        </button>
      </DM.Trigger>

      <DM.Portal>
        <DM.Content
          align="end"
          side="bottom"
          sideOffset={8}
          className="z-50 w-72 rounded-2xl border border-line bg-surface p-2 shadow-lifted animate-pop-in text-ink"
        >
          <div className="px-2 pt-1 pb-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-ink-soft">Dashboard Currency</p>
            <p className="text-xs text-ink-soft">Net worth, totals & Zakat are calculated in this currency.</p>
          </div>

          <div className="relative mb-2 px-1">
            <Search className="pointer-events-none absolute left-3.5 top-2.5 size-3.5 text-ink-soft" aria-hidden="true" />
            <input
              id={searchId}
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search currency..."
              className="w-full rounded-xl border border-line bg-surface-muted/50 py-1.5 pr-2.5 pl-8 text-xs text-ink placeholder:text-ink-soft focus:border-focus focus:bg-surface focus:outline-none focus:ring-2 focus:ring-brand"
              autoFocus
            />
          </div>

          <div className="max-h-60 overflow-y-auto px-1 space-y-0.5">
            {filtered.length === 0 ? (
              <p className="py-4 text-center text-xs text-ink-soft">No currencies found</p>
            ) : (
              filtered.map((o) => {
                const isSelected = o.code === currentBase;
                return (
                  <DM.Item
                    key={o.code}
                    onSelect={() => handleSelect(o.code)}
                    className={cn(
                      "flex cursor-pointer items-center justify-between rounded-xl px-2.5 py-2 text-xs outline-none transition data-[highlighted]:bg-surface-muted",
                      isSelected ? "bg-brand/15 font-semibold text-brand-ink" : "text-ink",
                    )}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="w-9 font-bold shrink-0">{o.code}</span>
                      <span className="truncate text-ink-soft">{currencyName(o.code)}</span>
                    </div>
                    {isSelected && <Check className="size-4 shrink-0 text-brand-ink" aria-hidden="true" />}
                  </DM.Item>
                );
              })
            )}
          </div>
        </DM.Content>
      </DM.Portal>
    </DM.Root>
  );
}
