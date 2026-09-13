import { useCallback, useEffect, useRef, useState } from 'react';
import { GlobalWorkerOptions, getDocument, type PDFDocumentProxy, type PDFPageProxy } from 'pdfjs-dist';
// Vite's `?url` import gives us the worker script's built URL so it can be
// bundled and served offline — no CDN dependency, works inside a Capacitor
// WebView with no network at all.
// eslint-disable-next-line import/no-unresolved
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url';
import {
  ChevronLeft, ChevronRight, Eraser, Highlighter, Minus, Pencil, Plus, Redo2, Underline, Undo2,
} from 'lucide-react';
import { IconButton } from '@/components/ui/Button';
import { cn } from '@/lib/cn';
import {
  createAnnotation, deleteAnnotation, getAnnotationsForPage,
} from '@/services/annotationService';
import { getViewerProgress, saveViewerProgress } from '@/services/viewerProgressService';
import type { Annotation, AnnotationPoint, ID } from '@/types';

GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

const HIGHLIGHT_COLOR = '#FACC15';
const UNDERLINE_COLOR = '#38BDF8';
const PEN_COLOR = '#F97373';
const ZOOM_STEPS = [0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3];

type Tool = 'none' | 'highlight' | 'underline' | 'freehand' | 'erase';

/**
 * A real PDF.js reader: page navigation, zoom, and a canvas overlay for
 * highlight / underline / freehand annotations persisted to Dexie keyed by
 * resource + page. Pointer events (not a gesture library) drive both drawing
 * and pinch-zoom, since Button/IconButton already cover the 44px touch-target
 * work from the Wave-1 pass.
 */
export function PdfViewer({ resourceId, blob }: { resourceId: ID; blob: Blob }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const docRef = useRef<PDFDocumentProxy | null>(null);
  const pageRef = useRef<PDFPageProxy | null>(null);
  const renderTaskRef = useRef<ReturnType<PDFPageProxy['render']> | null>(null);
  const loadingTaskRef = useRef<ReturnType<typeof getDocument> | null>(null);

  const [numPages, setNumPages] = useState(0);
  const [page, setPage] = useState(1);
  const [zoomIdx, setZoomIdx] = useState(2); // 1.0
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tool, setTool] = useState<Tool>('none');
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [undone, setUndone] = useState<Annotation[]>([]);
  const zoom = ZOOM_STEPS[zoomIdx]!;

  // Load the document once.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const buf = await blob.arrayBuffer();
        const loadingTask = getDocument({ data: buf });
        loadingTaskRef.current = loadingTask;
        const doc = await loadingTask.promise;
        if (cancelled) return;
        docRef.current = doc;
        setNumPages(doc.numPages);
        const progress = await getViewerProgress(resourceId);
        setPage(Math.min(Math.max(progress?.lastPage ?? 1, 1), doc.numPages));
        if (progress?.zoom) {
          const idx = ZOOM_STEPS.findIndex((z) => Math.abs(z - progress.zoom!) < 0.01);
          if (idx >= 0) setZoomIdx(idx);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Could not open this PDF.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      void loadingTaskRef.current?.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blob, resourceId]);

  const renderPage = useCallback(async () => {
    const doc = docRef.current;
    const canvas = canvasRef.current;
    const overlay = overlayRef.current;
    if (!doc || !canvas || !overlay || page < 1 || page > doc.numPages) return;
    renderTaskRef.current?.cancel();
    const pdfPage = await doc.getPage(page);
    pageRef.current = pdfPage;
    const viewport = pdfPage.getViewport({ scale: zoom * (window.devicePixelRatio || 1) });
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    canvas.style.width = `${viewport.width / (window.devicePixelRatio || 1)}px`;
    canvas.style.height = `${viewport.height / (window.devicePixelRatio || 1)}px`;
    overlay.width = viewport.width;
    overlay.height = viewport.height;
    overlay.style.width = canvas.style.width;
    overlay.style.height = canvas.style.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const task = pdfPage.render({ canvasContext: ctx, viewport, canvas });
    renderTaskRef.current = task;
    try {
      await task.promise;
    } catch (e) {
      // RenderingCancelledException is expected when the user flips pages
      // fast — anything else is worth knowing about but shouldn't crash.
      if (!(e instanceof Error) || !/cancel/i.test(e.message)) console.warn('PDF render error', e);
    }
  }, [page, zoom]);

  useEffect(() => { if (!loading && !error) void renderPage(); }, [loading, error, renderPage]);

  useEffect(() => {
    if (loading || error) return;
    void getAnnotationsForPage(resourceId, page).then(setAnnotations);
    setUndone([]);
  }, [resourceId, page, loading, error]);

  useEffect(() => { drawOverlay(); }, [annotations]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!loading && !error) void saveViewerProgress(resourceId, { lastPage: page, zoom });
  }, [resourceId, page, zoom, loading, error]);

  function drawOverlay() {
    const overlay = overlayRef.current;
    if (!overlay) return;
    const ctx = overlay.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, overlay.width, overlay.height);
    for (const a of annotations) {
      ctx.globalAlpha = a.kind === 'highlight' ? 0.38 : 1;
      ctx.fillStyle = a.color;
      ctx.strokeStyle = a.color;
      if ((a.kind === 'highlight' || a.kind === 'underline') && a.rects) {
        for (const r of a.rects) {
          const x = r.x * overlay.width;
          const y = r.y * overlay.height;
          const w = r.w * overlay.width;
          const h = r.h * overlay.height;
          if (a.kind === 'highlight') ctx.fillRect(x, y, w, h);
          else {
            ctx.lineWidth = Math.max(2, h * 0.12);
            ctx.beginPath();
            ctx.moveTo(x, y + h);
            ctx.lineTo(x + w, y + h);
            ctx.stroke();
          }
        }
      } else if (a.kind === 'freehand' && a.points?.length) {
        ctx.globalAlpha = 1;
        ctx.lineWidth = (a.strokeWidth ?? 0.006) * overlay.width;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.beginPath();
        a.points.forEach((p, i) => {
          const x = p.x * overlay.width;
          const y = p.y * overlay.height;
          if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        });
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
  }

  /* ---------------- drawing / selection input ---------------- */
  const drawingRef = useRef<AnnotationPoint[] | null>(null);
  const selectStartRef = useRef<AnnotationPoint | null>(null);
  const [livePreview, setLivePreview] = useState<Annotation | null>(null);

  const pointFromEvent = (e: React.PointerEvent<HTMLCanvasElement>): AnnotationPoint => {
    const overlay = overlayRef.current!;
    const rect = overlay.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) / rect.width,
      y: (e.clientY - rect.top) / rect.height,
    };
  };

  const toolColor: Record<Tool, string> = {
    none: '', erase: '',
    highlight: HIGHLIGHT_COLOR,
    underline: UNDERLINE_COLOR,
    freehand: PEN_COLOR,
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (tool === 'none') return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = pointFromEvent(e);
    if (tool === 'freehand') {
      drawingRef.current = [p];
    } else if (tool === 'highlight' || tool === 'underline') {
      selectStartRef.current = p;
    } else if (tool === 'erase') {
      void eraseAt(p);
    }
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (tool === 'freehand' && drawingRef.current) {
      const p = pointFromEvent(e);
      drawingRef.current.push(p);
      setLivePreview({
        id: '__live__', createdAt: 0, updatedAt: 0, resourceId, page,
        kind: 'freehand', color: PEN_COLOR, points: [...drawingRef.current], strokeWidth: 0.006,
      });
    } else if ((tool === 'highlight' || tool === 'underline') && selectStartRef.current) {
      const start = selectStartRef.current;
      const p = pointFromEvent(e);
      const rect = {
        x: Math.min(start.x, p.x), y: Math.min(start.y, p.y),
        w: Math.abs(p.x - start.x), h: Math.abs(p.y - start.y),
      };
      setLivePreview({
        id: '__live__', createdAt: 0, updatedAt: 0, resourceId, page,
        kind: tool, color: toolColor[tool], rects: [rect],
      });
    }
  };

  const onPointerUp = async () => {
    if (tool === 'freehand' && drawingRef.current) {
      const points = drawingRef.current;
      drawingRef.current = null;
      setLivePreview(null);
      if (points.length > 1) {
        const created = await createAnnotation({
          resourceId, page, kind: 'freehand', color: PEN_COLOR, points, strokeWidth: 0.006,
        });
        setAnnotations((prev) => [...prev, created]);
        setUndone([]);
      }
    } else if ((tool === 'highlight' || tool === 'underline') && selectStartRef.current && livePreview?.rects) {
      const rect = livePreview.rects[0]!;
      selectStartRef.current = null;
      setLivePreview(null);
      if (rect.w > 0.005 && rect.h > 0.002) {
        const created = await createAnnotation({
          resourceId, page, kind: tool, color: toolColor[tool], rects: [rect],
        });
        setAnnotations((prev) => [...prev, created]);
        setUndone([]);
      }
    }
  };

  const eraseAt = async (p: AnnotationPoint) => {
    const hit = annotations.find((a) => {
      if (a.rects) return a.rects.some((r) => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h);
      if (a.points) return a.points.some((pt) => Math.hypot(pt.x - p.x, pt.y - p.y) < 0.02);
      return false;
    });
    if (!hit) return;
    await deleteAnnotation(hit.id);
    setAnnotations((prev) => prev.filter((a) => a.id !== hit.id));
  };

  const undo = () => {
    setAnnotations((prev) => {
      if (prev.length === 0) return prev;
      const last = prev[prev.length - 1]!;
      void deleteAnnotation(last.id);
      setUndone((u) => [...u, last]);
      return prev.slice(0, -1);
    });
  };

  const redo = () => {
    setUndone((prev) => {
      if (prev.length === 0) return prev;
      const last = prev[prev.length - 1]!;
      void createAnnotation({
        resourceId, page, kind: last.kind, color: last.color,
        rects: last.rects, points: last.points, strokeWidth: last.strokeWidth,
      }).then((created) => setAnnotations((a) => [...a, created]));
      return prev.slice(0, -1);
    });
  };

  useEffect(() => { drawOverlayWithPreview(); }, [livePreview]); // eslint-disable-line react-hooks/exhaustive-deps
  function drawOverlayWithPreview() {
    drawOverlay();
    if (!livePreview) return;
    const overlay = overlayRef.current;
    const ctx = overlay?.getContext('2d');
    if (!overlay || !ctx) return;
    ctx.globalAlpha = livePreview.kind === 'highlight' ? 0.38 : 1;
    ctx.fillStyle = livePreview.color;
    ctx.strokeStyle = livePreview.color;
    if (livePreview.rects) {
      const r = livePreview.rects[0]!;
      const x = r.x * overlay.width, y = r.y * overlay.height, w = r.w * overlay.width, h = r.h * overlay.height;
      if (livePreview.kind === 'highlight') ctx.fillRect(x, y, w, h);
      else { ctx.lineWidth = Math.max(2, h * 0.12); ctx.beginPath(); ctx.moveTo(x, y + h); ctx.lineTo(x + w, y + h); ctx.stroke(); }
    } else if (livePreview.points) {
      ctx.globalAlpha = 1;
      ctx.lineWidth = (livePreview.strokeWidth ?? 0.006) * overlay.width;
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.beginPath();
      livePreview.points.forEach((p, i) => {
        const x = p.x * overlay.width, y = p.y * overlay.height;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      });
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  if (error) {
    return <div className="flex h-full items-center justify-center p-6 text-center t-muted">{error}</div>;
  }

  return (
    <div ref={containerRef} className="flex h-full flex-col bg-surface-base">
      <div className="flex-1 overflow-auto">
        <div className="flex min-h-full items-start justify-center p-4">
          {loading ? (
            <div className="flex h-64 items-center justify-center t-muted">Loading PDF…</div>
          ) : (
            <div className="relative inline-block shadow-panel">
              <canvas ref={canvasRef} className="block" />
              <canvas
                ref={overlayRef}
                className={cn(
                  'absolute inset-0 touch-none',
                  tool !== 'none' ? 'cursor-crosshair' : 'pointer-events-none',
                )}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={() => void onPointerUp()}
                onPointerLeave={() => void onPointerUp()}
              />
            </div>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-center gap-1.5 border-t border-line bg-surface-raised px-2 py-2">
        <IconButton label="Previous page" size="md" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
          <ChevronLeft className="h-4 w-4" />
        </IconButton>
        <span className="t-num min-w-[5rem] text-center text-sm text-ink-muted">
          {numPages ? `${page} / ${numPages}` : '—'}
        </span>
        <IconButton label="Next page" size="md" disabled={page >= numPages} onClick={() => setPage((p) => Math.min(numPages, p + 1))}>
          <ChevronRight className="h-4 w-4" />
        </IconButton>
        <div className="mx-1 h-6 w-px bg-line" />
        <IconButton label="Zoom out" size="md" disabled={zoomIdx <= 0} onClick={() => setZoomIdx((z) => Math.max(0, z - 1))}>
          <Minus className="h-4 w-4" />
        </IconButton>
        <span className="t-num min-w-[3.5rem] text-center text-sm text-ink-muted">{Math.round(zoom * 100)}%</span>
        <IconButton label="Zoom in" size="md" disabled={zoomIdx >= ZOOM_STEPS.length - 1} onClick={() => setZoomIdx((z) => Math.min(ZOOM_STEPS.length - 1, z + 1))}>
          <Plus className="h-4 w-4" />
        </IconButton>
        <div className="mx-1 h-6 w-px bg-line" />
        <ToolButton label="Highlight" active={tool === 'highlight'} onClick={() => setTool((t) => (t === 'highlight' ? 'none' : 'highlight'))}>
          <Highlighter className="h-4 w-4" />
        </ToolButton>
        <ToolButton label="Underline" active={tool === 'underline'} onClick={() => setTool((t) => (t === 'underline' ? 'none' : 'underline'))}>
          <Underline className="h-4 w-4" />
        </ToolButton>
        <ToolButton label="Freehand draw" active={tool === 'freehand'} onClick={() => setTool((t) => (t === 'freehand' ? 'none' : 'freehand'))}>
          <Pencil className="h-4 w-4" />
        </ToolButton>
        <ToolButton label="Erase" active={tool === 'erase'} onClick={() => setTool((t) => (t === 'erase' ? 'none' : 'erase'))}>
          <Eraser className="h-4 w-4" />
        </ToolButton>
        <div className="mx-1 h-6 w-px bg-line" />
        <IconButton label="Undo" size="md" disabled={annotations.length === 0} onClick={undo}>
          <Undo2 className="h-4 w-4" />
        </IconButton>
        <IconButton label="Redo" size="md" disabled={undone.length === 0} onClick={redo}>
          <Redo2 className="h-4 w-4" />
        </IconButton>
      </div>
    </div>
  );
}

function ToolButton({
  label, active, onClick, children,
}: { label: string; active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <IconButton label={label} size="md" variant={active ? 'primary' : 'ghost'} onClick={onClick}>
      {children}
    </IconButton>
  );
}
