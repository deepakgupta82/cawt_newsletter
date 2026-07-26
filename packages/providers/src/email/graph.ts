import { randomUUID } from 'node:crypto';
import type { EmailProvider, OutboundMessage, SendResult } from '../types.js';

/**
 * Sends through a single Exchange Online mailbox using Microsoft Graph with
 * app-only (client-credentials) auth.
 *
 * The app registration behind this holds the Graph Mail.Send application
 * permission, which is tenant-wide on its own. It is deliberately fenced to one
 * mailbox by an Exchange ApplicationAccessPolicy (RestrictAccess to a group that
 * contains only `sender`). That fence lives in Exchange, not here, so this class
 * always addresses `/users/{sender}` and never trusts a caller-supplied From.
 */
export interface GraphEmailOptions {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  /** The one mailbox this app is allowed to send as, e.g. contact@cawt.ai. */
  sender: string;
}

interface CachedToken {
  value: string;
  expiresAt: number;
}

export class GraphEmailProvider implements EmailProvider {
  readonly name = 'graph';
  private readonly options: GraphEmailOptions;
  private token: CachedToken | null = null;

  constructor(options: GraphEmailOptions) {
    const missing = (['tenantId', 'clientId', 'clientSecret', 'sender'] as const).filter(
      (key) => !options[key],
    );
    if (missing.length > 0) {
      throw new Error(
        `GraphEmailProvider is missing required settings: ${missing.join(', ')}. ` +
          'Set AZURE_TENANT_ID, GRAPH_CLIENT_ID, GRAPH_CLIENT_SECRET and GRAPH_SENDER.',
      );
    }
    this.options = options;
  }

  async send(message: OutboundMessage): Promise<SendResult> {
    const token = await this.accessToken();
    const internetMessageId = `<${randomUUID()}@cawt.ai>`;

    // Graph only accepts custom internet headers (those beginning with x-/X-).
    // Standard headers such as List-Unsubscribe are rejected by sendMail, so
    // they are dropped here rather than failing the whole send.
    const customHeaders = Object.entries(message.headers ?? {})
      .filter(([name]) => /^x-/i.test(name))
      .map(([name, value]) => ({ name, value }));

    const payload = {
      message: {
        subject: message.subject,
        internetMessageId,
        body: { contentType: 'HTML', content: message.html },
        toRecipients: [
          {
            emailAddress: message.toName
              ? { address: message.to, name: message.toName }
              : { address: message.to },
          },
        ],
        ...(message.replyTo
          ? { replyTo: [{ emailAddress: { address: message.replyTo } }] }
          : {}),
        ...(customHeaders.length > 0 ? { internetMessageHeaders: customHeaders } : {}),
      },
      saveToSentItems: true,
    };

    const url = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(
      this.options.sender,
    )}/sendMail`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(
        `Graph sendMail failed (${response.status}) for ${this.options.sender}: ${detail.slice(0, 500)}`,
      );
    }

    return { messageId: internetMessageId };
  }

  private async accessToken(): Promise<string> {
    const now = Date.now();
    if (this.token && this.token.expiresAt > now + 60_000) return this.token.value;

    const body = new URLSearchParams({
      client_id: this.options.clientId,
      client_secret: this.options.clientSecret,
      scope: 'https://graph.microsoft.com/.default',
      grant_type: 'client_credentials',
    });

    const response = await fetch(
      `https://login.microsoftonline.com/${this.options.tenantId}/oauth2/v2.0/token`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
      },
    );

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(`Graph token request failed (${response.status}): ${detail.slice(0, 300)}`);
    }

    const json = (await response.json()) as { access_token: string; expires_in: number };
    this.token = {
      value: json.access_token,
      expiresAt: now + json.expires_in * 1000,
    };
    return this.token.value;
  }
}
