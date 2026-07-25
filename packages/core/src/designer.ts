import { z } from 'zod';
import {
  blueprintSchema,
  newId,
  nowIso,
  type Blueprint,
  type Provenance,
  type UsageRecord,
} from '@cawt/domain';
import type { LlmProvider } from '@cawt/providers';
import { SYSTEM_PROMPTS, untrusted } from './prompts.js';

/**
 * The designer: turns whatever the user gives us into an editable brief, a
 * blueprint, and eventually a rendered sample.
 *
 * Three layers, each editable, none mandatory:
 *   1. the crude prompt
 *   2. the plain-English brief  (edit this paragraph instead of a settings form)
 *   3. the blueprint            (business-friendly structure, every field editable)
 *
 * A user can enter at any layer. Paste a sample instead of a prompt, paste both,
 * or refine in conversation. All paths converge on the same blueprint.
 */

/** What the model returns. The system owns version, provenance and timestamps. */
const blueprintDraftSchema = blueprintSchema.omit({
  version: true,
  provenance: true,
  createdAt: true,
  derivedFromMessageId: true,
});
export type BlueprintDraft = z.infer<typeof blueprintDraftSchema>;

const blueprintDraftJsonSchema = z.toJSONSchema(blueprintDraftSchema, {
  io: 'input',
  unrepresentable: 'any',
}) as Record<string, unknown>;

export interface DesignInput {
  /** A crude prompt. "daily wealth news india singapore us, keep it short". */
  prompt?: string;
  /** An existing newsletter to reproduce the shape of. */
  sample?: string;
  /** Prior brief, when refining rather than starting fresh. */
  existingBrief?: string;
}

export interface DesignResult {
  brief: string;
  blueprint: Blueprint;
  usage: UsageRecord[];
  /** Things the system could not determine and needs the user to supply. */
  notes: string[];
}

/**
 * Coarse provenance: enough for the UI to show "read from your sample" versus
 * "inferred, worth a look" versus "needs you to say", without drowning the user
 * in per-field badges.
 */
function buildProvenance(input: DesignInput): Record<string, Provenance> {
  const fromSample = Boolean(input.sample);
  const derived: Provenance = fromSample ? 'observed' : 'inferred';
  return {
    structure: derived,
    freshness: derived,
    counts: fromSample ? 'inferred' : 'inferred',
    itemLength: derived,
    tone: derived,
    title: derived,
    // Never guessable from a prompt or a single sample.
    schedule: 'supplied',
    recipients: 'supplied',
    exclusions: 'supplied',
    blockedSources: 'supplied',
  };
}

const ALWAYS_NEEDED = [
  'Which topics should be deliberately excluded. A sample only shows what was published, never what was filtered out.',
  'Any sources that should be blocked.',
  'Delivery schedule, recipient group and sender. These are set on the settings tab, not derived from the prompt.',
];

/** Step one: whatever the user gave us becomes an editable English brief. */
export async function deriveBrief(llm: LlmProvider, input: DesignInput): Promise<{ brief: string; usage: UsageRecord }> {
  if (input.sample) {
    const result = await llm.completeText({
      tier: 'writer',
      operation: 'brief_from_prompt',
      system: SYSTEM_PROMPTS.briefFromSample,
      user: [
        input.prompt ? `The user also said: ${input.prompt}` : '',
        input.existingBrief ? `The current brief is: ${input.existingBrief}` : '',
        'Here is the sample newsletter to reproduce the shape of:',
        untrusted(input.sample),
      ]
        .filter(Boolean)
        .join('\n\n'),
      maxTokens: 900,
    });
    return { brief: result.value, usage: result.usage };
  }

  const parts = [input.existingBrief, input.prompt].filter(Boolean).join('\n\n');
  const result = await llm.completeText({
    tier: 'writer',
    operation: 'brief_from_prompt',
    system: SYSTEM_PROMPTS.briefFromPrompt,
    user: parts,
    maxTokens: 700,
  });
  return { brief: result.value, usage: result.usage };
}

/** Step two: the brief becomes a structured blueprint of blocks. */
export async function deriveBlueprint(
  llm: LlmProvider,
  brief: string,
  options: { previous?: Blueprint; version: number; messageId?: string } = { version: 1 },
): Promise<{ blueprint: Blueprint; usage: UsageRecord }> {
  const user = [
    `BRIEF:\n${brief}`,
    options.previous
      ? `The user is refining an existing newsletter. Its current structure is below. Preserve everything the brief does not change, including block ids where the block still exists.\n\nCURRENT_BLUEPRINT:\n${JSON.stringify(
          { blocks: options.previous.blocks, titleTemplate: options.previous.titleTemplate },
          null,
          2,
        )}`
      : '',
  ]
    .filter(Boolean)
    .join('\n\n');

  const result = await llm.completeJson<BlueprintDraft>({
    tier: 'writer',
    operation: 'blueprint_from_brief',
    system: SYSTEM_PROMPTS.blueprintFromBrief,
    user,
    maxTokens: 4000,
    schema: {
      name: 'newsletter_blueprint',
      jsonSchema: blueprintDraftJsonSchema,
      parse: (value) => blueprintDraftSchema.parse(value),
    },
  });

  const blueprint = blueprintSchema.parse({
    ...result.value,
    version: options.version,
    provenance: {},
    createdAt: nowIso(),
    ...(options.messageId ? { derivedFromMessageId: options.messageId } : {}),
  });

  return { blueprint, usage: result.usage };
}

/**
 * The whole design step in one call. Used for a first draft and for every
 * subsequent refinement, so "add a Europe section" three months later follows
 * exactly the same path as the original prompt.
 */
export async function design(
  llm: LlmProvider,
  input: DesignInput,
  options: { previous?: Blueprint; version?: number; messageId?: string } = {},
): Promise<DesignResult> {
  const usage: UsageRecord[] = [];

  const briefResult = await deriveBrief(llm, input);
  usage.push(briefResult.usage);

  const blueprintResult = await deriveBlueprint(llm, briefResult.brief, {
    previous: options.previous,
    version: options.version ?? (options.previous ? options.previous.version + 1 : 1),
    messageId: options.messageId,
  });
  usage.push(blueprintResult.usage);

  const blueprint: Blueprint = {
    ...blueprintResult.blueprint,
    provenance: buildProvenance(input),
  };

  const notes = [...new Set([...blueprint.notes, ...ALWAYS_NEEDED])];

  return { brief: briefResult.brief, blueprint: { ...blueprint, notes }, usage, notes };
}

/** Creates the first newsletter record from a design result. */
export function newsletterIdFor(name: string): string {
  return newId(`nl-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 20)}`);
}
