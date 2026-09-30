import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/cn";

export function Card({ className, ...props }: HTMLAttributes<HTMLElement>) {
  return (
    <section
      className={cn("rounded-[var(--radius-card)] border border-line bg-surface shadow-soft", className)}
      {...props}
    />
  );
}

export function CardHeader({
  title,
  icon,
  actions,
  subtitle,
  className,
  titleId,
}: {
  title: ReactNode;
  icon?: ReactNode;
  actions?: ReactNode;
  subtitle?: ReactNode;
  className?: string;
  titleId?: string;
}) {
  return (
    <header className={cn("flex items-start justify-between gap-3 px-4 pt-4 sm:px-5 sm:pt-5", className)}>
      <div className="flex min-w-0 items-center gap-2.5">
        {icon ? (
          <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-surface-muted text-ink-soft" aria-hidden="true">
            {icon}
          </span>
        ) : null}
        <div className="min-w-0">
          <h2 id={titleId} className="truncate text-base font-semibold text-ink">
            {title}
          </h2>
          {subtitle ? <p className="truncate text-sm text-ink-soft">{subtitle}</p> : null}
        </div>
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-1.5">{actions}</div> : null}
    </header>
  );
}

export function CardBody({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("px-4 pt-3 pb-4 sm:px-5 sm:pb-5", className)} {...props} />;
}
