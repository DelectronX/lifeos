import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Button, IconButton } from './Button';

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'full';
  /** Disables backdrop/Escape dismissal for destructive confirmations. */
  persistent?: boolean;
}

const SIZES = {
  sm: 'sm:max-w-sm',
  md: 'sm:max-w-lg',
  lg: 'sm:max-w-2xl',
  xl: 'sm:max-w-4xl',
  full: 'sm:max-w-[min(72rem,calc(100vw-3rem))]',
};

export function Modal({ open, onClose, title, description, children, footer, size = 'md', persistent }: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !persistent) onClose();
    };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    panelRef.current?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose, persistent]);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-6">
      <div
        className="fixed inset-0 bg-black/60 animate-in-fade [:root:not(.dark)_&]:bg-black/30"
        onClick={persistent ? undefined : onClose}
      />
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        className={cn(
          // Phone: bottom sheet with a grabber. iPad/desktop: centred sheet.
          'panel relative z-10 flex max-h-[calc(100dvh-2.5rem)] w-full min-w-0 flex-col overflow-hidden',
          'rounded-t-[20px] animate-in-sheet focus:outline-none',
          'sm:max-h-[calc(100dvh-4rem)] sm:rounded-[18px] sm:animate-in-pop',
          SIZES[size],
        )}
      >
        <div className="mx-auto mt-2 h-1.5 w-9 shrink-0 rounded-full bg-line-strong sm:hidden" aria-hidden />
        {(title || description) && (
          <div className="flex shrink-0 items-start justify-between gap-4 px-6 pb-2 pt-5">
            <div className="min-w-0">
              {title ? <h2 className="t-title3">{title}</h2> : null}
              {description ? <p className="t-meta mt-1">{description}</p> : null}
            </div>
            <IconButton label="Close" size="sm" variant="secondary" onClick={onClose} className="-mr-1 shrink-0 text-ink-muted">
              <X className="h-4 w-4" strokeWidth={2.5} />
            </IconButton>
          </div>
        )}
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 py-4">{children}</div>
        {footer ? (
          <div className="flex shrink-0 items-center justify-end gap-2 border-t border-line-faint px-6 py-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:pb-4">
            {footer}
          </div>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}

export function ConfirmDialog({
  open, onClose, onConfirm, title, message, confirmLabel = 'Confirm', danger,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size="sm"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            className={danger ? '!bg-critical' : undefined}
            onClick={() => { onConfirm(); onClose(); }}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="t-muted">{message}</div>
    </Modal>
  );
}
