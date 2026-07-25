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
    <div className="flex h-full flex-col border-r border-stone-200 bg-white">
      <div className="border-b border-stone-200 px-5 py-4">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="truncate text-[15px] font-semibold text-stone-900">{newsletter.name}</h2>
          <span className="shrink-0 text-[11px] text-stone-400">v{newsletter.blueprint.version}</span>
        </div>
        <p className="mt-2 text-[13px] leading-relaxed text-stone-600">{newsletter.brief.text}</p>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-stone-400">Design history</p>
        <div className="space-y-3">
          {messages.map((message) => (
            <div
              key={message.id}
              className={cx(
                'rounded-lg px-3 py-2.5 text-[13px] leading-relaxed',
                message.role === 'user'
                  ? 'border border-stone-200 bg-stone-50 text-stone-800'
                  : 'border border-teal-200/70 bg-teal-50/60 text-teal-900',
              )}
            >
              <div className="mb-1 flex items-center gap-2">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-stone-400">
                  {kindLabel(message.kind)}
                </span>
                {message.producedBlueprintVersion !== undefined && (
                  <span className="rounded bg-white px-1.5 py-0.5 text-[10px] font-medium text-stone-500 ring-1 ring-inset ring-stone-200">
                    v{message.producedBlueprintVersion}
                  </span>
                )}
              </div>
              <p className="whitespace-pre-wrap">{message.content}</p>
            </div>
          ))}
          {busy && (
            <div className="flex items-center gap-2 rounded-lg border border-stone-200 bg-stone-50 px-3 py-2.5 text-[13px] text-stone-500">
              <Spinner />
              Rebuilding the structure
            </div>
          )}
          <div ref={endRef} />
        </div>
      </div>

      <div className="border-t border-stone-200 p-3">
        <div className="mb-2 flex flex-wrap gap-1.5">
          {QUICK_EDITS.map((quick) => (
            <button
              key={quick}
              onClick={() => submit(quick)}
              disabled={busy}
              className="rounded-md border border-stone-200 bg-white px-2 py-1 text-[11.5px] text-stone-600 transition-colors hover:border-stone-300 hover:bg-stone-50 hover:text-stone-900 disabled:opacity-50"
            >
              {quick}
            </button>
          ))}
        </div>
        <div className="rounded-lg border border-stone-200 bg-white transition-shadow focus-within:border-stone-300 focus-within:shadow-sm">
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
          <div className="flex items-center justify-between border-t border-stone-100 px-2.5 py-1.5">
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
