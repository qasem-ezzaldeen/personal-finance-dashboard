import * as DM from "@radix-ui/react-dropdown-menu";
import { Check, ChevronDown, Coins, Search } from "lucide-react";
import { useId, useMemo, useState } from "react";
import { useVault, useVaultAction } from "@/features/vault/VaultProvider";
import { updateProfile } from "@/lib/api";
import { cn } from "@/lib/cn";
import { currencyName, currencyOptions } from "@/lib/currencies";

interface CurrencyPickerProps {
  variant?: "header" | "sidebar";
  className?: string;
}

export function CurrencyPicker({ variant = "header", className }: CurrencyPickerProps) {
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
        {variant === "header" ? (
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
        ) : (
          <button
            type="button"
            className={cn(
              "group flex w-full items-center justify-between gap-2 rounded-xl border border-line bg-surface/60 p-2 text-left transition hover:border-line-strong hover:bg-surface-muted focus:outline-none focus:ring-2 focus:ring-brand xl:px-3",
              className,
            )}
            aria-label={`Change dashboard currency. Currently ${currentBase}`}
            title={`Dashboard currency: ${currentBase} (${currencyName(currentBase)})`}
          >
            {/* Expanded sidebar view (xl) */}
            <div className="hidden min-w-0 items-center gap-2.5 xl:flex">
              <span className="grid size-8 shrink-0 place-items-center rounded-lg border border-line bg-surface text-brand-ink shadow-xs">
                <Coins className="size-4" aria-hidden="true" />
              </span>
              <div className="min-w-0">
                <span className="block truncate text-xs font-bold text-ink">
                  {currentBase} · {currencyName(currentBase)}
                </span>
                <span className="block text-[11px] text-ink-soft">Dashboard Currency</span>
              </div>
            </div>

            {/* Collapsed sidebar view (md) */}
            <div className="flex flex-col items-center justify-center w-full py-0.5 xl:hidden">
              <Coins className="size-4 text-brand-ink" aria-hidden="true" />
              <span className="text-[10px] font-bold text-ink mt-0.5">{currentBase}</span>
            </div>

            <ChevronDown className="hidden size-4 shrink-0 text-ink-soft group-hover:text-ink xl:block" aria-hidden="true" />
          </button>
        )}
      </DM.Trigger>

      <DM.Portal>
        <DM.Content
          align={variant === "header" ? "end" : "start"}
          side={variant === "sidebar" ? "right" : "bottom"}
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

/** Sub-menu for embedding currency picker inside UserMenu */
export function CurrencySubMenu() {
  const { vault, userId, book } = useVault();
  const run = useVaultAction();
  const currentBase = vault.profile.base_currency;
  const options = useMemo(() => currencyOptions(book.usdRates.keys()), [book.usdRates]);

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
    <DM.Sub>
      <DM.SubTrigger className="flex cursor-pointer items-center justify-between gap-2 rounded-xl px-3 py-2 text-sm text-ink outline-none data-[highlighted]:bg-surface-muted">
        <div className="flex items-center gap-2">
          <Coins className="size-4" aria-hidden="true" />
          <span>Currency</span>
        </div>
        <span className="text-xs font-semibold text-ink-soft">{currentBase} ›</span>
      </DM.SubTrigger>
      <DM.Portal>
        <DM.SubContent className="z-50 max-h-72 w-64 overflow-y-auto rounded-2xl border border-line bg-surface p-1.5 shadow-lifted animate-pop-in">
          <div className="px-3 py-1.5 text-xs font-semibold text-ink-soft">Select Dashboard Currency</div>
          <DM.Separator className="my-1 h-px bg-line" />
          {options.map((o) => {
            const isSelected = o.code === currentBase;
            return (
              <DM.Item
                key={o.code}
                onSelect={() => handleSelect(o.code)}
                className={cn(
                  "flex cursor-pointer items-center justify-between rounded-xl px-3 py-2 text-xs outline-none data-[highlighted]:bg-surface-muted",
                  isSelected ? "bg-brand/15 font-semibold text-brand-ink" : "text-ink",
                )}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className="w-8 font-bold shrink-0">{o.code}</span>
                  <span className="truncate text-ink-soft">{currencyName(o.code)}</span>
                </div>
                {isSelected && <Check className="size-4 shrink-0 text-brand-ink" aria-hidden="true" />}
              </DM.Item>
            );
          })}
        </DM.SubContent>
      </DM.Portal>
    </DM.Sub>
  );
}
