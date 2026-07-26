import { useEffect, useState } from 'react';
import type { AdminCosts } from '../lib/types';
import { api } from '../lib/api';
import { cx, EmptyHint, Pill, Spinner } from './ui';

interface Props {
  onOpenNewsletter: (id: string) => void | Promise<void>;
}

/**
 * Spend and configuration, for whoever owns the bill.
 *
 * The unit is one edition run: an edition is generated once, then mailed to
 * everyone on the list, and sending costs nothing. So per-edition cost, not
 * per-recipient, is the number that tells an owner where the money goes and
 * which newsletter is worth tuning.
 */
export function AdminPanel({ onOpenNewsletter }: Props) {
  const [data, setData] = useState<AdminCosts | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api
      .adminCosts()
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center gap-2 px-6 py-16 text-[13px] text-stone-500">
        <Spinner /> Loading spend
      </div>
    );
  }
  if (!data) {
    return (
      <div className="px-6 py-16">
        <EmptyHint>Could not load spend right now.</EmptyHint>
      </div>
    );
  }

  const pct = data.monthlyCapUsd > 0 ? Math.min(100, (data.monthToDateUsd / data.monthlyCapUsd) * 100) : 0;
  const month = new Date().toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  const max = Math.max(...data.newsletters.map((row) => row.monthUsd), 0.0001);

  return (
    <div className="mx-auto max-w-4xl px-6 py-6">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h2 className="text-[16px] font-semibold text-stone-900">Spend across all newsletters</h2>
          <p className="mt-0.5 text-[12.5px] text-stone-500">
            {month}. One edition is generated once and mailed to everyone, so cost is per edition run, not per
            recipient.
          </p>
        </div>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-stone-200 bg-white px-4 py-3">
          <p className="text-[21px] font-semibold tracking-[-0.02em] text-stone-900 tabular-nums">
            ${data.monthToDateUsd.toFixed(2)}
            <span className="text-[13px] font-normal text-stone-400"> / ${data.monthlyCapUsd.toFixed(2)}</span>
          </p>
          <p className="mt-0.5 text-[11.5px] text-stone-500">Month to date vs cap</p>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-stone-100">
            <div
              className={cx('h-full rounded-full', pct > 85 ? 'bg-amber-500' : 'bg-teal-600')}
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
        <div className="rounded-xl border border-stone-200 bg-white px-4 py-3">
          <p className="text-[21px] font-semibold tracking-[-0.02em] text-stone-900 tabular-nums">{data.editionCount}</p>
          <p className="mt-0.5 text-[11.5px] text-stone-500">Editions generated this month</p>
        </div>
        <div className="rounded-xl border border-stone-200 bg-white px-4 py-3">
          <p className="text-[21px] font-semibold tracking-[-0.02em] text-stone-900 tabular-nums">
            ${data.avgPerEditionUsd.toFixed(3)}
          </p>
          <p className="mt-0.5 text-[11.5px] text-stone-500">Average cost per edition</p>
        </div>
      </div>

      <h3 className="mb-2 mt-6 text-[14px] font-semibold text-stone-900">By newsletter</h3>
      {data.newsletters.length === 0 ? (
        <EmptyHint>No newsletters yet.</EmptyHint>
      ) : (
        <div className="overflow-hidden rounded-xl border border-stone-200 bg-white">
          <div className="grid grid-cols-[1fr_auto_auto_auto_140px] gap-3 border-b border-stone-200 px-4 py-2 text-[10.5px] font-semibold uppercase tracking-[0.06em] text-stone-400">
            <span>Newsletter</span>
            <span className="text-right">Editions</span>
            <span className="text-right">Avg</span>
            <span className="text-right">Month</span>
            <span>Share</span>
          </div>
          {data.newsletters.map((row) => (
            <button
              key={row.id}
              onClick={() => void onOpenNewsletter(row.id)}
              className="grid w-full grid-cols-[1fr_auto_auto_auto_140px] items-center gap-3 border-b border-stone-100 px-4 py-2.5 text-left transition-colors last:border-b-0 hover:bg-stone-50"
            >
              <span className="min-w-0">
                <span className="block truncate text-[13px] text-stone-900">{row.name}</span>
                <span className="text-[11px] text-stone-400">
                  {row.scheduled ? 'Scheduled' : row.status} &middot; {row.allTimeEditions} all time
                </span>
              </span>
              <span className="text-right text-[13px] text-stone-600 tabular-nums">{row.editions}</span>
              <span className="text-right text-[13px] text-stone-600 tabular-nums">${row.avgUsd.toFixed(3)}</span>
              <span className="text-right text-[13px] font-medium text-stone-900 tabular-nums">
                ${row.monthUsd.toFixed(2)}
              </span>
              <span className="h-2 overflow-hidden rounded-full bg-stone-100">
                <span
                  className="block h-full rounded-full bg-teal-600"
                  style={{ width: `${Math.max(2, (row.monthUsd / max) * 100)}%` }}
                />
              </span>
            </button>
          ))}
        </div>
      )}

      <h3 className="mb-2 mt-6 text-[14px] font-semibold text-stone-900">Providers in use</h3>
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-stone-200 bg-white px-4 py-3">
        <Pill tone={data.providers.llm === 'mock' ? 'mock' : 'live'}>
          model {data.providers.llm === 'mock' ? 'mock' : data.providers.model}
        </Pill>
        <Pill tone={data.providers.search === 'mock' ? 'mock' : 'live'}>search {data.providers.search}</Pill>
        <Pill tone={data.providers.email === 'eml' ? 'mock' : 'live'}>email {data.providers.email}</Pill>
        <Pill>storage {data.providers.storage}</Pill>
        <span className="ml-auto text-[11.5px] text-stone-400">
          Set in the app's configuration, not per newsletter.
        </span>
      </div>

      <p className="mt-4 text-[11.5px] leading-relaxed text-stone-400">
        Search credits are billed by the provider separately and are not included above. To bring a newsletter's cost
        down, widen its freshness window (fewer runs finding nothing), reduce max items per section, or lower its
        cadence.
      </p>
    </div>
  );
}
