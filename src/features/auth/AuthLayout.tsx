import type { ReactNode } from "react";
import { Logo } from "@/components/layout/Logo";

export function AuthLayout({ title, subtitle, children, footer }: { title: string; subtitle?: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <main className="grid min-h-dvh lg:grid-cols-[1.1fr_1fr]">
      <aside className="relative hidden overflow-hidden bg-brand lg:flex lg:flex-col lg:justify-between lg:p-12" aria-hidden="true">
        <div className="flex items-center gap-3">
          <Logo className="size-11" />
          <span className="text-xl font-semibold text-brand-ink">AuraFinance</span>
        </div>
        <div className="relative z-10 max-w-md">
          <p className="text-3xl leading-tight font-semibold text-ink">Your wealth, calmly in one place.</p>
          <p className="mt-3 text-ink-soft">Cash, gold and stocks with live prices, growth since you bought, goals and Zakat tracking.</p>
        </div>
        <div className="absolute -right-24 -bottom-24 size-96 rounded-full bg-gold opacity-70" />
        <div className="absolute right-40 bottom-40 size-40 rounded-full bg-gain opacity-80" />
        <div className="absolute top-32 -right-10 size-28 rounded-full bg-cash" />
      </aside>

      <div className="flex flex-col items-center justify-center px-5 py-10 sm:px-8">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <Logo className="size-10" />
            <span className="text-lg font-semibold text-brand-ink">AuraFinance</span>
          </div>
          <h1 className="text-2xl font-semibold text-ink">{title}</h1>
          {subtitle ? <p className="mt-1.5 text-ink-soft">{subtitle}</p> : null}
          <div className="mt-7">{children}</div>
          {footer ? <div className="mt-6 text-center text-sm text-ink-soft">{footer}</div> : null}
        </div>
      </div>
    </main>
  );
}
