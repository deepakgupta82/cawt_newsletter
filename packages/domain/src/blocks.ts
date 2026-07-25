import { z } from 'zod';

/**
 * The block vocabulary.
 *
 * This is the load-bearing idea of the whole platform. A user describes a
 * newsletter in plain language; a model composes a *tree of these blocks*.
 * It never writes HTML and never invents new structure, because the schema
 * below is the only thing it is allowed to emit. That keeps the output
 * open-ended in shape while keeping rendering deterministic, testable and
 * safe for Outlook.
 *
 * There are two parallel trees:
 *
 *   Blueprint  - the saved *template*. Contains selection rules, not content.
 *                Derived once at design time, then frozen and versioned.
 *   Edition    - one *instance* produced by executing a blueprint against
 *                the articles retrieved on a given day.
 *
 * Nesting is deliberately capped at two levels (section -> leaf). Every real
 * newsletter shape we have seen fits, the JSON Schema stays non-recursive,
 * and structured-output support across model families is far more reliable.
 */

// ---------------------------------------------------------------------------
// Shared value objects
// ---------------------------------------------------------------------------

/**
 * How recent an article must be to qualify for a group. Expressed in hours
 * rather than a fixed "last 48 hours" so a section can ask for 96, 24 or 720
 * without any change to the code.
 */
export const freshnessRuleSchema = z.object({
  windowHours: z
    .number()
    .int()
    .min(1)
    .max(24 * 365)
    .describe('How far back this group may reach, in hours.'),
  label: z
    .string()
    .max(80)
    .optional()
    .describe('Optional heading shown above the group, e.g. "Fresh - last 48 hours".'),
});
export type FreshnessRule = z.infer<typeof freshnessRuleSchema>;

/**
 * A range, never a fixed target. If only two stories clear the relevance bar
 * the edition carries two. The system must never pad to hit a number, because
 * padding is where invented content comes from.
 */
export const countRuleSchema = z.object({
  min: z.number().int().min(0).max(50).describe('Fewer than this triggers a warning, never invention.'),
  max: z.number().int().min(1).max(50).describe('Hard ceiling on items in this group.'),
});
export type CountRule = z.infer<typeof countRuleSchema>;

export const storyStyleSchema = z.enum([
  'headline_paragraph', // Headline, a paragraph, then sources. The CAWT house style.
  'compact_list', // One line per item. For quick-hits sections.
  'headline_only', // Headline plus source only.
]);
export type StoryStyle = z.infer<typeof storyStyleSchema>;

export const citationStyleSchema = z.enum([
  'inline_link', // Publisher name hyperlinked to the article, after the body.
  'inline_domain', // Bare domain shown as the link text.
  'footnote', // Numbered markers in the body, list at the end of the section.
]);
export type CitationStyle = z.infer<typeof citationStyleSchema>;

// ---------------------------------------------------------------------------
// Blueprint blocks (the template)
// ---------------------------------------------------------------------------

/**
 * A selection rule. At run time this produces zero or more StoryBlocks.
 * This is what replaces the fixed "lookback period" and "max stories" fields
 * of a conventional newsletter definition: every group carries its own.
 */
export const storyGroupBlockSchema = z.object({
  type: z.literal('story_group'),
  id: z.string().min(1),
  intent: z
    .string()
    .min(1)
    .max(500)
    .describe('Plain-language description of what belongs in this group. Drives query planning and relevance scoring.'),
  keywords: z.array(z.string().max(80)).max(30).default([]),
  regions: z.array(z.string().max(80)).max(20).default([]).describe('Country or region filter. Empty means no filter.'),
  freshness: freshnessRuleSchema,
  count: countRuleSchema,
  relevanceFloor: z
    .number()
    .min(0)
    .max(1)
    .default(0.6)
    .describe('Articles scoring below this are dropped even if the group is under its minimum.'),
  style: storyStyleSchema.default('headline_paragraph'),
  includeWhyItMatters: z.boolean().default(true),
  targetWords: z.number().int().min(15).max(400).default(75).describe('Approximate words per item.'),
  emptyState: z
    .string()
    .max(300)
    .default('No developments in this period.')
    .describe('Rendered when the group returns nothing. Never replaced with invented content.'),
});
export type StoryGroupBlock = z.infer<typeof storyGroupBlockSchema>;

/**
 * A paragraph the model writes, grounded strictly in the stories that were
 * actually selected. This is how CAWT's "Bottom line:" closing paragraph is
 * expressed without hard-coding it.
 */
export const proseSpecBlockSchema = z.object({
  type: z.literal('prose_spec'),
  id: z.string().min(1),
  purpose: z.enum(['intro', 'synthesis', 'commentary']),
  instruction: z.string().min(1).max(500).describe('What this paragraph should do.'),
  label: z.string().max(80).optional().describe('Optional lead-in, e.g. "Bottom line:".'),
  targetWords: z.number().int().min(10).max(300).default(60),
});
export type ProseSpecBlock = z.infer<typeof proseSpecBlockSchema>;

export const dividerBlockSchema = z.object({
  type: z.literal('divider'),
  id: z.string().min(1),
});
export type DividerBlock = z.infer<typeof dividerBlockSchema>;

/** Blocks that may appear inside a section. */
export const blueprintLeafBlockSchema = z.discriminatedUnion('type', [
  storyGroupBlockSchema,
  proseSpecBlockSchema,
  dividerBlockSchema,
]);
export type BlueprintLeafBlock = z.infer<typeof blueprintLeafBlockSchema>;

export const blueprintSectionBlockSchema = z.object({
  type: z.literal('section'),
  id: z.string().min(1),
  heading: z.string().min(1).max(160),
  lead: z.string().max(400).optional().describe('Optional line under the heading.'),
  children: z.array(blueprintLeafBlockSchema).min(1).max(20),
});
export type BlueprintSectionBlock = z.infer<typeof blueprintSectionBlockSchema>;

export const blueprintBlockSchema = z.discriminatedUnion('type', [
  blueprintSectionBlockSchema,
  storyGroupBlockSchema,
  proseSpecBlockSchema,
  dividerBlockSchema,
]);
export type BlueprintBlock = z.infer<typeof blueprintBlockSchema>;

// ---------------------------------------------------------------------------
// Edition blocks (one rendered instance)
// ---------------------------------------------------------------------------

export const sourceRefSchema = z.object({
  url: z.string().url(),
  title: z.string().max(400),
  publisher: z.string().max(160),
  publishedAt: z.string().optional(),
});
export type SourceRef = z.infer<typeof sourceRefSchema>;

/**
 * One story as it appears in a generated edition.
 *
 * `body` holds a restricted subset of HTML (b, i, em, strong, a, br) produced
 * by the editor. It is sanitised on save and again at render time.
 *
 * Every story carries the sources it was built from, so a reviewer can verify
 * any claim in one click, and so the deterministic fact checker has something
 * to check the numbers against.
 */
export const storyBlockSchema = z.object({
  type: z.literal('story'),
  id: z.string().min(1),
  groupId: z.string().min(1).describe('Which story_group produced this.'),
  headline: z.string().min(1).max(300),
  body: z.string().min(1),
  whyItMatters: z.string().optional(),
  sources: z.array(sourceRefSchema).min(1),
  publishedAt: z.string().optional(),
  style: storyStyleSchema.default('headline_paragraph'),
  warnings: z.array(z.string()).default([]),
  confidence: z.number().min(0).max(1).default(1),
});
export type StoryBlock = z.infer<typeof storyBlockSchema>;

export const proseBlockSchema = z.object({
  type: z.literal('prose'),
  id: z.string().min(1),
  label: z.string().max(80).optional(),
  text: z.string().min(1),
  warnings: z.array(z.string()).default([]),
});
export type ProseBlock = z.infer<typeof proseBlockSchema>;

/** Rendered when a story_group returned nothing. Its presence is a feature. */
export const emptyStateBlockSchema = z.object({
  type: z.literal('empty_state'),
  id: z.string().min(1),
  groupId: z.string().min(1),
  text: z.string().min(1),
});
export type EmptyStateBlock = z.infer<typeof emptyStateBlockSchema>;

/** A group heading such as "Fresh - last 48 hours", emitted from a group's label. */
export const groupLabelBlockSchema = z.object({
  type: z.literal('group_label'),
  id: z.string().min(1),
  text: z.string().min(1).max(160),
});
export type GroupLabelBlock = z.infer<typeof groupLabelBlockSchema>;

export const editionLeafBlockSchema = z.discriminatedUnion('type', [
  storyBlockSchema,
  proseBlockSchema,
  emptyStateBlockSchema,
  groupLabelBlockSchema,
  dividerBlockSchema,
]);
export type EditionLeafBlock = z.infer<typeof editionLeafBlockSchema>;

export const editionSectionBlockSchema = z.object({
  type: z.literal('section'),
  id: z.string().min(1),
  heading: z.string().min(1).max(160),
  lead: z.string().optional(),
  children: z.array(editionLeafBlockSchema),
});
export type EditionSectionBlock = z.infer<typeof editionSectionBlockSchema>;

export const editionBlockSchema = z.discriminatedUnion('type', [
  editionSectionBlockSchema,
  storyBlockSchema,
  proseBlockSchema,
  emptyStateBlockSchema,
  groupLabelBlockSchema,
  dividerBlockSchema,
]);
export type EditionBlock = z.infer<typeof editionBlockSchema>;

// ---------------------------------------------------------------------------
// Traversal helpers
// ---------------------------------------------------------------------------

export function walkBlueprint(blocks: BlueprintBlock[], visit: (block: BlueprintBlock) => void): void {
  for (const block of blocks) {
    visit(block);
    if (block.type === 'section') {
      for (const child of block.children) visit(child);
    }
  }
}

export function collectStoryGroups(blocks: BlueprintBlock[]): StoryGroupBlock[] {
  const groups: StoryGroupBlock[] = [];
  walkBlueprint(blocks, (block) => {
    if (block.type === 'story_group') groups.push(block);
  });
  return groups;
}

export function collectStories(blocks: EditionBlock[]): StoryBlock[] {
  const stories: StoryBlock[] = [];
  for (const block of blocks) {
    if (block.type === 'story') stories.push(block);
    if (block.type === 'section') {
      for (const child of block.children) {
        if (child.type === 'story') stories.push(child);
      }
    }
  }
  return stories;
}
