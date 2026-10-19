import { lazy, Suspense, useLayoutEffect, useRef, useState } from "react";
import { Skeleton } from "@/components/ui/misc";
import { cn } from "@/lib/cn";

// The chart library is large; load it after the rest of the page.
const WealthDonut = lazy(() => import("./WealthDonut").then((m) => ({ default: m.WealthDonut })));

/**
 * The chart mounts only while its box has a width. A hidden chart (e.g. `hidden sm:block` on phones)
 * measures 0×0, which the chart library warns about, and would load that library for nothing.
 */
export function LazyWealthDonut({ className }: { className?: string }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useLayoutEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const measure = () => setVisible(box.offsetWidth > 0);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={boxRef} className={cn("mx-auto aspect-square w-full", className)}>
      {visible ? (
        <Suspense fallback={<Skeleton className="size-full rounded-full" />}>
          <WealthDonut />
        </Suspense>
      ) : null}
    </div>
  );
}
