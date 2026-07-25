import type { JsonRequest, LlmProvider, LlmResult, TextRequest } from '../types.js';
import { approxTokens } from '../types.js';

/**
 * A mock that actually interprets the input rather than replaying one canned
 * answer.
 *
 * It parses regions, freshness windows, cadence and length hints out of the
 * user's prompt with plain rules, then composes a real blueprint from the
 * block vocabulary. That means the whole designer flow - type a crude prompt,
 * get a structured newsletter, refine it, re-render - can be built and
 * demonstrated offline for nothing, and switching to a real model is one
 * environment variable.
 *
 * It is deliberately not clever. Where it guesses, the pipeline marks the
 * value as inferred so the UI shows it as needing a look.
 */

const REGION_ALIASES: Array<[RegExp, string]> = [
  [/\b(india|indian|bharat|mumbai|delhi)\b/i, 'India'],
  [/\b(singapore|sg|singaporean)\b/i, 'Singapore'],
  [/\b(united states|usa|u\.s\.|us|america|american)\b/i, 'United States'],
  [/\b(united kingdom|uk|britain|british|london)\b/i, 'United Kingdom'],
  [/\b(uae|dubai|abu dhabi|emirates)\b/i, 'UAE'],
  [/\b(hong kong|hk)\b/i, 'Hong Kong'],
  [/\b(europe|european|eu)\b/i, 'Europe'],
  [/\b(middle east|gcc)\b/i, 'Middle East'],
  [/\b(australia|australian)\b/i, 'Australia'],
  [/\b(switzerland|swiss|zurich|geneva)\b/i, 'Switzerland'],
];

const TOPIC_HINTS: Array<[RegExp, string]> = [
  [/\bsuccession\b/i, 'succession'],
  [/\b(estate|inheritance|probate)\b/i, 'estate planning'],
  [/\btrust(s|ee)?\b/i, 'trusts'],
  [/\bfamily (office|business|controlled)\b/i, 'family office'],
  [/\b(wealth|private client|hnw|uhnw)\b/i, 'private wealth'],
  [/\b(property|real estate)\b/i, 'property'],
  [/\b(tax|taxation)\b/i, 'tax'],
  [/\b(litigation|dispute|court|ruling)\b/i, 'litigation'],
  [/\b(regulation|regulatory|compliance)\b/i, 'regulation'],
  [/\b(m&a|merger|acquisition|deal)\b/i, 'deals'],
];

function detectRegions(text: string): string[] {
  const found: string[] = [];
  for (const [pattern, name] of REGION_ALIASES) {
    if (pattern.test(text) && !found.includes(name)) found.push(name);
  }
  return found;
}

function detectTopics(text: string): string[] {
  const found: string[] = [];
  for (const [pattern, name] of TOPIC_HINTS) {
    if (pattern.test(text) && !found.includes(name)) found.push(name);
  }
  return found.length > 0 ? found : ['general news'];
}

/** Reads "last 96 hours", "past 4 days", "previous week" out of free text. */
function detectFreshnessHours(text: string): number | null {
  const match = /\b(?:last|past|previous|within)\s+(\d+)\s*(hour|day|week)s?\b/i.exec(text);
  if (match) {
    const amount = Number(match[1]);
    const unit = match[2]!.toLowerCase();
    if (unit === 'hour') return amount;
    if (unit === 'day') return amount * 24;
    return amount * 168;
  }
  if (/\btwice (a|per) week\b/i.test(text)) return 84;
  if (/\bweekly\b/i.test(text)) return 168;
  if (/\bdaily\b/i.test(text)) return 48;
  return null;
}

function detectTargetWords(text: string): number {
  if (/\b(very short|one line|headline only|snappy|terse)\b/i.test(text)) return 30;
  if (/\b(short|brief|concise|tight|quick)\b/i.test(text)) return 55;
  if (/\b(detailed|in-?depth|thorough|long|comprehensive)\b/i.test(text)) return 130;
  return 75;
}

function detectTitle(text: string): string {
  const quoted = /["“']([^"”']{4,60})["”']/.exec(text);
  if (quoted?.[1]) return `${quoted[1].trim()} - {{date}}`;

  const topics = detectTopics(text);
  if (topics.includes('succession') && topics.includes('private wealth')) return 'Wealth & Succession Watch - {{date}}';
  if (topics.includes('private wealth')) return 'Private Wealth Briefing - {{date}}';
  if (topics.includes('estate planning')) return 'Estate & Legacy Watch - {{date}}';
  return 'News Digest - {{date}}';
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'section';
}

function buildBrief(prompt: string): string {
  const regions = detectRegions(prompt);
  const topics = detectTopics(prompt);
  const words = detectTargetWords(prompt);
  const freshHours = detectFreshnessHours(prompt) ?? 48;

  const regionPhrase =
    regions.length > 0 ? `across ${regions.slice(0, -1).join(', ')}${regions.length > 1 ? ' and ' : ''}${regions.at(-1)}` : 'with no regional restriction';

  return [
    `A ${/\bweekly\b/i.test(prompt) ? 'weekly' : 'daily'} digest covering ${topics.join(', ')} ${regionPhrase}.`,
    regions.length > 0 ? 'Each region is covered in its own section.' : 'Stories are presented in a single list.',
    `Within each section, developments from the last ${freshHours} hours are separated from longer-running background matters.`,
    `Each item runs to roughly ${words} words, states why it matters to the reader, and links the sources it was built from.`,
    'The edition closes with a short synthesis of the themes cutting across the stories.',
    'Where sources disagree on a figure, the disagreement is reported rather than resolved.',
  ].join(' ');
}

/** Composes a blueprint tree from whatever the brief indicates. */
function buildBlueprint(brief: string): Record<string, unknown> {
  const regions = detectRegions(brief);
  const topics = detectTopics(brief);
  const targetWords = detectTargetWords(brief);
  const freshHours = detectFreshnessHours(brief) ?? 48;
  const intent = `${topics.join(', ')} relevant to professional advisers`;

  const freshLabel =
    freshHours % 24 === 0 ? `Fresh - last ${freshHours / 24} day${freshHours === 24 ? '' : 's'}` : `Fresh - last ${freshHours} hours`;

  const makeGroups = (region: string | null) => {
    const key = region ? slug(region) : 'all';
    const regionList = region ? [region] : [];
    return [
      {
        type: 'story_group',
        id: `grp-${key}-fresh`,
        intent: region ? `${intent} in ${region}` : intent,
        keywords: topics,
        regions: regionList,
        freshness: { windowHours: freshHours, label: freshLabel },
        count: { min: 0, max: 5 },
        relevanceFloor: 0.34,
        style: 'headline_paragraph',
        includeWhyItMatters: true,
        targetWords,
        emptyState:
          freshHours % 24 === 0
            ? `No fresh developments in the past ${freshHours / 24} day${freshHours === 24 ? '' : 's'}.`
            : `No fresh developments in the past ${freshHours} hours.`,
      },
      {
        type: 'story_group',
        id: `grp-${key}-ongoing`,
        intent: region ? `Ongoing ${intent} in ${region}` : `Ongoing ${intent}`,
        keywords: topics,
        regions: regionList,
        freshness: { windowHours: 720, label: 'Ongoing matters' },
        count: { min: 0, max: 4 },
        relevanceFloor: 0.34,
        style: 'headline_paragraph',
        includeWhyItMatters: true,
        targetWords,
        emptyState: 'No ongoing matters to report.',
      },
    ];
  };

  const blocks: Array<Record<string, unknown>> =
    regions.length > 0
      ? regions.map((region) => ({
          type: 'section',
          id: `sec-${slug(region)}`,
          heading: region,
          children: makeGroups(region),
        }))
      : [{ type: 'section', id: 'sec-all', heading: 'Latest', children: makeGroups(null) }];

  blocks.push({
    type: 'prose_spec',
    id: 'prose-bottom-line',
    purpose: 'synthesis',
    instruction:
      'Summarise the themes cutting across the selected stories in two or three sentences. Use only what the stories state.',
    label: 'Bottom line:',
    targetWords: 60,
  });

  return {
    titleTemplate: detectTitle(brief),
    subjectTemplate: detectTitle(brief),
    preheader: `${topics.slice(0, 3).join(', ')} briefing`,
    tone: 'Neutral, factual, written for a professional adviser. No hype, no adjectives that are not in the sources.',
    citationStyle: 'inline_link',
    blocks,
    notes:
      regions.length > 0
        ? []
        : ['No regions were mentioned, so a single combined section was used. Add regions if you want them split.'],
  };
}

function sentenceCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

const TOPIC_HASHTAGS: Array<[string, string]> = [
  ['succession', '#Succession'],
  ['private wealth', '#PrivateWealth'],
  ['family office', '#FamilyOffice'],
  ['estate planning', '#EstatePlanning'],
  ['trusts', '#Trusts'],
  ['regulation', '#WealthRegulation'],
  ['tax', '#Tax'],
  ['litigation', '#EstateLitigation'],
];

/** First sentence, splitting only on real sentence ends (not decimals like $1.6). */
function firstSentence(text: string): string {
  const parts = text.trim().split(/(?<=[.!?])\s+(?=[A-Z])/);
  return (parts[0] ?? text).trim();
}

/**
 * Builds a LinkedIn post and a diagram prompt from the edition digest that
 * social.ts hands over. Deterministic, so the feature demonstrates offline and
 * a real model is one environment variable away.
 */
function buildSocial(digest: string): { post: string; diagramPrompt: string } {
  const title = (/^TITLE:\s*(.+)$/m.exec(digest)?.[1] ?? 'CAWT briefing').replace(/\s*-?\s*\{\{date\}\}\s*$/, '').trim();
  const bottomLine = /^BOTTOM_LINE:\s*([\s\S]+?)$/m.exec(digest)?.[1]?.trim() ?? '';
  const stories = [...digest.matchAll(/^STORY:\s*(?<region>[^:]+?)\s*::\s*(?<headline>.+)$/gm)].map((match) => ({
    region: match.groups?.['region']?.trim() ?? 'General',
    headline: match.groups?.['headline']?.trim() ?? '',
  }));

  const regions: string[] = [];
  for (const story of stories) if (!regions.includes(story.region)) regions.push(story.region);

  const regionPhrase =
    regions.length === 0
      ? ''
      : ` across ${regions.slice(0, -1).join(', ')}${regions.length > 1 ? ' and ' : ''}${regions.at(-1)}`;

  const hook =
    stories.length > 0
      ? `${stories.length} shifts${regionPhrase} that private client advisers should not miss this week.`
      : 'What moved in private wealth and succession this week.';

  // Round-robin across regions so the post reads as a spread, not five items
  // from whichever section came first.
  const queues = new Map<string, string[]>();
  for (const story of stories) {
    const queue = queues.get(story.region) ?? [];
    queue.push(story.headline);
    queues.set(story.region, queue);
  }
  const picked: Array<{ region: string; headline: string }> = [];
  for (let added = true; added && picked.length < 5; ) {
    added = false;
    for (const region of regions) {
      const queue = queues.get(region);
      if (queue && queue.length > 0) {
        picked.push({ region, headline: queue.shift()! });
        added = true;
        if (picked.length >= 5) break;
      }
    }
  }
  const bullets = picked
    .map((story) => {
      const headline = story.headline.length > 96 ? `${story.headline.slice(0, 93).trimEnd()}...` : story.headline;
      return `• ${story.region}: ${headline}`;
    })
    .join('\n');

  const takeaway = bottomLine
    ? firstSentence(bottomLine)
    : 'The common thread: families are being pushed to formalise control and document intent rather than rely on informal understanding.';

  const topics = detectTopics(digest);
  const tags: string[] = [];
  for (const [topic, tag] of TOPIC_HASHTAGS) {
    if (topics.includes(topic) && !tags.includes(tag)) tags.push(tag);
  }
  if (tags.length === 0) tags.push('#PrivateWealth', '#Succession');
  const hashtags = tags.slice(0, 3).join(' ');

  const post = [
    hook,
    '',
    bullets,
    '',
    takeaway,
    '',
    'Full briefing goes to CapAlpha WhiteTrust subscribers. Follow CAWT or get in touch to receive it.',
    '',
    hashtags,
  ]
    .join('\n')
    .trim();

  const panels = regions.length > 0 ? regions.join(', ') : 'the key themes';
  const diagramPrompt =
    `Create a clean, professional LinkedIn infographic in a square 1:1 format titled "${title}". ` +
    `Draw ${regions.length > 0 ? regions.length : 3} labelled panels, one for each of: ${panels}, and under each panel ` +
    `list its one or two headline developments in short phrases. ` +
    `Style: deep navy (#0B1220) background accents with a teal (#0E7C6B) highlight, generous white space, flat minimal ` +
    `shapes, thin connector lines, a clear modern sans-serif. Place the CAWT logo (a navy tree emblem above the "CAWT" ` +
    `wordmark) small in the top-left corner. Board-room clean. No photorealism, no stock photography, no faces, no clip-art.`;

  return { post, diagramPrompt };
}

/** Trims text to roughly the requested word count, ending on a sentence. */
function toWordBudget(text: string, words: number): string {
  const sentences = text.split(/(?<=[.!?])\s+/);
  const out: string[] = [];
  let count = 0;
  for (const sentence of sentences) {
    const length = sentence.split(/\s+/).length;
    if (count > 0 && count + length > words * 1.25) break;
    out.push(sentence);
    count += length;
  }
  return out.join(' ').trim() || text.slice(0, words * 6);
}

export class MockLlmProvider implements LlmProvider {
  readonly name = 'mock';

  async completeText(request: TextRequest): Promise<LlmResult<string>> {
    const text = this.textFor(request);
    return { value: text, usage: this.meter(request, text) };
  }

  async completeJson<T>(request: JsonRequest<T>): Promise<LlmResult<T>> {
    const raw = this.jsonFor(request);
    const value = request.schema.parse(raw);
    return { value, usage: this.meter(request, JSON.stringify(raw)) };
  }

  private meter(request: TextRequest, output: string) {
    const inputTokens = approxTokens(`${request.system}\n${request.user}`);
    const outputTokens = approxTokens(output);
    return {
      provider: 'mock',
      operation: request.operation,
      model: 'mock',
      inputTokens,
      outputTokens,
      searchQueries: 0,
      estimatedCostUsd: 0,
    };
  }

  private textFor(request: TextRequest): string {
    switch (request.operation) {
      case 'brief_from_prompt':
        return buildBrief(request.user);
      case 'write_prose': {
        const headlines = [...request.user.matchAll(/^- (.+)$/gm)].map((match) => match[1]!).slice(0, 4);
        if (headlines.length === 0) return 'No qualifying stories were selected for this edition.';
        const themes = headlines.map((headline) => headline.replace(/\s*\(.*?\)\s*$/, '').toLowerCase());
        return sentenceCase(
          `the clearest current themes are ${themes.slice(0, 3).join('; ')}. Taken together they point to continuing pressure on families to formalise control and document intent rather than rely on informal understanding.`,
        );
      }
      default:
        throw new Error(`MockLlmProvider has no text handler for operation "${request.operation}"`);
    }
  }

  private jsonFor(request: TextRequest): unknown {
    switch (request.operation) {
      case 'blueprint_from_brief':
        return buildBlueprint(request.user);

      case 'plan_queries': {
        const topics = detectTopics(request.user);
        const regions = detectRegions(request.user);
        const queries =
          regions.length > 0
            ? regions.flatMap((region) => topics.slice(0, 3).map((topic) => `${topic} ${region}`))
            : topics.map((topic) => `${topic} news`);
        return { queries: queries.slice(0, 8) };
      }

      case 'score_articles': {
        // The corpus already carries a term-overlap score; the mock trusts it
        // and simply penalises the obvious junk categories.
        const entries = [...request.user.matchAll(/^\[(?<id>[^\]]+)\]\s*(?<title>.+)$/gm)];
        return {
          scores: entries.map((entry) => {
            const title = entry.groups?.['title'] ?? '';
            const junk = /\b(hiring|sponsored|webinar|token launch|apply now)\b/i.test(title);
            return {
              id: entry.groups?.['id'] ?? '',
              score: junk ? 0.05 : 0.8,
              reason: junk ? 'Promotional or recruitment content, not editorial.' : 'On topic for this group.',
            };
          }),
        };
      }

      case 'summarise_article': {
        const titleMatch = /^TITLE:\s*(.+)$/m.exec(request.user);
        const bodyMatch = /^CONTENT:\s*([\s\S]+?)(?:\n[A-Z]+:|$)/m.exec(request.user);
        const wordsMatch = /^TARGET_WORDS:\s*(\d+)/m.exec(request.user);
        const words = wordsMatch ? Number(wordsMatch[1]) : 75;
        const title = titleMatch?.[1]?.trim() ?? 'Untitled';
        const content = bodyMatch?.[1]?.trim() ?? '';
        return {
          headline: title,
          body: toWordBudget(content, words),
          whyItMatters:
            'Relevant to advisers because it bears on how control and intent are documented rather than assumed.',
          confidence: 0.9,
          warnings: [],
        };
      }

      case 'social_post':
        return buildSocial(request.user);

      case 'fact_check':
        return { warnings: [] };

      default:
        throw new Error(`MockLlmProvider has no JSON handler for operation "${request.operation}"`);
    }
  }
}
