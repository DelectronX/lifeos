import { useState, type ReactNode } from 'react';
import { ArrowLeft, ArrowRight, Eye, EyeOff, GripVertical, Maximize2, X } from 'lucide-react';
import { cn } from '@/lib/cn';

/**
 * Wraps one widget instance with edit-mode chrome: drag handle (HTML5 DnD),
 * keyboard-accessible move earlier/later, size cycle, hide/show and remove.
 * Hidden widgets render only in edit mode, dimmed, with a Show button.
 */
export function WidgetSlot({
  editing, dragging, isOver, hidden, label, onRemove, onHide, onResize, onMove, onDragStart, onDragEnd, onDragOver, onDrop, children, sizeClass,
}: {
  editing: boolean;
  dragging: boolean;
  isOver: boolean;
  hidden?: boolean;
  label: string;
  onRemove: () => void;
  onHide: (hidden: boolean) => void;
  onResize: () => void;
  onMove: (delta: -1 | 1) => void;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: () => void;
  children: ReactNode;
  sizeClass: string;
}) {
  const btn = 'grid h-7 w-7 place-items-center rounded-full text-ink-muted transition-colors hover:bg-ink/10 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60';
  return (
    <div
      className={cn(
        sizeClass,
        'relative min-w-0 transition-[opacity,transform] duration-base',
        dragging && 'scale-[0.98] opacity-40',
        isOver && 'rounded-[var(--r-xl)] outline outline-2 outline-offset-2 outline-accent/60',
        hidden && 'opacity-45',
      )}
      draggable={editing}
      onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; onDragStart(); }}
      onDragEnd={onDragEnd}
      onDragOver={(e) => { if (editing) { e.preventDefault(); onDragOver(e); } }}
      onDrop={(e) => { if (editing) { e.preventDefault(); onDrop(); } }}
    >
      {editing ? (
        <div className="panel absolute -top-3 right-2 z-10 flex items-center gap-0.5 rounded-full p-0.5 animate-in-pop" role="toolbar" aria-label={`${label} widget`}>
          <span className={cn(btn, 'cursor-grab')} aria-hidden title="Drag to reorder"><GripVertical className="h-3.5 w-3.5" /></span>
          <button type="button" className={btn} aria-label={`Move ${label} earlier`} title="Move earlier" onClick={() => onMove(-1)}><ArrowLeft className="h-3.5 w-3.5" /></button>
          <button type="button" className={btn} aria-label={`Move ${label} later`} title="Move later" onClick={() => onMove(1)}><ArrowRight className="h-3.5 w-3.5" /></button>
          <button type="button" className={btn} aria-label={`Resize ${label}`} title="Change size" onClick={onResize}><Maximize2 className="h-3.5 w-3.5" /></button>
          <button type="button" className={btn} aria-label={hidden ? `Show ${label}` : `Hide ${label}`} title={hidden ? 'Show' : 'Hide'} onClick={() => onHide(!hidden)}>
            {hidden ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
          </button>
          <button type="button" className={cn(btn, 'hover:bg-critical/15 hover:text-critical')} aria-label={`Remove ${label}`} title="Remove" onClick={onRemove}><X className="h-3.5 w-3.5" /></button>
        </div>
      ) : null}
      <div className={cn('h-full', editing && 'pointer-events-none select-none')}>{children}</div>
    </div>
  );
}

/** Local drag-reorder state, kept in HomePage but factored for clarity. */
export function useDragReorder() {
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  return { draggedId, setDraggedId, overId, setOverId };
}
