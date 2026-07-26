import { useEffect, useRef, useState } from 'react';
import type { ConversationMessage, Newsletter } from '../lib/types';
import { Button, cx, Spinner } from './ui';

interface Props {
  newsletter: Newsletter;
  messages: ConversationMessage[];
  onRefine: (instruction: string) => Promise<void>;
  busy: boolean;
}

const QUICK_EDITS = ['Make items shorter', 'Add a Europe section', 'Widen fresh to 7 days', 'Drop the bottom line'];

function kindLabel(kind: ConversationMessage['kind']): string {
  return { prompt: 'Prompt', sample: 'Sample', refinement: 'Change', note: 'Note', result: 'Understood as' }[kind];
}

/**
 * Renders the light markdown the model emits (**bold**) as real emphasis, and
 * turns blank lines into paragraph breaks. The brief and the "understood as"
 * summaries arrive as prose with the odd **bold** run; showing the raw asterisks
 * read as unfinished output.
 */
function RichText({ text }: { text: string }) {
  const paragraphs = text.split(/\n{2,}/).map((block) => block.trim()).filter(Boolean);
  return (
    <>
      {paragraphs.map((para, pi) => (
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

/**
 * The persistent design conversation.
 *
 * The thread lives with the newsletter, so reopening it in three months and
 * saying "add Europe" does not mean re-explaining what the newsletter is. Every
 * blueprint version records the message that produced it.
 */
export function DesignerPanel({ newsletter, messages, onRefine, busy }: Props) {
  const [instruction, setInstruction] = useState('');
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages.length, busy]);

  const submit = (value?: string) => {
    const text = (value ?? instruction).trim();
    if (!text || busy) return;
    setInstruction('');
    void onRefine(text);
  };

  return (
    <div className="flex h-full flex-col bg-stone-100/70">
      {/* Header + brief card */}
      <div className="shrink-0 px-4 pt-4">
        <div className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm">
          <div className="flex items-baseline justify-between gap-2">
            <h2 className="truncate text-[15px] font-semibold text-stone-900">{newsletter.name}</h2>
            <span className="shrink-0 rounded-md bg-stone-100 px-1.5 py-0.5 text-[10px] font-medium text-stone-500 ring-1 ring-inset ring-stone-200">
              v{newsletter.blueprint.version}
            </span>
          </div>
          <div className="mt-3 rounded-lg bg-stone-50 p-3 ring-1 ring-inset ring-stone-200/70">
            <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.09em] text-stone-400">Brief</p>
            <div className="text-[13px] leading-6 text-stone-700">
              <RichText text={newsletter.brief.text} />
            </div>
          </div>
        </div>
      </div>

      {/* Design history */}
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <p className="mb-2.5 px-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-stone-400">
          Design history
        </p>
        <div className="space-y-2.5">
          {messages.map((message) => {
            const isUser = message.role === 'user';
            return (
              <div
                key={message.id}
                className={cx(
                  'rounded-xl border p-3 text-[13px] leading-6 shadow-sm',
                  isUser
                    ? 'border-stone-200 bg-white text-stone-800'
                    : 'border-l-[3px] border-l-teal-500 border-y-teal-100 border-r-teal-100 bg-teal-50/70 text-teal-950',
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
                  {message.producedBlueprintVersion !== undefined && (
                    <span className="rounded bg-white px-1.5 py-0.5 text-[10px] font-medium text-stone-500 ring-1 ring-inset ring-stone-200">
                      v{message.producedBlueprintVersion}
                    </span>
                  )}
                </div>
                <div className="whitespace-pre-wrap">
                  <RichText text={message.content} />
                </div>
              </div>
            );
          })}
          {busy && (
            <div className="flex items-center gap-2 rounded-xl border border-stone-200 bg-white px-3 py-2.5 text-[13px] text-stone-500 shadow-sm">
              <Spinner />
              Rebuilding the structure
            </div>
          )}
          <div ref={endRef} />
        </div>
      </div>

      {/* Composer */}
      <div className="shrink-0 border-t border-stone-200 bg-white p-3">
        <p className="mb-1.5 px-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-stone-400">
          Quick changes
        </p>
        <div className="mb-2.5 flex flex-wrap gap-1.5">
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
        <div className="rounded-xl border border-stone-200 bg-stone-50 transition-shadow focus-within:border-teal-300 focus-within:bg-white focus-within:shadow-sm">
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
            placeholder="Change something. &quot;Add a Middle East section&quot;, &quot;only last 4 days&quot;..."
            className="w-full resize-none bg-transparent px-3 py-2.5 text-[13.5px] leading-relaxed text-stone-900 outline-none placeholder:text-stone-400"
          />
          <div className="flex items-center justify-between border-t border-stone-200/70 px-2.5 py-1.5">
            <span className="text-[11px] text-stone-400">Enter to send</span>
            <Button size="sm" variant="primary" onClick={() => submit()} disabled={!instruction.trim()} loading={busy}>
              Apply
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
