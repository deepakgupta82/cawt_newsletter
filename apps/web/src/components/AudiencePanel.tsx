import { useEffect, useMemo, useState } from 'react';
import type { Newsletter, Recipient } from '../lib/types';
import { api } from '../lib/api';
import { Button, cx, EmptyHint } from './ui';

interface Props {
  newsletter: Newsletter;
  onNewsletterChange: (next: Newsletter) => void;
}

type Cadence = 'daily' | 'weekly' | 'custom';

const DAYS = [
  { value: 1, label: 'Mon' },
  { value: 2, label: 'Tue' },
  { value: 3, label: 'Wed' },
  { value: 4, label: 'Thu' },
  { value: 5, label: 'Fri' },
  { value: 6, label: 'Sat' },
  { value: 0, label: 'Sun' },
];

// A short list covers where CAWT and its readers actually are.
const TIMEZONES = ['Asia/Kolkata', 'Asia/Singapore', 'Asia/Dubai', 'Europe/London', 'America/New_York', 'UTC'];

function buildCron(cadence: Cadence, time: string, days: number[], custom: string): string {
  const [hh, mm] = time.split(':');
  const h = Number(hh ?? 9);
  const m = Number(mm ?? 0);
  if (cadence === 'daily') return `${m} ${h} * * *`;
  if (cadence === 'weekly') return `${m} ${h} * * ${(days.length ? [...days].sort() : [1]).join(',')}`;
  return custom.trim();
}

/** Best-effort read of an existing cron back into the friendly controls. */
function parseCron(cron: string): { cadence: Cadence; time: string; days: number[] } {
  const daily = /^(\d+)\s+(\d+)\s+\*\s+\*\s+\*$/.exec(cron);
  if (daily) return { cadence: 'daily', time: hhmm(daily[2]!, daily[1]!), days: [] };
  const weekly = /^(\d+)\s+(\d+)\s+\*\s+\*\s+([0-9,]+)$/.exec(cron);
  if (weekly) return { cadence: 'weekly', time: hhmm(weekly[2]!, weekly[1]!), days: weekly[3]!.split(',').map(Number) };
  return { cadence: 'custom', time: '09:00', days: [] };
}

function hhmm(h: string, m: string): string {
  return `${h.padStart(2, '0')}:${m.padStart(2, '0')}`;
}

function describe(cadence: Cadence, time: string, days: number[], tz: string): string {
  if (cadence === 'daily') return `Every day at ${time}, ${tz} time.`;
  if (cadence === 'weekly') {
    const names = DAYS.filter((d) => days.includes(d.value)).map((d) => d.label);
    return `Every ${names.length ? names.join(', ') : 'Monday'} at ${time}, ${tz} time.`;
  }
  return `Custom schedule, in ${tz} time.`;
}

export function AudiencePanel({ newsletter, onNewsletterChange }: Props) {
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [loading, setLoading] = useState(true);
  const [paste, setPaste] = useState('');
  const [adding, setAdding] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const initial = newsletter.schedule ? parseCron(newsletter.schedule.cron) : null;
  const [cadence, setCadence] = useState<Cadence>(initial?.cadence ?? 'daily');
  const [time, setTime] = useState(initial?.time ?? '08:00');
  const [days, setDays] = useState<number[]>(initial?.days ?? [1]);
  const [timezone, setTimezone] = useState(newsletter.schedule?.timezone ?? 'Asia/Kolkata');
  const [enabled, setEnabled] = useState(newsletter.schedule?.enabled ?? false);
  const [customCron, setCustomCron] = useState(
    initial?.cadence === 'custom' ? newsletter.schedule?.cron ?? '0 8 * * 1-5' : '0 8 * * 1-5',
  );
  const [savingSchedule, setSavingSchedule] = useState(false);

  const [reviewers, setReviewers] = useState<string[]>(newsletter.reviewers ?? []);
  const [reviewerInput, setReviewerInput] = useState('');
  const [autoPublish, setAutoPublish] = useState(newsletter.autoPublish ?? false);
  const [savingReview, setSavingReview] = useState(false);

  useEffect(() => {
    setLoading(true);
    api
      .recipients(newsletter.id)
      .then(setRecipients)
      .catch(() => setRecipients([]))
      .finally(() => setLoading(false));
  }, [newsletter.id]);

  const cron = useMemo(() => buildCron(cadence, time, days, customCron), [cadence, time, days, customCron]);

  const addRecipients = async () => {
    if (!paste.trim()) return;
    setAdding(true);
    setNotice(null);
    try {
      const result = await api.addRecipients(newsletter.id, paste);
      setRecipients(result.recipients);
      setPaste('');
      setNotice(result.added.length ? `Added ${result.added.length}.` : 'Those addresses were already on the list.');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not add recipients');
    } finally {
      setAdding(false);
    }
  };

  const remove = async (id: string) => {
    setRecipients(await api.removeRecipient(newsletter.id, id));
  };

  const saveReview = async (nextReviewers = reviewers, nextAuto = autoPublish) => {
    setSavingReview(true);
    setNotice(null);
    try {
      const updated = await api.updateNewsletter(newsletter.id, { reviewers: nextReviewers, autoPublish: nextAuto });
      onNewsletterChange(updated);
      setReviewers(updated.reviewers);
      setAutoPublish(updated.autoPublish);
      setNotice('Review settings saved.');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not save review settings');
    } finally {
      setSavingReview(false);
    }
  };

  const isEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

  const addReviewer = () => {
    const email = reviewerInput.trim().toLowerCase();
    setReviewerInput('');
    if (!isEmail(email) || reviewers.includes(email)) return;
    void saveReview([...reviewers, email], autoPublish);
  };

  const saveSchedule = async (nextEnabled = enabled) => {
    setSavingSchedule(true);
    setNotice(null);
    try {
      const updated = await api.updateNewsletter(newsletter.id, {
        schedule: { cron, timezone, enabled: nextEnabled },
      });
      onNewsletterChange(updated);
      setEnabled(nextEnabled);
      setNotice('Schedule saved.');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not save the schedule');
    } finally {
      setSavingSchedule(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-6 py-6">
      {/* Recipients */}
      <section>
        <div className="flex items-baseline justify-between">
          <h3 className="text-[15px] font-semibold text-stone-900">Recipients</h3>
          <span className="text-[12px] text-stone-500">{recipients.length} on the list</span>
        </div>
        <p className="mt-1 text-[12.5px] leading-relaxed text-stone-500">
          Everyone who receives this newsletter. Paste as many addresses as you like, separated by commas, spaces or new
          lines.
        </p>

        <div className="mt-3 rounded-xl border border-stone-200 bg-white p-3">
          <textarea
            value={paste}
            onChange={(event) => setPaste(event.target.value)}
            rows={3}
            placeholder="jane@advisory.com, partner@familyoffice.sg&#10;trustee@example.com"
            className="w-full resize-y rounded-lg bg-transparent px-1 py-1 text-[13px] text-stone-800 outline-none placeholder:text-stone-400"
          />
          <div className="mt-1 flex items-center justify-between">
            <span className="text-[11.5px] text-stone-400">{notice}</span>
            <Button variant="primary" size="sm" onClick={() => void addRecipients()} loading={adding} disabled={!paste.trim()}>
              Add recipients
            </Button>
          </div>
        </div>

        <div className="mt-3">
          {loading ? (
            <EmptyHint>Loading recipients…</EmptyHint>
          ) : recipients.length === 0 ? (
            <EmptyHint>No recipients yet. Add some above.</EmptyHint>
          ) : (
            <div className="divide-y divide-stone-100 rounded-xl border border-stone-200 bg-white">
              {recipients.map((recipient) => (
                <div key={recipient.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-[13px] text-stone-800">{recipient.email}</p>
                    <p className="text-[11px] text-stone-400">
                      {recipient.status} &middot; added {new Date(recipient.createdAt).toLocaleDateString()}
                    </p>
                  </div>
                  <button
                    onClick={() => void remove(recipient.id)}
                    className="shrink-0 rounded-md px-2 py-1 text-[11.5px] text-stone-500 transition-colors hover:bg-red-50 hover:text-red-700"
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* Schedule */}
      <section>
        <div className="flex items-baseline justify-between">
          <h3 className="text-[15px] font-semibold text-stone-900">Schedule</h3>
          <label className="flex items-center gap-2 text-[12.5px] text-stone-600">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(event) => void saveSchedule(event.target.checked)}
              className="h-4 w-4 accent-teal-700"
            />
            {enabled ? 'On' : 'Off'}
          </label>
        </div>
        <p className="mt-1 text-[12.5px] leading-relaxed text-stone-500">
          How often this newsletter is prepared. Choose when, then switch it on.
        </p>

        <div className="mt-3 space-y-3 rounded-xl border border-stone-200 bg-white p-4">
          <div className="flex flex-wrap items-center gap-2">
            {(['daily', 'weekly', 'custom'] as const).map((value) => (
              <button
                key={value}
                onClick={() => setCadence(value)}
                className={cx(
                  'rounded-lg border px-3 py-1.5 text-[12.5px] font-medium capitalize transition-colors',
                  cadence === value
                    ? 'border-teal-300 bg-accent-soft text-teal-800'
                    : 'border-stone-200 text-stone-600 hover:bg-stone-50',
                )}
              >
                {value === 'custom' ? 'Advanced' : value}
              </button>
            ))}
          </div>

          {cadence === 'weekly' && (
            <div className="flex flex-wrap gap-1.5">
              {DAYS.map((day) => (
                <button
                  key={day.value}
                  onClick={() =>
                    setDays((current) =>
                      current.includes(day.value) ? current.filter((d) => d !== day.value) : [...current, day.value],
                    )
                  }
                  className={cx(
                    'rounded-md border px-2.5 py-1 text-[11.5px] transition-colors',
                    days.includes(day.value)
                      ? 'border-teal-300 bg-accent-soft text-teal-800'
                      : 'border-stone-200 text-stone-600 hover:bg-stone-50',
                  )}
                >
                  {day.label}
                </button>
              ))}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-4">
            {cadence !== 'custom' ? (
              <label className="flex items-center gap-2 text-[12.5px] text-stone-600">
                Time
                <input
                  type="time"
                  value={time}
                  onChange={(event) => setTime(event.target.value)}
                  className="rounded-md border border-stone-200 px-2 py-1 text-[12.5px] text-stone-800 outline-none focus:border-stone-400"
                />
              </label>
            ) : (
              <label className="flex flex-1 items-center gap-2 text-[12.5px] text-stone-600">
                Pattern
                <input
                  value={customCron}
                  onChange={(event) => setCustomCron(event.target.value)}
                  placeholder="0 8 * * 1-5"
                  className="w-44 rounded-md border border-stone-200 px-2 py-1 font-mono text-[12px] text-stone-800 outline-none focus:border-stone-400"
                />
                <span className="text-[11px] text-stone-400">Advanced schedule. Use Daily or Weekly unless you need something unusual.</span>
              </label>
            )}

            <label className="flex items-center gap-2 text-[12.5px] text-stone-600">
              Timezone
              <select
                value={timezone}
                onChange={(event) => setTimezone(event.target.value)}
                className="rounded-md border border-stone-200 px-2 py-1 text-[12.5px] text-stone-800 outline-none focus:border-stone-400"
              >
                {TIMEZONES.map((tz) => (
                  <option key={tz} value={tz}>
                    {tz}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-stone-100 pt-3">
            <div className="text-[12.5px] text-stone-600">
              {describe(cadence, time, days, timezone)}
            </div>
            <Button variant="primary" size="sm" onClick={() => void saveSchedule()} loading={savingSchedule}>
              Save schedule
            </Button>
          </div>
        </div>

        <p className="mt-2 text-[11.5px] leading-relaxed text-stone-400">
          Each scheduled run generates a draft. By default it waits for a reviewer to approve before it reaches
          recipients; turn on auto-publish below to send without waiting.
        </p>
      </section>

      {/* Review & sending */}
      <section>
        <h3 className="text-[15px] font-semibold text-stone-900">Review &amp; sending</h3>
        <p className="mt-1 text-[12.5px] leading-relaxed text-stone-500">
          Reviewers approve a scheduled draft before it goes out. They receive a preview email with Approve and Edit
          buttons. Recipients (above) are who the finished newsletter is sent to; reviewers are who signs it off.
        </p>

        <div className="mt-3 space-y-4 rounded-xl border border-stone-200 bg-white p-4">
          <div>
            <p className="text-[12.5px] font-medium text-stone-700">Reviewers</p>
            <div className="mt-2 flex gap-2">
              <input
                value={reviewerInput}
                onChange={(event) => setReviewerInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    addReviewer();
                  }
                }}
                placeholder="editor@cawt.ai"
                className="flex-1 rounded-md border border-stone-200 px-2.5 py-1.5 text-[13px] text-stone-800 outline-none focus:border-stone-400"
              />
              <Button variant="secondary" size="sm" onClick={addReviewer} loading={savingReview} disabled={!reviewerInput.trim()}>
                Add
              </Button>
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {reviewers.length === 0 ? (
                <span className="text-[11.5px] text-stone-400">No reviewers yet. Add at least one to receive drafts.</span>
              ) : (
                reviewers.map((email) => (
                  <span
                    key={email}
                    className="inline-flex items-center gap-1.5 rounded-full border border-stone-200 bg-stone-50 py-1 pl-2.5 pr-1.5 text-[12px] text-stone-700"
                  >
                    {email}
                    <button
                      onClick={() => void saveReview(reviewers.filter((r) => r !== email), autoPublish)}
                      className="rounded-full px-1 text-stone-400 hover:bg-red-50 hover:text-red-700"
                      aria-label={`Remove ${email}`}
                    >
                      ×
                    </button>
                  </span>
                ))
              )}
            </div>
          </div>

          <label className="flex items-start gap-3 border-t border-stone-100 pt-3">
            <input
              type="checkbox"
              checked={autoPublish}
              onChange={(event) => void saveReview(reviewers, event.target.checked)}
              className="mt-0.5 h-4 w-4 accent-teal-700"
            />
            <span className="text-[12.5px] leading-relaxed text-stone-600">
              <span className="font-medium text-stone-800">Auto-publish this newsletter</span>
              <br />
              Skip review and send each scheduled edition straight to recipients. Leave off until you trust the output.
            </span>
          </label>
        </div>
      </section>
    </div>
  );
}
