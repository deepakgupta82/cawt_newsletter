import { useCallback, useEffect, useRef, useState } from 'react';
import type { AppConfig, ConversationMessage, Edition, Newsletter, NewsletterSummary } from './lib/types';
import { api } from './lib/api';
import { scheduleLabel } from './lib/edition';
import { StartScreen } from './components/StartScreen';
import { OverviewPanel } from './components/OverviewPanel';
import { EditionPanel } from './components/EditionPanel';
import { DesignPanel } from './components/DesignPanel';
import { AudiencePanel } from './components/AudiencePanel';
import { SentPanel } from './components/SentPanel';
import { AdminPanel } from './components/AdminPanel';
import { LoginScreen, type Session } from './components/LoginScreen';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ConfirmDialog } from './components/ConfirmDialog';
import { Button, cx, Spinner } from './components/ui';

const SESSION_KEY = 'cawt.session';
const RAIL_KEY = 'cawt.railOpen';

type Tab = 'overview' | 'edition' | 'design' | 'audience' | 'sent';

const TABS: Array<[Tab, string]> = [
  ['overview', 'Overview'],
  ['edition', 'Edition'],
  ['design', 'Design'],
  ['audience', 'Audience'],
  ['sent', 'Sent'],
];

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

/** A small fact about the newsletter, shown as a chip under its name. */
function Chip({ children, tone = 'plain', onClick, title }: {
  children: React.ReactNode;
  tone?: 'plain' | 'accent' | 'muted';
  onClick?: () => void;
  title?: string;
}) {
  const className = cx(
    'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium',
    tone === 'accent'
      ? 'border-teal-200 bg-accent-soft text-teal-800'
      : tone === 'muted'
        ? 'border-stone-200 bg-white text-stone-500'
        : 'border-stone-200 bg-stone-50 text-stone-600',
    onClick && 'transition-colors hover:border-stone-300 hover:text-stone-900',
  );
  return onClick ? (
    <button onClick={onClick} title={title} className={className}>
      {children}
    </button>
  ) : (
    <span title={title} className={className}>
      {children}
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
  const [busy, setBusy] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showStart, setShowStart] = useState(false);
  const [showAdmin, setShowAdmin] = useState(false);
  const [tab, setTab] = useState<Tab>('overview');
  const [refreshKey, setRefreshKey] = useState(0);

  const [railOpen, setRailOpen] = useState(() => localStorage.getItem(RAIL_KEY) !== 'false');
  const [filter, setFilter] = useState('');
  const [userMenu, setUserMenu] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [nameDraft, setNameDraft] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Building an edition takes the better part of a minute: it searches, reads
  // and writes every section. Without a visible clock that reads as a hang.
  useEffect(() => {
    if (!running) {
      setElapsed(0);
      return;
    }
    const started = Date.now();
    const timer = setInterval(() => setElapsed(Math.round((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [running]);

  useEffect(() => {
    if (!session) return;
    void api.config().then(setConfig).catch(() => undefined);
    void api.listNewsletters().then(setList).catch(() => undefined);
  }, [session]);

  useEffect(() => localStorage.setItem(RAIL_KEY, String(railOpen)), [railOpen]);

  const open = useCallback(async (id: string) => {
    setError(null);
    setEdition(null);
    setShowStart(false);
    setShowAdmin(false);
    setTab('overview');
    const [newsletter, thread] = await Promise.all([api.getNewsletter(id), api.conversation(id)]);
    setActive(newsletter);
    setMessages(thread);
    // The most recent edition is what an editor almost always wants in hand.
    // Falls back to the edition list so a summary that is unavailable leaves the
    // Edition tab populated rather than looking empty.
    void api
      .summary(id)
      .then((stats) => setEdition(stats.latestEdition))
      .catch(async () => {
        const editions = await api.editions(id).catch(() => [] as Edition[]);
        const newest = [...editions].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
        setEdition(newest ?? null);
      });
  }, []);

  // Deep link from the review email's Edit button: /?newsletter=<id> opens it.
  const deepLinked = useRef(false);
  useEffect(() => {
    if (!session || deepLinked.current) return;
    const id = new URLSearchParams(window.location.search).get('newsletter');
    if (!id) return;
    deepLinked.current = true;
    void open(id).catch(() => undefined);
    window.history.replaceState({}, '', window.location.pathname);
  }, [session, open]);

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
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'Could not apply that change');
      } finally {
        setBusy(false);
      }
    },
    [active],
  );

  const run = useCallback(async () => {
    if (!active) return;
    setRunning(true);
    setError(null);
    try {
      const result = await api.preview(active.id);
      setEdition(result.edition);
      setRefreshKey((key) => key + 1);
      setTab('edition');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not generate an edition');
    } finally {
      setRunning(false);
    }
  }, [active]);

  const saveName = async () => {
    if (!active || !nameDraft?.trim()) return;
    try {
      const updated = await api.updateNewsletter(active.id, { name: nameDraft.trim() });
      setActive(updated);
      setList(await api.listNewsletters());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not rename');
    } finally {
      setNameDraft(null);
    }
  };

  const removeNewsletter = async () => {
    if (!active) return;
    setDeleting(true);
    try {
      await api.deleteNewsletter(active.id);
      setActive(null);
      setEdition(null);
      setMessages([]);
      setList(await api.listNewsletters());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not delete');
    } finally {
      setDeleting(false);
      setConfirmDelete(false);
    }
  };

  const logout = () => {
    localStorage.removeItem(SESSION_KEY);
    setSession(null);
    setUserMenu(false);
    setActive(null);
    setEdition(null);
  };

  if (!session) return <LoginScreen onLogin={(next) => {
    localStorage.setItem(SESSION_KEY, JSON.stringify(next));
    setSession(next);
  }} />;

  const usingMocks = config ? config.llm === 'mock' || config.search === 'mock' : false;
  const live = config ? config.llm !== 'mock' : false;
  const startMode = showStart || (!active && !showAdmin && list.length === 0);
  const filtered = filter.trim()
    ? list.filter((item) => item.name.toLowerCase().includes(filter.trim().toLowerCase()))
    : list;

  const newNewsletter = () => {
    setActive(null);
    setEdition(null);
    setShowAdmin(false);
    setShowStart(true);
  };

  const initials = (session.name || session.email)
    .split(/[\s.@]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join('');

  const cadence = active ? scheduleLabel(active.schedule) : null;

  return (
    <div className="flex h-full">
      {/* ---- Navigation rail ---- */}
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
                    active?.id === item.id && !showAdmin ? 'bg-rail-2 text-white' : 'text-slate-300 hover:bg-white/5',
                  )}
                >
                  <span className="truncate text-[12.5px] font-medium">{item.name}</span>
                  <span className="text-[10.5px] capitalize text-slate-500">{item.status}</span>
                </button>
              ))
            )}
          </nav>

          <div className="border-t border-white/5 px-2 py-2">
            <button
              onClick={() => {
                setShowAdmin(true);
                setShowStart(false);
              }}
              className={cx(
                'flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[12.5px] transition-colors',
                showAdmin ? 'bg-rail-2 text-white' : 'text-slate-300 hover:bg-white/5',
              )}
            >
              <Icon path="M4 5h16v14H4zM4 10h16M9 10v9" className="h-4 w-4" />
              Admin &amp; costs
            </button>
            <div className="flex items-center gap-2 px-3 pb-1 pt-2 text-[11px] text-slate-400">
              <span className={cx('h-1.5 w-1.5 rounded-full', live ? 'bg-emerald-400 animate-pulse-soft' : 'bg-sky-400')} />
              {live ? 'Live' : 'Demonstration mode'}
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
          <button
            onClick={() => setShowAdmin(true)}
            title="Admin & costs"
            className="grid h-9 w-9 place-items-center rounded-lg text-slate-300 transition-colors hover:bg-white/5 hover:text-white"
          >
            <Icon path="M4 5h16v14H4zM4 10h16M9 10v9" className="h-[17px] w-[17px]" />
          </button>
          <span
            className={cx('mt-auto h-1.5 w-1.5 rounded-full', live ? 'bg-emerald-400 animate-pulse-soft' : 'bg-sky-400')}
            title={live ? 'Live' : 'Demonstration mode'}
          />
        </aside>
      )}

      {/* ---- Workspace ---- */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="shrink-0 border-b border-line bg-white px-6 pt-4">
          <div className="flex flex-wrap items-start gap-4">
            <div className="min-w-0 flex-1">
              {nameDraft !== null && active ? (
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    void saveName();
                  }}
                  className="flex items-center gap-2"
                >
                  <input
                    autoFocus
                    value={nameDraft}
                    onChange={(event) => setNameDraft(event.target.value)}
                    onKeyDown={(event) => event.key === 'Escape' && setNameDraft(null)}
                    aria-label="Newsletter name"
                    className="min-w-0 flex-1 rounded-lg border border-stone-300 px-2.5 py-1 text-[17px] font-semibold text-ink outline-none focus:border-teal-500"
                  />
                  <Button size="sm" variant="primary" type="submit" disabled={!nameDraft.trim()}>
                    Save
                  </Button>
                  <Button size="sm" type="button" onClick={() => setNameDraft(null)}>
                    Cancel
                  </Button>
                </form>
              ) : (
              <h1 className="truncate text-[18px] font-semibold leading-tight tracking-[-0.01em] text-ink">
                {showAdmin
                  ? 'Admin & costs'
                  : active
                    ? active.name
                    : startMode
                      ? 'New newsletter'
                      : 'Newsletter Studio'}
                {active && !showAdmin && (
                  <button
                    onClick={() => setNameDraft(active.name)}
                    title="Rename"
                    aria-label="Rename newsletter"
                    className="ml-2 align-middle text-stone-300 transition-colors hover:text-stone-600"
                  >
                    <Icon path="M4 20h4l10-10-4-4L4 16v4zM14 6l4 4" className="inline h-4 w-4" />
                  </button>
                )}
              </h1>
              )}
              {active && !showAdmin ? (
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  <Chip
                    tone={cadence ? 'accent' : 'muted'}
                    onClick={() => setTab('audience')}
                    title={
                      active.schedule?.enabled
                        ? `Sends automatically (${active.schedule.timezone})`
                        : 'Choose how often this goes out'
                    }
                  >
                    <Icon path="M12 7v5l3 2M12 21a9 9 0 100-18 9 9 0 000 18z" className="h-3 w-3" />
                    {cadence ?? 'Not scheduled'}
                  </Chip>
                  <Chip onClick={() => setTab('audience')}>
                    {active.autoPublish ? 'Sends without approval' : 'Needs your approval'}
                  </Chip>
                  
                </div>
              ) : (
                <p className="mt-1 text-[12.5px] text-muted">
                  {showAdmin
                    ? 'What each newsletter costs to run'
                    : 'Newsletters for CapAlpha WhiteTrust'}
                </p>
              )}
            </div>

            <div className="flex items-center gap-2">
              {active && !showAdmin && (
                <Button size="sm" onClick={() => void run()} loading={running}>
                  {edition ? 'Create a new edition' : "Create today's edition"}
                </Button>
              )}
              {active && !showAdmin && edition && edition.status !== 'sent' && (
                <Button variant="primary" size="sm" onClick={() => setTab('edition')}>
                  Review &amp; send
                </Button>
              )}
              {active && !showAdmin && (
                <button
                  onClick={() => setConfirmDelete(true)}
                  title="Delete this newsletter"
                  aria-label="Delete this newsletter"
                  className="rounded-lg border border-line px-2 py-2 text-stone-400 transition-colors hover:border-red-200 hover:bg-red-50 hover:text-red-600"
                >
                  <Icon path="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13" className="h-4 w-4" />
                </button>
              )}

              <div className="relative ml-1">
                <button
                  onClick={() => setUserMenu((value) => !value)}
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
          </div>

          {active && !showAdmin && (
            <div className="mt-3 flex gap-1">
              {TABS.map(([value, label]) => (
                <button
                  key={value}
                  onClick={() => setTab(value)}
                  className={cx(
                    'border-b-2 px-3 pb-2.5 pt-1 text-[13.5px] transition-colors',
                    tab === value
                      ? 'border-teal-600 font-semibold text-teal-800'
                      : 'border-transparent font-medium text-stone-500 hover:text-stone-900',
                  )}
                >
                  {label}
                  {value === 'edition' && (edition?.warnings?.length ?? 0) > 0 && (
                    <span className="ml-1.5 rounded-full border border-amber-200 bg-amber-50 px-1.5 text-[10.5px] font-bold text-amber-700">
                      {edition!.warnings.length}
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}
        </header>

        {usingMocks && (
          <div className="shrink-0 border-b border-sky-200 bg-sky-50 px-6 py-1.5 text-[12px] text-sky-800">
            Demonstration mode: sample content, nothing is charged and no email leaves this machine.
          </div>
        )}

        {running && (
          <div className="flex shrink-0 items-center gap-3 border-b border-teal-200 bg-accent-soft px-6 py-2 text-[12.5px] text-teal-900">
            <Spinner className="text-teal-700" />
            <span className="font-medium">Gathering today&apos;s news and writing the edition</span>
            <span className="text-teal-700">
              {elapsed < 60 ? `${elapsed}s` : `${Math.floor(elapsed / 60)}m ${elapsed % 60}s`} &middot; usually takes
              under a minute
            </span>
          </div>
        )}

        <main className="min-h-0 flex-1 overflow-y-auto bg-canvas">
          <ErrorBoundary resetKey={`${showAdmin ? 'admin' : (active?.id ?? 'none')}:${tab}`}>
          {showAdmin ? (
            <AdminPanel onOpenNewsletter={(id) => void open(id)} />
          ) : startMode || !active ? (
            <StartScreen onCreate={create} busy={busy} error={error} />
          ) : tab === 'overview' ? (
            <OverviewPanel
              newsletter={active}
              refreshKey={refreshKey}
              onOpenEdition={openEdition}
              onGoto={setTab}
              onRun={run}
              running={running}
            />
          ) : tab === 'edition' ? (
            <EditionPanel
              newsletter={active}
              edition={edition}
              onRun={run}
              running={running}
              onSent={() => setRefreshKey((key) => key + 1)}
              onEditionChange={setEdition}
            />
          ) : tab === 'design' ? (
            <DesignPanel
              newsletter={active}
              messages={messages}
              onRefine={refine}
              busy={busy}
              onNewsletterChange={(next) => {
                setActive(next);
                void api.listNewsletters().then(setList);
              }}
            />
          ) : tab === 'audience' ? (
            <AudiencePanel
              newsletter={active}
              onNewsletterChange={(next) => {
                setActive(next);
                setRefreshKey((key) => key + 1);
                void api.listNewsletters().then(setList);
              }}
            />
          ) : (
            <SentPanel
              newsletter={active}
              refreshKey={refreshKey}
              onOpenEdition={openEdition}
              onGotoEdition={() => setTab('edition')}
            />
          )}
          </ErrorBoundary>
        </main>

        {error && active && !showAdmin && (
          <div className="shrink-0 border-t border-red-200 bg-red-50 px-6 py-2 text-[12.5px] text-red-800">{error}</div>
        )}

        <ConfirmDialog
          open={confirmDelete}
          title="Delete this newsletter?"
          body={`"${active?.name ?? ''}" and its design history will be removed. Newsletters already sent stay on record. This cannot be undone.`}
          confirmLabel="Delete"
          tone="danger"
          busy={deleting}
          onConfirm={() => void removeNewsletter()}
          onCancel={() => setConfirmDelete(false)}
        />
      </div>
    </div>
  );
}
