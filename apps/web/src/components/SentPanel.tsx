import { useEffect, useState } from 'react';
import type { Delivery, Edition, Newsletter } from '../lib/types';
import { api } from '../lib/api';
import { collectStories, editionState, formatWhen } from '../lib/edition';
import { Button, cx, EmptyHint } from './ui';

interface Props {
  newsletter: Newsletter;
  refreshKey: number;
  onOpenEdition: (editionId: string) => void | Promise<void>;
  onGotoEdition: () => void;
}

type View = 'sent' | 'editions';

function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-stone-200 bg-white px-2.5 py-1.5">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-stone-400">
        <circle cx="11" cy="11" r="7" />
        <path d="M21 21l-4-4" />
      </svg>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="w-52 bg-transparent text-[12.5px] text-stone-800 outline-none placeholder:text-stone-400"
      />
    </div>
  );
}

/**
 * The archive: what actually reached an inbox, and every edition that was ever
 * generated. Kept together because "what went out on the 25th" and "what did we
 * draft on the 25th" are the same question asked two ways.
 */
export function SentPanel({ newsletter, refreshKey, onOpenEdition, onGotoEdition }: Props) {
  const [view, setView] = useState<View>('sent');
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [editions, setEditions] = useState<Edition[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [viewing, setViewing] = useState<Delivery | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setViewing(null);
    Promise.all([api.deliveries(newsletter.id), api.editions(newsletter.id)])
      .then(([d, e]) => {
        if (cancelled) return;
        setDeliveries(d);
        setEditions(e);
      })
      .catch(() => undefined)
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [newsletter.id, refreshKey]);

  const query = search.trim().toLowerCase();

  if (viewing) {
    return (
      <div className="flex h-full flex-col">
        <div className="flex flex-wrap items-center gap-3 border-b border-stone-200 bg-white px-5 py-2.5">
          <Button size="sm" onClick={() => setViewing(null)}>
            &larr; Back
          </Button>
          <div className="min-w-0">
            <p className="truncate text-[13px] font-medium text-stone-900">{viewing.subject}</p>
            <p className="truncate text-[11.5px] text-stone-500">
              To {viewing.email} &middot; {formatWhen(viewing.timestamp)} &middot; via {viewing.provider ?? 'email'}
            </p>
          </div>
        </div>
        <iframe
          key={viewing.id}
          title="Sent email"
          src={api.deliveryHtmlUrl(viewing.id)}
          sandbox=""
          className="min-h-0 w-full flex-1 border-0 bg-stone-100"
        />
      </div>
    );
  }

  const sentFiltered = deliveries
    .filter((item) => !query || `${item.email} ${item.subject}`.toLowerCase().includes(query))
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp));

  const editionsFiltered = editions
    .filter((item) => !query || `${item.title} ${item.subject}`.toLowerCase().includes(query))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return (
    <div className="mx-auto max-w-4xl px-6 py-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex overflow-hidden rounded-lg border border-stone-200 bg-white">
          {(
            [
              ['sent', `Sent emails${deliveries.length ? ` (${deliveries.length})` : ''}`],
              ['editions', `All editions${editions.length ? ` (${editions.length})` : ''}`],
            ] as Array<[View, string]>
          ).map(([value, label]) => (
            <button
              key={value}
              onClick={() => setView(value)}
              className={cx(
                'px-3 py-1.5 text-[12.5px] font-medium transition-colors',
                view === value ? 'bg-accent-soft text-teal-800' : 'text-stone-600 hover:bg-stone-50',
              )}
            >
              {label}
            </button>
          ))}
        </div>
        <SearchBox
          value={search}
          onChange={setSearch}
          placeholder={view === 'sent' ? 'Search recipient or subject' : 'Search editions'}
        />
      </div>

      <p className="mt-2 text-[12.5px] leading-relaxed text-stone-500">
        {view === 'sent'
          ? 'Every email actually sent for this newsletter, including scheduled sends. Open one to read exactly what the recipient received.'
          : 'Every edition generated for this newsletter, sent or not. Open one to review or publish it.'}
      </p>

      <div className="mt-4">
        {loading ? (
          <EmptyHint>Loading…</EmptyHint>
        ) : view === 'sent' ? (
          sentFiltered.length === 0 ? (
            <EmptyHint>
              {deliveries.length === 0
                ? 'Nothing sent yet. Publish an edition, or send yourself a test from the Edition tab.'
                : 'No sent email matches that search.'}
            </EmptyHint>
          ) : (
            <div className="overflow-hidden rounded-xl border border-stone-200 bg-white">
              {sentFiltered.map((item) => (
                <button
                  key={item.id}
                  onClick={() => setViewing(item)}
                  className="flex w-full items-center justify-between gap-4 border-b border-stone-100 px-4 py-3 text-left transition-colors last:border-b-0 hover:bg-stone-50"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-[13.5px] font-medium text-stone-900">{item.email}</span>
                      <span
                        className={cx(
                          'rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
                          item.kind === 'live' ? 'bg-teal-50 text-teal-700' : 'bg-stone-100 text-stone-500',
                        )}
                      >
                        {item.kind}
                      </span>
                      {item.status === 'failed' && (
                        <span className="rounded bg-red-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-red-700">
                          failed
                        </span>
                      )}
                    </div>
                    <p className="truncate text-[12px] text-stone-500">{item.subject}</p>
                  </div>
                  <span className="w-36 shrink-0 text-right text-[11.5px] text-stone-400">
                    {formatWhen(item.timestamp)}
                  </span>
                </button>
              ))}
            </div>
          )
        ) : editionsFiltered.length === 0 ? (
          <EmptyHint>
            {editions.length === 0 ? 'No editions yet. Run the newsletter to create the first one.' : 'No edition matches that search.'}
          </EmptyHint>
        ) : (
          <div className="overflow-hidden rounded-xl border border-stone-200 bg-white">
            {editionsFiltered.map((item) => {
              const state = editionState(item.status);
              const count = collectStories(item).length;
              return (
                <button
                  key={item.id}
                  onClick={() => {
                    void onOpenEdition(item.id);
                    onGotoEdition();
                  }}
                  className="flex w-full items-center justify-between gap-4 border-b border-stone-100 px-4 py-3 text-left transition-colors last:border-b-0 hover:bg-stone-50"
                >
                  <div className="min-w-0">
                    <p className="truncate text-[13.5px] font-medium text-stone-900">{item.subject}</p>
                    <p className="truncate text-[12px] text-stone-500">
                      {count} {count === 1 ? 'story' : 'stories'} &middot; v{item.blueprintVersion}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <span
                      className={cx(
                        'rounded-full px-2 py-0.5 text-[10.5px] font-medium ring-1 ring-inset',
                        state.tone === 'sent'
                          ? 'bg-teal-50 text-teal-700 ring-teal-200'
                          : state.tone === 'review'
                            ? 'bg-amber-50 text-amber-800 ring-amber-200'
                            : 'bg-stone-100 text-stone-600 ring-stone-200',
                      )}
                    >
                      {state.label}
                    </span>
                    <span className="w-32 text-right text-[11.5px] text-stone-400">{formatWhen(item.createdAt)}</span>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
