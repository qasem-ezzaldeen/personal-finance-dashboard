import { CheckCircle2, AlertCircle, X } from "lucide-react";
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { motionScale } from "@/lib/motion";

type Tone = "success" | "error" | "info";
interface ToastItem {
  id: number;
  title: string;
  description?: string;
  tone: Tone;
  leaving?: boolean;
}

interface ToastApi {
  show: (toast: { title: string; description?: string; tone?: Tone }) => void;
  success: (title: string, description?: string) => void;
  error: (error: unknown, fallback?: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  // Fade out first, then remove
  const dismiss = useCallback((id: number) => {
    setItems((list) => list.map((t) => (t.id === id ? { ...t, leaving: true } : t)));
    window.setTimeout(() => setItems((list) => list.filter((t) => t.id !== id)), 160 * motionScale() + 20);
  }, []);

  const show = useCallback<ToastApi["show"]>(
    ({ title, description, tone = "info" }) => {
      const id = nextId.current++;
      setItems((list) => [...list.slice(-2), { id, title, description, tone }]);
      window.setTimeout(() => dismiss(id), tone === "error" ? 7000 : 3500);
    },
    [dismiss],
  );

  const api = useMemo<ToastApi>(
    () => ({
      show,
      success: (title, description) => show({ title, description, tone: "success" }),
      error: (error, fallback = "Something went wrong") =>
        show({ title: error instanceof Error ? error.message : typeof error === "string" ? error : fallback, tone: "error" }),
    }),
    [show],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        className="pointer-events-none fixed inset-x-0 bottom-20 z-[60] flex flex-col items-center gap-2 px-4 md:bottom-6 md:items-end md:px-6"
        aria-live="polite"
        aria-atomic="false"
      >
        {items.map((t) => (
          <div
            key={t.id}
            role={t.tone === "error" ? "alert" : "status"}
            className={cn(
              "pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-2xl border border-line bg-surface px-4 py-3 shadow-lifted",
              t.leaving ? "animate-pop-out" : "animate-pop-in",
            )}
          >
            {t.tone === "error" ? (
              <AlertCircle className="mt-0.5 size-5 shrink-0 text-loss-ink" aria-hidden="true" />
            ) : (
              <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-gain-ink" aria-hidden="true" />
            )}
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-ink">{t.title}</p>
              {t.description ? <p className="text-sm text-ink-soft">{t.description}</p> : null}
            </div>
            <button
              type="button"
              onClick={() => dismiss(t.id)}
              className="-mr-1 grid size-7 place-items-center rounded-lg text-ink-soft hover:bg-surface-muted"
              aria-label="Dismiss"
            >
              <X className="size-4" aria-hidden="true" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside ToastProvider");
  return ctx;
}
