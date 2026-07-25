import { useEffect, useState } from 'react';
import type { Blueprint, BlueprintLeafBlock, Delivery, Edition, Newsletter, StoryBlock } from '../lib/types';
import { api } from '../lib/api';
import { Button, cx, EmptyHint, ProvenanceBadge, SectionTitle } from './ui';
import { LinkedInEditor } from './LinkedInEditor';
import { AudiencePanel } from './AudiencePanel';

const LINKEDIN_LIMIT = 3000;

type Tab = 'preview' | 'structure' | 'checks' | 'audience' | 'linkedin' | 'history' | 'sent';

interface Social {
  post: string;
  diagramPrompt: string;
  charCount: number;
}

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

interface Props {
  newsletter: Newsletter;
  edition: Edition | null;
  onPreview: () => Promise<void>;
  previewing: boolean;
  lastCost: number | null;
  onOpenEdition: (editionId: string) => void | Promise<void>;
  onNewsletterChange: (next: Newsletter) => void;
}

function formatWindow(hours: number): string {
  if (hours % 168 === 0) return `${hours / 168} week${hours === 168 ? '' : 's'}`;
  if (hours % 24 === 0) return `${hours / 24} day${hours === 24 ? '' : 's'}`;
  return `${hours} hours`;
}

function collectStories(edition: Edition): StoryBlock[] {
  const out: StoryBlock[] = [];
  for (const block of edition.blocks) {
    if (block.type === 'story') out.push(block);
    if (block.type === 'section') for (const child of block.children) if (child.type === 'story') out.push(child);
  }
  return out;
}

function LeafRow({ block, provenance }: { block: BlueprintLeafBlock; provenance: Blueprint['provenance'] }) {
  if (block.type === 'divider') {
    return <div className="py-1 text-[12px] text-stone-400">divider</div>;
  }

  if (block.type === 'prose_spec') {
    return (
      <div className="rounded-lg border border-stone-200 bg-stone-50/60 px-3 py-2.5">
        <div className="flex items-center gap-2">
          <span className="rounded bg-white px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-stone-500 ring-1 ring-inset ring-stone-200">
            {block.purpose}
          </span>
          {block.label && <span className="text-[12.5px] font-medium text-stone-700">{block.label}</span>}
        </div>
        <p className="mt-1.5 text-[12.5px] leading-relaxed text-stone-600">{block.instruction}</p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-stone-200 bg-white px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[12.5px] font-medium text-stone-800">{block.freshness.label ?? 'Items'}</span>
        <ProvenanceBadge value={provenance['freshness'] ?? 'inferred'} />
      </div>
      <p className="mt-1 text-[12.5px] leading-relaxed text-stone-600">{block.intent}</p>
      <dl className="mt-2.5 grid grid-cols-2 gap-x-4 gap-y-1.5 text-[12px] sm:grid-cols-4">
        {[
          ['Window', formatWindow(block.freshness.windowHours)],
          ['Items', `${block.count.min} to ${block.count.max}`],
          ['Length', `~${block.targetWords} words`],
          ['Quality floor', block.relevanceFloor.toFixed(2)],
        ].map(([label, value]) => (
          <div key={label}>
            <dt className="text-[10.5px] uppercase tracking-wide text-stone-400">{label}</dt>
            <dd className="font-medium text-stone-700">{value}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-2 text-[11.5px] italic text-stone-400">When nothing qualifies: &ldquo;{block.emptyState}&rdquo;</p>
    </div>
  );
}

export function MainPane({
  newsletter,
  edition,
  onPreview,
  previewing,
  lastCost,
  onOpenEdition,
  onNewsletterChange,
}: Props) {
  const [tab, setTab] = useState<Tab>('preview');
  const [testTo, setTestTo] = useState('reviewer@cawt.ai');
  const [testResult, setTestResult] = useState<string | null>(null);
  const [social, setSocial] = useState<Social | null>(null);
  const [postDraft, setPostDraft] = useState('');
  const [socialBusy, setSocialBusy] = useState(false);
  const [socialError, setSocialError] = useState<string | null>(null);
  const [copied, setCopied] = useState<'post' | 'diagram' | null>(null);
  const [history, setHistory] = useState<Edition[]>([]);
  const [historyBusy, setHistoryBusy] = useState(false);
  const [historySearch, setHistorySearch] = useState('');
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [deliveriesBusy, setDeliveriesBusy] = useState(false);
  const [sentSearch, setSentSearch] = useState('');
  const [sentRefresh, setSentRefresh] = useState(0);
  const [viewing, setViewing] = useState<Delivery | null>(null);

  const stories = edition ? collectStories(edition) : [];
  const flagged = stories.filter((story) => story.warnings.length > 0);
  const blueprint = newsletter.blueprint;

  // A fresh edition invalidates any post built from the previous one.
  useEffect(() => {
    setSocial(null);
    setPostDraft('');
    setSocialError(null);
  }, [edition?.id]);

  // Load the edition history when that tab opens, and after a new run.
  useEffect(() => {
    if (tab !== 'history') return;
    setHistoryBusy(true);
    api
      .editions(newsletter.id)
      .then(setHistory)
      .catch(() => setHistory([]))
      .finally(() => setHistoryBusy(false));
  }, [tab, newsletter.id, edition?.id]);

  // Load the sent emails when that tab opens, and after a test send.
  useEffect(() => {
    if (tab !== 'sent') return;
    setViewing(null);
    setDeliveriesBusy(true);
    api
      .deliveries(newsletter.id)
      .then(setDeliveries)
      .catch(() => setDeliveries([]))
      .finally(() => setDeliveriesBusy(false));
  }, [tab, newsletter.id, sentRefresh]);

  const genSocial = async () => {
    if (!edition) return;
    setSocialBusy(true);
    setSocialError(null);
    try {
      const result = await api.social(edition.id);
      setSocial({ post: result.post, diagramPrompt: result.diagramPrompt, charCount: result.charCount });
      setPostDraft(result.post);
    } catch (error) {
      setSocialError(error instanceof Error ? error.message : 'Could not generate the post');
    } finally {
      setSocialBusy(false);
    }
  };

  const copy = async (text: string, which: 'post' | 'diagram') => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(which);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      setSocialError('Clipboard blocked by the browser. Select the text and copy manually.');
    }
  };

  const sendTest = async () => {
    if (!edition) return;
    setTestResult(null);
    try {
      const result = await api.sendTest(edition.id, testTo);
      setTestResult(result.location ? `Written to ${result.location}` : `Sent via ${result.provider}`);
      setSentRefresh((count) => count + 1);
    } catch (error) {
      setTestResult(error instanceof Error ? error.message : 'Send failed');
    }
  };

  const tabs: Array<[Tab, string]> = [
    ['preview', 'Preview'],
    ['structure', 'Structure'],
    ['checks', 'Checks'],
    ['audience', 'Audience'],
    ['linkedin', 'LinkedIn'],
    ['history', 'History'],
    ['sent', 'Sent'],
  ];

  const sentFiltered = deliveries.filter((item) => {
    const query = sentSearch.trim().toLowerCase();
    return !query || `${item.email} ${item.subject}`.toLowerCase().includes(query);
  });

  const historyFiltered = history
    .filter((item) => {
      const query = historySearch.trim().toLowerCase();
      return !query || `${item.title} ${item.subject}`.toLowerCase().includes(query);
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return (
    <div className="flex h-full min-w-0 flex-col bg-canvas">
      <div className="flex items-center justify-between gap-4 border-b border-stone-200 bg-white px-5 py-2.5">
        <div className="flex items-center gap-1">
          {tabs.map(([value, label]) => (
            <button
              key={value}
              onClick={() => setTab(value)}
              className={cx(
                'relative rounded-md px-3 py-1.5 text-[13px] font-medium transition-colors',
                tab === value ? 'bg-accent-soft text-teal-800' : 'text-stone-500 hover:text-stone-900',
              )}
            >
              {label}
              {value === 'checks' && flagged.length > 0 && (
                <span className="ml-1.5 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800">
                  {flagged.length}
                </span>
              )}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          {lastCost !== null && (
            <span className="text-[11.5px] text-stone-400">
              last run ${lastCost.toFixed(4)}
            </span>
          )}
          <Button variant="primary" size="sm" onClick={() => void onPreview()} loading={previewing}>
            {edition ? 'Run again' : 'Run against live news'}
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {tab === 'preview' && (
          <div className="flex h-full flex-col">
            {edition ? (
              <>
                {edition.warnings.length > 0 && (
                  <div className="border-b border-amber-200 bg-amber-50 px-5 py-2.5">
                    {edition.warnings.map((warning) => (
                      <p key={warning} className="text-[12.5px] leading-relaxed text-amber-900">
                        {warning}
                      </p>
                    ))}
                  </div>
                )}
                <iframe
                  key={edition.id}
                  title="Newsletter preview"
                  src={api.editionHtmlUrl(edition.id)}
                  sandbox=""
                  className="min-h-0 w-full flex-1 border-0 bg-stone-100"
                />
                <div className="flex flex-wrap items-center gap-2 border-t border-stone-200 bg-white px-5 py-2.5">
                  <span className="text-[12px] text-stone-500">Send a test copy to</span>
                  <input
                    value={testTo}
                    onChange={(event) => setTestTo(event.target.value)}
                    className="w-56 rounded-md border border-stone-200 px-2.5 py-1 text-[12.5px] text-stone-800 outline-none focus:border-stone-400"
                  />
                  <Button size="sm" onClick={() => void sendTest()}>
                    Send test
                  </Button>
                  {testResult && <span className="truncate text-[11.5px] text-stone-500">{testResult}</span>}
                </div>
              </>
            ) : (
              <div className="mx-auto max-w-md px-6 py-20 text-center">
                <p className="text-[15px] font-medium text-stone-800">No sample edition yet</p>
                <p className="mt-1.5 text-[13.5px] leading-relaxed text-stone-500">
                  Run the blueprint against current news to see what a real edition looks like before anything is saved
                  or sent.
                </p>
                <Button variant="primary" className="mt-5" onClick={() => void onPreview()} loading={previewing}>
                  Run against live news
                </Button>
              </div>
            )}
          </div>
        )}

        {tab === 'structure' && (
          <div className="mx-auto max-w-3xl space-y-5 px-6 py-6">
            <div>
              <SectionTitle>Title</SectionTitle>
              <p className="mt-1.5 font-serif text-[17px] text-stone-900">{blueprint.titleTemplate}</p>
            </div>

            {blueprint.blocks.map((block) =>
              block.type === 'section' ? (
                <div key={block.id}>
                  <SectionTitle action={<ProvenanceBadge value={blueprint.provenance['structure'] ?? 'inferred'} />}>
                    {block.heading}
                  </SectionTitle>
                  <div className="mt-2 space-y-2">
                    {block.children.map((child) => (
                      <LeafRow key={child.id} block={child} provenance={blueprint.provenance} />
                    ))}
                  </div>
                </div>
              ) : (
                <div key={block.id}>
                  <SectionTitle>Closing</SectionTitle>
                  <div className="mt-2">
                    <LeafRow block={block} provenance={blueprint.provenance} />
                  </div>
                </div>
              ),
            )}

            {blueprint.notes.length > 0 && (
              <div className="rounded-xl border border-stone-300 border-dashed bg-stone-50 p-4">
                <SectionTitle>Still needs you</SectionTitle>
                <ul className="mt-2 space-y-1.5">
                  {blueprint.notes.map((note) => (
                    <li key={note} className="flex gap-2 text-[13px] leading-relaxed text-stone-600">
                      <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-stone-400" />
                      {note}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {tab === 'checks' && (
          <div className="mx-auto max-w-3xl space-y-4 px-6 py-6">
            {!edition ? (
              <EmptyHint>Run the newsletter once to see verification results.</EmptyHint>
            ) : (
              <>
                <div className="grid grid-cols-3 gap-3">
                  {[
                    ['Stories', stories.length],
                    ['Flagged', flagged.length],
                    ['Sources cited', stories.reduce((sum, story) => sum + story.sources.length, 0)],
                  ].map(([label, value]) => (
                    <div key={String(label)} className="rounded-xl border border-stone-200 bg-white px-4 py-3">
                      <p className="text-[11px] uppercase tracking-wide text-stone-400">{label}</p>
                      <p className="mt-0.5 text-[22px] font-semibold text-stone-900">{value}</p>
                    </div>
                  ))}
                </div>

                {flagged.length === 0 ? (
                  <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
                    <p className="text-[13.5px] text-emerald-800">
                      Every figure, date and quotation in this edition was found in its cited source.
                    </p>
                  </div>
                ) : (
                  flagged.map((story) => (
                    <div key={story.id} className="rounded-xl border border-amber-200 bg-white p-4">
                      <p className="text-[14px] font-medium text-stone-900">{story.headline}</p>
                      <ul className="mt-2 space-y-1">
                        {story.warnings.map((warning) => (
                          <li key={warning} className="text-[12.5px] leading-relaxed text-amber-800">
                            {warning}
                          </li>
                        ))}
                      </ul>
                      <div className="mt-2.5 flex flex-wrap gap-2">
                        {story.sources.map((source) => (
                          <a
                            key={source.url}
                            href={source.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-[11.5px] text-amber-700 underline underline-offset-2"
                          >
                            {source.publisher}
                          </a>
                        ))}
                      </div>
                    </div>
                  ))
                )}
              </>
            )}
          </div>
        )}

        {tab === 'audience' && (
          <AudiencePanel newsletter={newsletter} onNewsletterChange={onNewsletterChange} />
        )}

        {tab === 'linkedin' && (
          <div className="space-y-4 px-6 py-6">
            {!edition ? (
              <EmptyHint>Run the newsletter once, then generate a LinkedIn post from that edition.</EmptyHint>
            ) : (
              <>
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-[14px] font-semibold text-stone-900">LinkedIn post</p>
                    <p className="text-[12.5px] leading-relaxed text-stone-500">
                      Built from this edition, so it repeats only fact-checked stories. Copy and paste it yourself;
                      nothing is posted.
                    </p>
                  </div>
                  <Button variant="primary" size="sm" onClick={() => void genSocial()} loading={socialBusy}>
                    {social ? 'Regenerate' : 'Generate post'}
                  </Button>
                </div>

                {socialError && (
                  <div className="rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-[13px] text-red-800">
                    {socialError}
                  </div>
                )}

                {!social && !socialBusy && (
                  <EmptyHint>Generate a post and a matching diagram prompt from the current edition.</EmptyHint>
                )}

                {social && (
                  <>
                    <div className="overflow-hidden rounded-xl border border-stone-200 bg-white shadow-sm">
                      <div className="flex items-center gap-3 border-b border-stone-100 px-4 py-3">
                        <img src="/cawt-logo.png" alt="CAWT" className="h-9 w-auto" />
                        <div className="min-w-0">
                          <p className="text-[13px] font-semibold text-stone-900">CapAlpha WhiteTrust</p>
                          <p className="text-[11.5px] text-stone-500">Private client advisory &middot; now</p>
                        </div>
                      </div>
                      <LinkedInEditor value={postDraft} onChange={setPostDraft} limit={LINKEDIN_LIMIT} />
                    </div>

                    <div className="rounded-xl border border-stone-200 bg-white p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-[13px] font-semibold text-stone-900">Diagram prompt</p>
                          <p className="text-[12px] leading-relaxed text-stone-500">
                            Paste into an image or diagram generator. Attach{' '}
                            <code className="rounded bg-stone-100 px-1 py-0.5 text-[11px]">cawt-logo.png</code> so the
                            mark is exact.
                          </p>
                        </div>
                        <Button size="sm" onClick={() => void copy(social.diagramPrompt, 'diagram')}>
                          {copied === 'diagram' ? 'Copied' : 'Copy prompt'}
                        </Button>
                      </div>
                      <p className="mt-2.5 rounded-lg bg-stone-50 px-3 py-2.5 text-[12.5px] leading-relaxed text-stone-700">
                        {social.diagramPrompt}
                      </p>
                    </div>
                  </>
                )}
              </>
            )}
          </div>
        )}

        {tab === 'history' && (
          <div className="mx-auto max-w-3xl space-y-4 px-6 py-6">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-[14px] font-semibold text-stone-900">Edition history</p>
                <p className="text-[12.5px] text-stone-500">
                  Every edition generated for this newsletter, newest first. Open one to read exactly what went out.
                </p>
              </div>
              <div className="flex items-center gap-2 rounded-lg border border-stone-200 bg-white px-2.5 py-1.5">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-stone-400">
                  <circle cx="11" cy="11" r="7" />
                  <path d="M21 21l-4-4" />
                </svg>
                <input
                  value={historySearch}
                  onChange={(event) => setHistorySearch(event.target.value)}
                  placeholder="Search editions"
                  className="w-40 bg-transparent text-[12.5px] text-stone-800 outline-none placeholder:text-stone-400"
                />
              </div>
            </div>

            {historyBusy ? (
              <EmptyHint>Loading history…</EmptyHint>
            ) : historyFiltered.length === 0 ? (
              <EmptyHint>
                {history.length === 0
                  ? 'No editions yet. Run the newsletter against live news to create the first one.'
                  : 'No edition matches that search.'}
              </EmptyHint>
            ) : (
              <div className="space-y-2">
                {historyFiltered.map((item) => {
                  const count = collectStories(item).length;
                  return (
                    <button
                      key={item.id}
                      onClick={() => {
                        setTab('preview');
                        void onOpenEdition(item.id);
                      }}
                      className={cx(
                        'flex w-full items-center justify-between gap-4 rounded-xl border bg-white px-4 py-3 text-left transition-colors hover:border-stone-300',
                        edition?.id === item.id ? 'border-teal-300 ring-1 ring-teal-200' : 'border-stone-200',
                      )}
                    >
                      <div className="min-w-0">
                        <p className="truncate text-[13.5px] font-medium text-stone-900">{item.title}</p>
                        <p className="truncate text-[12px] text-stone-500">{item.subject}</p>
                      </div>
                      <div className="flex shrink-0 items-center gap-4 text-right">
                        <span className="text-[11.5px] text-stone-500">
                          {count} {count === 1 ? 'story' : 'stories'} &middot; v{item.blueprintVersion}
                        </span>
                        <span className="w-36 text-[11.5px] text-stone-400">{formatWhen(item.createdAt)}</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}

            <p className="pt-1 text-[11.5px] leading-relaxed text-stone-400">
              These are editions generated for review. To see what actually reached an inbox, use the Sent tab.
            </p>
          </div>
        )}

        {tab === 'sent' &&
          (viewing ? (
            <div className="flex h-full flex-col">
              <div className="flex flex-wrap items-center gap-3 border-b border-stone-200 bg-white px-5 py-2.5">
                <Button size="sm" onClick={() => setViewing(null)}>
                  &larr; Back to sent
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
          ) : (
            <div className="mx-auto max-w-3xl space-y-4 px-6 py-6">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-[14px] font-semibold text-stone-900">Sent emails</p>
                  <p className="text-[12.5px] text-stone-500">
                    Every email actually sent for this newsletter. Search by recipient or subject, then open one to read
                    exactly what they received.
                  </p>
                </div>
                <div className="flex items-center gap-2 rounded-lg border border-stone-200 bg-white px-2.5 py-1.5">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-stone-400">
                    <circle cx="11" cy="11" r="7" />
                    <path d="M21 21l-4-4" />
                  </svg>
                  <input
                    value={sentSearch}
                    onChange={(event) => setSentSearch(event.target.value)}
                    placeholder="Search recipient or subject"
                    className="w-52 bg-transparent text-[12.5px] text-stone-800 outline-none placeholder:text-stone-400"
                  />
                </div>
              </div>

              {deliveriesBusy ? (
                <EmptyHint>Loading sent emails…</EmptyHint>
              ) : sentFiltered.length === 0 ? (
                <EmptyHint>
                  {deliveries.length === 0
                    ? 'No emails sent yet. Send a test copy from the Preview tab and it will appear here.'
                    : 'No sent email matches that search.'}
                </EmptyHint>
              ) : (
                <div className="space-y-2">
                  {sentFiltered.map((item) => (
                    <button
                      key={item.id}
                      onClick={() => setViewing(item)}
                      className="flex w-full items-center justify-between gap-4 rounded-xl border border-stone-200 bg-white px-4 py-3 text-left transition-colors hover:border-stone-300"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-[13.5px] font-medium text-stone-900">{item.email}</span>
                          <span
                            className={cx(
                              'rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
                              item.kind === 'live'
                                ? 'bg-emerald-50 text-emerald-700'
                                : 'bg-stone-100 text-stone-500',
                            )}
                          >
                            {item.kind}
                          </span>
                        </div>
                        <p className="truncate text-[12px] text-stone-500">{item.subject}</p>
                      </div>
                      <span className="w-36 shrink-0 text-right text-[11.5px] text-stone-400">
                        {formatWhen(item.timestamp)}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
      </div>
    </div>
  );
}
