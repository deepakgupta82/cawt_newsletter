import type { Edition, Newsletter, StoryBlock } from './types';

/** Stories live at the top level or one level down inside a section. */
export function collectStories(edition: Edition): StoryBlock[] {
  const out: StoryBlock[] = [];
  for (const block of edition.blocks) {
    if (block.type === 'story') out.push(block);
    if (block.type === 'section') for (const child of block.children) if (child.type === 'story') out.push(child);
  }
  return out;
}

export function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export function formatDay(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

export function formatWindow(hours: number): string {
  if (hours % 168 === 0) return `${hours / 168} week${hours === 168 ? '' : 's'}`;
  if (hours % 24 === 0) return `${hours / 24} day${hours === 24 ? '' : 's'}`;
  return `${hours} hours`;
}

/** "Daily 08:00", "Weekdays 08:00", or null when nothing is scheduled. */
export function scheduleLabel(schedule: Newsletter['schedule']): string | null {
  if (!schedule?.enabled) return null;
  const match = /^(\d+)\s+(\d+)\s+\*\s+\*\s+(.+)$/.exec(schedule.cron);
  if (!match) return 'Scheduled';
  const time = `${match[2]!.padStart(2, '0')}:${match[1]!.padStart(2, '0')}`;
  const dow = match[3];
  if (dow === '*') return `Daily ${time}`;
  if (dow === '1-5') return `Weekdays ${time}`;
  return `Weekly ${time}`;
}

/** How an edition reads to a person: what state it is in, and what colour that is. */
export function editionState(status: Edition['status']): { label: string; tone: 'draft' | 'review' | 'sent' } {
  if (status === 'sent') return { label: 'Sent', tone: 'sent' };
  if (status === 'ready_for_review') return { label: 'Needs review', tone: 'review' };
  if (status === 'failed') return { label: 'Failed', tone: 'review' };
  return { label: 'Draft', tone: 'draft' };
}
