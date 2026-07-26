import parser from 'cron-parser';
import { newsletterSchema, nowIso, type Edition, type Newsletter } from '@cawt/domain';
import { generateEdition, totalCost } from '@cawt/core';
import { renderEditionHtml } from '@cawt/render';
import { appBaseUrl, DEFAULT_BRAND, type AppContext } from './context.js';
import { activeRecipients, publishEdition } from './publish.js';
import { signApproval } from './tokens.js';
import { renderReviewEmail } from './review-email.js';

/**
 * In-process scheduler.
 *
 * One ticker serves every newsletter. Each newsletter carries its own cron and
 * timezone, so any number of cadences coexist: the ticker just asks each one
 * "were you due since you last ran?" and runs the ones that were. A per-slot
 * lastRunAt guard means a restart or an overlapping tick never double-fires.
 *
 * A due slot generates a fresh edition, then follows the newsletter's policy:
 * autoPublish sends it to the recipient list immediately; otherwise it is held
 * as ready_for_review and a preview email with Approve / Edit actions goes to
 * the reviewers. Nothing reaches recipients without a human unless autoPublish
 * is explicitly turned on for that newsletter.
 */

const TICK_MS = 60_000;
const MAX_BACKFILL_MS = 6 * 60 * 60 * 1000; // don't run slots older than 6h after a long outage.

/** The most recent cron fire at or before `now`, evaluated in the schedule's timezone. */
function previousFire(cron: string, timezone: string, now: Date): Date | null {
  try {
    return parser.parseExpression(cron, { currentDate: now, tz: timezone }).prev().toDate();
  } catch {
    return null; // A malformed cron is skipped rather than crashing the ticker.
  }
}

async function stampSlot(ctx: AppContext, newsletter: Parameters<typeof newsletterSchema.parse>[0], slot: string): Promise<void> {
  const parsed = newsletterSchema.parse(newsletter);
  if (!parsed.schedule) return;
  await ctx.stores.newsletters.save(
    newsletterSchema.parse({ ...parsed, schedule: { ...parsed.schedule, lastRunAt: slot }, updatedAt: nowIso() }),
  );
}

/** Emails each reviewer the draft with Approve / Edit actions. */
async function notifyReviewers(ctx: AppContext, newsletter: Newsletter, edition: Edition): Promise<void> {
  if (newsletter.reviewers.length === 0) {
    console.log(`[scheduler] ${newsletter.name}: draft ${edition.id} ready, no reviewers set (waiting in app)`);
    return;
  }
  const brand = (await ctx.stores.brands.get(newsletter.brandId)) ?? DEFAULT_BRAND;
  const recipientCount = (await activeRecipients(ctx, newsletter)).length;
  const html = renderEditionHtml(edition, {
    brand,
    unsubscribeUrl: `mailto:${brand.contactAddress}?subject=unsubscribe`,
  });
  const base = appBaseUrl();
  const editUrl = `${base}/?newsletter=${newsletter.id}`;

  for (const reviewer of newsletter.reviewers) {
    const approveUrl = `${base}/api/approve?token=${signApproval(edition.id)}`;
    const reviewHtml = renderReviewEmail({ newsletterName: newsletter.name, editionHtml: html, approveUrl, editUrl, recipientCount });
    try {
      await ctx.email.send({
        to: reviewer,
        fromAddress: brand.contactAddress,
        fromName: brand.name,
        replyTo: brand.contactAddress,
        subject: `[Review] ${edition.subject}`,
        html: reviewHtml,
        text: `A scheduled draft of "${newsletter.name}" is ready to review.\nApprove & send: ${approveUrl}\nEdit in app: ${editUrl}`,
      });
    } catch (error) {
      console.error(`[scheduler] ${newsletter.name}: failed to email reviewer ${reviewer}`, error);
    }
  }
  console.log(`[scheduler] ${newsletter.name}: emailed ${newsletter.reviewers.length} reviewer(s) for ${edition.id}`);
}

async function runDue(ctx: AppContext, now: Date): Promise<void> {
  for (const newsletter of await ctx.stores.newsletters.list()) {
    const schedule = newsletter.schedule;
    if (!schedule?.enabled) continue;

    const prev = previousFire(schedule.cron, schedule.timezone, now);
    if (!prev) continue;
    const slot = prev.toISOString();

    if (schedule.lastRunAt && schedule.lastRunAt >= slot) continue; // already ran this slot

    // After a long outage, catch up at most the current slot; don't replay a backlog.
    if (now.getTime() - prev.getTime() > MAX_BACKFILL_MS) {
      await stampSlot(ctx, newsletter, slot);
      continue;
    }

    try {
      const edition = await generateEdition({
        llm: ctx.llm,
        search: ctx.search,
        resolveContent: ctx.resolveContent,
        blueprint: newsletter.blueprint,
        newsletterId: newsletter.id,
        timezone: schedule.timezone,
        preferredDomains: newsletter.sourcePolicy.preferredDomains,
        blockedDomains: newsletter.sourcePolicy.blockedDomains,
      });
      // Hold for review unless the newsletter is trusted to auto-publish.
      const draft: Edition = { ...edition, status: newsletter.autoPublish ? edition.status : 'ready_for_review' };
      await ctx.stores.editions.save(draft);
      console.log(
        `[scheduler] ${newsletter.name}: generated ${draft.id} for slot ${slot} ($${totalCost(draft.usage).toFixed(4)})`,
      );

      if (newsletter.autoPublish) {
        const outcome = await publishEdition(ctx, draft.id, { actor: 'auto-publish' });
        console.log(`[scheduler] ${newsletter.name}: auto-published ${draft.id} -> ${outcome.status} (${outcome.sent} sent, ${outcome.failed} failed)`);
      } else {
        await notifyReviewers(ctx, newsletter, draft);
      }
    } catch (error) {
      console.error(`[scheduler] ${newsletter.name}: run failed`, error);
    } finally {
      // Stamp the slot even on failure, so one broken newsletter does not retry every minute.
      await stampSlot(ctx, newsletter, slot);
    }
  }
}

export function startScheduler(ctx: AppContext): void {
  let running = false;
  const tick = async (): Promise<void> => {
    if (running) return; // never overlap ticks
    running = true;
    try {
      await runDue(ctx, new Date());
    } catch (error) {
      console.error('[scheduler] tick error', error);
    } finally {
      running = false;
    }
  };
  setInterval(() => void tick(), TICK_MS);
  console.log('[scheduler] started (60s tick)');
}
