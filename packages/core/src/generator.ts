import { z } from 'zod';
import {
  collectStoryGroups,
  fillTemplate,
  formatEditionDate,
  newId,
  nowIso,
  type Article,
  type Blueprint,
  type BlueprintLeafBlock,
  type Edition,
  type EditionBlock,
  type EditionLeafBlock,
  type SourceRef,
  type StoryBlock,
  type StoryGroupBlock,
  type UsageRecord,
} from '@cawt/domain';
import type { LlmProvider, SearchProvider } from '@cawt/providers';
import { SYSTEM_PROMPTS, untrusted } from './prompts.js';
import { checkStoryAgainstSources, detectConflictingFigures } from './factcheck.js';

/**
 * Executes a stored blueprint against whatever news exists today, producing one
 * edition.
 *
 * The blueprint is never re-derived here. Structure is decided once at design
 * time by a human who approved it; this step only fills it. That is what stops
 * the newsletter's shape drifting between editions, which readers read as
 * broken rather than dynamic.
 */

const queryPlanSchema = z.object({ queries: z.array(z.string().min(1)).min(1).max(8) });
const scoreSchema = z.object({
  scores: z.array(z.object({ id: z.string(), score: z.number().min(0).max(1), reason: z.string().default('') })),
});
const summarySchema = z.object({
  headline: z.string().min(1),
  body: z.string().min(1),
  whyItMatters: z.string().optional(),
  confidence: z.number().min(0).max(1).default(0.9),
  warnings: z.array(z.string()).default([]),
});
const factCheckSchema = z.object({ warnings: z.array(z.string()).default([]) });

const json = <T extends z.ZodType>(schema: T) => z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' }) as Record<string, unknown>;

export type ContentResolver = (article: Article) => Promise<string | undefined>;

export interface GenerateOptions {
  llm: LlmProvider;
  search: SearchProvider;
  resolveContent: ContentResolver;
  blueprint: Blueprint;
  newsletterId: string;
  timezone?: string;
  isPreview?: boolean;
  preferredDomains?: string[];
  blockedDomains?: string[];
  /** Model-based fact check on top of the deterministic one. Costs a little. */
  modelFactCheck?: boolean;
  now?: Date;
}

interface GroupOutcome {
  group: StoryGroupBlock;
  stories: StoryBlock[];
}

function toSourceRef(article: Article): SourceRef {
  return {
    url: article.canonicalUrl,
    title: article.title,
    publisher: article.publisher,
    ...(article.publishedAt ? { publishedAt: article.publishedAt } : {}),
  };
}

async function selectArticles(
  group: StoryGroupBlock,
  options: GenerateOptions,
  used: Set<string>,
  usage: UsageRecord[],
): Promise<Article[]> {
  const { llm, search } = options;

  const plan = await llm.completeJson({
    tier: 'bulk',
    operation: 'plan_queries',
    system: SYSTEM_PROMPTS.planQueries,
    user: `INTENT: ${group.intent}\nKEYWORDS: ${group.keywords.join(', ')}\nREGIONS: ${group.regions.join(', ') || 'any'}`,
    maxTokens: 400,
    schema: { name: 'query_plan', jsonSchema: json(queryPlanSchema), parse: (v) => queryPlanSchema.parse(v) },
  });
  usage.push(plan.usage);

  const found = await search.search({
    queries: plan.value.queries,
    maxResults: Math.max(group.count.max * 3, 12),
    maxAgeHours: group.freshness.windowHours,
    regions: group.regions,
    preferredDomains: options.preferredDomains ?? [],
    blockedDomains: options.blockedDomains ?? [],
  });
  usage.push(found.usage);

  // An article inside a 48-hour window is also inside a 720-hour one, so
  // without this the same story appears under both "Fresh" and "Ongoing".
  const candidates = found.articles.filter((article) => !used.has(article.id));
  if (candidates.length === 0) return [];

  const scored = await llm.completeJson({
    tier: 'bulk',
    operation: 'score_articles',
    system: SYSTEM_PROMPTS.scoreArticles,
    user: `INTENT: ${group.intent}\n\nCANDIDATES:\n${untrusted(
      candidates.map((article) => `[${article.id}] ${article.title} - ${article.snippet}`).join('\n'),
    )}`,
    maxTokens: 1500,
    schema: { name: 'article_scores', jsonSchema: json(scoreSchema), parse: (v) => scoreSchema.parse(v) },
  });
  usage.push(scored.usage);

  const scoreById = new Map(scored.value.scores.map((entry) => [entry.id, entry.score]));

  return candidates
    .map((article) => ({ article, score: scoreById.get(article.id) ?? 0 }))
    .filter((entry) => entry.score >= group.relevanceFloor)
    .sort((a, b) => b.score - a.score)
    .slice(0, group.count.max)
    .map((entry) => entry.article);
}

async function writeStory(
  article: Article,
  group: StoryGroupBlock,
  blueprint: Blueprint,
  options: GenerateOptions,
  usage: UsageRecord[],
): Promise<StoryBlock | null> {
  const content = (await options.resolveContent(article)) ?? article.snippet;
  if (!content || content.trim().length < 40) return null;

  const summary = await options.llm.completeJson({
    tier: 'bulk',
    operation: 'summarise_article',
    system: SYSTEM_PROMPTS.summariseArticle,
    user: [
      `TITLE: ${article.title}`,
      `PUBLISHER: ${article.publisher}`,
      `PUBLISHED: ${article.publishedAt ?? 'unknown'}`,
      `TARGET_WORDS: ${group.targetWords}`,
      `TONE: ${blueprint.tone}`,
      `WHY_IT_MATTERS: ${group.includeWhyItMatters ? 'yes' : 'no'}`,
      `CONTENT:\n${untrusted(content)}`,
    ].join('\n'),
    maxTokens: 900,
    schema: { name: 'story_summary', jsonSchema: json(summarySchema), parse: (v) => summarySchema.parse(v) },
  });
  usage.push(summary.usage);

  // Deterministic verification first. It runs in plain code, costs nothing, and
  // cannot itself invent anything.
  const combined = `${summary.value.body}\n${summary.value.whyItMatters ?? ''}`;
  const findings = checkStoryAgainstSources(combined, content);
  const warnings = [...summary.value.warnings, ...findings.map((finding) => finding.message)];

  if (options.modelFactCheck) {
    const checked = await options.llm.completeJson({
      tier: 'writer',
      operation: 'fact_check',
      system: SYSTEM_PROMPTS.factCheck,
      user: `DRAFT:\n${combined}\n\nSOURCE:\n${untrusted(content)}`,
      maxTokens: 500,
      schema: { name: 'fact_check', jsonSchema: json(factCheckSchema), parse: (v) => factCheckSchema.parse(v) },
    });
    usage.push(checked.usage);
    warnings.push(...checked.value.warnings);
  }

  return {
    type: 'story',
    id: newId('sty'),
    groupId: group.id,
    headline: summary.value.headline,
    body: summary.value.body,
    ...(summary.value.whyItMatters ? { whyItMatters: summary.value.whyItMatters } : {}),
    sources: [toSourceRef(article)],
    ...(article.publishedAt ? { publishedAt: article.publishedAt } : {}),
    style: group.style,
    warnings,
    confidence: findings.length > 0 ? Math.min(summary.value.confidence, 0.6) : summary.value.confidence,
  };
}

/**
 * Two sources reporting different figures for the same event is exactly what
 * CAWT's current newsletter already handles well ("$9 million in one and $1.7
 * million in another"). Preserving that behaviour is deliberate.
 */
function annotateConflicts(stories: StoryBlock[], contents: Map<string, string>): void {
  const byTitleKey = new Map<string, StoryBlock[]>();
  for (const story of stories) {
    const key = story.headline.toLowerCase().split(/\s+/).slice(0, 4).join(' ');
    byTitleKey.set(key, [...(byTitleKey.get(key) ?? []), story]);
  }

  for (const group of byTitleKey.values()) {
    if (group.length < 2) continue;
    const texts = group.map((story) => contents.get(story.id) ?? '');
    for (const conflict of detectConflictingFigures(texts)) {
      for (const story of group) story.warnings.push(conflict);
    }
  }
}

export async function generateEdition(options: GenerateOptions): Promise<Edition> {
  const now = options.now ?? new Date();
  const usage: UsageRecord[] = [];
  const used = new Set<string>();
  const outcomes = new Map<string, GroupOutcome>();
  const contentByStory = new Map<string, string>();

  // 1. Execute every selection rule in the blueprint.
  //
  // Groups run in order because a later group's selection dedups against
  // stories an earlier one already used (Fresh vs Ongoing). Within a group the
  // per-article writes are independent, so they run concurrently - that turns a
  // long chain of model calls into a few short bursts, which keeps a live
  // preview under the platform's request timeout.
  for (const group of collectStoryGroups(options.blueprint.blocks)) {
    const articles = await selectArticles(group, options, used, usage);
    // Reserve the ids before writing so the next group dedups correctly.
    for (const article of articles) used.add(article.id);

    const written = await Promise.all(
      articles.map((article) => writeStory(article, group, options.blueprint, options, usage)),
    );

    const stories: StoryBlock[] = [];
    for (let i = 0; i < written.length; i++) {
      const story = written[i];
      if (!story) continue;
      stories.push(story);
      contentByStory.set(story.id, (await options.resolveContent(articles[i]!)) ?? articles[i]!.snippet);
    }

    outcomes.set(group.id, { group, stories });
  }

  const allStories = [...outcomes.values()].flatMap((outcome) => outcome.stories);
  annotateConflicts(allStories, contentByStory);

  // 2. Write the connecting prose, grounded only in what was actually selected.
  const proseText = new Map<string, string>();
  const proseSpecs = options.blueprint.blocks
    .flatMap((block) => (block.type === 'section' ? block.children : [block]))
    .filter((block): block is Extract<BlueprintLeafBlock, { type: 'prose_spec' }> => block.type === 'prose_spec');

  for (const spec of proseSpecs) {
    if (allStories.length === 0) {
      proseText.set(spec.id, 'No qualifying stories were found for this edition.');
      continue;
    }
    const result = await options.llm.completeText({
      tier: 'writer',
      operation: 'write_prose',
      system: SYSTEM_PROMPTS.writeProse,
      user: [
        `PURPOSE: ${spec.purpose}`,
        `INSTRUCTION: ${spec.instruction}`,
        `TARGET_WORDS: ${spec.targetWords}`,
        'STORIES:',
        ...allStories.map((story) => `- ${story.headline}`),
      ].join('\n'),
      maxTokens: 600,
    });
    usage.push(result.usage);
    proseText.set(spec.id, result.value);
  }

  // 3. Mirror the blueprint tree, swapping rules for the content they produced.
  const expandLeaf = (block: BlueprintLeafBlock): EditionLeafBlock[] => {
    if (block.type === 'divider') return [block];

    if (block.type === 'prose_spec') {
      return [
        {
          type: 'prose',
          id: newId('prs'),
          ...(block.label ? { label: block.label } : {}),
          text: proseText.get(block.id) ?? '',
          warnings: [],
        },
      ];
    }

    const outcome = outcomes.get(block.id);
    const out: EditionLeafBlock[] = [];
    if (block.freshness.label) {
      out.push({ type: 'group_label', id: newId('lbl'), text: block.freshness.label });
    }
    if (!outcome || outcome.stories.length === 0) {
      out.push({ type: 'empty_state', id: newId('emp'), groupId: block.id, text: block.emptyState });
    } else {
      out.push(...outcome.stories);
    }
    return out;
  };

  const blocks: EditionBlock[] = [];
  for (const block of options.blueprint.blocks) {
    if (block.type === 'section') {
      const children: EditionLeafBlock[] = [];
      for (const child of block.children) children.push(...expandLeaf(child));
      blocks.push({
        type: 'section',
        id: block.id,
        heading: block.heading,
        ...(block.lead ? { lead: block.lead } : {}),
        children,
      });
    } else {
      blocks.push(...expandLeaf(block));
    }
  }

  // 4. Warnings that belong to the edition rather than to one story.
  const warnings: string[] = [];
  for (const { group, stories } of outcomes.values()) {
    if (stories.length < group.count.min) {
      warnings.push(
        `"${group.intent}" returned ${stories.length} of a wanted minimum of ${group.count.min}. Widen the window or lower the relevance floor rather than padding.`,
      );
    }
  }
  const flagged = allStories.filter((story) => story.warnings.length > 0).length;
  if (flagged > 0) warnings.push(`${flagged} of ${allStories.length} stories carry verification warnings. Review before sending.`);
  if (allStories.length === 0) warnings.push('No stories qualified. Recommend skipping this edition rather than publishing an empty one.');

  const dateLabel = formatEditionDate(now, options.timezone ?? 'Asia/Kolkata');

  return {
    id: newId(options.isPreview ? 'prv' : 'edn'),
    newsletterId: options.newsletterId,
    blueprintVersion: options.blueprint.version,
    editionDate: now.toISOString().slice(0, 10),
    revision: 1,
    status: 'draft',
    isPreview: options.isPreview ?? false,
    subject: fillTemplate(options.blueprint.subjectTemplate, { date: dateLabel }),
    ...(options.blueprint.preheader ? { preheader: options.blueprint.preheader } : {}),
    title: fillTemplate(options.blueprint.titleTemplate, { date: dateLabel }),
    blocks,
    warnings,
    usage,
    createdAt: nowIso(),
  };
}

export function totalCost(usage: UsageRecord[]): number {
  return usage.reduce((sum, record) => sum + record.estimatedCostUsd, 0);
}
