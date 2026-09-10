import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/Button';
import { MISTAKE_LABELS, MISTAKE_TYPES } from '@/engines/paperAnalytics';
import type { MistakeType } from '@/types';

/**
 * Mistake classification picker. Available in the runner right after marking a
 * question incorrect, and again during review — the same component both times,
 * so a classification is always editable.
 */
export function MistakePicker({
  value, onChange, size = 'md', className,
}: {
  value: MistakeType | null;
  onChange: (value: MistakeType | null) => void;
  size?: 'sm' | 'md';
  className?: string;
}) {
  return (
    <div className={cn('flex flex-wrap gap-1.5', className)}>
      {MISTAKE_TYPES.map((type) => (
        <Button
          key={type}
          size={size === 'sm' ? 'xs' : 'sm'}
          variant={value === type ? 'primary' : 'subtle'}
          onClick={() => onChange(value === type ? null : type)}
        >
          {MISTAKE_LABELS[type]}
        </Button>
      ))}
    </div>
  );
}
