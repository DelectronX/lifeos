import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Pointer-event drag engine for the timeline.
 *
 * Uses raw pointer events because the timeline needs exact minute maths
 * (pixels -> minutes -> snapped timestamp), a live preview of the dragged
 * geometry, and edge-resize on the same element.
 *
 * Listeners are attached to `window` for the lifetime of a drag rather than to
 * the block element. That matters: the grid hides the block being dragged and
 * draws a ghost instead, so element-bound listeners (or pointer capture on the
 * block) would die the moment React unmounted it and the drag would never
 * commit. Window listeners also keep the drag alive when the pointer leaves the
 * column or the browser window.
 */

export type DragMode = 'move' | 'resize-start' | 'resize-end';

export interface DragState {
  id: string;
  mode: DragMode;
  /** Minute-of-day preview values, already snapped. */
  startMinute: number;
  endMinute: number;
  /** Column index the pointer is currently over (week view); 0 when unused. */
  columnIndex: number;
  /** True once the pointer has moved past the activation threshold. */
  active: boolean;
}

export interface DragOrigin {
  id: string;
  mode: DragMode;
  startMinute: number;
  endMinute: number;
  columnIndex: number;
}

export interface DragCommit {
  id: string;
  mode: DragMode;
  startMinute: number;
  endMinute: number;
  columnIndex: number;
  columnDelta: number;
}

export interface UseTimelineDragOptions {
  /** Pixels per minute of the rendered grid. */
  pixelsPerMinute: number;
  /** Snap step in minutes. */
  snapMinutes: number;
  /** Minimum block length in minutes. */
  minMinutes: number;
  /** First rendered minute-of-day (grid origin). */
  originMinute: number;
  /** Last rendered minute-of-day. */
  endMinute: number;
  /** Column width in px; pass 0 to disable horizontal (day) movement. */
  getColumnWidth?: () => number;
  columnCount?: number;
  /** Pixels the pointer must travel before a drag is considered real. */
  threshold?: number;
  onCommit: (result: DragCommit) => void | Promise<void>;
}

export function useTimelineDrag(options: UseTimelineDragOptions) {
  const [drag, setDrag] = useState<DragState | null>(null);
  /** Stable flag so the listener effect subscribes once per drag, not per move. */
  const [session, setSession] = useState(0);
  const originRef = useRef<DragOrigin | null>(null);
  const startPointRef = useRef<{ x: number; y: number } | null>(null);
  const latestRef = useRef<DragState | null>(null);
  /** Timestamp of the last real drag, so the trailing click can be ignored. */
  const lastDragEndRef = useRef(0);
  const optsRef = useRef(options);
  optsRef.current = options;

  /** True if a drag finished within the last 250ms — used to swallow the click. */
  const justDragged = useCallback(() => Date.now() - lastDragEndRef.current < 250, []);

  const finish = useCallback((commit: boolean) => {
    const origin = originRef.current;
    const latest = latestRef.current;
    originRef.current = null;
    startPointRef.current = null;
    latestRef.current = null;
    setDrag(null);
    setSession(0);
    if (latest?.active) lastDragEndRef.current = Date.now();

    if (!commit || !origin || !latest?.active) return;
    const moved =
      latest.startMinute !== origin.startMinute ||
      latest.endMinute !== origin.endMinute ||
      latest.columnIndex !== origin.columnIndex;
    if (!moved) return;

    void optsRef.current.onCommit({
      id: origin.id,
      mode: origin.mode,
      startMinute: latest.startMinute,
      endMinute: latest.endMinute,
      columnIndex: latest.columnIndex,
      columnDelta: latest.columnIndex - origin.columnIndex,
    });
  }, []);

  const begin = useCallback((e: React.PointerEvent, origin: DragOrigin) => {
    // Only the primary button (or any touch/pen contact) starts a drag.
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    originRef.current = origin;
    startPointRef.current = { x: e.clientX, y: e.clientY };
    const initial: DragState = { ...origin, active: false };
    latestRef.current = initial;
    setDrag(initial);
    setSession((n) => n + 1);
  }, []);

  // Window-level listeners live only while a drag is in flight.
  useEffect(() => {
    if (!session) return;

    const onMove = (e: PointerEvent) => {
      const origin = originRef.current;
      const start = startPointRef.current;
      if (!origin || !start) return;
      const o = optsRef.current;

      const dx = e.clientX - start.x;
      const dy = e.clientY - start.y;
      if (!latestRef.current?.active && Math.abs(dx) <= (o.threshold ?? 4) && Math.abs(dy) <= (o.threshold ?? 4)) {
        return;
      }

      const deltaMinutes = snap(dy / o.pixelsPerMinute, o.snapMinutes);
      const colWidth = o.getColumnWidth?.() ?? 0;
      const columnDelta = colWidth > 0 ? Math.round(dx / colWidth) : 0;
      const columnIndex = clampInt(origin.columnIndex + columnDelta, 0, Math.max(0, (o.columnCount ?? 1) - 1));

      let startMinute = origin.startMinute;
      let endMinute = origin.endMinute;

      if (origin.mode === 'move') {
        const length = endMinute - startMinute;
        startMinute = clamp(origin.startMinute + deltaMinutes, o.originMinute, o.endMinute - length);
        endMinute = startMinute + length;
      } else if (origin.mode === 'resize-start') {
        startMinute = clamp(origin.startMinute + deltaMinutes, o.originMinute, origin.endMinute - o.minMinutes);
      } else {
        endMinute = clamp(origin.endMinute + deltaMinutes, origin.startMinute + o.minMinutes, o.endMinute);
      }

      const next: DragState = { id: origin.id, mode: origin.mode, startMinute, endMinute, columnIndex, active: true };
      latestRef.current = next;
      setDrag(next);
    };

    const onUp = () => finish(true);
    const onCancel = () => finish(false);
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') finish(false); };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    window.addEventListener('keydown', onKey);
    // Suppress text selection and native scrolling while dragging.
    const prevSelect = document.body.style.userSelect;
    const prevTouch = document.body.style.touchAction;
    document.body.style.userSelect = 'none';
    document.body.style.touchAction = 'none';

    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      window.removeEventListener('keydown', onKey);
      document.body.style.userSelect = prevSelect;
      document.body.style.touchAction = prevTouch;
    };
  }, [session, finish]);

  return { drag, begin, justDragged, isDragging: !!drag?.active };
}

function snap(value: number, step: number): number {
  return Math.round(value / step) * step;
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

function clampInt(v: number, min: number, max: number): number {
  return Math.round(clamp(v, min, max));
}
