import { useEffect, useRef, useState } from 'react';
import type {
  Blueprint,
  BlueprintBlock,
  ConversationMessage,
  Newsletter,
  StoryGroupBlock,
} from '../lib/types';
import { api } from '../lib/api';
import { formatWindow } from '../lib/edition';
import { Button, cx, Spinner } from './ui';

interface Props {
  newsletter: Newsletter;
  messages: ConversationMessage[];
  onRefine: (instruction: string) => Promise<void>;
  busy: boolean;
  onNewsletterChange: (next: Newsletter) => void;
}

const QUICK_EDITS = ['Make items shorter', 'Cover the last 7 days', 'Drop the closing summary', 'Add a Europe section'];

// The three strictness settings map to a relevance floor the generator uses to
// discard weak matches. Named rather than numeric: an editor thinks "let more
// through", not "0.45".
const STRICTNESS: Array<[string, number, string]> = [
  ['Broad', 0.45, 'More items, some only loosely related'],
  ['Balanced', 0.6, 'The default'],
  ['Strict', 0.75, 'Only clearly relevant items'],
];
const WINDOWS: Array<[string, number]> = [
  ['36 hours', 36],
  ['3 days', 72],
  ['7 days', 168],
];

function kindLabel(kind: ConversationMessage['kind']): string {
  return { prompt: 'You asked for', sample: 'Example provided', refinement: 'You asked for', note: 'Note', result: 'Now set to' }[kind];
}

/** Renders the light markdown the model emits (**bold**) plus paragraph breaks. */
function RichText({ text }: { text: string }) {
  return (
    <>
      {text
        .split(/\n{2,}/)
        .map((block) => block.trim())
        .filter(Boolean)
        .map((para, pi) => (
          <p key={pi} className={pi > 0 ? 'mt-2' : undefined}>
            {para.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
              /^\*\*[^*]+\*\*$/.test(part) ? (
                <strong key={i} className="font-semibold text-stone-900">
                  {part.slice(2, -2)}
                </strong>
              ) : (
                <span key={i}>{part}</span>
              ),
            )}
          </p>
        ))}
    </>
  );
}

/** Replaces one story_group anywhere in the tree, leaving everything else alone. */
function replaceGroup(blocks: BlueprintBlock[], id: string, next: StoryGroupBlock): BlueprintBlock[] {
  return blocks.map((block) => {
    if (block.type === 'section') {
      return { ...block, children: block.children.map((child) => (child.id === id ? next : child)) };
    }
    return block.id === id ? next : block;
  });
}

function collectGroups(blueprint: Blueprint): Array<{ heading: string; group: StoryGroupBlock }> {
  const out: Array<{ heading: string; group: StoryGroupBlock }> = [];
  for (const block of blueprint.blocks) {
    if (block.type === 'section') {
      for (const child of block.children) {
        if (child.type === 'story_group') out.push({ heading: block.heading, group: child });
      }
    } else if (block.type === 'story_group') {
      out.push({ heading: 'Ungrouped', group: block });
    }
  }
  return out;
}

/**
 * Where a newsletter is changed: the design conversation on one side, what it
 * currently looks for on the other. The structure is editable here rather than
 * being a read-only report, so an editor who dislikes yesterday's coverage can
 * fix it (keywords, freshness, strictness, blocked sources) without a developer.
 */
export function DesignPanel({ newsletter, messages, onRefine, busy, onNewsletterChange }: Props) {
  const [instruction, setInstruction] = useState('');
  const [draft, setDraft] = useState<Blueprint>(newsletter.blueprint);
  const [blocked, setBlocked] = useState(newsletter.sourcePolicy?.blockedDomains.join(', ') ?? '');
  const [preferred, setPreferred] = useState(newsletter.sourcePolicy?.preferredDomains.join(', ') ?? '');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setDraft(newsletter.blueprint);
    setBlocked(newsletter.sourcePolicy?.blockedDomains.join(', ') ?? '');
    setPreferred(newsletter.sourcePolicy?.preferredDomains.join(', ') ?? '');
  }, [newsletter.id, newsletter.blueprint, newsletter.sourcePolicy]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages.length, busy]);

  const submit = (value?: string) => {
    const text = (value ?? instruction).trim();
    if (!text || busy) return;
    setInstruction('');
    void onRefine(text);
  };

  const patchGroup = (id: string, changes: Partial<StoryGroupBlock>) => {
    setDraft((current) => {
      const found = collectGroups(current).find((entry) => entry.group.id === id);
      if (!found) return current;
      return { ...current, blocks: replaceGroup(current.blocks, id, { ...found.group, ...changes }) };
    });
    setSaved(null);
  };

  const parseDomains = (raw: string): string[] =>
    raw
      .split(/[\s,;]+/)
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean);

  const saveTuning = async () => {
    setSaving(true);
    setSaved(null);
    try {
      const updated = await api.updateNewsletter(newsletter.id, {
        blueprint: draft,
        sourcePolicy: {
          ...(newsletter.sourcePolicy ?? { mode: 'feeds_then_search' as const, preferredDomains: [], blockedDomains: [] }),
          preferredDomains: parseDomains(preferred),
          blockedDomains: parseDomains(blocked),
        },
      });
      onNewsletterChange(updated);
      setSaved('Saved. The next edition uses these settings.');
    } catch (error) {
      setSaved(error instanceof Error ? error.message : 'Could not save');
    } finally {
      setSaving(false);
    }
  };

  const groups = collectGroups(draft);
  const dirty = JSON.stringify(draft) !== JSON.stringify(newsletter.blueprint);

  return (
    <div className="mx-auto grid max-w-6xl gap-5 px-6 py-6 lg:grid-cols-2">
      {/* Conversation */}
      <section className="flex min-h-0 flex-col">
        <h3 className="mb-2 text-[14px] font-semibold text-stone-900">Ask for a change</h3>

        <div className="rounded-xl border border-stone-200 bg-white p-4">
          <p className="text-[10px] font-semibold uppercase tracking-[0.09em] text-stone-400">Brief</p>
          <div className="mt-1.5 max-h-40 overflow-y-auto text-[13px] leading-6 text-stone-600">
            <RichText text={newsletter.brief.text} />
          </div>
        </div>

        <div className="mt-3 max-h-[430px] space-y-2.5 overflow-y-auto pr-1">
          {messages.map((message) => {
            const isUser = message.role === 'user';
            return (
              <div
                key={message.id}
                className={cx(
                  'rounded-xl border p-3 text-[13px] leading-6',
                  isUser
                    ? 'border-stone-200 bg-white text-stone-800'
                    : 'border-l-[3px] border-l-teal-500 border-y-teal-100 border-r-teal-100 bg-teal-50/60 text-teal-950',
                )}
              >
                <div className="mb-1.5 flex items-center gap-2">
                  <span
                    className={cx(
                      'rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
                      isUser ? 'bg-stone-100 text-stone-500' : 'bg-teal-100 text-teal-700',
                    )}
                  >
                    {kindLabel(message.kind)}
                  </span>

                </div>
                <RichText text={message.content} />
              </div>
            );
          })}
          {busy && (
            <div className="flex items-center gap-2 rounded-xl border border-stone-200 bg-white px-3 py-2.5 text-[13px] text-stone-500">
              <Spinner />
              Rebuilding the structure
            </div>
          )}
          <div ref={endRef} />
        </div>

        <div className="mt-3 flex flex-wrap gap-1.5">
          {QUICK_EDITS.map((quick) => (
            <button
              key={quick}
              onClick={() => submit(quick)}
              disabled={busy}
              className="rounded-full border border-stone-200 bg-white px-2.5 py-1 text-[11.5px] text-stone-600 transition-colors hover:border-teal-300 hover:bg-teal-50 hover:text-teal-800 disabled:opacity-50"
            >
              {quick}
            </button>
          ))}
        </div>

        <div className="mt-2 rounded-xl border border-stone-200 bg-white transition-shadow focus-within:border-teal-300 focus-within:shadow-sm">
          <textarea
            value={instruction}
            onChange={(event) => setInstruction(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                submit();
              }
            }}
            rows={2}
            placeholder='Change something. "Add a US tax section", "only regulator and law firm sources"…'
            className="w-full resize-none bg-transparent px-3 py-2.5 text-[13.5px] leading-relaxed text-stone-900 outline-none placeholder:text-stone-400"
          />
          <div className="flex items-center justify-between border-t border-stone-100 px-2.5 py-1.5">
            <span className="text-[11px] text-stone-400">Enter to send</span>
            <Button size="sm" variant="primary" onClick={() => submit()} disabled={!instruction.trim()} loading={busy}>
              Apply
            </Button>
          </div>
        </div>
      </section>

      {/* Structure and tuning */}
      <section>
        <div className="mb-2 flex items-baseline justify-between gap-3">
          <h3 className="text-[14px] font-semibold text-stone-900">What it covers</h3>
        </div>
        <p className="mb-3 text-[12.5px] leading-relaxed text-stone-500">
          What this newsletter looks for, section by section. If it missed something, cover a longer period, be less
          strict, add topics, or block a source you never want to see.
        </p>

        <div className="space-y-3">
          {groups.map(({ heading, group }) => (
            <div key={group.id} className="rounded-xl border border-stone-200 bg-white p-4">
              <div className="flex items-baseline justify-between gap-2">
                <p className="text-[13.5px] font-semibold text-stone-900">{heading}</p>
                <span className="text-[11px] text-stone-400">
                  {formatWindow(group.freshness.windowHours)} &middot; {group.count.min}–{group.count.max} items
                </span>
              </div>
              <p className="mt-1 text-[12.5px] leading-relaxed text-stone-600">{group.intent}</p>

              <label className="mt-3 block">
                <span className="text-[11px] font-medium text-stone-500">Topics to look for</span>
                <input
                  value={group.keywords.join(', ')}
                  onChange={(event) =>
                    patchGroup(group.id, {
                      keywords: event.target.value
                        .split(',')
                        .map((value) => value.trim())
                        .filter(Boolean),
                    })
                  }
                  placeholder="succession, trusts, estate tax"
                  className="mt-1 w-full rounded-md border border-stone-200 px-2.5 py-1.5 text-[12.5px] text-stone-800 outline-none focus:border-teal-400"
                />
              </label>

              <div className="mt-3 flex flex-wrap gap-4">
                <div>
                  <span className="text-[11px] font-medium text-stone-500">How recent</span>
                  <div className="mt-1 inline-flex overflow-hidden rounded-lg border border-stone-200">
                    {WINDOWS.map(([label, hours]) => (
                      <button
                        key={hours}
                        onClick={() => patchGroup(group.id, { freshness: { ...group.freshness, windowHours: hours } })}
                        className={cx(
                          'px-2.5 py-1 text-[11.5px] transition-colors',
                          group.freshness.windowHours === hours
                            ? 'bg-accent-soft font-semibold text-teal-800'
                            : 'text-stone-600 hover:bg-stone-50',
                        )}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <span className="text-[11px] font-medium text-stone-500">Strictness</span>
                  <div className="mt-1 inline-flex overflow-hidden rounded-lg border border-stone-200">
                    {STRICTNESS.map(([label, floor, hint]) => (
                      <button
                        key={label}
                        title={hint}
                        onClick={() => patchGroup(group.id, { relevanceFloor: floor })}
                        className={cx(
                          'px-2.5 py-1 text-[11.5px] transition-colors',
                          Math.abs(group.relevanceFloor - floor) < 0.05
                            ? 'bg-accent-soft font-semibold text-teal-800'
                            : 'text-stone-600 hover:bg-stone-50',
                        )}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                <label className="block">
                  <span className="text-[11px] font-medium text-stone-500">Most items</span>
                  <input
                    type="number"
                    min={1}
                    max={20}
                    value={group.count.max}
                    onChange={(event) =>
                      patchGroup(group.id, {
                        count: { ...group.count, max: Math.max(1, Number(event.target.value) || 1) },
                      })
                    }
                    className="mt-1 block w-20 rounded-md border border-stone-200 px-2.5 py-1 text-[12.5px] text-stone-800 outline-none focus:border-teal-400"
                  />
                </label>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-3 rounded-xl border border-stone-200 bg-white p-4">
          <p className="text-[13.5px] font-semibold text-stone-900">Sources</p>
          <p className="mt-1 text-[12.5px] leading-relaxed text-stone-500">
            Applies to every section of this newsletter.
          </p>
          <label className="mt-3 block">
            <span className="text-[11px] font-medium text-stone-500">Never use these</span>
            <input
              value={blocked}
              onChange={(event) => {
                setBlocked(event.target.value);
                setSaved(null);
              }}
              placeholder="facebook.com, reddit.com"
              className="mt-1 w-full rounded-md border border-stone-200 px-2.5 py-1.5 text-[12.5px] text-stone-800 outline-none focus:border-teal-400"
            />
          </label>
          <label className="mt-2.5 block">
            <span className="text-[11px] font-medium text-stone-500">Prefer these (leave empty for the whole web)</span>
            <input
              value={preferred}
              onChange={(event) => {
                setPreferred(event.target.value);
                setSaved(null);
              }}
              placeholder="mondaq.com, law360.com, step.org"
              className="mt-1 w-full rounded-md border border-stone-200 px-2.5 py-1.5 text-[12.5px] text-stone-800 outline-none focus:border-teal-400"
            />
          </label>
        </div>

        <div className="sticky bottom-0 mt-3 flex items-center justify-end gap-3 rounded-xl border border-stone-200 bg-white/95 px-4 py-2.5 backdrop-blur">
          {saved && <span className="text-[12px] text-stone-500">{saved}</span>}
          {dirty && !saved && <span className="text-[12px] text-amber-700">Unsaved changes</span>}
          <Button variant="primary" size="sm" onClick={() => void saveTuning()} loading={saving}>
            Save changes
          </Button>
        </div>
      </section>
    </div>
  );
}
