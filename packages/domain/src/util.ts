import { randomUUID } from 'node:crypto';

/** Short, readable, sortable-ish id with a type prefix. */
export function newId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 20)}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}

/** Renders {{date}} and {{name}} placeholders in a title or subject template. */
export function fillTemplate(template: string, values: Record<string, string>): string {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, key: string) => values[key] ?? match);
}

export function formatEditionDate(date: Date, timezone = 'Asia/Kolkata'): string {
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: timezone,
  }).format(date);
}

/** Hours between an ISO timestamp and now. Returns Infinity when unparseable. */
export function hoursSince(iso: string | undefined, reference = new Date()): number {
  if (!iso) return Number.POSITIVE_INFINITY;
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return Number.POSITIVE_INFINITY;
  return (reference.getTime() - then) / 3_600_000;
}

/**
 * Canonical form of a URL for dedup: lowercase host, no tracking params,
 * no trailing slash, no fragment.
 */
export function canonicalizeUrl(raw: string): string {
  try {
    const url = new URL(raw);
    url.hash = '';
    url.hostname = url.hostname.toLowerCase().replace(/^www\./, '');
    const strip = [
      'utm_source',
      'utm_medium',
      'utm_campaign',
      'utm_term',
      'utm_content',
      'fbclid',
      'gclid',
      'ref',
    ];
    for (const param of strip) url.searchParams.delete(param);
    let out = url.toString();
    if (out.endsWith('/')) out = out.slice(0, -1);
    return out;
  } catch {
    return raw.trim();
  }
}

/** Normalised title hash, used as a second dedup signal alongside the URL. */
export function titleKey(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function publisherFromUrl(raw: string): string {
  try {
    return new URL(raw).hostname.replace(/^www\./, '');
  } catch {
    return 'unknown';
  }
}
