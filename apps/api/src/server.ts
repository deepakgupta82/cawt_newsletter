import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import express, { type NextFunction, type Request, type Response } from 'express';
import cors from 'cors';
import parser from 'cron-parser';
import { z } from 'zod';
import {
  blueprintSchema,
  deliverySchema,
  editionSchema,
  newId,
  newsletterSchema,
  nowIso,
  recipientGroupSchema,
  recipientSchema,
  scheduleSchema,
  type ConversationMessage,
  type Newsletter,
  type Recipient,
} from '@cawt/domain';
import { composeSocial, design, generateEdition, totalCost } from '@cawt/core';
import { renderEditionHtml, renderEditionText } from '@cawt/render';
import { appBaseUrl, createContext, DEFAULT_BRAND, loadEnv, type AppContext } from './context.js';
import { normaliseSample } from './sample.js';
import { startScheduler } from './scheduler.js';
import { publishEdition } from './publish.js';
import { verifyApproval, verifyUnsubscribe } from './tokens.js';
import { confirmPage, resultPage, unsubscribeConfirmPage } from './approve-pages.js';

await loadEnv();
const ctx: AppContext = await createContext();

const app = express();
app.use(cors());
app.use(express.json({ limit: '5mb' }));
// The emailed Approve confirm page posts a form, not JSON.
app.use(express.urlencoded({ extended: false }));

/** Wraps an async handler so a rejection becomes a 500 rather than a hang. */
const route =
  (handler: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction): void => {
    handler(req, res).catch(next);
  };

/** Express 5 types params as string | string[] | undefined; narrow once here. */
function param(req: Request, name: string): string {
  const value = (req.params as Record<string, string | string[] | undefined>)[name];
  if (typeof value === 'string' && value.length > 0) return value;
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0];
  throw Object.assign(new Error(`Missing route parameter "${name}"`), { status: 400 });
}

async function requireNewsletter(id: string): Promise<Newsletter> {
  const newsletter = await ctx.stores.newsletters.get(id);
  if (!newsletter) throw Object.assign(new Error(`Newsletter ${id} not found`), { status: 404 });
  return newsletter;
}

async function appendMessage(message: Omit<ConversationMessage, 'id' | 'createdAt'>): Promise<ConversationMessage> {
  return ctx.stores.conversations.append({ ...message, id: newId('msg'), createdAt: nowIso() });
}

// ---------------------------------------------------------------------------
// Meta
// ---------------------------------------------------------------------------

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', time: nowIso() });
});

app.get('/api/config', (_req, res) => {
  res.json(ctx.config);
});

// ---------------------------------------------------------------------------
// Newsletters
// ---------------------------------------------------------------------------

const createSchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    prompt: z.string().max(6000).optional(),
    sample: z.string().max(400_000).optional(),
  })
  .refine((value) => Boolean(value.prompt || value.sample), {
    message: 'Provide a prompt, a sample newsletter, or both.',
  });

app.get(
  '/api/newsletters',
  route(async (_req, res) => {
    const newsletters = await ctx.stores.newsletters.list();
    res.json(
      newsletters
        .map((newsletter) => ({
          id: newsletter.id,
          name: newsletter.name,
          status: newsletter.status,
          blueprintVersion: newsletter.blueprint.version,
          updatedAt: newsletter.updatedAt,
        }))
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    );
  }),
);

/**
 * Create from a crude prompt, a sample newsletter, or both. All three inputs
 * converge on the same brief plus blueprint, which is the whole point: the user
 * should not have to know which door they came through.
 */
app.post(
  '/api/newsletters',
  route(async (req, res) => {
    const input = createSchema.parse(req.body);
    const sample = input.sample ? normaliseSample(input.sample) : undefined;

    const designed = await design(ctx.llm, {
      ...(input.prompt ? { prompt: input.prompt } : {}),
      ...(sample ? { sample: sample.text } : {}),
    });

    const id = newId('nl');
    const name = input.name ?? designed.blueprint.titleTemplate.replace(/\s*-?\s*\{\{date\}\}\s*/g, '').trim();

    const newsletter = newsletterSchema.parse({
      id,
      name: name || 'Untitled newsletter',
      status: 'draft',
      brief: { text: designed.brief, updatedAt: nowIso() },
      blueprint: designed.blueprint,
      schedule: null,
      recipientGroupId: null,
      brandId: 'default',
      approvalPolicy: 'author_sends',
      createdBy: 'local-dev',
      createdAt: nowIso(),
      updatedAt: nowIso(),
    });

    await ctx.stores.newsletters.save(newsletter);

    if (sample) {
      const path = `samples/${id}/original.txt`;
      await ctx.stores.blobs.put(path, sample.text, 'text/plain');
      await appendMessage({
        newsletterId: id,
        role: 'user',
        kind: 'sample',
        content: `Uploaded a sample newsletter (${sample.format}, ${sample.text.length} characters).`,
        attachmentRef: path,
      });
    }
    if (input.prompt) {
      await appendMessage({ newsletterId: id, role: 'user', kind: 'prompt', content: input.prompt });
    }
    await appendMessage({
      newsletterId: id,
      role: 'assistant',
      kind: 'result',
      content: designed.brief,
      producedBlueprintVersion: designed.blueprint.version,
    });

    res.status(201).json({ newsletter, usage: designed.usage, cost: totalCost(designed.usage) });
  }),
);

app.get(
  '/api/newsletters/:id',
  route(async (req, res) => {
    res.json(await requireNewsletter(param(req, 'id')));
  }),
);

const patchSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  brief: z.string().min(1).max(4000).optional(),
  blueprint: blueprintSchema.optional(),
  schedule: scheduleSchema.nullable().optional(),
  status: z.enum(['draft', 'active', 'paused', 'archived']).optional(),
  reviewers: z.array(z.string().email()).max(20).optional(),
  autoPublish: z.boolean().optional(),
  sourcePolicy: newsletterSchema.shape.sourcePolicy.optional(),
});

/** Direct edits. Anything the user sets by hand is marked as supplied. */
app.patch(
  '/api/newsletters/:id',
  route(async (req, res) => {
    const existing = await requireNewsletter(param(req, 'id'));
    const patch = patchSchema.parse(req.body);

    const blueprint = patch.blueprint
      ? {
          ...patch.blueprint,
          version: existing.blueprint.version + 1,
          provenance: { ...existing.blueprint.provenance, structure: 'supplied' as const },
        }
      : existing.blueprint;

    // Enabling a schedule stamps lastRunAt to now, so the ticker starts from the
    // next slot rather than back-firing the most recent one on save.
    const schedule =
      patch.schedule === undefined
        ? existing.schedule
        : patch.schedule && patch.schedule.enabled && !patch.schedule.lastRunAt
          ? { ...patch.schedule, lastRunAt: existing.schedule?.lastRunAt ?? nowIso() }
          : patch.schedule;

    const updated = newsletterSchema.parse({
      ...existing,
      ...(patch.name ? { name: patch.name } : {}),
      ...(patch.brief ? { brief: { text: patch.brief, updatedAt: nowIso() } } : {}),
      ...(patch.status ? { status: patch.status } : {}),
      ...(patch.schedule !== undefined ? { schedule } : {}),
      ...(patch.reviewers !== undefined ? { reviewers: patch.reviewers } : {}),
      ...(patch.autoPublish !== undefined ? { autoPublish: patch.autoPublish } : {}),
      ...(patch.sourcePolicy !== undefined ? { sourcePolicy: patch.sourcePolicy } : {}),
      blueprint,
      updatedAt: nowIso(),
    });

    await ctx.stores.newsletters.save(updated);
    res.json(updated);
  }),
);

/**
 * Removes a newsletter and its design thread. Editions and delivery records are
 * left in place: they are the record of what was actually sent, and deleting a
 * definition should not erase history.
 */
app.delete(
  '/api/newsletters/:id',
  route(async (req, res) => {
    const id = param(req, 'id');
    await requireNewsletter(id);
    await ctx.stores.conversations.clear(id);
    await ctx.stores.newsletters.delete(id);
    res.json({ deleted: id });
  }),
);

/**
 * Conversational refinement. "Add a Europe section", "make items shorter",
 * "widen to 7 days". The thread persists with the newsletter, so reopening it
 * months later does not mean re-explaining what it is.
 */
app.post(
  '/api/newsletters/:id/refine',
  route(async (req, res) => {
    const { instruction } = z.object({ instruction: z.string().min(1).max(2000) }).parse(req.body);
    const existing = await requireNewsletter(param(req, 'id'));

    const message = await appendMessage({
      newsletterId: existing.id,
      role: 'user',
      kind: 'refinement',
      content: instruction,
    });

    const designed = await design(
      ctx.llm,
      { prompt: instruction, existingBrief: existing.brief.text },
      { previous: existing.blueprint, version: existing.blueprint.version + 1, messageId: message.id },
    );

    const updated = newsletterSchema.parse({
      ...existing,
      brief: { text: designed.brief, updatedAt: nowIso() },
      blueprint: designed.blueprint,
      updatedAt: nowIso(),
    });
    await ctx.stores.newsletters.save(updated);

    await appendMessage({
      newsletterId: existing.id,
      role: 'assistant',
      kind: 'result',
      content: designed.brief,
      producedBlueprintVersion: designed.blueprint.version,
    });

    res.json({ newsletter: updated, usage: designed.usage, cost: totalCost(designed.usage) });
  }),
);

app.get(
  '/api/newsletters/:id/conversation',
  route(async (req, res) => {
    res.json(await ctx.stores.conversations.list(param(req, 'id')));
  }),
);

app.get(
  '/api/newsletters/:id/editions',
  route(async (req, res) => {
    res.json(await ctx.stores.editions.listByNewsletter(param(req, 'id')));
  }),
);

/** The next time a cron fires, in its own timezone. Null if it cannot be read. */
function nextFire(cron: string, timezone: string): string | null {
  try {
    return parser.parseExpression(cron, { currentDate: new Date(), tz: timezone }).next().toDate().toISOString();
  } catch {
    return null;
  }
}

function monthStartIso(): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

/**
 * Everything the Overview screen needs in one call: where this newsletter
 * stands, what it last did, and what it will do next.
 */
app.get(
  '/api/newsletters/:id/summary',
  route(async (req, res) => {
    const newsletter = await requireNewsletter(param(req, 'id'));
    const [recipients, editions, deliveries] = await Promise.all([
      recipientsFor(newsletter),
      ctx.stores.editions.listByNewsletter(newsletter.id),
      ctx.stores.deliveries.listByNewsletter(newsletter.id),
    ]);

    const ordered = [...editions].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const latest = ordered[0] ?? null;
    const lastSentEdition = ordered.find((edition) => edition.status === 'sent') ?? null;
    const live = deliveries.filter((delivery) => delivery.kind === 'live');
    const since = monthStartIso();

    res.json({
      recipientCount: recipients.filter((recipient) => recipient.status === 'active').length,
      reviewerCount: newsletter.reviewers.length,
      editionCount: editions.length,
      latestEdition: latest,
      lastSentAt: lastSentEdition?.sentAt ?? null,
      lastSentCount: lastSentEdition
        ? live.filter((delivery) => delivery.editionId === lastSentEdition.id && delivery.status === 'sent').length
        : 0,
      lastCostUsd: latest ? totalCost(latest.usage) : null,
      monthCostUsd: editions
        .filter((edition) => edition.createdAt >= since)
        .reduce((sum, edition) => sum + totalCost(edition.usage), 0),
      nextRunAt:
        newsletter.schedule?.enabled && newsletter.schedule.cron
          ? nextFire(newsletter.schedule.cron, newsletter.schedule.timezone)
          : null,
      recentEditions: ordered.slice(0, 5).map((edition) => ({
        id: edition.id,
        status: edition.status,
        subject: edition.subject,
        createdAt: edition.createdAt,
        sentAt: edition.sentAt ?? null,
        costUsd: totalCost(edition.usage),
        deliveredCount: live.filter((d) => d.editionId === edition.id && d.status === 'sent').length,
      })),
    });
  }),
);

/**
 * Spend across every newsletter, for the Admin view. The unit is one edition
 * run: an edition is generated once and then mailed to everyone, so per-run cost
 * is what an owner can actually act on.
 */
app.get(
  '/api/admin/costs',
  route(async (_req, res) => {
    const newsletters = await ctx.stores.newsletters.list();
    const since = monthStartIso();

    const rows = await Promise.all(
      newsletters.map(async (newsletter) => {
        const editions = await ctx.stores.editions.listByNewsletter(newsletter.id);
        const thisMonth = editions.filter((edition) => edition.createdAt >= since);
        const monthUsd = thisMonth.reduce((sum, edition) => sum + totalCost(edition.usage), 0);
        return {
          id: newsletter.id,
          name: newsletter.name,
          status: newsletter.status,
          scheduled: Boolean(newsletter.schedule?.enabled),
          editions: thisMonth.length,
          monthUsd,
          avgUsd: thisMonth.length ? monthUsd / thisMonth.length : 0,
          allTimeEditions: editions.length,
        };
      }),
    );

    const monthToDateUsd = rows.reduce((sum, row) => sum + row.monthUsd, 0);
    const editionCount = rows.reduce((sum, row) => sum + row.editions, 0);

    res.json({
      monthlyCapUsd: ctx.config.monthlyCapUsd,
      monthToDateUsd,
      editionCount,
      avgPerEditionUsd: editionCount ? monthToDateUsd / editionCount : 0,
      newsletters: rows.sort((a, b) => b.monthUsd - a.monthUsd),
      providers: {
        llm: ctx.config.llm,
        model: ctx.config.modelWriter,
        search: ctx.config.search,
        email: ctx.config.email,
        storage: ctx.config.storage,
      },
    });
  }),
);

/**
 * Live test against current content. Costs real provider spend when a real
 * search or model is configured, which is why the response reports it.
 */
app.post(
  '/api/newsletters/:id/preview',
  route(async (req, res) => {
    const newsletter = await requireNewsletter(param(req, 'id'));

    const edition = await generateEdition({
      llm: ctx.llm,
      search: ctx.search,
      resolveContent: ctx.resolveContent,
      blueprint: newsletter.blueprint,
      newsletterId: newsletter.id,
      isPreview: true,
      timezone: newsletter.schedule?.timezone ?? 'Asia/Kolkata',
      preferredDomains: newsletter.sourcePolicy.preferredDomains,
      blockedDomains: newsletter.sourcePolicy.blockedDomains,
    });

    await ctx.stores.editions.save(edition);
    res.json({ edition, cost: totalCost(edition.usage) });
  }),
);

// ---------------------------------------------------------------------------
// Recipients (per newsletter, held in a recipient group)
// ---------------------------------------------------------------------------

function parseEmails(raw: string): string[] {
  const seen = new Set<string>();
  for (const token of raw.split(/[\s,;]+/)) {
    const email = token.trim().toLowerCase();
    if (email && z.string().email().safeParse(email).success) seen.add(email);
  }
  return [...seen];
}

async function recipientsFor(newsletter: Newsletter): Promise<Recipient[]> {
  if (!newsletter.recipientGroupId) return [];
  const group = await ctx.stores.recipientGroups.get(newsletter.recipientGroupId);
  if (!group) return [];
  const found = await Promise.all(group.recipientIds.map((id) => ctx.stores.recipients.get(id)));
  return found.filter((recipient): recipient is Recipient => Boolean(recipient));
}

app.get(
  '/api/newsletters/:id/recipients',
  route(async (req, res) => {
    res.json(await recipientsFor(await requireNewsletter(param(req, 'id'))));
  }),
);

app.post(
  '/api/newsletters/:id/recipients',
  route(async (req, res) => {
    const newsletter = await requireNewsletter(param(req, 'id'));
    const { emails } = z.object({ emails: z.string().max(50_000) }).parse(req.body);
    const parsed = parseEmails(emails);
    if (parsed.length === 0) throw Object.assign(new Error('No valid email addresses found.'), { status: 400 });

    const group =
      (newsletter.recipientGroupId ? await ctx.stores.recipientGroups.get(newsletter.recipientGroupId) : undefined) ??
      recipientGroupSchema.parse({
        id: newId('grp'),
        name: `${newsletter.name} recipients`,
        recipientIds: [],
        createdAt: nowIso(),
      });

    const existing = await recipientsFor(newsletter);
    const known = new Set(existing.map((recipient) => recipient.email));
    const added: string[] = [];
    for (const email of parsed) {
      if (known.has(email)) continue;
      const recipient = recipientSchema.parse({
        id: newId('rcp'),
        email,
        status: 'active',
        consentSource: 'manual',
        consentAt: nowIso(),
        createdAt: nowIso(),
      });
      await ctx.stores.recipients.save(recipient);
      group.recipientIds.push(recipient.id);
      added.push(email);
    }
    await ctx.stores.recipientGroups.save(group);

    let saved = newsletter;
    if (newsletter.recipientGroupId !== group.id) {
      saved = newsletterSchema.parse({ ...newsletter, recipientGroupId: group.id, updatedAt: nowIso() });
      await ctx.stores.newsletters.save(saved);
    }
    res.status(201).json({ added, recipients: await recipientsFor(saved) });
  }),
);

app.delete(
  '/api/newsletters/:id/recipients/:rid',
  route(async (req, res) => {
    const newsletter = await requireNewsletter(param(req, 'id'));
    const rid = param(req, 'rid');
    if (newsletter.recipientGroupId) {
      const group = await ctx.stores.recipientGroups.get(newsletter.recipientGroupId);
      if (group) {
        group.recipientIds = group.recipientIds.filter((id) => id !== rid);
        await ctx.stores.recipientGroups.save(group);
      }
    }
    await ctx.stores.recipients.delete(rid);
    res.json(await recipientsFor(newsletter));
  }),
);

// ---------------------------------------------------------------------------
// Editions
// ---------------------------------------------------------------------------

app.get(
  '/api/editions/:id',
  route(async (req, res) => {
    const edition = await ctx.stores.editions.get(param(req, 'id'));
    if (!edition) return res.status(404).json({ error: 'Edition not found' });
    return res.json(edition);
  }),
);

/** Rendered HTML, served for the preview iframe and for an Outlook eyeball test. */
app.get(
  '/api/editions/:id/html',
  route(async (req, res) => {
    const edition = await ctx.stores.editions.get(param(req, 'id'));
    if (!edition) return res.status(404).send('Edition not found');
    const brand = (await ctx.stores.brands.get('default')) ?? DEFAULT_BRAND;
    res.type('html').send(renderEditionHtml(edition, { brand, preview: req.query['preview'] === '1' }));
    return undefined;
  }),
);

/** Save reviewer edits to a story or paragraph. */
app.put(
  '/api/editions/:id',
  route(async (req, res) => {
    const existing = await ctx.stores.editions.get(param(req, 'id'));
    if (!existing) return res.status(404).json({ error: 'Edition not found' });

    const updated = editionSchema.parse({
      ...existing,
      ...z.object({ blocks: editionSchema.shape.blocks, subject: z.string().optional() }).parse(req.body),
      revision: existing.revision + 1,
    });
    await ctx.stores.editions.save(updated);
    return res.json(updated);
  }),
);

/**
 * A copy-paste LinkedIn post plus a diagram prompt, both built from the
 * edition. Grounded on already-fact-checked content, so nothing new is invented
 * at the social step. Posting is out of scope; this only produces the text.
 */
app.post(
  '/api/editions/:id/social',
  route(async (req, res) => {
    const edition = await ctx.stores.editions.get(param(req, 'id'));
    if (!edition) return res.status(404).json({ error: 'Edition not found' });

    const social = await composeSocial(ctx.llm, { edition });
    return res.json({
      post: social.post,
      diagramPrompt: social.diagramPrompt,
      charCount: social.charCount,
      cost: totalCost(social.usage),
    });
  }),
);

app.post(
  '/api/editions/:id/send-test',
  route(async (req, res) => {
    const { to } = z.object({ to: z.string().email() }).parse(req.body);
    const edition = await ctx.stores.editions.get(param(req, 'id'));
    if (!edition) return res.status(404).json({ error: 'Edition not found' });

    const brand = (await ctx.stores.brands.get('default')) ?? DEFAULT_BRAND;
    const subject = `[TEST] ${edition.subject}`;
    const html = renderEditionHtml(edition, { brand, unsubscribeUrl: 'https://example.invalid/unsubscribe' });
    const result = await ctx.email.send({
      to,
      fromAddress: brand.contactAddress,
      fromName: brand.name,
      replyTo: brand.contactAddress,
      subject,
      html,
      text: renderEditionText(edition, { brand, unsubscribeUrl: 'https://example.invalid/unsubscribe' }),
      headers: { 'List-Unsubscribe': `<mailto:${brand.contactAddress}?subject=unsubscribe>` },
    });

    // Record what actually went out, and keep the exact HTML so it can be read
    // back later from the Sent view.
    const deliveryId = newId('dlv');
    const snapshotPath = `sent/${deliveryId}.html`;
    await ctx.stores.blobs.put(snapshotPath, html, 'text/html');
    await ctx.stores.deliveries.save(
      deliverySchema.parse({
        id: deliveryId,
        newsletterId: edition.newsletterId,
        editionId: edition.id,
        recipientId: 'test',
        email: to,
        subject,
        kind: 'test',
        status: 'sent',
        provider: ctx.email.name,
        providerMessageId: result.messageId,
        snapshotPath,
        timestamp: nowIso(),
      }),
    );

    return res.json({ ...result, provider: ctx.email.name });
  }),
);

/**
 * Publish now: send this edition to the newsletter's recipient list. Used by the
 * Publish button in the app. The scheduler and the emailed Approve action reach
 * the same publishEdition path, so all three behave identically.
 */
app.post(
  '/api/editions/:id/publish',
  route(async (req, res) => {
    const { actor } = z.object({ actor: z.string().optional() }).parse(req.body ?? {});
    const outcome = await publishEdition(ctx, param(req, 'id'), { actor: actor || 'app' });
    if (outcome.status === 'not_found') return res.status(404).json({ error: 'Edition not found' });
    if (outcome.status === 'no_recipients') {
      return res.status(400).json({ error: 'No active recipients. Add recipients before publishing.' });
    }
    return res.json(outcome);
  }),
);

const editLinkFor = (newsletterId: string): string => `${appBaseUrl()}/?newsletter=${newsletterId}`;

/** Confirm page for the emailed Approve link. GET has no side effect, so a mail
 *  client prefetching the link cannot trigger a send; the confirm posts below. */
app.get(
  '/api/approve',
  route(async (req, res) => {
    const token = String(req.query['token'] ?? '');
    const verified = verifyApproval(token);
    if (!verified) {
      res
        .status(400)
        .type('html')
        .send(resultPage('Link expired', 'This approval link is invalid or has expired. Open the app to review and send.'));
      return;
    }
    const edition = await ctx.stores.editions.get(verified.editionId);
    if (!edition) {
      res.status(404).type('html').send(resultPage('Not found', 'That edition no longer exists.'));
      return;
    }
    const newsletter = await ctx.stores.newsletters.get(edition.newsletterId);
    const editUrl = editLinkFor(edition.newsletterId);
    if (edition.status === 'sent') {
      res.type('html').send(resultPage('Already sent', 'This edition has already been published.', editUrl));
      return;
    }
    const recipientCount = newsletter
      ? (await recipientsFor(newsletter)).filter((r) => r.status === 'active').length
      : 0;
    res.type('html').send(
      confirmPage({
        newsletterName: newsletter?.name ?? 'Newsletter',
        subject: edition.subject,
        recipientCount,
        token,
        editUrl,
      }),
    );
  }),
);

/** The confirm form posts here; this is what actually sends. */
app.post(
  '/api/approve',
  route(async (req, res) => {
    const token = String((req.body as { token?: string })?.token ?? req.query['token'] ?? '');
    const verified = verifyApproval(token);
    if (!verified) {
      res.status(400).type('html').send(resultPage('Link expired', 'This approval link is invalid or has expired.'));
      return;
    }
    const outcome = await publishEdition(ctx, verified.editionId, { actor: 'email-approval' });
    const editUrl = outcome.newsletter
      ? editLinkFor(outcome.newsletter.id)
      : outcome.edition
        ? editLinkFor(outcome.edition.newsletterId)
        : undefined;
    if (outcome.status === 'not_found') {
      res.status(404).type('html').send(resultPage('Not found', 'That edition no longer exists.'));
      return;
    }
    if (outcome.status === 'already_sent') {
      res.type('html').send(resultPage('Already sent', 'This edition was already published.', editUrl));
      return;
    }
    if (outcome.status === 'no_recipients') {
      res.status(400).type('html').send(resultPage('No recipients', 'Add recipients in the app before sending.', editUrl));
      return;
    }
    const failedNote = outcome.failed ? `, ${outcome.failed} failed` : '';
    res
      .type('html')
      .send(
        resultPage('Sent', `Published to ${outcome.sent} recipient${outcome.sent === 1 ? '' : 's'}${failedNote}.`, editUrl),
      );
  }),
);

/**
 * The unsubscribe link in every real send. GET only shows a confirm page and
 * has no side effect, because mail-security scanners (Safe Links, Proofpoint
 * and similar) pre-fetch every link in an inbound email; if a GET removed the
 * recipient, their own security software would silently unsubscribe them
 * before they ever opened the message. The confirm form's POST is what
 * actually removes them.
 */
app.get(
  '/api/unsubscribe',
  route(async (req, res) => {
    const token = String(req.query['token'] ?? '');
    const verified = verifyUnsubscribe(token);
    if (!verified) {
      res.status(400).type('html').send(resultPage('Link expired', 'This unsubscribe link is invalid or has expired.'));
      return;
    }
    const [recipient, newsletter] = await Promise.all([
      ctx.stores.recipients.get(verified.recipientId),
      ctx.stores.newsletters.get(verified.newsletterId),
    ]);
    if (!recipient || !newsletter) {
      res.status(404).type('html').send(resultPage('Not found', 'That subscription no longer exists.'));
      return;
    }
    if (recipient.status === 'unsubscribed') {
      res.type('html').send(resultPage('Already unsubscribed', `${recipient.email} is not receiving "${newsletter.name}".`));
      return;
    }
    res
      .type('html')
      .send(unsubscribeConfirmPage({ newsletterName: newsletter.name, email: recipient.email, token }));
  }),
);

app.post(
  '/api/unsubscribe',
  route(async (req, res) => {
    const token = String((req.body as { token?: string })?.token ?? req.query['token'] ?? '');
    const verified = verifyUnsubscribe(token);
    if (!verified) {
      res.status(400).type('html').send(resultPage('Link expired', 'This unsubscribe link is invalid or has expired.'));
      return;
    }
    const recipient = await ctx.stores.recipients.get(verified.recipientId);
    const newsletter = await ctx.stores.newsletters.get(verified.newsletterId);
    if (!recipient || !newsletter) {
      res.status(404).type('html').send(resultPage('Not found', 'That subscription no longer exists.'));
      return;
    }
    await ctx.stores.recipients.save(
      recipientSchema.parse({ ...recipient, status: 'unsubscribed', unsubscribedAt: nowIso() }),
    );
    res
      .type('html')
      .send(resultPage('Unsubscribed', `${recipient.email} has been removed from "${newsletter.name}". You will not receive further editions.`));
  }),
);

app.get(
  '/api/newsletters/:id/deliveries',
  route(async (req, res) => {
    res.json(await ctx.stores.deliveries.listByNewsletter(param(req, 'id')));
  }),
);

/** The exact HTML that was sent, for the Sent view's reader. */
app.get(
  '/api/deliveries/:id/html',
  route(async (req, res) => {
    const delivery = await ctx.stores.deliveries.get(param(req, 'id'));
    if (!delivery?.snapshotPath) return res.status(404).send('Sent email not found');
    const html = await ctx.stores.blobs.getText(delivery.snapshotPath);
    if (!html) return res.status(404).send('Sent email content not found');
    res.type('html').send(html);
    return undefined;
  }),
);

// ---------------------------------------------------------------------------
// Static SPA (production: API and UI served from one origin)
// ---------------------------------------------------------------------------

const webDist = resolve(dirname(fileURLToPath(import.meta.url)), '../../web/dist');
if (existsSync(webDist)) {
  app.use(express.static(webDist));
  // Client-side routes fall back to index.html; the API namespace is left alone.
  app.use((req, res, next) => {
    if (req.method !== 'GET' || req.path.startsWith('/api')) return next();
    res.sendFile(join(webDist, 'index.html'));
  });
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (error instanceof z.ZodError) {
    res.status(400).json({ error: 'Invalid request', issues: error.issues });
    return;
  }
  const status = (error as { status?: number }).status ?? 500;
  const message = error instanceof Error ? error.message : 'Unexpected error';
  if (status >= 500) console.error(error);
  res.status(status).json({ error: message });
});

const port = Number(process.env['PORT'] ?? process.env['API_PORT'] ?? 7071);
app.listen(port, () => {
  console.log(`\n  CAWT newsletter API  http://localhost:${port}`);
  console.log(
    `  providers: llm=${ctx.config.llm} search=${ctx.config.search} email=${ctx.config.email} storage=${ctx.config.storage}\n`,
  );
  // The ticker only acts on newsletters whose schedule is enabled, so it is
  // safe to run everywhere; set SCHEDULER_ENABLED=false to turn it off.
  if (process.env['SCHEDULER_ENABLED'] !== 'false') startScheduler(ctx);
});
