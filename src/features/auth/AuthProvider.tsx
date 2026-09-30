import type { Session, User } from "@supabase/supabase-js";
import { useQueryClient } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { supabase } from "@/lib/supabase";

interface AuthContextValue {
  status: "loading" | "signedOut" | "signedIn";
  session: Session | null;
  user: User | null;
  /** True after opening a password-reset link, until a new password is saved */
  recovering: boolean;
  finishRecovery: () => void;
  signOut: (options?: { everywhere?: boolean }) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

// Keys written by the previous AuraFinance. None of them are needed any more.
const OLD_STORAGE_KEYS = [
  "usdSavings", "goldGrams", "goldPremium", "upcomingIncome", "transactions", "cachedUsdEgp",
  "cachedGold24kUsd", "lastFetchedTime", "usdEgpTrend", "gold24kTrend", "gold21kTrend", "lastResetMonth",
  "resetPending", "resetRolledIncome", "supabase_url", "supabase_key", "firebase_config", "firebase_sync_code",
  "supabase_sync_code", "aurafinance_local_state", "twelve_data_api_key", "aura_ai_api_key", "theme",
  "dashboard_grid_ratio",
];

function purgeOldStorage() {
  try {
    for (const key of OLD_STORAGE_KEYS) localStorage.removeItem(key);
    for (const key of Object.keys(localStorage)) {
      // Settings saved by development builds of this version
      if (key.startsWith("aurafinance_local_state") || key.startsWith("aura.v2.")) localStorage.removeItem(key);
    }
  } catch {
    // storage can be unavailable (private mode); nothing to clean then
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [session, setSession] = useState<Session | null>(null);
  const [status, setStatus] = useState<AuthContextValue["status"]>("loading");
  const [recovering, setRecovering] = useState(false);

  useEffect(() => {
    purgeOldStorage();

    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSession(data.session);
      setStatus(data.session ? "signedIn" : "signedOut");
    });

    // Keep this callback synchronous: awaiting Supabase calls inside it can deadlock the auth client.
    const { data } = supabase.auth.onAuthStateChange((event, next) => {
      if (event === "PASSWORD_RECOVERY") setRecovering(true);
      setSession(next);
      setStatus(next ? "signedIn" : "signedOut");
      if (event === "SIGNED_OUT") queryClient.clear();
    });

    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, [queryClient]);

  const signOut = useCallback(
    async (options: { everywhere?: boolean } = {}) => {
      await supabase.auth.signOut({ scope: options.everywhere ? "global" : "local" });
      // Wipe everything loaded for this account so nothing carries over to the next one
      queryClient.clear();
      setRecovering(false);
    },
    [queryClient],
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      session,
      user: session?.user ?? null,
      recovering,
      finishRecovery: () => setRecovering(false),
      signOut,
    }),
    [status, session, recovering, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
