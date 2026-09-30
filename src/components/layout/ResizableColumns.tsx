import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";

const STORAGE_KEY = "aura.columnRatio";
const MIN = 30;
const MAX = 70;

function readRatio(): number {
  try {
    const n = Number(localStorage.getItem(STORAGE_KEY));
    return n >= MIN && n <= MAX ? n : 45;
  } catch {
    return 45;
  }
}

/**
 * Two columns with a draggable divider on large desktops (≥1280px), remembered per device.
 * Below that the columns stack (tablet portrait/phone) or split evenly (tablet landscape).
 */
export function ResizableColumns({ left, right, leftClassName }: { left: ReactNode; right: ReactNode; leftClassName?: string }) {
  const [ratio, setRatio] = useState(readRatio);
  const container = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, String(Math.round(ratio)));
    } catch {
      // not persisted; fine
    }
  }, [ratio]);

  useEffect(() => {
    const move = (e: PointerEvent) => {
      if (!dragging.current || !container.current) return;
      const rect = container.current.getBoundingClientRect();
      const pct = ((e.clientX - rect.left) / rect.width) * 100;
      setRatio(Math.min(MAX, Math.max(MIN, pct)));
    };
    const up = () => {
      dragging.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, []);

  const onKey = (e: KeyboardEvent) => {
    if (e.key === "ArrowLeft") setRatio((r) => Math.max(MIN, r - 2));
    if (e.key === "ArrowRight") setRatio((r) => Math.min(MAX, r + 2));
  };

  return (
    <div
      ref={container}
      className="grid grid-cols-1 gap-5 lg:grid-cols-2 xl:grid-cols-[var(--left)_1.25rem_minmax(0,1fr)] xl:gap-0"
      style={{ "--left": `minmax(0, ${ratio}%)` } as CSSProperties}
    >
      <div className={`${leftClassName ?? "flex"} min-w-0 flex-col gap-5`}>{left}</div>
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize columns"
        aria-valuemin={MIN}
        aria-valuemax={MAX}
        aria-valuenow={Math.round(ratio)}
        tabIndex={0}
        onKeyDown={onKey}
        onPointerDown={(e) => {
          e.preventDefault();
          dragging.current = true;
          document.body.style.cursor = "col-resize";
          document.body.style.userSelect = "none";
        }}
        onDoubleClick={() => setRatio(45)}
        className="group hidden cursor-col-resize justify-center xl:flex"
        title="Drag to resize · double-click to reset"
      >
        <span className="h-full w-1 rounded-full bg-transparent transition group-hover:bg-line-strong group-focus-visible:bg-focus" />
      </div>
      <div className="flex min-w-0 flex-col gap-5">{right}</div>
    </div>
  );
}
