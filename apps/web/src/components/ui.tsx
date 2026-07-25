import type { ButtonHTMLAttributes, ReactNode } from 'react';
import type { Provenance } from '../lib/types';

export function cx(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(' ');
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost';
  size?: 'sm' | 'md';
  loading?: boolean;
}

export function Button({ variant = 'secondary', size = 'md', loading, className, children, ...rest }: ButtonProps) {
  const base =
    'inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700';
  const sizes = { sm: 'px-2.5 py-1.5 text-[13px]', md: 'px-3.5 py-2 text-sm' };
  const variants = {
    primary: 'bg-teal-700 text-white hover:bg-teal-800 shadow-sm',
    secondary: 'bg-white text-stone-700 border border-stone-200 hover:bg-stone-50 hover:border-stone-300',
    ghost: 'text-stone-600 hover:bg-stone-100 hover:text-stone-900',
  };

  return (
    <button className={cx(base, sizes[size], variants[variant], className)} disabled={loading || rest.disabled} {...rest}>
      {loading && <Spinner />}
      {children}
    </button>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <svg className={cx('h-3.5 w-3.5 animate-spin', className)} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-25" />
      <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function Pill({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'mock' | 'live' }) {
  const tones = {
    neutral: 'bg-stone-100 text-stone-600 ring-stone-200',
    mock: 'bg-sky-50 text-sky-700 ring-sky-200',
    live: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  };
  return (
    <span className={cx('inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset', tones[tone])}>
      {children}
    </span>
  );
}

/**
 * The read / inferred / needs-you tiering, shown wherever a derived value
 * appears. Confidently wrong is worse than visibly uncertain, so guesses are
 * labelled rather than hidden.
 */
export function ProvenanceBadge({ value }: { value: Provenance }) {
  const map: Record<Provenance, { label: string; className: string; title: string }> = {
    observed: {
      label: 'from your sample',
      className: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
      title: 'Read directly from the sample you provided.',
    },
    inferred: {
      label: 'inferred',
      className: 'bg-amber-50 text-amber-800 ring-amber-200',
      title: 'Derived from your description. Probable, but worth a look.',
    },
    supplied: {
      label: 'needs you',
      className: 'bg-stone-100 text-stone-600 ring-stone-300',
      title: 'Cannot be derived from a prompt or a sample. You need to set this.',
    },
    default: {
      label: 'default',
      className: 'bg-stone-50 text-stone-500 ring-stone-200',
      title: 'A system default was used because nothing indicated otherwise.',
    },
  };
  const entry = map[value];
  return (
    <span
      title={entry.title}
      className={cx('inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium ring-1 ring-inset', entry.className)}
    >
      {entry.label}
    </span>
  );
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx('rounded-xl border border-stone-200 bg-white', className)}>{children}</div>;
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <h2 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-stone-500">{children}</h2>
      {action}
    </div>
  );
}

export function EmptyHint({ children }: { children: ReactNode }) {
  return <p className="text-sm leading-relaxed text-stone-500">{children}</p>;
}
