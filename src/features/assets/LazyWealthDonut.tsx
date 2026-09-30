import { lazy, Suspense } from "react";
import { Skeleton } from "@/components/ui/misc";

// The chart library is large; load it after the rest of the page.
const WealthDonut = lazy(() => import("./WealthDonut").then((m) => ({ default: m.WealthDonut })));

export function LazyWealthDonut({ size = 200 }: { size?: number }) {
  return (
    <Suspense fallback={<Skeleton className="mx-auto rounded-full" style={{ width: size, height: size }} />}>
      <WealthDonut size={size} />
    </Suspense>
  );
}
