import { useState, type ReactNode } from 'react';
import { GripVertical, X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { IconButton } from '@/components/ui/Button';

/**
 * Wraps one widget instance with edit-mode chrome: a drag handle, a remove
 * button, and drop-target behaviour for reordering. Uses plain HTML5
 * drag-and-drop (no extra dependency) — consistent with the rest of the app
 * preferring small hand-rolled interactions over a DnD library for a single
 * reorderable list.
 */
export function WidgetSlot({
  editing, dragging, isOver, onRemove, onDragStart, onDragEnd, onDragOver, onDrop, children, sizeClass,
}: {
  editing: boolean;
  dragging: boolean;
  isOver: boolean;
  onRemove: () => void;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: () => void;
  children: ReactNode;
  sizeClass: string;
}) {
  return (
    <div
      className={cn(
        sizeClass,
        'relative transition-opacity',
        dragging && 'opacity-40',
        isOver && 'outline outline-2 outline-accent/50 rounded-card',
      )}
      draggable={editing}
      onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; onDragStart(); }}
      onDragEnd={onDragEnd}
      onDragOver={(e) => { if (editing) { e.preventDefault(); onDragOver(e); } }}
      onDrop={(e) => { if (editing) { e.preventDefault(); onDrop(); } }}
    >
      {editing ? (
        <div className="absolute right-2 top-2 z-10 flex items-center gap-1">
          <span className="flex h-6 w-6 cursor-grab items-center justify-center rounded-md bg-surface-overlay text-ink-faint">
            <GripVertical className="h-3.5 w-3.5" />
          </span>
          <IconButton label="Remove widget" size="xs" variant="secondary" onClick={onRemove}>
            <X className="h-3.5 w-3.5" />
          </IconButton>
        </div>
      ) : null}
      {children}
    </div>
  );
}

/** Local drag-reorder state, kept in HomePage but factored for clarity. */
export function useDragReorder() {
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  return { draggedId, setDraggedId, overId, setOverId };
}
