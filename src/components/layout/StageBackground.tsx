import { memo, useEffect, useReducer, useRef } from 'react';
import { useLiveSettings } from '@/state/useLiveData';
import { normaliseBackground } from '@/lib/uiMode';
import { useMediaQuery } from '@/lib/platform';

/** The piece's grid (cols × rows), the font size it renders at, glyph width ratio. */
const COLS = 104, ROWS = 40, PX = 9, CELL_W = 0.6;
const BASE_W = Math.ceil(COLS * PX * CELL_W);
const BASE_H = Math.ceil(ROWS * PX * CELL_W * 2); // cell aspect ≈ 1:2

/**
 * StageBackground — the "Spiral Galaxy" ASCII piece (ASCII Magic, MIT,
 * self-hosted in /public/ascii) behind the content layer.
 *
 * Performance contract:
 *  - the piece always renders the same 104×40 canvas at a small font; the
 *    cover size comes from one GPU `transform: scale`, so cost is constant
 *    whatever the window size;
 *  - the player pauses itself off-screen; this component also unmounts the
 *    element while the document is hidden, so a background tab costs zero;
 *  - Reduce Motion (system or Settings) and the "still" option render one
 *    frame and stop.
 * Decoration only (aria-hidden); every page carries its own real heading.
 */
export const StageBackground = memo(function StageBackground() {
  const settings = useLiveSettings();
  const mode = normaliseBackground(settings?.appearance?.background);
  const systemReduce = useMediaQuery('(prefers-reduced-motion: reduce)');
  const still = mode === 'still' || systemReduce || !!settings?.appearance?.reduceMotion;
  const layer = useRef<HTMLDivElement>(null);
  const hidden = useDocumentHidden();
  useAsciiInteractionPause();

  useEffect(() => {
    const el = layer.current;
    if (!el) return;
    const fit = () => {
      const scale = Math.max(window.innerWidth / BASE_W, window.innerHeight / BASE_H) * 1.08;
      el.style.setProperty('--galaxy-scale', scale.toFixed(3));
    };
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, [mode, hidden]);

  return (
    <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden" aria-hidden>
      <div className="ambient-stage absolute inset-0" />
      {mode !== 'off' && !hidden ? (
        <div className="galaxy-mask absolute inset-0">
          <div ref={layer} className="galaxy-layer" style={{ ['--galaxy-w' as string]: `${BASE_W}px`, ['--galaxy-h' as string]: `${BASE_H}px` }}>
            <ascii-art piece="spiral-galaxy" look="dots" size={PX} speed="0.6" fps="6" {...(still ? { still: '' } : {})} />
          </div>
        </div>
      ) : null}
      <div className="content-veil absolute inset-0" />
    </div>
  );
});

/**
 * Pauses every ASCII player while the user interacts (scroll, pointer drag,
 * wheel) and while any modal/overlay is open, resuming 350 ms after the last
 * interaction. One passive listener set for the whole app.
 */
export function useAsciiInteractionPause(): void {
  useEffect(() => {
    const root = document.documentElement;
    let t = 0;
    const pause = () => {
      root.setAttribute('data-ascii-paused', '');
      window.clearTimeout(t);
      t = window.setTimeout(() => { if (!document.querySelector('[aria-modal="true"]')) root.removeAttribute('data-ascii-paused'); }, 350);
    };
    const opts = { passive: true, capture: true } as const;
    window.addEventListener('scroll', pause, opts);
    window.addEventListener('wheel', pause, opts);
    window.addEventListener('touchmove', pause, opts);
    const onMove = (e: PointerEvent) => { if (e.buttons) pause(); };
    window.addEventListener('pointermove', onMove, opts);
    // Overlays: pause while any modal dialog is in the DOM.
    const mo = new MutationObserver(() => {
      if (document.querySelector('[aria-modal="true"]')) root.setAttribute('data-ascii-paused', '');
      else if (!t) root.removeAttribute('data-ascii-paused');
    });
    mo.observe(document.body, { childList: true });
    return () => {
      window.clearTimeout(t);
      window.removeEventListener('scroll', pause, opts);
      window.removeEventListener('wheel', pause, opts);
      window.removeEventListener('touchmove', pause, opts);
      window.removeEventListener('pointermove', onMove, opts);
      mo.disconnect();
      root.removeAttribute('data-ascii-paused');
    };
  }, []);
}

function useDocumentHidden(): boolean {
  const hiddenRef = useRef(typeof document !== 'undefined' && document.visibilityState === 'hidden');
  const [, force] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    const on = () => {
      const h = document.visibilityState === 'hidden';
      if (h !== hiddenRef.current) { hiddenRef.current = h; force(); }
    };
    document.addEventListener('visibilitychange', on);
    return () => document.removeEventListener('visibilitychange', on);
  }, []);
  return hiddenRef.current;
}
