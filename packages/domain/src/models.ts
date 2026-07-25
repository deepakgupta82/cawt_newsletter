import { z } from 'zod';
import { blueprintBlockSchema, citationStyleSchema, editionBlockSchema } from './blocks.js';

// ---------------------------------------------------------------------------
// Provenance
// ---------------------------------------------------------------------------

/**
 * Where a derived value came from. The UI shows these differently so a user
 * can tell at a glance what the system read from their input, what it guessed,
 * and what it still needs from them. Confidently wrong is worse than visibly
 * uncertain, so nothing in the "supplied" bucket gets a plausible default.
 */
export const provenanceSchema = z.enum([
  'observed', // Read directly from a sample the user provided.
  'inferred', // Derived from the brief. Probable, worth a look.
  'supplied', // The user set it explicitly.
  'default', // Fell back to a system default because nothing indicated otherwise.
]);
export type Provenance = z.infer<typeof provenanceSchema>;

// ---------------------------------------------------------------------------
// Blueprint
// ---------------------------------------------------------------------------

/**
 * The saved newsletter template: what sections exist, how items are selected,
 * how long they run, what closes the edition.
 *
 * Derived once at design time from a prompt and/or a sample, then FROZEN.
 * Scheduled runs execute a stored blueprint; they never re-derive it. Without
 * that rule the newsletter's shape drifts day to day and readers see it as
 * broken rather than dynamic. Changing structure means a new version, which
 * can be tested before activation and never alters editions already sent.
 */
export const blueprintSchema = z.object({
  version: z.number().int().min(1),
  titleTemplate: z
    .string()
    .min(1)
    .max(200)
    .describe('Supports {{date}}, e.g. "Wealth & Legacy Watch - {{date}}".'),
  subjectTemplate: z.string().min(1).max(200),
  preheader: z.string().max(200).optional(),
  tone: z.string().max(300).default('Neutral, factual, written for a professional reader.'),
  citationStyle: citationStyleSchema.default('inline_link'),
  blocks: z.array(blueprintBlockSchema).min(1).max(40),
  provenance: z.record(z.string(), provenanceSchema).default({}),
  notes: z.array(z.string()).default([]).describe('Things the system could not determine and needs from the user.'),
  createdAt: z.string(),
  derivedFromMessageId: z.string().optional(),
});
export type Blueprint = z.infer<typeof blueprintSchema>;

/** The editable plain-English layer between the crude prompt and the blueprint. */
export const briefSchema = z.object({
  text: z.string().min(1).max(4000),
  updatedAt: z.string(),
});
export type Brief = z.infer<typeof briefSchema>;

// ---------------------------------------------------------------------------
// Newsletter definition
// ---------------------------------------------------------------------------

export const scheduleSchema = z.object({
  cron: z.string().min(1).describe('Standard 5-field cron, evaluated in the timezone below.'),
  timezone: z.string().min(1).default('Asia/Kolkata'),
  enabled: z.boolean().default(false),
  /** ISO instant of the scheduled slot last run, so the ticker never double-fires. */
  lastRunAt: z.string().optional(),
});
export type Schedule = z.infer<typeof scheduleSchema>;

export const newsletterStatusSchema = z.enum(['draft', 'active', 'paused', 'archived']);
export type NewsletterStatus = z.infer<typeof newsletterStatusSchema>;

export const approvalPolicySchema = z.enum([
  'author_sends', // The editor reviews and sends. No second person required.
  'review_requested', // A colleague must approve before send.
]);
export type ApprovalPolicy = z.infer<typeof approvalPolicySchema>;

export const newsletterSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(200),
  status: newsletterStatusSchema.default('draft'),
  brief: briefSchema,
  blueprint: blueprintSchema,
  /** Operational settings. Deliberately NOT derived from the prompt. */
  schedule: scheduleSchema.nullable().default(null),
  recipientGroupId: z.string().nullable().default(null),
  brandId: z.string().default('default'),
  approvalPolicy: approvalPolicySchema.default('author_sends'),
  sourcePolicy: z
    .object({
      preferredDomains: z.array(z.string()).default([]),
      blockedDomains: z.array(z.string()).default([]),
      mode: z.enum(['feeds_only', 'feeds_then_search', 'search_first']).default('feeds_then_search'),
    })
    .default({ preferredDomains: [], blockedDomains: [], mode: 'feeds_then_search' }),
  createdBy: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Newsletter = z.infer<typeof newsletterSchema>;

// ---------------------------------------------------------------------------
// Conversation
// ---------------------------------------------------------------------------

/**
 * Persistent per-newsletter thread. Reopening a newsletter three months later
 * and saying "add Europe" should not require re-explaining it, so the whole
 * design history travels with the newsletter.
 */
export const conversationMessageSchema = z.object({
  id: z.string().min(1),
  newsletterId: z.string().min(1),
  role: z.enum(['user', 'assistant', 'system']),
  content: z.string(),
  /** What kind of input this was, so the UI can render attachments distinctly. */
  kind: z.enum(['prompt', 'sample', 'refinement', 'note', 'result']).default('prompt'),
  attachmentRef: z.string().optional().describe('Blob path of an uploaded sample, if any.'),
  producedBlueprintVersion: z.number().int().optional(),
  createdAt: z.string(),
});
export type ConversationMessage = z.infer<typeof conversationMessageSchema>;

// ---------------------------------------------------------------------------
// Articles
// ---------------------------------------------------------------------------

export const articleSchema = z.object({
  id: z.string().min(1),
  canonicalUrl: z.string().url(),
  title: z.string().min(1),
  publisher: z.string(),
  author: z.string().optional(),
  publishedAt: z.string().optional(),
  discoveredAt: z.string(),
  language: z.string().default('en'),
  publisherCountry: z.string().optional(),
  regions: z.array(z.string()).default([]),
  topics: z.array(z.string()).default([]),
  snippet: z.string().default(''),
  /** Blob path for retrieved full text. Kept out of the record to stay small. */
  contentRef: z.string().optional(),
  contentHash: z.string(),
  relevanceScore: z.number().min(0).max(1).optional(),
  qualityScore: z.number().min(0).max(1).optional(),
  duplicateClusterId: z.string().optional(),
  provider: z.string().default('mock'),
});
export type Article = z.infer<typeof articleSchema>;

// ---------------------------------------------------------------------------
// Editions
// ---------------------------------------------------------------------------

export const editionStatusSchema = z.enum([
  'draft',
  'ready_for_review',
  'changes_requested',
  'approved',
  'sending',
  'sent',
  'failed',
  'cancelled',
]);
export type EditionStatus = z.infer<typeof editionStatusSchema>;

export const usageRecordSchema = z.object({
  provider: z.string(),
  operation: z.string(),
  model: z.string().optional(),
  inputTokens: z.number().int().default(0),
  outputTokens: z.number().int().default(0),
  searchQueries: z.number().int().default(0),
  estimatedCostUsd: z.number().default(0),
});
export type UsageRecord = z.infer<typeof usageRecordSchema>;

export const editionSchema = z.object({
  id: z.string().min(1),
  newsletterId: z.string().min(1),
  blueprintVersion: z.number().int(),
  editionDate: z.string(),
  revision: z.number().int().default(1),
  status: editionStatusSchema.default('draft'),
  /** True for unsaved live tests run from the designer. Expire on a timer. */
  isPreview: z.boolean().default(false),
  subject: z.string(),
  preheader: z.string().optional(),
  title: z.string(),
  blocks: z.array(editionBlockSchema),
  warnings: z.array(z.string()).default([]),
  usage: z.array(usageRecordSchema).default([]),
  renderedHtmlRef: z.string().optional(),
  plainTextRef: z.string().optional(),
  createdAt: z.string(),
  approvedAt: z.string().optional(),
  approvedBy: z.string().optional(),
  sentAt: z.string().optional(),
});
export type Edition = z.infer<typeof editionSchema>;

// ---------------------------------------------------------------------------
// Recipients and branding
// ---------------------------------------------------------------------------

export const recipientSchema = z.object({
  id: z.string().min(1),
  email: z.string().email(),
  displayName: z.string().optional(),
  status: z.enum(['active', 'unsubscribed', 'bounced']).default('active'),
  /** How this address got on the list. Required for a lawful basis. */
  consentSource: z.string().default('manual'),
  consentAt: z.string().optional(),
  unsubscribedAt: z.string().optional(),
  createdAt: z.string(),
});
export type Recipient = z.infer<typeof recipientSchema>;

export const recipientGroupSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(200),
  description: z.string().optional(),
  recipientIds: z.array(z.string()).default([]),
  createdAt: z.string(),
});
export type RecipientGroup = z.infer<typeof recipientGroupSchema>;

export const brandSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  logoRef: z.string().optional(),
  primaryColor: z.string().default('#1F2937'),
  accentColor: z.string().default('#B45309'),
  backgroundColor: z.string().default('#FFFFFF'),
  fontFamily: z.string().default("Georgia, 'Times New Roman', serif"),
  headerText: z.string().optional(),
  footerText: z.string().default('You are receiving this because you subscribed to updates from CAWT.'),
  contactAddress: z.string().default('contact@cawt.ai'),
  disclaimer: z.string().optional(),
});
export type Brand = z.infer<typeof brandSchema>;

// ---------------------------------------------------------------------------
// Delivery
// ---------------------------------------------------------------------------

export const deliverySchema = z.object({
  id: z.string().min(1),
  newsletterId: z.string().min(1),
  editionId: z.string().min(1),
  recipientId: z.string().min(1),
  email: z.string().email(),
  toName: z.string().optional(),
  /** The subject line the recipient actually saw. */
  subject: z.string().default(''),
  /** A one-off test send versus a real edition send. */
  kind: z.enum(['test', 'live']).default('test'),
  status: z.enum(['queued', 'sent', 'failed']).default('queued'),
  provider: z.string().optional(),
  providerMessageId: z.string().optional(),
  /** Blob path of the exact HTML that was sent, so it can be read back later. */
  snapshotPath: z.string().optional(),
  failureReason: z.string().optional(),
  retryCount: z.number().int().default(0),
  timestamp: z.string(),
});
export type Delivery = z.infer<typeof deliverySchema>;

export const auditEventSchema = z.object({
  id: z.string().min(1),
  actor: z.string(),
  action: z.string(),
  objectType: z.string(),
  objectId: z.string(),
  correlationId: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).default({}),
  timestamp: z.string(),
});
export type AuditEvent = z.infer<typeof auditEventSchema>;
