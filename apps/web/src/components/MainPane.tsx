import { useState } from 'react';
import type { Blueprint, BlueprintLeafBlock, Edition, Newsletter, StoryBlock } from '../lib/types';
import { api } from '../lib/api';
import { Button, cx, EmptyHint, ProvenanceBadge, SectionTitle } from './ui';

type Tab = 'preview' | 'structure' | 'checks';

interface Props {
  newsletter: Newsletter;
  edition: Edition | null;
  onPreview: () => Promise<void>;
  previewing: boolean;
  lastCost: number | null;
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

export function MainPane({ newsletter, edition, onPreview, previewing, lastCost }: Props) {
  const [tab, setTab] = useState<Tab>('preview');
  const [testTo, setTestTo] = useState('reviewer@cawt.ai');
  const [testResult, setTestResult] = useState<string | null>(null);

  const stories = edition ? collectStories(edition) : [];
  const flagged = stories.filter((story) => story.warnings.length > 0);
  const blueprint = newsletter.blueprint;

  const sendTest = async () => {
    if (!edition) return;
    setTestResult(null);
    try {
      const result = await api.sendTest(edition.id, testTo);
      setTestResult(result.location ? `Written to ${result.location}` : `Sent via ${result.provider}`);
    } catch (error) {
      setTestResult(error instanceof Error ? error.message : 'Send failed');
    }
  };

  const tabs: Array<[Tab, string]> = [
    ['preview', 'Preview'],
    ['structure', 'Structure'],
    ['checks', 'Checks'],
  ];

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
      </div>
    </div>
  );
}
