import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Stateless signed tokens for the emailed Approve action.
 *
 * The Approve link in a review email lets whoever holds it publish one edition
 * to the whole recipient list, so it must be unforgeable and time-limited. A
 * token carries only the edition id and an expiry, signed with a server secret;
 * nothing is stored. It is not made single-use by a database flag - publishing
 * checks the edition is still awaiting review and refuses an already-sent one,
 * so a replayed link is a no-op rather than a second send.
 */

const DEFAULT_TTL_MS = 14 * 24 * 60 * 60 * 1000; // 14 days: a daily draft is approved well within this.

function secret(): string {
  const value = process.env['APPROVAL_SIGNING_SECRET'];
  if (value && value.length >= 16) return value;
  // A fixed development fallback keeps local runs working; production sets a
  // real secret as an app setting. Warn once so an unset prod secret is caught.
  if (!warned) {
    warned = true;
    console.warn('[tokens] APPROVAL_SIGNING_SECRET is unset or weak; using an insecure development secret.');
  }
  return 'cawt-dev-approval-secret-do-not-use-in-prod';
}
let warned = false;

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

function sign(payload: string): string {
  return createHmac('sha256', secret()).update(payload).digest('base64url');
}

/** A token that authorises publishing exactly this edition until it expires. */
export function signApproval(editionId: string, ttlMs = DEFAULT_TTL_MS): string {
  const body = { p: 'approve', e: editionId, exp: Date.now() + ttlMs };
  const payload = b64url(JSON.stringify(body));
  return `${payload}.${sign(payload)}`;
}

/** Returns the edition id if the token is valid, unexpired, and an approval token. */
export function verifyApproval(token: string): { editionId: string } | null {
  const body = verify(token);
  if (!body || body['p'] !== 'approve' || typeof body['e'] !== 'string') return null;
  return { editionId: body['e'] };
}

// Five years: an unsubscribe link must keep working for as long as the
// recipient might still be receiving mail, which for a standing distribution
// list is effectively indefinite. Unlike Approve, this token has no side
// effect on its own - a stolen or reused link only ever removes one address
// from one list, so a long lifetime is not a meaningful risk.
const UNSUBSCRIBE_TTL_MS = 5 * 365 * 24 * 60 * 60 * 1000;

/** A token that authorises removing exactly this recipient from this newsletter. */
export function signUnsubscribe(recipientId: string, newsletterId: string): string {
  const body = { p: 'unsub', r: recipientId, n: newsletterId, exp: Date.now() + UNSUBSCRIBE_TTL_MS };
  const payload = b64url(JSON.stringify(body));
  return `${payload}.${sign(payload)}`;
}

/** Returns the recipient/newsletter pair if the token is valid and an unsubscribe token. */
export function verifyUnsubscribe(token: string): { recipientId: string; newsletterId: string } | null {
  const body = verify(token);
  if (!body || body['p'] !== 'unsub' || typeof body['r'] !== 'string' || typeof body['n'] !== 'string') return null;
  return { recipientId: body['r'], newsletterId: body['n'] };
}

function verify(token: string): Record<string, unknown> | null {
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [payload, mac] = parts as [string, string];

  const expected = sign(payload);
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  try {
    const body = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<string, unknown>;
    if (typeof body['exp'] !== 'number' || body['exp'] < Date.now()) return null;
    return body;
  } catch {
    return null;
  }
}
