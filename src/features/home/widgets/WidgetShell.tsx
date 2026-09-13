import type { ReactNode } from 'react';
import { Card } from '@/components/ui/Card';
import { cn } from '@/lib/cn';

/**
 * Shared widget shell: title + optional trailing slot (settings gear in edit
 * mode) + body. Every widget renders through this so spacing/empty-state
 * treatment stays consistent without each widget re-deriving it.
 */
export function WidgetShell({
  title, trailing, children, className,
}: {
  title: ReactNode;
  trailing?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Card className={cn('flex h-full flex-col', className)}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="t-label">{title}</h3>
        {trailing}
      </div>
      <div className="flex-1">{children}</div>
    </Card>
  );
}

/** Small inline empty-state for use inside a widget body (no card-in-card). */
export function WidgetEmpty({ text }: { text: string }) {
  return <p className="t-meta py-2">{text}</p>;
}
