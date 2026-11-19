import { cn } from '@/lib/cn';

/**
 * The LifeOS mark: a day dial — a ring for the 24 hours with today's elapsed
 * arc in the accent and a dot for "now". It echoes the Day Ribbon on Home,
 * so the brand is the product's own idea, not a letter in a square.
 */
export function BrandMark({ className, progress }: { className?: string; progress?: number }) {
  const now = new Date();
  const p = progress ?? (now.getHours() * 60 + now.getMinutes()) / 1440;
  const r = 9;
  const c = 2 * Math.PI * r;
  const angle = p * 2 * Math.PI - Math.PI / 2;
  return (
    <svg viewBox="0 0 24 24" className={cn('h-7 w-7', className)} aria-hidden>
      <rect x="0" y="0" width="24" height="24" rx="7" fill="rgb(var(--c-surface-sunken))" />
      <circle cx="12" cy="12" r={r} fill="none" stroke="rgb(var(--c-ink) / 0.14)" strokeWidth="2.2" />
      <circle
        cx="12" cy="12" r={r} fill="none" stroke="rgb(var(--c-accent))" strokeWidth="2.2" strokeLinecap="round"
        strokeDasharray={c} strokeDashoffset={c * (1 - p)} transform="rotate(-90 12 12)"
      />
      <circle cx={12 + r * Math.cos(angle)} cy={12 + r * Math.sin(angle)} r="2.1" fill="rgb(var(--c-ink))" />
    </svg>
  );
}
