/**
 * UI-side view types.
 *
 * Deliberately not imported from @cawt/domain: that package reaches for
 * node:crypto, which does not belong in a browser bundle. This is a small,
 * read-mostly surface, so a hand-kept mirror is cheaper than restructuring the
 * domain package around an isomorphic build.
 */

export type Provenance = 'observed' | 'inferred' | 'supplied' | 'default';

export interface FreshnessRule {
  windowHours: number;
  label?: string;
}

export interface StoryGroupBlock {
  type: 'story_group';
  id: string;
  intent: string;
  keywords: string[];
  regions: string[];
  freshness: FreshnessRule;
  count: { min: number; max: number };
  relevanceFloor: number;
  style: string;
  includeWhyItMatters: boolean;
  targetWords: number;
  emptyState: string;
}

export interface ProseSpecBlock {
  type: 'prose_spec';
  id: string;
  purpose: 'intro' | 'synthesis' | 'commentary';
  instruction: string;
  label?: string;
  targetWords: number;
}

export interface DividerBlock {
  type: 'divider';
  id: string;
}

export type BlueprintLeafBlock = StoryGroupBlock | ProseSpecBlock | DividerBlock;

export interface BlueprintSectionBlock {
  type: 'section';
  id: string;
  heading: string;
  lead?: string;
  children: BlueprintLeafBlock[];
}

export type BlueprintBlock = BlueprintSectionBlock | BlueprintLeafBlock;

export interface Blueprint {
  version: number;
  titleTemplate: string;
  subjectTemplate: string;
  preheader?: string;
  tone: string;
  citationStyle: string;
  blocks: BlueprintBlock[];
  provenance: Record<string, Provenance>;
  notes: string[];
  createdAt: string;
}

export interface Newsletter {
  id: string;
  name: string;
  status: 'draft' | 'active' | 'paused' | 'archived';
  brief: { text: string; updatedAt: string };
  blueprint: Blueprint;
  schedule: { cron: string; timezone: string; enabled: boolean } | null;
  recipientGroupId: string | null;
  reviewers: string[];
  autoPublish: boolean;
  sourcePolicy: SourcePolicy;
  updatedAt: string;
}

export interface SourcePolicy {
  preferredDomains: string[];
  blockedDomains: string[];
  mode: 'feeds_only' | 'feeds_then_search' | 'search_first';
}

export interface EditionRef {
  id: string;
  status: EditionStatus;
  subject: string;
  createdAt: string;
  sentAt: string | null;
  costUsd: number;
  deliveredCount: number;
}

export interface NewsletterSummaryStats {
  recipientCount: number;
  reviewerCount: number;
  editionCount: number;
  latestEdition: Edition | null;
  lastSentAt: string | null;
  lastSentCount: number;
  lastCostUsd: number | null;
  monthCostUsd: number;
  nextRunAt: string | null;
  recentEditions: EditionRef[];
}

export interface AdminCosts {
  monthlyCapUsd: number;
  monthToDateUsd: number;
  editionCount: number;
  avgPerEditionUsd: number;
  newsletters: Array<{
    id: string;
    name: string;
    status: string;
    scheduled: boolean;
    editions: number;
    monthUsd: number;
    avgUsd: number;
    allTimeEditions: number;
  }>;
  providers: { llm: string; model: string; search: string; email: string; storage: string };
}

export interface NewsletterSummary {
  id: string;
  name: string;
  status: string;
  blueprintVersion: number;
  updatedAt: string;
}

export interface SourceRef {
  url: string;
  title: string;
  publisher: string;
  publishedAt?: string;
}

export interface StoryBlock {
  type: 'story';
  id: string;
  groupId: string;
  headline: string;
  body: string;
  whyItMatters?: string;
  sources: SourceRef[];
  publishedAt?: string;
  warnings: string[];
  confidence: number;
}

export type EditionLeafBlock =
  | StoryBlock
  | { type: 'prose'; id: string; label?: string; text: string; warnings: string[] }
  | { type: 'empty_state'; id: string; groupId: string; text: string }
  | { type: 'group_label'; id: string; text: string }
  | DividerBlock;

export type EditionBlock =
  | { type: 'section'; id: string; heading: string; lead?: string; children: EditionLeafBlock[] }
  | EditionLeafBlock;

export type EditionStatus =
  | 'draft'
  | 'ready_for_review'
  | 'changes_requested'
  | 'approved'
  | 'sending'
  | 'sent'
  | 'failed'
  | 'cancelled';

export interface Edition {
  id: string;
  newsletterId: string;
  blueprintVersion: number;
  status: EditionStatus;
  title: string;
  subject: string;
  blocks: EditionBlock[];
  warnings: string[];
  usage: Array<{ operation: string; model?: string; inputTokens: number; outputTokens: number; estimatedCostUsd: number }>;
  createdAt: string;
  sentAt?: string;
}

export interface Recipient {
  id: string;
  email: string;
  displayName?: string;
  status: 'active' | 'unsubscribed' | 'bounced';
  consentSource: string;
  consentAt?: string;
  createdAt: string;
}

export interface Delivery {
  id: string;
  newsletterId: string;
  editionId: string;
  recipientId: string;
  email: string;
  toName?: string;
  subject: string;
  kind: 'test' | 'live';
  status: 'queued' | 'sent' | 'failed';
  provider?: string;
  providerMessageId?: string;
  snapshotPath?: string;
  failureReason?: string;
  retryCount: number;
  timestamp: string;
}

export interface ConversationMessage {
  id: string;
  newsletterId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  kind: 'prompt' | 'sample' | 'refinement' | 'note' | 'result';
  producedBlueprintVersion?: number;
  createdAt: string;
}

export interface AppConfig {
  llm: string;
  search: string;
  email: string;
  storage: string;
  modelBulk: string;
  modelWriter: string;
  monthlyCapUsd: number;
}
