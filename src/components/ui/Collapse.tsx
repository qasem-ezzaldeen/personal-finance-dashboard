import { useEffect, useState, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { useMotionScale } from "@/lib/motion";
import { useOpenKey } from "./Dialog";

/**
 * Animates open/closed by height (grid-rows 0fr ⇄ 1fr) with a fade. Collapsed content is `inert`,
 * so it can't be tabbed to or read out. Overflow is clipped only while animating, so focus rings
 * and drag shadows aren't cut off once it's open.
 */
export function Collapse({ open, id, children, className }: { open: boolean; id?: string; children: ReactNode; className?: string }) {
  const openKey = useOpenKey(open);
  const [settledKey, setSettledKey] = useState(open ? openKey : -1);
  const motion = useMotionScale();

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => setSettledKey(openKey), 240 * motion + 40);
    return () => window.clearTimeout(timer);
  }, [open, openKey, motion]);

  const clip = !open || settledKey !== openKey;
  return (
    <div
      id={id}
      className={cn("grid grid-cols-1", className)}
      style={{
        gridTemplateRows: open ? "1fr" : "0fr",
        transition: "grid-template-rows var(--duration-base) var(--ease-out-soft)",
      }}
      inert={!open}
    >
      <div
        className={cn("min-h-0 min-w-0", clip && "overflow-hidden")}
        style={{ opacity: open ? 1 : 0, transition: "opacity var(--duration-base) var(--ease-out-soft)" }}
      >
        {children}
      </div>
    </div>
  );
}
