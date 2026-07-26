import { useState } from 'react';
import { Button, cx } from './ui';

const EXAMPLES = [
  'daily wealth and succession news for private client advisers, india singapore and us, keep items short',
  'weekly digest of family office and trust regulation across singapore, hong kong and the uae',
  'estate litigation and probate rulings in the us, last 7 days, detailed items with why it matters',
];

interface Props {
  onCreate: (input: { prompt?: string; sample?: string }) => Promise<void>;
  busy: boolean;
  error: string | null;
}

/**
 * The entry point. One box, a crude prompt, and a newsletter comes back.
 *
 * The sample tab exists because a user may have an example newsletter rather
 * than a description. Both paths converge on the same brief and blueprint, so
 * it does not matter which door they come through.
 */
export function StartScreen({ onCreate, busy, error }: Props) {
  const [mode, setMode] = useState<'describe' | 'sample'>('describe');
  const [prompt, setPrompt] = useState('');
  const [sample, setSample] = useState('');

  const canSubmit = mode === 'describe' ? prompt.trim().length > 3 : sample.trim().length > 40;

  const submit = () => {
    if (!canSubmit || busy) return;
    void onCreate(
      mode === 'describe'
        ? { prompt: prompt.trim() }
        : { sample: sample.trim(), ...(prompt.trim() ? { prompt: prompt.trim() } : {}) },
    );
  };

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center px-6 py-16">
      <img src="/cawt-logo.png" alt="CapAlpha WhiteTrust" className="mb-7 h-10 w-auto self-start" />
      <h1 className="text-[28px] font-semibold leading-tight tracking-[-0.02em] text-stone-900">
        Describe the newsletter you want.
      </h1>
      <p className="mt-2 text-[15px] leading-relaxed text-stone-500">
        Write it however you like, in plain English. The sections, how recent the news should be and how long each item
        runs are worked out for you, then shown as a draft you can change.
      </p>

      <div className="mt-7 inline-flex self-start rounded-lg border border-stone-200 bg-white p-0.5">
        {(
          [
            ['describe', 'Describe it'],
            ['sample', 'Paste an example'],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            onClick={() => setMode(value)}
            className={cx(
              'rounded-md px-3 py-1.5 text-[13px] font-medium transition-colors',
              mode === value ? 'bg-stone-900 text-white' : 'text-stone-600 hover:text-stone-900',
            )}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="mt-3 rounded-xl border border-stone-200 bg-white shadow-sm transition-shadow focus-within:border-stone-300 focus-within:shadow-md">
        {mode === 'describe' ? (
          <textarea
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) submit();
            }}
            rows={4}
            autoFocus
            placeholder="daily wealth and succession news for private client advisers, india singapore and us, keep items short"
            className="w-full resize-none rounded-xl bg-transparent px-4 py-3.5 text-[15px] leading-relaxed text-stone-900 outline-none placeholder:text-stone-400"
          />
        ) : (
          <>
            <textarea
              value={sample}
              onChange={(event) => setSample(event.target.value)}
              rows={10}
              autoFocus
              placeholder="Paste an existing newsletter here. HTML source works best, because heading levels come through exactly. Plain text is fine too."
              className="w-full resize-none rounded-t-xl bg-transparent px-4 py-3.5 font-mono text-[12.5px] leading-relaxed text-stone-800 outline-none placeholder:font-sans placeholder:text-[14px] placeholder:text-stone-400"
            />
            <div className="border-t border-stone-100 px-4 py-2.5">
              <input
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                placeholder="Optional: what to change about it, e.g. &quot;like this but add Europe&quot;"
                className="w-full bg-transparent text-[14px] text-stone-800 outline-none placeholder:text-stone-400"
              />
            </div>
          </>
        )}

        <div className="flex items-center justify-between gap-3 border-t border-stone-100 px-3 py-2.5">
          <span className="pl-1 text-[12px] text-stone-400">
            {mode === 'sample' ? 'Structure is read from the example. Guesses are labelled.' : 'Ctrl + Enter to build'}
          </span>
          <Button variant="primary" onClick={submit} disabled={!canSubmit} loading={busy}>
            {busy ? 'Building' : 'Build the draft'}
          </Button>
        </div>
      </div>

      {error && (
        <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-[13px] text-red-800">{error}</div>
      )}

      {mode === 'describe' && (
        <div className="mt-8">
          <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-stone-400">Try one of these</p>
          <div className="mt-2.5 flex flex-col gap-1.5">
            {EXAMPLES.map((example) => (
              <button
                key={example}
                onClick={() => setPrompt(example)}
                className="rounded-lg border border-stone-200 bg-white px-3.5 py-2.5 text-left text-[13.5px] leading-snug text-stone-600 transition-colors hover:border-stone-300 hover:bg-stone-50 hover:text-stone-900"
              >
                {example}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
