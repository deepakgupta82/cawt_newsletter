import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { EmailProvider, OutboundMessage, SendResult } from '../types.js';

/**
 * Local email sink. Writes a real RFC 5322 message to disk instead of sending.
 *
 * This is the one mock that is not optional. Without it, a stray test run or a
 * mistyped environment variable eventually mails a draft to the live recipient
 * list, and that is not a recoverable mistake. The .eml files it writes open
 * directly in Outlook, so the rendered result can be checked in the client that
 * actually matters.
 */
export class EmlFileEmailProvider implements EmailProvider {
  readonly name = 'eml';
  private readonly directory: string;

  constructor(directory = '.outbox') {
    this.directory = resolve(directory);
  }

  async send(message: OutboundMessage): Promise<SendResult> {
    await mkdir(this.directory, { recursive: true });

    const messageId = `<${randomUUID()}@local.cawt.invalid>`;
    const boundary = `----cawt-${randomUUID()}`;
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const safeRecipient = message.to.replace(/[^a-z0-9._@-]/gi, '_');
    const filename = `${stamp}__${safeRecipient}.eml`;
    const path = join(this.directory, filename);

    const headers: Array<[string, string]> = [
      ['From', `${encodeHeaderWord(message.fromName)} <${message.fromAddress}>`],
      ['To', message.toName ? `${encodeHeaderWord(message.toName)} <${message.to}>` : message.to],
      ['Subject', encodeHeaderWord(message.subject)],
      ['Date', new Date().toUTCString()],
      ['Message-ID', messageId],
      ['MIME-Version', '1.0'],
      ['Content-Type', `multipart/alternative; boundary="${boundary}"`],
    ];
    if (message.replyTo) headers.push(['Reply-To', message.replyTo]);
    for (const [key, value] of Object.entries(message.headers ?? {})) headers.push([key, value]);

    const body = [
      `--${boundary}`,
      'Content-Type: text/plain; charset=utf-8',
      'Content-Transfer-Encoding: 8bit',
      '',
      message.text,
      '',
      `--${boundary}`,
      'Content-Type: text/html; charset=utf-8',
      'Content-Transfer-Encoding: 8bit',
      '',
      message.html,
      '',
      `--${boundary}--`,
      '',
    ].join('\r\n');

    const raw = `${headers.map(([key, value]) => `${key}: ${value}`).join('\r\n')}\r\n\r\n${body}`;
    await writeFile(path, raw, 'utf8');

    return { messageId, location: path };
  }
}

/** RFC 2047 encoding, needed for any header value that is not plain ASCII. */
function encodeHeaderWord(value: string): string {
  // eslint-disable-next-line no-control-regex
  if (/^[\x20-\x7E]*$/.test(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
}
