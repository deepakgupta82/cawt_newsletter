import { useEffect } from 'react';
import { Button } from './ui';

interface Props {
  open: boolean;
  title: string;
  body: string;
  confirmLabel: string;
  tone?: 'primary' | 'danger';
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * An in-app confirmation for the few actions that cannot be undone.
 *
 * The browser's own confirm() was doing this job, which looks like a security
 * warning rather than part of the product and gives no room to say what will
 * actually happen. Sending to a real distribution list deserves a sentence
 * naming the number of people it reaches.
 */
export function ConfirmDialog({ open, title, body, confirmLabel, tone = 'primary', busy, onConfirm, onCancel }: Props) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
      <div className="absolute inset-0 bg-stone-900/40" onClick={onCancel} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="relative w-full max-w-md rounded-2xl border border-stone-200 bg-white p-6 shadow-xl"
      >
        <h2 className="text-[16px] font-semibold text-stone-900">{title}</h2>
        <p className="mt-2 text-[13.5px] leading-relaxed text-stone-600">{body}</p>
        <div className="mt-5 flex justify-end gap-2">
          <Button onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={onConfirm}
            loading={busy}
            className={tone === 'danger' ? 'bg-red-700 hover:bg-red-800' : undefined}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
