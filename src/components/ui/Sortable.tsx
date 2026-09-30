import {
  DndContext,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";
import { useState, type CSSProperties, type ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * Drag-to-reorder list. Mouse: drag the handle. Touch: long-press the handle.
 * Keyboard: focus the handle, press Space, move with the arrow keys, Space to drop.
 */
export function SortableList({ ids, onReorder, children }: { ids: string[]; onReorder: (ids: string[]) => void; children: ReactNode }) {
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const from = ids.indexOf(String(active.id));
    const to = ids.indexOf(String(over.id));
    if (from < 0 || to < 0) return;
    onReorder(arrayMove(ids, from, to));
  };
  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        {children}
      </SortableContext>
    </DndContext>
  );
}

export function useSortableItem(id: string) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    position: "relative",
    zIndex: isDragging ? 10 : undefined,
  };
  return { setNodeRef, style, isDragging, handleProps: { ...attributes, ...listeners } };
}

export function DragHandle({ label, className, ...props }: { label: string; className?: string } & Record<string, unknown>) {
  return (
    <button
      type="button"
      className={cn(
        "grid size-8 shrink-0 cursor-grab touch-none place-items-center rounded-lg text-ink-faint hover:bg-surface-muted hover:text-ink-soft active:cursor-grabbing",
        className,
      )}
      aria-label={label}
      {...props}
    >
      <GripVertical className="size-4" aria-hidden="true" />
    </button>
  );
}

/** Keeps a local copy of an ordered id list so a drop shows immediately while it saves. */
export function useLocalOrder(sourceIds: string[]): [string[], (ids: string[]) => void] {
  const signature = sourceIds.join("|");
  const [state, setState] = useState<{ signature: string; ids: string[] }>({ signature, ids: sourceIds });
  if (state.signature !== signature) {
    setState({ signature, ids: sourceIds });
  }
  return [state.signature === signature ? state.ids : sourceIds, (ids) => setState({ signature, ids })];
}
