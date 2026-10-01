import { lazy, Suspense } from "react";
import { Skeleton } from "@/components/ui/misc";
import { cn } from "@/lib/cn";

// The chart library is large; load it after the rest of the page.
const WealthDonut = lazy(() => import("./WealthDonut").then((m) => ({ default: m.WealthDonut })));

export function LazyWealthDonut({ className }: { className?: string }) {
  return (
    <Suspense fallback={<Skeleton className={cn("mx-auto aspect-square w-full rounded-full", className)} />}>
      <WealthDonut className={className} />
    </Suspense>
  );
}
