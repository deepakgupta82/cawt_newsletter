import parser from 'cron-parser';
import { newsletterSchema, nowIso } from '@cawt/domain';
import { generateEdition, totalCost } from '@cawt/core';
import type { AppContext } from './context.js';

/**
 * In-process scheduler.
 *
 * One ticker serves every newsletter. Each newsletter carries its own cron and
 * timezone, so any number of cadences coexist: the ticker just asks each one
 * "were you due since you last ran?" and runs the ones that were. A per-slot
 * lastRunAt guard means a restart or an overlapping tick never double-fires.
 *
 * Sending is deliberately not wired here yet: a scheduled run generates and
 * stores the edition (visible under History) for review. Once the mailbox is
 * connected, the send step slots in right after the edition is saved.
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
      await ctx.stores.editions.save(edition);
      console.log(
        `[scheduler] ${newsletter.name}: generated ${edition.id} for slot ${slot} ($${totalCost(edition.usage).toFixed(4)})`,
      );
      // TODO: send to the recipient group here once the Graph mailbox is connected.
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
