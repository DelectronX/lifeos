import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Check, ChevronRight, Info, X, XCircle } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { cn } from '@/lib/cn';
import { useToastStore, type Toast, type ToastTone } from '@/state/toastStore';

const ICONS: Record<ToastTone, typeof Info> = { default: Info, success: Check, warning: AlertTriangle, error: XCircle };
const WELL: Record<ToastTone, string> = {
  default: 'bg-surface-sunken text-ink-muted',
  success: 'bg-positive text-white',
  warning: 'bg-caution text-white',
  error: 'bg-critical text-white',
};

/**
 * Floating notifications. Glass banners drop from beneath the notch on a
 * spring and stack like iOS notification groups: the newest sits in front,
 * older ones tuck behind it, scaled down. Hover expands the stack. Each
 * banner shows a countdown hairline, pauses while hovered, and can be
 * flicked upward to dismiss.
 */
export function Toaster() {
  const toasts = useToastStore((s) => s.toasts);
  const [hover, setHover] = useState(false);
  const visible = toasts.slice(-4).reverse(); // newest first

  if (!visible.length) return null;
  return (
    <div
      className="pointer-events-none fixed left-1/2 top-[calc(max(0.5rem,env(safe-area-inset-top))+3.5rem)] z-[60] w-[min(26rem,calc(100vw-1.5rem))] -translate-x-1/2"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      role="region"
      aria-label="Notifications"
    >
      <div className="relative">
        {visible.map((t, i) => (
          <Banner key={t.id} toast={t} index={i} expanded={hover || visible.length === 1} paused={hover} />
        ))}
      </div>
    </div>
  );
}

function Banner({ toast: t, index, expanded, paused }: { toast: Toast; index: number; expanded: boolean; paused: boolean }) {
  const dismiss = useToastStore((s) => s.dismiss);
  const [leaving, setLeaving] = useState(false);
  const [drag, setDrag] = useState(0);
  const start = useRef<number | null>(null);
  const Icon = ICONS[t.tone];
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const link = t.link && t.link !== pathname ? t.link : undefined;

  const close = () => { setLeaving(true); window.setTimeout(() => dismiss(t.id), 240); };

  // Own the timer here so it can pause on hover (the store timer is a fallback).
  const remaining = useRef(t.durationMs);
  const since = useRef(Date.now());
  useEffect(() => {
    if (t.durationMs <= 0) return;
    if (paused) { remaining.current -= Date.now() - since.current; return; }
    since.current = Date.now();
    const id = window.setTimeout(close, Math.max(0, remaining.current - 260));
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paused]);

  const stacked = !expanded && index > 0;
  const y = expanded ? index * 84 : index * 10;
  const scale = stacked ? 1 - index * 0.05 : 1;

  return (
    <div
      role="status"
      className="pointer-events-auto absolute inset-x-0 top-0"
      style={{
        transform: `translateY(${y + Math.min(0, drag)}px) scale(${scale})`,
        transformOrigin: 'top center',
        zIndex: 10 - index,
        opacity: stacked && index > 2 ? 0 : 1,
        transition: start.current === null ? 'transform 480ms cubic-bezier(0.32,0.72,0,1), opacity 300ms ease' : 'none',
      }}
      onPointerDown={(e) => { start.current = e.clientY; (e.target as HTMLElement).setPointerCapture?.(e.pointerId); }}
      onPointerMove={(e) => { if (start.current !== null) setDrag(e.clientY - start.current); }}
      onPointerUp={() => { const d = drag; start.current = null; setDrag(0); if (d < -36) close(); }}
      onPointerCancel={() => { start.current = null; setDrag(0); }}
    >
      <div className={cn('glass overflow-hidden rounded-[22px]', leaving ? 'toast-out' : 'toast-in')}>
        <div className={cn('flex items-start gap-3 py-3 pl-3 pr-2.5 transition-opacity', stacked && 'opacity-0')}>
          <span className={cn('mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full', WELL[t.tone])}>
            <Icon className="h-4 w-4" strokeWidth={t.tone === 'success' ? 3 : 2.25} />
          </span>
          <div
            className={cn('min-w-0 flex-1 py-0.5', link && 'cursor-pointer')}
            onClick={link ? () => { if (Math.abs(drag) < 4) { navigate(link); close(); } } : undefined}
          >
            <div className="flex items-center gap-1 text-[0.9375rem] font-semibold leading-snug tracking-[-0.01em] text-ink">
              <span className="min-w-0">{t.title}</span>
              {link ? <ChevronRight className="h-3.5 w-3.5 shrink-0 text-ink-faint" /> : null}
            </div>
            {t.description ? <div className="mt-0.5 line-clamp-3 whitespace-pre-line text-[0.8125rem] leading-snug text-ink-muted">{t.description}</div> : null}
          </div>
          {t.action ? (
            <button type="button" onClick={() => { void t.action?.onClick(); close(); }}
              className="pressable mt-0.5 h-8 shrink-0 rounded-full bg-accent px-3.5 text-[0.8125rem] font-semibold text-accent-contrast hover:brightness-110">
              {t.action.label}
            </button>
          ) : null}
          <button type="button" aria-label="Dismiss" onClick={close}
            className="touch-hit mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full text-ink-faint hover:bg-white/10 hover:text-ink">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
        {t.durationMs > 0 && index === 0 ? (
          <div className="h-[2px] w-full bg-white/5">
            <div className="h-full origin-left bg-ink/30"
              style={{ animation: `lo-shrink ${t.durationMs}ms linear forwards`, animationPlayState: paused ? 'paused' : 'running' }} />
          </div>
        ) : null}
      </div>
    </div>
  );
}
