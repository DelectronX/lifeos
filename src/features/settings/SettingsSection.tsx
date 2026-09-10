import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { Card } from '@/components/ui/Card';

/** Consistent chrome for every settings section. */
export function SettingsSection({
  title, description, children, className, action,
}: {
  title: string;
  description?: ReactNode;
  children: ReactNode;
  className?: string;
  action?: ReactNode;
}) {
  return (
    <Card className={cn('mb-4', className)}>
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="t-section">{title}</h3>
          {description ? <p className="t-muted mt-0.5">{description}</p> : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      <div className="space-y-3">{children}</div>
    </Card>
  );
}

/** Label + control on one line, stacking on narrow screens. */
export function SettingRow({
  label, hint, children, className,
}: {
  label: ReactNode;
  hint?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col gap-1.5 sm:flex-row sm:items-center sm:justify-between sm:gap-4', className)}>
      <div className="min-w-0 sm:flex-1">
        <div className="text-sm font-medium text-ink">{label}</div>
        {hint ? <div className="t-meta mt-0.5">{hint}</div> : null}
      </div>
      <div className="shrink-0 sm:w-48">{children}</div>
    </div>
  );
}

/** Numeric setting bounded to a sane range so a typo cannot break scheduling. */
export function clampNumber(value: string, min: number, max: number, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

export function minutesToHHMM(minute: number): string {
  const m = Math.max(0, Math.min(1440, Math.round(minute)));
  return `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

export function hhmmToMinutes(value: string, fallback: number): number {
  const [h, m] = value.split(':').map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return fallback;
  return Math.min(1440, Math.max(0, h * 60 + m));
}
