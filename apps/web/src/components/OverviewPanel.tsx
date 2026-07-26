import { useEffect, useState } from 'react';
import type { Newsletter, NewsletterSummaryStats } from '../lib/types';
import { api } from '../lib/api';
import { editionState, formatDay, formatWhen } from '../lib/edition';
import { Button, cx, EmptyHint, Spinner } from './ui';

interface Props {
  newsletter: Newsletter;
  refreshKey: number;
  onOpenEdition: (editionId: string) => void | Promise<void>;
  onGoto: (tab: 'edition' | 'design' | 'audience' | 'sent') => void;
  onRun: () => Promise<void>;
  running: boolean;
}

function Stat({ value, label, hint }: { value: string; label: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-stone-200 bg-white px-4 py-3">
      <p className="text-[19px] font-semibold leading-tight tracking-[-0.02em] text-stone-900 tabular-nums">{value}</p>
      <p className="mt-0.5 text-[11.5px] text-stone-500">{label}</p>
      {hint && <p className="text-[11px] text-stone-400">{hint}</p>}
    </div>
  );
}

const TONES: Record<'draft' | 'review' | 'sent', string> = {
  draft: 'bg-stone-100 text-stone-600 ring-stone-200',
  review: 'bg-amber-50 text-amber-800 ring-amber-200',
  sent: 'bg-teal-50 text-teal-700 ring-teal-200',
};

/**
 * What a newsletter's owner needs on opening it: where it stands, what it last
 * did, what it will do next, and the one action worth taking now. The detail
 * lives behind the tabs; this is the answer to "is this thing healthy".
 */
export function OverviewPanel({ newsletter, refreshKey, onOpenEdition, onGoto, onRun, running }: Props) {
  const [stats, setStats] = useState<NewsletterSummaryStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [briefOpen, setBriefOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .summary(newsletter.id)
      .then((result) => !cancelled && setStats(result))
      .catch(() => !cancelled && setStats(null))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [newsletter.id, refreshKey]);

  const latest = stats?.latestEdition ?? null;
  const state = latest ? editionState(latest.status) : null;

  return (
    <div className="mx-auto max-w-5xl px-6 py-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat
          value={stats?.nextRunAt ? formatDay(stats.nextRunAt) : 'Not scheduled'}
          label="Next run"
          hint={
            stats?.nextRunAt
              ? new Date(stats.nextRunAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
              : 'Set a cadence in Audience'
          }
        />
        <Stat
          value={stats?.lastSentAt ? formatDay(stats.lastSentAt) : 'Never'}
          label="Last sent"
          hint={stats?.lastSentAt ? `${stats.lastSentCount} delivered` : 'Nothing published yet'}
        />
        <Stat
          value={stats?.lastCostUsd != null ? `$${stats.lastCostUsd.toFixed(2)}` : '—'}
          label="Last edition cost"
          hint={`${stats?.editionCount ?? 0} generated in total`}
        />
        <Stat
          value={stats ? `$${stats.monthCostUsd.toFixed(2)}` : '—'}
          label="This month"
          hint="Across this newsletter"
        />
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-[1.55fr_1fr]">
        {/* Latest edition */}
        <section>
          <div className="mb-2 flex items-baseline justify-between gap-3">
            <h3 className="text-[14px] font-semibold text-stone-900">
              {latest ? (latest.status === 'sent' ? 'Latest edition' : 'Latest draft') : 'Latest edition'}
            </h3>
            {latest && (
              <button
                onClick={() => onGoto('edition')}
                className="text-[12.5px] font-medium text-teal-700 hover:text-teal-800"
              >
                Open edition &rarr;
              </button>
            )}
          </div>

          {loading ? (
            <div className="flex items-center gap-2 rounded-xl border border-stone-200 bg-white px-4 py-10 text-[13px] text-stone-500">
              <Spinner /> Loading
            </div>
          ) : !latest ? (
            <div className="rounded-xl border border-dashed border-stone-300 bg-white px-6 py-12 text-center">
              <p className="text-[14.5px] font-medium text-stone-800">No edition yet</p>
              <p className="mx-auto mt-1.5 max-w-sm text-[13px] leading-relaxed text-stone-500">
                Run this newsletter against current news to see what a real edition looks like. Nothing is sent until
                you publish it.
              </p>
              <Button variant="primary" className="mt-4" onClick={() => void onRun()} loading={running}>
                Run against live news
              </Button>
            </div>
          ) : (
            <div className="overflow-hidden rounded-xl border border-stone-200 bg-white">
              <div className="flex flex-wrap items-center gap-2 border-b border-stone-200 px-4 py-2.5">
                <span
                  className={cx(
                    'rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset',
                    TONES[state!.tone],
                  )}
                >
                  {state!.label}
                </span>
                <span className="truncate text-[12.5px] text-stone-500">{formatWhen(latest.createdAt)}</span>
                {(latest.warnings?.length ?? 0) > 0 && (
                  <span className="ml-auto text-[12px] font-medium text-amber-700">
                    {latest.warnings!.length} item{latest.warnings!.length === 1 ? '' : 's'} to check
                  </span>
                )}
              </div>
              <iframe
                key={latest.id}
                title="Latest edition"
                src={api.editionHtmlUrl(latest.id)}
                sandbox=""
                className="h-[380px] w-full border-0 bg-stone-100"
              />
              <div className="flex flex-wrap items-center gap-2 border-t border-stone-200 bg-stone-50 px-4 py-2.5">
                <Button size="sm" onClick={() => void onRun()} loading={running}>
                  Run again
                </Button>
                <span className="ml-auto text-[12px] text-stone-500">
                  {stats?.recipientCount ?? 0} recipient{stats?.recipientCount === 1 ? '' : 's'}
                </span>
                <Button variant="primary" size="sm" onClick={() => onGoto('edition')}>
                  {latest.status === 'sent' ? 'View edition' : 'Review & publish'}
                </Button>
              </div>
            </div>
          )}
        </section>

        {/* About + recent */}
        <section>
          <div className="mb-2 flex items-baseline justify-between gap-3">
            <h3 className="text-[14px] font-semibold text-stone-900">About</h3>
            <button
              onClick={() => onGoto('design')}
              className="text-[12.5px] font-medium text-teal-700 hover:text-teal-800"
            >
              Edit in Design &rarr;
            </button>
          </div>
          <div className="rounded-xl border border-stone-200 bg-white p-4">
            <p className="text-[10px] font-semibold uppercase tracking-[0.09em] text-stone-400">Brief</p>
            <p
              className={cx(
                'mt-1.5 text-[13px] leading-6 text-stone-600',
                !briefOpen && 'line-clamp-4',
              )}
            >
              {newsletter.brief.text}
            </p>
            <button
              onClick={() => setBriefOpen((open) => !open)}
              className="mt-1.5 text-[11.5px] font-medium text-teal-700 hover:text-teal-800"
            >
              {briefOpen ? 'Show less' : 'Show more'}
            </button>
          </div>

          <div className="mb-2 mt-5 flex items-baseline justify-between gap-3">
            <h3 className="text-[14px] font-semibold text-stone-900">Recent editions</h3>
            <button
              onClick={() => onGoto('sent')}
              className="text-[12.5px] font-medium text-teal-700 hover:text-teal-800"
            >
              All &rarr;
            </button>
          </div>
          <div className="overflow-hidden rounded-xl border border-stone-200 bg-white">
            {(stats?.recentEditions.length ?? 0) === 0 ? (
              <div className="px-4 py-5">
                <EmptyHint>Nothing generated yet.</EmptyHint>
              </div>
            ) : (
              stats!.recentEditions.map((item) => {
                const itemState = editionState(item.status);
                return (
                  <button
                    key={item.id}
                    onClick={() => {
                      void onOpenEdition(item.id);
                      onGoto('edition');
                    }}
                    className="flex w-full items-center justify-between gap-3 border-b border-stone-100 px-4 py-2.5 text-left last:border-b-0 hover:bg-stone-50"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-[12.5px] text-stone-800">{formatWhen(item.createdAt)}</p>
                      <p className="text-[11px] text-stone-400">
                        ${item.costUsd.toFixed(2)}
                        {item.deliveredCount > 0 && ` · ${item.deliveredCount} delivered`}
                      </p>
                    </div>
                    <span
                      className={cx(
                        'shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-medium ring-1 ring-inset',
                        TONES[itemState.tone],
                      )}
                    >
                      {itemState.label}
                    </span>
                  </button>
                );
              })
            )}
          </div>

          <div className="mt-3 flex items-center justify-between rounded-xl border border-stone-200 bg-white px-4 py-3">
            <div>
              <p className="text-[12.5px] font-medium text-stone-800">
                {stats?.recipientCount ?? 0} recipients &middot; {stats?.reviewerCount ?? 0} reviewers
              </p>
              <p className="text-[11.5px] text-stone-500">
                {newsletter.autoPublish ? 'Auto-publishes on schedule' : 'Every edition waits for approval'}
              </p>
            </div>
            <Button size="sm" onClick={() => onGoto('audience')}>
              Manage
            </Button>
          </div>
        </section>
      </div>
    </div>
  );
}
