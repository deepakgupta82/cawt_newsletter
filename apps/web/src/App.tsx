import { useCallback, useEffect, useRef, useState } from 'react';
import type { AppConfig, ConversationMessage, Edition, Newsletter, NewsletterSummary, StoryBlock } from './lib/types';
import { api } from './lib/api';
import { StartScreen } from './components/StartScreen';
import { DesignerPanel } from './components/DesignerPanel';
import { MainPane } from './components/MainPane';
import { LoginScreen, type Session } from './components/LoginScreen';
import { cx, Pill } from './components/ui';

const SESSION_KEY = 'cawt.session';
const RAIL_KEY = 'cawt.railOpen';
const WIDTH_KEY = 'cawt.designerWidth';

function collectStories(edition: Edition): StoryBlock[] {
  const out: StoryBlock[] = [];
  for (const block of edition.blocks) {
    if (block.type === 'story') out.push(block);
    if (block.type === 'section') for (const child of block.children) if (child.type === 'story') out.push(child);
  }
  return out;
}

function readSession(): Session | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

function Icon({ path, className }: { path: string; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" className={className ?? 'h-[17px] w-[17px]'}>
      <path d={path} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function scheduleLabel(schedule: Newsletter['schedule']): string | null {
  if (!schedule?.enabled) return null;
  const match = /^(\d+)\s+(\d+)\s+\*\s+\*\s+(.+)$/.exec(schedule.cron);
  if (!match) return 'Scheduled';
  const time = `${match[2]!.padStart(2, '0')}:${match[1]!.padStart(2, '0')}`;
  const dow = match[3];
  if (dow === '*') return `Daily ${time}`;
  if (dow === '1-5') return `Weekdays ${time}`;
  return `Weekly ${time}`;
}

function StatusChip({ status }: { status: string }) {
  const tones: Record<string, string> = {
    active: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
    draft: 'bg-stone-100 text-stone-600 ring-stone-200',
    paused: 'bg-amber-50 text-amber-700 ring-amber-200',
    archived: 'bg-stone-100 text-stone-500 ring-stone-200',
  };
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10.5px] font-medium capitalize ring-1 ring-inset',
        tones[status] ?? tones['draft'],
      )}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />
      {status}
    </span>
  );
}

export default function App() {
  const [session, setSession] = useState<Session | null>(readSession);
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

  const [railOpen, setRailOpen] = useState(() => localStorage.getItem(RAIL_KEY) !== 'false');
  const [filter, setFilter] = useState('');
  const [userMenu, setUserMenu] = useState(false);
  const [designerWidth, setDesignerWidth] = useState(() => Number(localStorage.getItem(WIDTH_KEY)) || 380);
  const [focus, setFocus] = useState<{ tab: string; n: number }>({ tab: 'preview', n: 0 });
  const splitRef = useRef<HTMLDivElement>(null);

  const requestTab = (tab: string) => setFocus((current) => ({ tab, n: current.n + 1 }));

  useEffect(() => {
    if (!session) return;
    void api.config().then(setConfig).catch(() => undefined);
    void api.listNewsletters().then(setList).catch(() => undefined);
  }, [session]);

  useEffect(() => localStorage.setItem(RAIL_KEY, String(railOpen)), [railOpen]);

  const open = useCallback(async (id: string) => {
    setError(null);
    setEdition(null);
    setLastCost(null);
    setShowStart(false);
    const [newsletter, thread] = await Promise.all([api.getNewsletter(id), api.conversation(id)]);
    setActive(newsletter);
    setMessages(thread);
  }, []);

  const openEdition = useCallback(async (editionId: string) => {
    try {
      setEdition(await api.getEdition(editionId));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not open that edition');
    }
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

  const startDrag = (event: React.PointerEvent) => {
    event.preventDefault();
    const move = (moveEvent: PointerEvent) => {
      const rect = splitRef.current?.getBoundingClientRect();
      if (!rect) return;
      setDesignerWidth(Math.max(300, Math.min(640, moveEvent.clientX - rect.left)));
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setDesignerWidth((width) => {
        localStorage.setItem(WIDTH_KEY, String(width));
        return width;
      });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const logout = () => {
    localStorage.removeItem(SESSION_KEY);
    setSession(null);
    setUserMenu(false);
    setActive(null);
    setEdition(null);
  };

  const login = (next: Session) => {
    localStorage.setItem(SESSION_KEY, JSON.stringify(next));
    setSession(next);
  };

  if (!session) return <LoginScreen onLogin={login} />;

  const usingMocks = config ? config.llm === 'mock' || config.search === 'mock' : false;
  const live = config ? config.llm !== 'mock' : false;
  const startMode = showStart || (!active && list.length === 0);
  const filtered = filter.trim()
    ? list.filter((item) => item.name.toLowerCase().includes(filter.trim().toLowerCase()))
    : list;

  const stories = edition ? collectStories(edition) : [];
  const flagged = stories.filter((story) => story.warnings.length > 0).length;

  const newNewsletter = () => {
    setActive(null);
    setEdition(null);
    setShowStart(true);
  };

  const initials = (session.name || session.email)
    .split(/[\s.@]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join('');

  const metrics: Array<{ k: string; v: string; d: string; tone?: 'good' | 'warn' }> = [
    {
      k: 'This run',
      v: lastCost !== null ? `$${lastCost.toFixed(4)}` : '—',
      d: config ? `model ${config.llm === 'mock' ? 'mock' : config.modelWriter}` : 'no run yet',
    },
    { k: 'Monthly cap', v: config ? `$${config.monthlyCapUsd.toFixed(2)}` : '—', d: 'provider spend ceiling' },
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
      {/* ---- Dark operations rail (collapsible) ---- */}
      {railOpen ? (
        <aside className="flex w-60 shrink-0 flex-col bg-rail text-rail-ink">
          <div className="flex items-start justify-between px-4 pb-3 pt-5">
            <div>
              <img src="/cawt-logo-white.png" alt="CapAlpha WhiteTrust" className="h-11 w-auto" />
              <p className="mt-2.5 text-[11px] font-medium uppercase tracking-[0.14em] text-slate-500">
                Newsletter Studio
              </p>
            </div>
            <button
              onClick={() => setRailOpen(false)}
              title="Collapse sidebar"
              className="rounded-md p-1 text-slate-500 transition-colors hover:bg-white/5 hover:text-white"
            >
              <Icon path="M15 6l-6 6 6 6" className="h-4 w-4" />
            </button>
          </div>

          <div className="px-3 pb-2">
            <button
              onClick={newNewsletter}
              className="w-full rounded-lg bg-teal-600 px-3 py-2 text-[13px] font-medium text-white transition-colors hover:bg-teal-500"
            >
              + New newsletter
            </button>
          </div>

          <div className="px-3 pb-1">
            <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5">
              <Icon path="M11 4a7 7 0 105 12l4 4" className="h-3.5 w-3.5 text-slate-500" />
              <input
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
                placeholder="Search newsletters"
                className="w-full bg-transparent text-[12.5px] text-white outline-none placeholder:text-slate-500"
              />
            </div>
          </div>

          <p className="px-4 pb-1.5 pt-3 text-[10px] font-bold uppercase tracking-[0.13em] text-slate-500">
            Newsletters ({list.length})
          </p>

          <nav className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
            {filtered.length === 0 ? (
              <p className="px-3 py-3 text-[12px] leading-relaxed text-slate-500">
                {list.length === 0 ? 'Nothing yet. Describe one, or paste an example.' : 'No newsletter matches that search.'}
              </p>
            ) : (
              filtered.map((item) => (
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
      ) : (
        <aside className="flex w-16 shrink-0 flex-col items-center gap-1.5 bg-rail py-4 text-rail-ink">
          <img src="/cawt-logo-white.png" alt="CAWT" title="CapAlpha WhiteTrust" className="mb-2 w-11" />
          <button
            onClick={() => setRailOpen(true)}
            title="Expand sidebar"
            className="grid h-9 w-9 place-items-center rounded-lg text-slate-300 transition-colors hover:bg-white/5 hover:text-white"
          >
            <Icon path="M9 6l6 6-6 6" className="h-[18px] w-[18px]" />
          </button>
          <button
            onClick={newNewsletter}
            title="New newsletter"
            className="grid h-9 w-9 place-items-center rounded-lg bg-teal-600 text-white transition-colors hover:bg-teal-500"
          >
            <Icon path="M12 5v14M5 12h14" className="h-[18px] w-[18px]" />
          </button>
          <div
            className="mt-1 grid h-9 w-9 place-items-center rounded-lg text-slate-400"
            title={`${list.length} newsletters`}
          >
            <Icon path="M4 5h16v4H4zM4 12h9v7H4zM16 12h4v7h-4z" className="h-[17px] w-[17px]" />
          </div>
          <span
            className={cx('mt-auto h-1.5 w-1.5 rounded-full', live ? 'bg-emerald-400 animate-pulse-soft' : 'bg-sky-400')}
            title={live ? 'Live models' : 'Local mocks'}
          />
        </aside>
      )}

      {/* ---- Main column ---- */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex shrink-0 items-center justify-between gap-4 border-b border-line bg-white px-5 py-3 shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="truncate text-[15px] font-semibold leading-tight tracking-[-0.01em] text-ink">
                {active ? active.name : startMode ? 'New newsletter' : 'Newsletter Studio'}
              </h1>
              {active && <StatusChip status={active.status} />}
              {active && (
                <button
                  onClick={() => requestTab('audience')}
                  title={
                    active.schedule?.enabled
                      ? `${active.schedule.cron} (${active.schedule.timezone})`
                      : 'Set recipients and a delivery schedule'
                  }
                  className={cx(
                    'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[10.5px] font-medium transition-colors',
                    active.schedule?.enabled
                      ? 'border-teal-200 bg-accent-soft text-teal-800 hover:border-teal-300'
                      : 'border-stone-200 text-stone-500 hover:bg-stone-50 hover:text-stone-800',
                  )}
                >
                  <Icon path="M12 7v5l3 2M12 21a9 9 0 100-18 9 9 0 000 18z" className="h-3 w-3" />
                  {scheduleLabel(active.schedule) ?? 'Not scheduled'}
                </button>
              )}
            </div>
            <p className="text-[11.5px] leading-tight text-muted">
              {active ? `Blueprint v${active.blueprint.version}` : 'Prompt-driven authoring for CapAlpha WhiteTrust'}
            </p>
          </div>

          <div className="flex items-center gap-3">
            {config && (
              <div className="hidden items-center gap-1 rounded-lg border border-line bg-canvas px-1.5 py-1 lg:flex">
                <Pill tone={config.llm === 'mock' ? 'mock' : 'live'}>
                  model {config.llm === 'mock' ? 'mock' : config.modelWriter}
                </Pill>
                <Pill tone={config.search === 'mock' ? 'mock' : 'live'}>search {config.search}</Pill>
                <Pill tone={config.email === 'eml' ? 'mock' : 'live'}>email {config.email}</Pill>
                <Pill>store {config.storage}</Pill>
              </div>
            )}

            <div className="hidden h-6 w-px bg-line lg:block" />

            <div className="relative">
              <button
                onClick={() => setUserMenu((open) => !open)}
                className="flex items-center gap-2 rounded-lg border border-line py-1 pl-1 pr-2 transition-colors hover:bg-stone-50"
              >
                <span className="grid h-7 w-7 place-items-center rounded-md bg-rail text-[11px] font-semibold text-white">
                  {initials}
                </span>
                <Icon path="M6 9l6 6 6-6" className="h-3.5 w-3.5 text-stone-400" />
              </button>
              {userMenu && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setUserMenu(false)} />
                  <div className="absolute right-0 z-20 mt-1.5 w-56 rounded-xl border border-line bg-white p-1.5 shadow-lg">
                    <div className="px-2.5 py-2">
                      <p className="truncate text-[13px] font-medium text-ink">{session.name}</p>
                      <p className="truncate text-[11.5px] text-muted">{session.email}</p>
                    </div>
                    <div className="my-1 h-px bg-line" />
                    <button
                      onClick={logout}
                      className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] text-stone-700 transition-colors hover:bg-stone-50"
                    >
                      <Icon path="M15 12H3m0 0l4-4m-4 4l4 4M17 4h2a2 2 0 012 2v12a2 2 0 01-2 2h-2" className="h-4 w-4" />
                      Sign out
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
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

            <div ref={splitRef} className="flex min-h-0 flex-1">
              <div style={{ width: designerWidth }} className="shrink-0">
                <DesignerPanel newsletter={active} messages={messages} onRefine={refine} busy={busy} />
              </div>
              <div
                onPointerDown={startDrag}
                title="Drag to resize"
                className="group w-1 shrink-0 cursor-col-resize bg-line transition-colors hover:bg-teal-500"
              >
                <div className="mx-auto h-full w-px bg-transparent group-hover:bg-teal-500" />
              </div>
              <div className="min-w-0 flex-1">
                <MainPane
                  newsletter={active}
                  edition={edition}
                  onPreview={preview}
                  previewing={previewing}
                  lastCost={lastCost}
                  onOpenEdition={openEdition}
                  onNewsletterChange={(next) => {
                    setActive(next);
                    void api.listNewsletters().then(setList);
                  }}
                  focusTab={focus.tab as never}
                  focusSignal={focus.n}
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
