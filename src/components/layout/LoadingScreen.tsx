import type { ReactNode } from 'react';

/**
 * Boot / loading screen: the Spiral Galaxy piece with a real heading next
 * to it (the art is decoration). Same composition as the static splash in
 * index.html, so the hand-off from HTML to React does not jump.
 */
export function LoadingScreen({ message = 'Starting LifeOS', children }: { message?: string; children?: ReactNode }) {
  return (
    <div className="lo-boot" role="status" aria-live="polite">
      <div className="lo-boot-art" aria-hidden>
        <ascii-art piece="spiral-galaxy" look="dots" size="7" />
      </div>
      <h1 className="lo-boot-title">LifeOS</h1>
      <p className="lo-boot-msg">{message}<span className="lo-boot-dots" aria-hidden /></p>
      {children}
    </div>
  );
}
