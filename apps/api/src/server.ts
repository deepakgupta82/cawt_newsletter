import express, { type NextFunction, type Request, type Response } from 'express';
import cors from 'cors';
import { z } from 'zod';
import {
  blueprintSchema,
  editionSchema,
  newId,
  newsletterSchema,
  nowIso,
  scheduleSchema,
  type ConversationMessage,
  type Newsletter,
} from '@cawt/domain';
import { design, generateEdition, totalCost } from '@cawt/core';
import { renderEditionHtml, renderEditionText } from '@cawt/render';
import { createContext, DEFAULT_BRAND, loadEnv, type AppContext } from './context.js';
import { normaliseSample } from './sample.js';

await loadEnv();
const ctx: AppContext = await createContext();

const app = express();
app.use(cors());
app.use(express.json({ limit: '5mb' }));

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

    const updated = newsletterSchema.parse({
      ...existing,
      ...(patch.name ? { name: patch.name } : {}),
      ...(patch.brief ? { brief: { text: patch.brief, updatedAt: nowIso() } } : {}),
      ...(patch.status ? { status: patch.status } : {}),
      ...(patch.schedule !== undefined ? { schedule: patch.schedule } : {}),
      blueprint,
      updatedAt: nowIso(),
    });

    await ctx.stores.newsletters.save(updated);
    res.json(updated);
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

app.post(
  '/api/editions/:id/send-test',
  route(async (req, res) => {
    const { to } = z.object({ to: z.string().email() }).parse(req.body);
    const edition = await ctx.stores.editions.get(param(req, 'id'));
    if (!edition) return res.status(404).json({ error: 'Edition not found' });

    const brand = (await ctx.stores.brands.get('default')) ?? DEFAULT_BRAND;
    const result = await ctx.email.send({
      to,
      fromAddress: brand.contactAddress,
      fromName: brand.name,
      replyTo: brand.contactAddress,
      subject: `[TEST] ${edition.subject}`,
      html: renderEditionHtml(edition, { brand, unsubscribeUrl: 'https://example.invalid/unsubscribe' }),
      text: renderEditionText(edition, { brand, unsubscribeUrl: 'https://example.invalid/unsubscribe' }),
      headers: { 'List-Unsubscribe': `<mailto:${brand.contactAddress}?subject=unsubscribe>` },
    });

    return res.json({ ...result, provider: ctx.email.name });
  }),
);

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

const port = Number(process.env['API_PORT'] ?? 7071);
app.listen(port, () => {
  console.log(`\n  CAWT newsletter API  http://localhost:${port}`);
  console.log(
    `  providers: llm=${ctx.config.llm} search=${ctx.config.search} email=${ctx.config.email} storage=${ctx.config.storage}\n`,
  );
});
