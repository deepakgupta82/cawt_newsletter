import { deliverySchema, newId, nowIso, type Edition, type Newsletter, type Recipient } from '@cawt/domain';
import { renderEditionHtml, renderEditionText } from '@cawt/render';
import { appBaseUrl, DEFAULT_BRAND, type AppContext } from './context.js';
import { signUnsubscribe } from './tokens.js';

export interface PublishOutcome {
  status: 'sent' | 'already_sent' | 'no_recipients' | 'not_found';
  sent: number;
  failed: number;
  recipientCount: number;
  edition?: Edition;
  newsletter?: Newsletter;
}

export async function activeRecipients(ctx: AppContext, newsletter: Newsletter): Promise<Recipient[]> {
  if (!newsletter.recipientGroupId) return [];
  const group = await ctx.stores.recipientGroups.get(newsletter.recipientGroupId);
  if (!group) return [];
  const found = await Promise.all(group.recipientIds.map((id) => ctx.stores.recipients.get(id)));
  return found.filter((r): r is Recipient => Boolean(r) && r!.status === 'active');
}

/**
 * Sends one edition to its newsletter's recipient list and records a delivery
 * per recipient.
 *
 * This is the single publish path, used by the manual Publish button, the
 * scheduler's auto-publish, and the emailed Approve action, so all three behave
 * identically. It is idempotent by edition status: an edition already marked
 * sent is not sent again, which is what makes a replayed Approve link safe.
 */
export async function publishEdition(
  ctx: AppContext,
  editionId: string,
  opts: { actor: string },
): Promise<PublishOutcome> {
  const edition = await ctx.stores.editions.get(editionId);
  if (!edition) return { status: 'not_found', sent: 0, failed: 0, recipientCount: 0 };
  if (edition.status === 'sent') {
    return { status: 'already_sent', sent: 0, failed: 0, recipientCount: 0, edition };
  }

  const newsletter = await ctx.stores.newsletters.get(edition.newsletterId);
  if (!newsletter) return { status: 'not_found', sent: 0, failed: 0, recipientCount: 0 };

  const recipients = await activeRecipients(ctx, newsletter);
  if (recipients.length === 0) {
    return { status: 'no_recipients', sent: 0, failed: 0, recipientCount: 0, edition, newsletter };
  }

  const brand = (await ctx.stores.brands.get(newsletter.brandId)) ?? DEFAULT_BRAND;

  // One snapshot of the exact HTML per edition, for the internal Sent viewer.
  // Its unsubscribe link is a generic placeholder - nobody unsubscribes from a
  // read-only archive copy - while each recipient's actual email below carries
  // their own working, personalised link.
  const snapshotHtml = renderEditionHtml(edition, {
    brand,
    unsubscribeUrl: `mailto:${brand.contactAddress}?subject=unsubscribe`,
  });
  const snapshotPath = `sent/${edition.id}.html`;
  await ctx.stores.blobs.put(snapshotPath, snapshotHtml, 'text/html');

  let sent = 0;
  let failed = 0;
  for (const recipient of recipients) {
    const unsubscribeUrl = `${appBaseUrl()}/api/unsubscribe?token=${signUnsubscribe(recipient.id, newsletter.id)}`;
    const base = {
      id: newId('dlv'),
      newsletterId: newsletter.id,
      editionId: edition.id,
      recipientId: recipient.id,
      email: recipient.email,
      ...(recipient.displayName ? { toName: recipient.displayName } : {}),
      subject: edition.subject,
      kind: 'live' as const,
      provider: ctx.email.name,
      snapshotPath,
      timestamp: nowIso(),
    };
    try {
      const result = await ctx.email.send({
        to: recipient.email,
        ...(recipient.displayName ? { toName: recipient.displayName } : {}),
        fromAddress: brand.contactAddress,
        fromName: brand.name,
        replyTo: brand.contactAddress,
        subject: edition.subject,
        html: renderEditionHtml(edition, { brand, unsubscribeUrl }),
        text: renderEditionText(edition, { brand, unsubscribeUrl }),
        headers: { 'List-Unsubscribe': `<${unsubscribeUrl}>` },
      });
      sent += 1;
      await ctx.stores.deliveries.save(
        deliverySchema.parse({ ...base, status: 'sent', providerMessageId: result.messageId }),
      );
    } catch (error) {
      failed += 1;
      await ctx.stores.deliveries.save(
        deliverySchema.parse({
          ...base,
          status: 'failed',
          failureReason: error instanceof Error ? error.message : 'send failed',
        }),
      );
    }
  }

  const updated: Edition = {
    ...edition,
    status: 'sent',
    approvedBy: opts.actor,
    approvedAt: nowIso(),
    sentAt: nowIso(),
    renderedHtmlRef: snapshotPath,
  };
  await ctx.stores.editions.save(updated);

  return { status: 'sent', sent, failed, recipientCount: recipients.length, edition: updated, newsletter };
}
