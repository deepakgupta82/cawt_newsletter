import { useCallback, useEffect, useState } from 'react';
import type { AppConfig, ConversationMessage, Edition, Newsletter, NewsletterSummary, StoryBlock } from './lib/types';
import { api } from './lib/api';
import { StartScreen } from './components/StartScreen';
import { DesignerPanel } from './components/DesignerPanel';
import { MainPane } from './components/MainPane';
import { cx, Pill } from './components/ui';

/** Stories live either at the top level or one section deep. */
function collectStories(edition: Edition): StoryBlock[] {
  const out: StoryBlock[] = [];
  for (const block of edition.blocks) {
    if (block.type === 'story') out.push(block);
    if (block.type === 'section') for (const child of block.children) if (child.type === 'story') out.push(child);
  }
  return out;
}

function RailIcon({ path }: { path: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" className="h-[17px] w-[17px] shrink-0">
      <path d={path} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function App() {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [list, setList] = useState<NewsletterSummary[]>([]);
  const [active, setActive] = useState<Newsletter | null>(null);
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [edition, setEdition] = useState<Edition | null>(null);
  const [lastCost, setLastCost] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showStart, setShowStart] = useState(false);

  useEffect(() => {
    void api.config().then(setConfig).catch(() => undefined);
    void api.listNewsletters().then(setList).catch(() => undefined);
  }, []);

  const open = useCallback(async (id: string) => {
    setError(null);
    setEdition(null);
    setLastCost(null);
    setShowStart(false);
    const [newsletter, thread] = await Promise.all([api.getNewsletter(id), api.conversation(id)]);
    setActive(newsletter);
    setMessages(thread);
  }, []);

  const create = useCallback(
    async (input: { prompt?: string; sample?: string }) => {
      setBusy(true);
      setError(null);
      try {
        const result = await api.createNewsletter(input);
        setLastCost(result.cost);
        setList(await api.listNewsletters());
        await open(result.newsletter.id);
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'Could not build the newsletter');
      } finally {
        setBusy(false);
      }
    },
    [open],
  );

  const refine = useCallback(
    async (instruction: string) => {
      if (!active) return;
      setBusy(true);
      setError(null);
      try {
        const result = await api.refine(active.id, instruction);
        setActive(result.newsletter);
        setMessages(await api.conversation(active.id));
        setLastCost(result.cost);
        // Structure changed, so any rendered edition is now out of date.
        setEdition(null);
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'Could not apply that change');
      } finally {
        setBusy(false);
      }
    },
    [active],
  );

  const preview = useCallback(async () => {
    if (!active) return;
    setPreviewing(true);
    setError(null);
    try {
      const result = await api.preview(active.id);
      setEdition(result.edition);
      setLastCost(result.cost);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not generate a preview');
    } finally {
      setPreviewing(false);
    }
  }, [active]);

  const usingMocks = config ? config.llm === 'mock' || config.search === 'mock' : false;
  const live = config ? config.llm !== 'mock' : false;
  const startMode = showStart || (!active && list.length === 0);

  const stories = edition ? collectStories(edition) : [];
  const flagged = stories.filter((story) => story.warnings.length > 0).length;

  const newNewsletter = () => {
    setActive(null);
    setEdition(null);
    setShowStart(true);
  };

  const metrics: Array<{ k: string; v: string; d: string; tone?: 'good' | 'warn' }> = [
    {
      k: 'This run',
      v: lastCost !== null ? `$${lastCost.toFixed(4)}` : '—',
      d: config ? `model ${config.llm === 'mock' ? 'mock' : config.modelWriter}` : 'no run yet',
    },
    {
      k: 'Monthly cap',
      v: config ? `$${config.monthlyCapUsd.toFixed(2)}` : '—',
      d: 'provider spend ceiling',
    },
    {
      k: 'Stories',
      v: edition ? String(stories.length) : '—',
      d: edition ? `${stories.reduce((sum, s) => sum + s.sources.length, 0)} sources cited` : 'run to populate',
    },
    {
      k: 'Fact checks',
      v: edition ? String(flagged) : '—',
      d: edition ? (flagged === 0 ? 'all figures traced' : 'to review') : 'run to check',
      tone: edition ? (flagged === 0 ? 'good' : 'warn') : undefined,
    },
  ];

  return (
    <div className="flex h-full">
      {/* ---- Dark operations rail ---- */}
      <aside className="flex w-60 shrink-0 flex-col bg-rail text-rail-ink">
        <div className="px-4 pb-4 pt-5">
          <img src="/cawt-logo-white.png" alt="CapAlpha WhiteTrust" className="h-11 w-auto" />
          <p className="mt-2.5 text-[11px] font-medium uppercase tracking-[0.14em] text-slate-500">
            Newsletter Studio
          </p>
        </div>

        <div className="px-3 pb-1">
          <button
            onClick={newNewsletter}
            className="w-full rounded-lg bg-teal-600 px-3 py-2 text-[13px] font-medium text-white transition-colors hover:bg-teal-500"
          >
            + New newsletter
          </button>
        </div>

        <p className="px-4 pb-1.5 pt-4 text-[10px] font-bold uppercase tracking-[0.13em] text-slate-500">Workspace</p>
        <div className="flex items-center gap-2.5 rounded-lg px-3.5 py-2 text-[13px] text-white">
          <RailIcon path="M4 5h16v4H4zM4 12h9v7H4zM16 12h4v7h-4z" />
          Newsletters
          <span className="ml-auto rounded bg-white/10 px-1.5 py-0.5 text-[10px] font-medium text-slate-300">
            {list.length}
          </span>
        </div>

        <nav className="mt-1 min-h-0 flex-1 overflow-y-auto px-2 pb-3">
          {list.length === 0 ? (
            <p className="px-3 py-3 text-[12px] leading-relaxed text-slate-500">
              Nothing yet. Describe one, or paste an example of a newsletter you already send.
            </p>
          ) : (
            list.map((item) => (
              <button
                key={item.id}
                onClick={() => void open(item.id)}
                className={cx(
                  'mb-0.5 flex w-full flex-col rounded-lg px-3 py-2 text-left transition-colors',
                  active?.id === item.id ? 'bg-rail-2 text-white' : 'text-slate-300 hover:bg-white/5',
                )}
              >
                <span className="truncate text-[12.5px] font-medium">{item.name}</span>
                <span className="text-[10.5px] text-slate-500">
                  v{item.blueprintVersion} &middot; {item.status}
                </span>
              </button>
            ))
          )}
        </nav>

        <div className="border-t border-white/5 px-4 py-3">
          <div className="flex items-center gap-2 text-[11px] text-slate-400">
            <span className={cx('h-1.5 w-1.5 rounded-full', live ? 'bg-emerald-400 animate-pulse-soft' : 'bg-sky-400')} />
            {live ? 'Live models' : 'Local mocks'}
            {live && <span className="ml-auto text-slate-500">South India</span>}
          </div>
        </div>
      </aside>

      {/* ---- Main column ---- */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex shrink-0 items-center justify-between gap-4 border-b border-line bg-white px-5 py-2.5">
          <div className="min-w-0">
            <p className="truncate text-[14px] font-semibold leading-tight text-ink">
              {active ? active.name : startMode ? 'New newsletter' : 'Newsletter Studio'}
            </p>
            <p className="text-[11px] leading-tight text-muted">
              {active ? `Blueprint v${active.blueprint.version} · ${active.status}` : 'Prompt-driven authoring'}
            </p>
          </div>

          {config && (
            <div className="flex items-center gap-1.5">
              <Pill tone={config.llm === 'mock' ? 'mock' : 'live'}>
                model {config.llm === 'mock' ? 'mock' : config.modelWriter}
              </Pill>
              <Pill tone={config.search === 'mock' ? 'mock' : 'live'}>search {config.search}</Pill>
              <Pill tone={config.email === 'eml' ? 'mock' : 'live'}>email {config.email}</Pill>
              <Pill>store {config.storage}</Pill>
            </div>
          )}
        </header>

        {usingMocks && (
          <div className="shrink-0 border-b border-sky-200 bg-sky-50 px-5 py-1.5 text-[12px] text-sky-800">
            Running on local mocks. No provider is being billed, no email leaves this machine, and results are
            identical on every run.
          </div>
        )}

        {startMode || !active ? (
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
            <StartScreen onCreate={create} busy={busy} error={error} />
          </div>
        ) : (
          <>
            <div className="grid shrink-0 grid-cols-2 gap-3 border-b border-line bg-canvas px-5 py-3.5 sm:grid-cols-4">
              {metrics.map((m) => (
                <div key={m.k} className="rounded-xl border border-line bg-white px-4 py-2.5">
                  <p className="text-[10.5px] uppercase tracking-[0.07em] text-muted">{m.k}</p>
                  <p className="mt-0.5 text-[21px] font-semibold tracking-[-0.02em] text-ink tabular-nums">{m.v}</p>
                  <p
                    className={cx(
                      'text-[11px]',
                      m.tone === 'good' ? 'text-emerald-600' : m.tone === 'warn' ? 'text-amber-600' : 'text-muted',
                    )}
                  >
                    {m.d}
                  </p>
                </div>
              ))}
            </div>

            <div className="flex min-h-0 flex-1">
              <div className="w-[380px] shrink-0">
                <DesignerPanel newsletter={active} messages={messages} onRefine={refine} busy={busy} />
              </div>
              <div className="min-w-0 flex-1">
                <MainPane
                  newsletter={active}
                  edition={edition}
                  onPreview={preview}
                  previewing={previewing}
                  lastCost={lastCost}
                />
              </div>
            </div>
          </>
        )}

        {error && active && (
          <div className="shrink-0 border-t border-red-200 bg-red-50 px-5 py-2 text-[12.5px] text-red-800">{error}</div>
        )}
      </div>
    </div>
  );
}
