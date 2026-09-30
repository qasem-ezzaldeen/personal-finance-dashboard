import * as RD from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { useState, type FormEvent, type ReactNode } from "react";
import { cn } from "@/lib/cn";

interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  /** When set, the body and footer are wrapped in a <form> */
  onSubmit?: (event: FormEvent<HTMLFormElement>) => void;
  size?: "sm" | "md" | "lg";
}

const widths = { sm: "sm:w-[min(92vw,26rem)]", md: "sm:w-[min(92vw,32rem)]", lg: "sm:w-[min(94vw,42rem)]" };

/**
 * A number that goes up each time `open` becomes true. Use it as a `key` on dialog contents so
 * every opening starts with fresh form state, while closing keeps the content for its exit animation.
 */
export function useOpenKey(open: boolean): number {
  const [state, setState] = useState({ open, key: 0 });
  if (state.open !== open) setState({ open, key: open ? state.key + 1 : state.key });
  return open === state.open ? state.key : state.key + (open ? 1 : 0);
}

/**
 * Accessible dialog: a bottom sheet on phones, a centered card on larger screens.
 * Escape and clicking outside close it; focus stays inside while open.
 */
export function Dialog({ open, onOpenChange, title, description, children, footer, onSubmit, size = "md" }: DialogProps) {
  const inner = (
    <>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-4">{children}</div>
      {footer ? (
        <div className="safe-bottom flex flex-wrap items-center justify-end gap-2 border-t border-line bg-surface px-5 py-3">
          {footer}
        </div>
      ) : (
        <div className="safe-bottom" />
      )}
    </>
  );

  return (
    <RD.Root open={open} onOpenChange={onOpenChange}>
      <RD.Portal>
        <RD.Overlay className="fixed inset-0 z-50 bg-overlay data-[state=closed]:animate-fade-out data-[state=open]:animate-fade-in" />
        <RD.Content
          className={cn(
            "fixed z-50 flex flex-col bg-surface shadow-lifted focus:outline-none",
            "inset-x-0 bottom-0 max-h-[92dvh] rounded-t-3xl data-[state=closed]:animate-sheet-down data-[state=open]:animate-sheet-up",
            "sm:inset-auto sm:top-1/2 sm:left-1/2 sm:max-h-[88dvh] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-3xl",
            "sm:data-[state=closed]:animate-pop-out sm:data-[state=open]:animate-pop-in",
            widths[size],
          )}
        >
          <div className="mx-auto mt-2.5 h-1.5 w-10 shrink-0 rounded-full bg-line-strong sm:hidden" aria-hidden="true" />
          <div className="flex items-start justify-between gap-3 px-5 pt-4 pb-3">
            <div className="min-w-0">
              <RD.Title className="text-lg font-semibold text-ink">{title}</RD.Title>
              {description ? (
                <RD.Description className="mt-0.5 text-sm text-ink-soft">{description}</RD.Description>
              ) : (
                <RD.Description className="sr-only">{typeof title === "string" ? title : "Dialog"}</RD.Description>
              )}
            </div>
            <RD.Close
              className="-mr-2 grid size-10 shrink-0 place-items-center rounded-xl text-ink-soft hover:bg-surface-muted hover:text-ink"
              aria-label="Close"
            >
              <X className="size-5" aria-hidden="true" />
            </RD.Close>
          </div>
          {onSubmit ? (
            <form className="flex min-h-0 flex-1 flex-col" onSubmit={onSubmit} noValidate>
              {inner}
            </form>
          ) : (
            inner
          )}
        </RD.Content>
      </RD.Portal>
    </RD.Root>
  );
}
