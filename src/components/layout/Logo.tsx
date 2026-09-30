import { cn } from "@/lib/cn";

/** The AuraFinance mark: a soft triangle on a lilac tile. Colors come from colors.css. */
export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={cn("size-9", className)} aria-hidden="true">
      <rect width="48" height="48" rx="14" fill="var(--color-brand)" />
      <path d="M24 12 37 35H11L24 12Z" fill="var(--color-brand-strong)" />
      <path d="M24 22 30.5 33h-13L24 22Z" fill="var(--color-swatch-butter)" />
    </svg>
  );
}
