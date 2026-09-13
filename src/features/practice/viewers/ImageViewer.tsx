import { useRef, useState } from 'react';
import { RotateCcw, ZoomIn, ZoomOut } from 'lucide-react';
import { IconButton } from '@/components/ui/Button';

/** Two-finger pinch state tracked by pointer id -> last point. */
type PointerMap = Map<number, { x: number; y: number }>;

/**
 * Simple pinch-zoom/pan image viewer. Deliberately plain CSS-transform
 * pointer-event math — an image doesn't need a gesture library.
 */
export function ImageViewer({ src, alt }: { src: string; alt: string }) {
  const [scale, setScale] = useState(1);
  const [translate, setTranslate] = useState({ x: 0, y: 0 });
  const pointers = useRef<PointerMap>(new Map());
  const lastDist = useRef<number | null>(null);
  const dragStart = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null);

  const clampScale = (s: number) => Math.min(6, Math.max(1, s));

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 1) {
      dragStart.current = { x: e.clientX, y: e.clientY, tx: translate.x, ty: translate.y };
    } else {
      lastDist.current = null;
    }
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      const dist = Math.hypot(a!.x - b!.x, a!.y - b!.y);
      if (lastDist.current !== null) {
        const delta = dist / lastDist.current;
        setScale((s) => clampScale(s * delta));
      }
      lastDist.current = dist;
    } else if (pointers.current.size === 1 && dragStart.current && scale > 1) {
      const dx = e.clientX - dragStart.current.x;
      const dy = e.clientY - dragStart.current.y;
      setTranslate({ x: dragStart.current.tx + dx, y: dragStart.current.ty + dy });
    }
  };

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) lastDist.current = null;
    if (pointers.current.size === 0) dragStart.current = null;
  };

  const zoomBy = (factor: number) => setScale((s) => clampScale(s * factor));
  const reset = () => { setScale(1); setTranslate({ x: 0, y: 0 }); };

  return (
    <div className="flex h-full flex-col bg-black">
      <div
        className="relative flex-1 touch-none overflow-hidden"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onWheel={(e) => { e.preventDefault(); zoomBy(e.deltaY < 0 ? 1.1 : 1 / 1.1); }}
      >
        <img
          src={src}
          alt={alt}
          draggable={false}
          className="absolute left-1/2 top-1/2 max-h-none max-w-none select-none"
          style={{
            transform: `translate(-50%, -50%) translate(${translate.x}px, ${translate.y}px) scale(${scale})`,
            transition: pointers.current.size ? 'none' : 'transform 120ms ease-out',
          }}
        />
      </div>
      <div className="flex items-center justify-center gap-1.5 border-t border-line bg-surface-raised px-2 py-2">
        <IconButton label="Zoom out" size="md" onClick={() => zoomBy(1 / 1.3)}>
          <ZoomOut className="h-4 w-4" />
        </IconButton>
        <span className="t-num min-w-[3.5rem] text-center text-sm text-ink-muted">{Math.round(scale * 100)}%</span>
        <IconButton label="Zoom in" size="md" onClick={() => zoomBy(1.3)}>
          <ZoomIn className="h-4 w-4" />
        </IconButton>
        <IconButton label="Reset zoom" size="md" onClick={reset}>
          <RotateCcw className="h-4 w-4" />
        </IconButton>
      </div>
    </div>
  );
}
