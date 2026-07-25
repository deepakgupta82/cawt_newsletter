import { z } from 'zod';
import type { Edition, UsageRecord } from '@cawt/domain';
import type { LlmProvider } from '@cawt/providers';
import { SYSTEM_PROMPTS } from './prompts.js';

/**
 * Turns a finished edition into a copy-paste LinkedIn post plus a diagram
 * prompt.
 *
 * It works from the edition, not from the news directly, so the post can only
 * repeat facts that already passed the edition's fact check. Nothing new is
 * invented at the social step, which is the whole point of grounding it here.
 */

const DEFAULT_AUDIENCE = 'private client advisers, family offices, trustees and wealth professionals';

/** LinkedIn's hard limit is 3000 characters; leave headroom. */
export const LINKEDIN_LIMIT = 3000;

const socialSchema = z.object({
  post: z.string().min(1).max(3200),
  diagramPrompt: z.string().min(1).max(2000),
});

export interface SocialResult {
  post: string;
  diagramPrompt: string;
  charCount: number;
  usage: UsageRecord[];
}

interface DigestStory {
  region: string;
  headline: string;
}

/** Flattens the edition into the region/headline/bottom-line the composer needs. */
function digestEdition(edition: Edition): { stories: DigestStory[]; bottomLine: string } {
  const stories: DigestStory[] = [];
  let bottomLine = '';

  const takeLeaf = (block: Edition['blocks'][number], region: string): void => {
    if (block.type === 'story') stories.push({ region, headline: block.headline });
    if (block.type === 'prose' && block.text) bottomLine ||= block.text;
  };

  for (const block of edition.blocks) {
    if (block.type === 'section') {
      for (const child of block.children) takeLeaf(child, block.heading);
    } else {
      takeLeaf(block, 'General');
    }
  }
  return { stories, bottomLine };
}

/** The compact, parseable brief handed to the model (mock or real). */
function buildDigest(edition: Edition, audience: string): string {
  const { stories, bottomLine } = digestEdition(edition);
  const lines = [
    `TITLE: ${edition.title}`,
    `AUDIENCE: ${audience}`,
    ...stories.map((story) => `STORY: ${story.region} :: ${story.headline}`),
  ];
  if (bottomLine) lines.push(`BOTTOM_LINE: ${bottomLine}`);
  return lines.join('\n');
}

export async function composeSocial(
  llm: LlmProvider,
  options: { edition: Edition; audience?: string },
): Promise<SocialResult> {
  const audience = options.audience ?? DEFAULT_AUDIENCE;
  const digest = buildDigest(options.edition, audience);

  const result = await llm.completeJson({
    tier: 'writer',
    operation: 'social_post',
    system: SYSTEM_PROMPTS.socialPost,
    user: digest,
    maxTokens: 900,
    schema: {
      name: 'social_post',
      jsonSchema: z.toJSONSchema(socialSchema, { io: 'input', unrepresentable: 'any' }) as Record<string, unknown>,
      parse: (value) => socialSchema.parse(value),
    },
  });

  const post = result.value.post.trim().slice(0, LINKEDIN_LIMIT);
  return {
    post,
    diagramPrompt: result.value.diagramPrompt.trim(),
    charCount: post.length,
    usage: [result.usage],
  };
}
