import type { ReactNode } from "react";
import { Logo } from "./Logo";
import { Spinner } from "@/components/ui/Spinner";

export function FullScreenMessage({
  title,
  message,
  actions,
  loading = false,
}: {
  title: string;
  message?: string;
  actions?: ReactNode;
  loading?: boolean;
}) {
  return (
    <main className="grid min-h-dvh place-items-center px-6">
      <div className="flex max-w-sm flex-col items-center gap-4 text-center animate-fade-in">
        <Logo className="size-12" />
        <h1 className="text-lg font-semibold text-ink">{title}</h1>
        {loading ? <Spinner className="size-6 text-brand-ink" label={title} /> : null}
        {message ? <p className="text-sm text-ink-soft">{message}</p> : null}
        {actions ? <div className="flex flex-wrap justify-center gap-2">{actions}</div> : null}
      </div>
    </main>
  );
}
