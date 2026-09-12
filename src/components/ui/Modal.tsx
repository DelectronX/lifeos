import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { IconButton } from './Button';

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
  sm: 'max-w-sm',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
  xl: 'max-w-4xl',
  full: 'max-w-[min(72rem,calc(100vw-2rem))]',
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
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 sm:p-6">
      <div
        className="fixed inset-0 bg-[rgb(0_0_0/0.55)] animate-in-fade"
        onClick={persistent ? undefined : onClose}
      />
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        className={cn(
          'relative z-10 my-auto w-full rounded-card border border-line bg-surface-raised shadow-pop animate-in-rise focus:outline-none',
          SIZES[size],
        )}
      >
        {(title || description) && (
          <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
            <div className="min-w-0">
              {title ? <h2 className="t-title">{title}</h2> : null}
              {description ? <p className="t-muted mt-1">{description}</p> : null}
            </div>
            <IconButton label="Close" size="sm" onClick={onClose} className="-mr-1 -mt-1">
              <X className="h-4 w-4" />
            </IconButton>
          </div>
        )}
        <div className="px-5 py-4">{children}</div>
        {footer ? (
          <div className="flex items-center justify-end gap-2 border-t border-line bg-surface-sunken/50 px-5 py-3 rounded-b-card">
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
          <button
            type="button"
            onClick={onClose}
            className="h-9 rounded-lg border border-line-strong bg-surface-raised px-3.5 text-sm font-medium text-ink hover:bg-surface-sunken"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => { onConfirm(); onClose(); }}
            className={cn(
              'h-9 rounded-lg px-3.5 text-sm font-medium text-accent-contrast',
              danger ? 'bg-critical hover:bg-critical/90' : 'bg-accent hover:bg-accent/90',
            )}
          >
            {confirmLabel}
          </button>
        </>
      }
    >
      <div className="t-muted">{message}</div>
    </Modal>
  );
}
