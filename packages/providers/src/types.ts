import type { Article, UsageRecord } from '@cawt/domain';

/**
 * Every outside service sits behind one of these interfaces, with a mock
 * implementation alongside the real one.
 *
 * That is what lets the whole application run locally with no Azure account,
 * no API keys and no network: tests are free and repeatable, output is
 * identical every run so assertions are possible, and there is no code path
 * by which a test sends real email to real people.
 */

// ---------------------------------------------------------------------------
// Language model
// ---------------------------------------------------------------------------

/**
 * Two tiers, because roughly 90% of tokens flow through scoring and
 * summarising. Putting a cheap model there and a stronger one on the prose is
 * what keeps the monthly bill in single digits.
 */
export type ModelTier = 'bulk' | 'writer';

export interface TextRequest {
  tier: ModelTier;
  system: string;
  user: string;
  maxTokens?: number;
  /** Free-text label used for usage attribution, e.g. "summarise_article". */
  operation: string;
}

export interface JsonRequest<T> extends TextRequest {
  schema: {
    name: string;
    /** JSON Schema, produced from a zod schema via z.toJSONSchema(). */
    jsonSchema: Record<string, unknown>;
    /** Validates and narrows the parsed response. Throws on mismatch. */
    parse: (value: unknown) => T;
  };
}

export interface LlmResult<T> {
  value: T;
  usage: UsageRecord;
}

export interface LlmProvider {
  readonly name: string;
  completeText(request: TextRequest): Promise<LlmResult<string>>;
  completeJson<T>(request: JsonRequest<T>): Promise<LlmResult<T>>;
}

// ---------------------------------------------------------------------------
// Search / discovery
// ---------------------------------------------------------------------------

export interface SearchRequest {
  queries: string[];
  maxResults: number;
  maxAgeHours: number;
  regions?: string[];
  preferredDomains?: string[];
  blockedDomains?: string[];
}

export interface SearchResult {
  articles: Article[];
  usage: UsageRecord;
}

export interface SearchProvider {
  readonly name: string;
  search(request: SearchRequest): Promise<SearchResult>;
}

// ---------------------------------------------------------------------------
// Email
// ---------------------------------------------------------------------------

export interface OutboundMessage {
  to: string;
  toName?: string;
  fromAddress: string;
  fromName: string;
  replyTo?: string;
  subject: string;
  html: string;
  text: string;
  /** Extra headers. List-Unsubscribe belongs here. */
  headers?: Record<string, string>;
}

export interface SendResult {
  messageId: string;
  /** Where the message actually went, for the local sink. */
  location?: string;
}

export interface EmailProvider {
  readonly name: string;
  send(message: OutboundMessage): Promise<SendResult>;
}

// ---------------------------------------------------------------------------
// Cost metering
// ---------------------------------------------------------------------------

/** Rates in USD per million tokens. Overridable from configuration. */
export interface ModelRates {
  inputPerMillion: number;
  outputPerMillion: number;
}

export const DEFAULT_RATES: Record<string, ModelRates> = {
  // Anthropic on Microsoft Foundry, billed through Azure Marketplace at
  // standard API rates.
  'claude-haiku-4-5': { inputPerMillion: 1, outputPerMillion: 5 },
  'claude-sonnet-5': { inputPerMillion: 3, outputPerMillion: 15 },
  'claude-opus-4-8': { inputPerMillion: 5, outputPerMillion: 25 },
  // Azure OpenAI. Verify against the Azure pricing calculator before relying
  // on these for budgeting; per-token prices move.
  // Deployed for CAWT in South India (GlobalStandard): gpt-5-mini for bulk,
  // gpt-5.1 for the edition prose.
  'gpt-5-mini': { inputPerMillion: 0.25, outputPerMillion: 2 },
  'gpt-5.1': { inputPerMillion: 1.25, outputPerMillion: 10 },
  'gpt-4.1-nano': { inputPerMillion: 0.1, outputPerMillion: 0.4 },
  'gpt-4.1-mini': { inputPerMillion: 0.4, outputPerMillion: 1.6 },
  'gpt-4.1': { inputPerMillion: 2, outputPerMillion: 8 },
  'gpt-4o-mini': { inputPerMillion: 0.15, outputPerMillion: 0.6 },
  mock: { inputPerMillion: 0, outputPerMillion: 0 },
};

export function estimateCost(model: string, inputTokens: number, outputTokens: number): number {
  const rates = DEFAULT_RATES[model] ?? DEFAULT_RATES['mock']!;
  return (inputTokens / 1_000_000) * rates.inputPerMillion + (outputTokens / 1_000_000) * rates.outputPerMillion;
}

/** Rough token estimate for metering the mock provider and for pre-flight checks. */
export function approxTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
