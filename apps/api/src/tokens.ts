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
  const body = { e: editionId, exp: Date.now() + ttlMs };
  const payload = b64url(JSON.stringify(body));
  return `${payload}.${sign(payload)}`;
}

/** Returns the edition id if the token is valid and unexpired, otherwise null. */
export function verifyApproval(token: string): { editionId: string } | null {
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [payload, mac] = parts as [string, string];

  const expected = sign(payload);
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  try {
    const body = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { e?: string; exp?: number };
    if (!body.e || typeof body.exp !== 'number' || body.exp < Date.now()) return null;
    return { editionId: body.e };
  } catch {
    return null;
  }
}
