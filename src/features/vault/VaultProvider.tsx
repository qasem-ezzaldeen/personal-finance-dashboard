import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { useAuth } from "@/features/auth/AuthProvider";
import { bootstrapVault, estimatePurchaseCosts, fetchMarketPrices, fetchVault, runScheduledTasks } from "@/lib/api";
import { purchasesToEstimate } from "@/lib/estimates";
import { applyMotion } from "@/lib/motion";
import { applyTheme } from "@/lib/theme";
import { setFormatLocale } from "@/lib/format";
import { supabase } from "@/lib/supabase";
import type { VaultData } from "@/lib/types";
import { buildPriceBook, makeContext, summarizeVault, type PriceBook, type ValuationContext, type VaultSummary } from "@/lib/valuation";
import { FullScreenMessage } from "@/components/layout/FullScreenMessage";

export const queryKeys = {
  vault: (userId: string) => ["vault", userId] as const,
  activity: (userId: string) => ["activity", userId] as const,
  prices: ["market-prices"] as const,
};

interface VaultContextValue {
  userId: string;
  vault: VaultData;
  book: PriceBook;
  ctx: ValuationContext;
  summary: VaultSummary;
  now: Date;
}

const VaultContext = createContext<VaultContextValue | null>(null);

const USER_TABLES = [
  "profiles",
  "pricing_settings",
  "asset_groups",
  "assets",
  "asset_purchases",
  "automation_rules",
  "transactions",
  "goals",
  "zakat_hawl",
  "zakat_payments",
  "followed_tickers",
  "price_overrides",
] as const;

/** Keeps every open device in sync: any change to this user's rows refetches the affected data. */
function useRealtimeSync(userId: string, enabled: boolean) {
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!enabled) return;
    const pending = new Set<string>();
    let timer: number | undefined;
    const flush = () => {
      if (pending.has("vault")) queryClient.invalidateQueries({ queryKey: queryKeys.vault(userId) });
      if (pending.has("activity")) queryClient.invalidateQueries({ queryKey: queryKeys.activity(userId) });
      if (pending.has("prices")) queryClient.invalidateQueries({ queryKey: queryKeys.prices });
      pending.clear();
    };
    const schedule = (what: string, delay = 250) => {
      pending.add(what);
      window.clearTimeout(timer);
      timer = window.setTimeout(flush, delay);
    };

    const channel = supabase.channel(`vault:${userId}`);
    for (const table of USER_TABLES) {
      channel.on("postgres_changes", { event: "*", schema: "public", table, filter: `user_id=eq.${userId}` }, () => {
        schedule("vault");
        if (table === "transactions") schedule("activity");
      });
    }
    channel.on("postgres_changes", { event: "*", schema: "public", table: "market_prices" }, () => schedule("prices", 1500));
    channel.subscribe();

    return () => {
      window.clearTimeout(timer);
      supabase.removeChannel(channel);
    };
  }, [enabled, queryClient, userId]);
}

/** Whenever gold or stock purchases are missing a price, asks the server to fill in the market price on their date. */
function useAutoEstimates(userId: string, vault: VaultData | undefined) {
  const queryClient = useQueryClient();
  const requested = useRef("");
  const signature = vault ? purchasesToEstimate(vault).join(",") : "";

  useEffect(() => {
    if (!signature || requested.current === signature) return;
    requested.current = signature;
    estimatePurchaseCosts()
      .then(() => queryClient.invalidateQueries({ queryKey: queryKeys.vault(userId) }))
      .catch((err) => console.warn("Estimating purchase prices failed", err));
  }, [signature, queryClient, userId]);
}

function useMinuteClock(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(id);
  }, []);
  return now;
}

export function VaultProvider({ children }: { children: ReactNode }) {
  const { user, signOut } = useAuth();
  const userId = user!.id;
  const queryClient = useQueryClient();
  const now = useMinuteClock();

  const setup = useQuery({
    queryKey: ["bootstrap", userId],
    queryFn: async () => {
      await bootstrapVault();
      // Catch up on automations and the daily Zakat check in the background
      runScheduledTasks()
        .then(() => {
          queryClient.invalidateQueries({ queryKey: queryKeys.vault(userId) });
          queryClient.invalidateQueries({ queryKey: queryKeys.activity(userId) });
        })
        .catch((err) => console.warn("Scheduled tasks catch-up failed", err));
      return true;
    },
    staleTime: Number.POSITIVE_INFINITY,
    retry: 2,
  });

  const vaultQuery = useQuery({
    queryKey: queryKeys.vault(userId),
    queryFn: () => fetchVault(userId),
    enabled: setup.isSuccess,
  });

  const pricesQuery = useQuery({
    queryKey: queryKeys.prices,
    queryFn: fetchMarketPrices,
    enabled: setup.isSuccess,
    refetchInterval: 5 * 60_000,
  });

  useRealtimeSync(userId, setup.isSuccess);

  const vault = vaultQuery.data;
  useAutoEstimates(userId, vault);

  // Use this account's animation speed (also remembered on this device for the next visit)
  const animationSpeed = vault?.profile.animation_speed;
  useEffect(() => {
    if (animationSpeed) applyMotion(animationSpeed);
  }, [animationSpeed]);
  const theme = vault?.profile.theme;
  useEffect(() => {
    if (theme) applyTheme(theme);
  }, [theme]);
  // Idempotent; must run before anything below formats numbers
  if (vault) setFormatLocale(vault.profile.number_locale);

  const value = useMemo<VaultContextValue | null>(() => {
    if (!vault || !pricesQuery.data) return null;
    const book = buildPriceBook(pricesQuery.data);
    const ctx = makeContext(book, vault.pricing, vault.overrides);
    return { userId, vault, book, ctx, summary: summarizeVault(vault, ctx, now), now };
  }, [vault, pricesQuery.data, userId, now]);

  const error = setup.error ?? vaultQuery.error ?? pricesQuery.error;
  if (error && !value) {
    return (
      <FullScreenMessage
        title="We couldn't open your vault"
        message={error instanceof Error ? error.message : "Check your connection and try again."}
        actions={
          <>
            <Button variant="primary" onClick={() => window.location.reload()}>
              Try again
            </Button>
            <Button variant="ghost" onClick={() => signOut()}>
              Sign out
            </Button>
          </>
        }
      />
    );
  }
  if (!value) return <FullScreenMessage loading title="Opening your vault…" />;

  return <VaultContext.Provider value={value}>{children}</VaultContext.Provider>;
}

export function useVault(): VaultContextValue {
  const ctx = useContext(VaultContext);
  if (!ctx) throw new Error("useVault must be used inside VaultProvider");
  return ctx;
}

/** Runs a change, refreshes affected data and reports success or failure. Returns true on success. */
export function useVaultAction() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const { userId } = useVault();
  return useCallback(
    async (fn: () => Promise<unknown>, successMessage?: string): Promise<boolean> => {
      try {
        await fn();
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: queryKeys.vault(userId) }),
          queryClient.invalidateQueries({ queryKey: queryKeys.activity(userId) }),
        ]);
        if (successMessage) toast.success(successMessage);
        return true;
      } catch (err) {
        toast.error(err);
        return false;
      }
    },
    [queryClient, toast, userId],
  );
}
