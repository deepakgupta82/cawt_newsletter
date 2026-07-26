import { useEffect, useState } from 'react';
import type { Edition, Newsletter } from '../lib/types';
import { api } from '../lib/api';
import { collectStories, editionState, formatWhen } from '../lib/edition';
import { Button, cx, EmptyHint } from './ui';
import { ConfirmDialog } from './ConfirmDialog';
import { LinkedInEditor } from './LinkedInEditor';

const LINKEDIN_LIMIT = 3000;

interface Social {
  post: string;
  diagramPrompt: string;
  charCount: number;
}

interface Props {
  newsletter: Newsletter;
  edition: Edition | null;
  onRun: () => Promise<void>;
  running: boolean;
  onSent: () => void;
  onEditionChange: (next: Edition) => void;
}

type Mode = 'read' | 'checks' | 'linkedin';

/**
 * One screen for everything you do to a drafted edition: read it, see what the
 * fact-checker flagged, test it, publish it, and spin a LinkedIn post out of it.
 * Verification warnings sit inline rather than behind a separate tab, because
 * "is this safe to send" is part of reading it, not a different task.
 */
export function EditionPanel({ newsletter, edition, onRun, running, onSent, onEditionChange }: Props) {
  const [mode, setMode] = useState<Mode>('read');
  const [testTo, setTestTo] = useState(newsletter.reviewers?.[0] ?? 'itsupport@cawt.ai');
  const [testResult, setTestResult] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [publishResult, setPublishResult] = useState<string | null>(null);
  const [social, setSocial] = useState<Social | null>(null);
  const [postDraft, setPostDraft] = useState('');
  const [socialBusy, setSocialBusy] = useState(false);
  const [socialError, setSocialError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [recipientCount, setRecipientCount] = useState<number | null>(null);

  const stories = edition ? collectStories(edition) : [];
  const flagged = stories.filter((story) => (story.warnings?.length ?? 0) > 0);
  const editionWarnings = edition?.warnings ?? [];

  // How many people Publish would actually reach, so the confirmation can say so.
  useEffect(() => {
    let cancelled = false;
    api
      .recipients(newsletter.id)
      .then((list) => !cancelled && setRecipientCount(list.filter((r) => r.status === 'active').length))
      .catch(() => !cancelled && setRecipientCount(null));
    return () => {
      cancelled = true;
    };
  }, [newsletter.id]);

  // A fresh edition invalidates anything built from the previous one.
  useEffect(() => {
    setSocial(null);
    setPostDraft('');
    setSocialError(null);
    setPublishResult(null);
    setTestResult(null);
    setMode('read');
  }, [edition?.id]);

  const sendTest = async () => {
    if (!edition) return;
    setTestResult(null);
    try {
      const result = await api.sendTest(edition.id, testTo);
      setTestResult(result.location ? `Written to ${result.location}` : `Test sent via ${result.provider}`);
      onSent();
    } catch (error) {
      setTestResult(error instanceof Error ? error.message : 'Send failed');
    }
  };

  const publish = async () => {
    if (!edition) return;
    setConfirmOpen(false);
    setPublishing(true);
    setPublishResult(null);
    try {
      const result = await api.publish(edition.id);
      if (result.status === 'no_recipients') {
        setPublishResult('No active recipients. Add recipients in Audience first.');
      } else if (result.status === 'already_sent') {
        setPublishResult('This edition was already published.');
      } else {
        setPublishResult(
          `Published to ${result.sent} recipient${result.sent === 1 ? '' : 's'}${
            result.failed ? `, ${result.failed} failed` : ''
          }.`,
        );
        onEditionChange({ ...edition, status: 'sent', sentAt: new Date().toISOString() });
      }
      onSent();
    } catch (error) {
      setPublishResult(error instanceof Error ? error.message : 'Publish failed');
    } finally {
      setPublishing(false);
    }
  };

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

  const copyDiagram = async () => {
    if (!social) return;
    try {
      await navigator.clipboard.writeText(social.diagramPrompt);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setSocialError('Clipboard blocked by the browser. Select the text and copy manually.');
    }
  };

  if (!edition) {
    return (
      <div className="mx-auto max-w-md px-6 py-20 text-center">
        <p className="text-[15px] font-medium text-stone-800">No edition yet</p>
        <p className="mt-1.5 text-[13.5px] leading-relaxed text-stone-500">
          Run this newsletter against current news to see a real edition. Nothing is saved to recipients or sent until
          you publish.
        </p>
        <Button variant="primary" className="mt-5" onClick={() => void onRun()} loading={running}>
          Run against live news
        </Button>
      </div>
    );
  }

  const state = editionState(edition.status);
  const isSent = edition.status === 'sent';

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* sub-header: state + what to look at */}
      <div className="flex flex-wrap items-center gap-2 border-b border-stone-200 bg-white px-5 py-2">
        <span
          className={cx(
            'rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset',
            state.tone === 'sent'
              ? 'bg-teal-50 text-teal-700 ring-teal-200'
              : state.tone === 'review'
                ? 'bg-amber-50 text-amber-800 ring-amber-200'
                : 'bg-stone-100 text-stone-600 ring-stone-200',
          )}
        >
          {state.label}
        </span>
        <span className="text-[12px] text-stone-500">{formatWhen(edition.createdAt)}</span>
        <span className="text-[12px] text-stone-400">
          {stories.length} {stories.length === 1 ? 'story' : 'stories'}
        </span>

        <div className="ml-auto flex items-center gap-1">
          {(
            [
              ['read', 'Newsletter'],
              ['checks', flagged.length ? `Checks (${flagged.length})` : 'Checks'],
              ['linkedin', 'LinkedIn'],
            ] as Array<[Mode, string]>
          ).map(([value, label]) => (
            <button
              key={value}
              onClick={() => setMode(value)}
              className={cx(
                'rounded-md px-2.5 py-1 text-[12.5px] font-medium transition-colors',
                mode === value ? 'bg-accent-soft text-teal-800' : 'text-stone-500 hover:text-stone-900',
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {flagged.length > 0 && mode === 'read' && (
        <button
          onClick={() => setMode('checks')}
          className="flex items-center gap-2 border-b border-amber-200 bg-amber-50 px-5 py-2 text-left text-[12.5px] text-amber-900 hover:bg-amber-100"
        >
          <span className="font-semibold">
            {flagged.length} of {stories.length} stories carry a verification warning
          </span>
          <span className="text-amber-700">Review before sending &rarr;</span>
        </button>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {mode === 'read' && (
          <iframe
            key={edition.id}
            title="Newsletter preview"
            src={api.editionHtmlUrl(edition.id)}
            sandbox=""
            className="h-full min-h-[420px] w-full border-0 bg-stone-100"
          />
        )}

        {mode === 'checks' && (
          <div className="mx-auto max-w-3xl space-y-3 px-6 py-6">
            <div className="grid grid-cols-3 gap-3">
              {[
                ['Stories', stories.length],
                ['Flagged', flagged.length],
                ['Sources cited', stories.reduce((sum, story) => sum + (story.sources?.length ?? 0), 0)],
              ].map(([label, value]) => (
                <div key={String(label)} className="rounded-xl border border-stone-200 bg-white px-4 py-3">
                  <p className="text-[11px] uppercase tracking-wide text-stone-400">{label}</p>
                  <p className="mt-0.5 text-[21px] font-semibold text-stone-900 tabular-nums">{value}</p>
                </div>
              ))}
            </div>

            {editionWarnings.map((warning) => (
              <div key={warning} className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5">
                <p className="text-[12.5px] leading-relaxed text-amber-900">{warning}</p>
              </div>
            ))}

            {flagged.length === 0 ? (
              <div className="rounded-xl border border-teal-200 bg-teal-50 px-4 py-3">
                <p className="text-[13.5px] text-teal-800">
                  Every figure, date and quotation in this edition was found in its cited source.
                </p>
              </div>
            ) : (
              flagged.map((story) => (
                <div key={story.id} className="rounded-xl border border-amber-200 bg-white p-4">
                  <p className="text-[14px] font-medium text-stone-900">{story.headline}</p>
                  <ul className="mt-2 space-y-1">
                    {(story.warnings ?? []).map((warning) => (
                      <li key={warning} className="text-[12.5px] leading-relaxed text-amber-800">
                        {warning}
                      </li>
                    ))}
                  </ul>
                  <div className="mt-2.5 flex flex-wrap gap-2">
                    {(story.sources ?? []).map((source) => (
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
          </div>
        )}

        {mode === 'linkedin' && (
          <div className="mx-auto max-w-3xl space-y-4 px-6 py-6">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[14px] font-semibold text-stone-900">LinkedIn post</p>
                <p className="text-[12.5px] leading-relaxed text-stone-500">
                  Built from this edition, so it repeats only fact-checked stories. Copy and paste it yourself; nothing
                  is posted.
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

            {!social && !socialBusy && <EmptyHint>Generate a post and a matching diagram prompt from this edition.</EmptyHint>}

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
                        <code className="rounded bg-stone-100 px-1 py-0.5 text-[11px]">cawt-logo.png</code> so the mark
                        is exact.
                      </p>
                    </div>
                    <Button size="sm" onClick={() => void copyDiagram()}>
                      {copied ? 'Copied' : 'Copy prompt'}
                    </Button>
                  </div>
                  <p className="mt-2.5 rounded-lg bg-stone-50 px-3 py-2.5 text-[12.5px] leading-relaxed text-stone-700">
                    {social.diagramPrompt}
                  </p>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* action bar: the same one wherever you are in the edition */}
      <div className="flex flex-wrap items-center gap-2 border-t border-stone-200 bg-white px-5 py-2.5">
        <span className="text-[12px] text-stone-500">Send a test copy to</span>
        <input
          value={testTo}
          onChange={(event) => setTestTo(event.target.value)}
          className="w-52 rounded-md border border-stone-200 px-2.5 py-1 text-[12.5px] text-stone-800 outline-none focus:border-stone-400"
        />
        <Button size="sm" onClick={() => void sendTest()}>
          Send test
        </Button>
        {testResult && <span className="truncate text-[11.5px] text-stone-500">{testResult}</span>}

        <div className="ml-auto flex items-center gap-2">
          {publishResult && <span className="truncate text-[11.5px] text-stone-500">{publishResult}</span>}
          {isSent ? (
            <span className="rounded-md bg-teal-50 px-2.5 py-1 text-[11.5px] font-medium text-teal-700 ring-1 ring-inset ring-teal-200">
              Published
            </span>
          ) : (
            <Button variant="primary" size="sm" onClick={() => setConfirmOpen(true)} loading={publishing}>
              Send to everyone
            </Button>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        title="Send this newsletter?"
        body={
          recipientCount === null
            ? 'This will email the newsletter to everyone on the recipient list. It cannot be undone.'
            : recipientCount === 0
              ? 'There is nobody on the recipient list yet. Add recipients in the Audience tab first.'
              : `This will email "${edition.subject}" to ${recipientCount} ${
                  recipientCount === 1 ? 'person' : 'people'
                } on the recipient list. It cannot be undone.`
        }
        confirmLabel={recipientCount === 0 ? 'Send anyway' : 'Yes, send it'}
        busy={publishing}
        onConfirm={() => void publish()}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  );
}
