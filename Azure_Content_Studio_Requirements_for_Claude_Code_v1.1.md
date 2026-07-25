# Azure Content Studio
## Detailed Product and Technical Requirements for Newsletter and LinkedIn Content Automation
**Version 1.1 — 21 July 2026**

## 1. Document Purpose

This document defines the requirements for a small, Azure-native content application that enables non-technical client users to create and operate recurring newsletters and LinkedIn posts.

The application will be developed first on a local development machine using Claude Code, then deployed to the client’s Microsoft Azure environment. The initial client organisation has approximately 10–15 users and requires a deliberately simple interface.

The product will wrap and improve an existing workflow that currently uses Azure Logic Apps, a web-search API, an LLM and Azure-based email delivery.

## 2. Business Context

The client currently runs a Logic App that:
1. Executes an internet search using a search API.
2. Sends search results to an LLM.
3. Generates newsletter content in HTML.
4. Sends the newsletter by email.

The client wants to expand this into an easy-to-use application where business users can:
- Define a newsletter using a plain-language description.
- Specify topics, keywords, regions, preferred sources and exclusions.
- Maintain recipient groups without exposing recipients to one another.
- Generate, review, edit, approve and send daily newsletters.
- Reuse newsletter research to generate LinkedIn posts.
- Review and edit a LinkedIn post, attach an image, preview it and publish it through an authorised employee account.
- Add more newsletters and recipient groups later without requiring code changes.

## 3. Product Goals

The product shall:
- Present a simple editorial interface rather than an automation or developer interface.
- Reuse the existing Logic App and Azure investment wherever practical.
- Minimise paid search and model costs through RSS ingestion, caching, deduplication and selective use of paid search.
- Let a user test a newsletter definition immediately against live search results before saving it.
- Generate traceable, source-backed content.
- Require human review for newsletter sending during initial rollout.
- Present LinkedIn-ready copy and imagery for human copy-and-paste publishing; direct LinkedIn API publishing is optional.
- Support a custom sender such as contact@clientdomain.com through the client’s existing Microsoft 365 email environment where available.
- Keep all secrets and optional OAuth tokens outside source code.
- Be easy to run locally and deploy to Azure using infrastructure as code.

## 4. Out of Scope for the MVP

The first release will not include:
- A general-purpose internet crawler or search engine.
- Marketing automation, lead scoring or CRM functionality.
- Complex campaign segmentation or behavioural targeting.
- Multi-client SaaS tenancy.
- Native mobile applications.
- Automated comments, likes or engagement on LinkedIn.
- LinkedIn credential storage or browser automation.
- AI-generated images as a mandatory feature.
- A vector database or multi-agent framework.
- Kubernetes, API Management or Service Bus unless later justified by scale.

## 5. User Roles

Administrator
- Manage users and roles.
- Configure newsletters, recipient groups, sources, search providers and schedules.
- Configure sender details and LinkedIn integration.
- View usage, failures and audit history.

Editor
- Create and edit newsletter definitions.
- Review and edit newsletter editions.
- Create and edit LinkedIn drafts.
- Upload or select images.

Approver
- Approve or reject newsletter editions.
- Approve or reject LinkedIn posts.
- Publish an approved LinkedIn post when authorised.

Viewer
- View newsletters, source evidence, delivery history and LinkedIn history.

A user may hold more than one role. Authentication shall use Microsoft Entra ID in Azure. Local development shall support a clearly marked development authentication mode.

## 6. Primary User Experience

The application shall have two primary workspaces:

A. Newsletter Manager
- Dashboard of active newsletters.
- Create/edit newsletter wizard.
- Recipient group management.
- Draft review and approval.
- Sending and delivery history.

B. LinkedIn Studio
- Create a post from a newsletter, one or more stories, or a fresh topic.
- Generate multiple candidate posts.
- Edit and review the selected post.
- Upload, crop or replace an image.
- Preview the post.
- Approve and publish, or copy the final content for manual publishing.

The application must hide technical concepts such as Logic App actions, JSON, API keys, prompt internals and provider-specific parameters from normal users.

## 7. Functional Requirements — Newsletter Definition

FR-ND-01: A user shall be able to create a newsletter by entering a plain-language description.

FR-ND-02: The system shall convert the description into an editable structured definition containing:
- Newsletter name.
- Purpose and intended audience.
- Topics and keywords.
- Countries or regions.
- Preferred languages.
- Included story types.
- Excluded story types or terms.
- Preferred and blocked domains.
- Lookback period.
- Maximum number of stories.
- Delivery schedule and time zone.
- Recipient group.
- Newsletter template.
- Approval policy.

FR-ND-03: The structured definition shall be displayed as business-friendly fields and tags, not raw JSON.

FR-ND-04: The user shall be able to edit every generated field before saving.

FR-ND-05: The system shall support three source policies:
- Approved sources only.
- Broader web search.
- Broader web search with approved-source priority.

FR-ND-06: Before saving, the user shall be able to select **Test with live news**.

FR-ND-07: The live test shall:
- Build a bounded search plan from the current unsaved definition.
- Show the generated search topics in a collapsible “How this was searched” panel.
- Search feeds, cache and the configured paid-search fallback.
- Retrieve and rank current articles.
- Generate a complete sample newsletter using the selected template.
- Show article sources, publication dates and warnings.
- Record an estimated search-credit and model-token cost for the test.
- Avoid sending any email.

FR-ND-08: After viewing the sample, the user shall be able to:
- Edit the plain-language description.
- Edit generated topics, regions, sources or exclusions.
- Change the content format.
- Remove or replace articles.
- Re-run the live test.
- Compare the current preview with the immediately previous preview.
- Save only when satisfied.

FR-ND-09: Unsaved test runs shall expire after a configurable period, but their provider usage shall still be metered.

FR-ND-10: Saving the tested definition shall preserve:
- The final structured definition.
- Prompt/template versions.
- The most recent successful test summary.
- Search-policy settings.
- Expected schedule and recipient group.

FR-ND-11: A newsletter may be paused, resumed, duplicated or archived.

FR-ND-12: Changes to a saved newsletter definition shall create a draft configuration version. The user shall be able to test the draft before activating it.

FR-ND-13: Activating a changed configuration shall not alter editions already generated or sent.

## 8. Functional Requirements — Content Discovery

FR-CD-01: The platform shall use a hybrid discovery model in this priority order:
1. Native RSS/Atom feeds and approved direct sources.
2. Optional GDELT discovery for broader regional coverage.
3. Paid web search provider for gaps.
4. Tavily extraction only for selected URLs where direct retrieval is insufficient.

FR-CD-02: A shared ingestion process shall retrieve each source once and make the resulting articles available to all newsletters.

FR-CD-03: Search shall be executed per newsletter or topic, never per recipient.

FR-CD-04: Before paid search, the workflow shall check:
- Cached results for an equivalent recent query.
- Newly ingested feed articles.
- Previously stored articles matching the time window.

FR-CD-05: The LLM shall produce a bounded search plan, normally 3–8 focused queries, from the newsletter definition.

FR-CD-06: Each search run shall have configurable limits:
- Maximum paid queries.
- Maximum results per query.
- Maximum extracted pages.
- Maximum monthly provider spend.
- Maximum article age.

FR-CD-07: The platform shall retain the exact queries, provider used, returned URLs, search time and credit estimate.

FR-CD-08: The system shall support provider abstraction so Brave Search and Tavily can be enabled, disabled or swapped without changing newsletter logic.

FR-CD-09: Search provider failures shall not automatically fail the whole edition when sufficient cached or feed content exists.

## 9. Functional Requirements — Article Processing

FR-AP-01: Every candidate article shall be normalised into a common record containing:
- Canonical URL.
- Title.
- Publisher.
- Author when available.
- Publication date.
- Discovery date.
- Publisher country.
- Story regions.
- Language.
- Snippet.
- Retrieved article text or selected excerpts.
- Source type and provider.
- Content hash.
- Relevance score.
- Quality score.
- Duplicate cluster identifier.

FR-AP-02: The system shall reject:
- Previously used URLs within a configurable period.
- Blocked domains.
- Articles outside the allowed time range.
- Job advertisements and promotional pages when excluded.
- Pages with insufficient readable content.
- Duplicate or syndicated copies when a better primary source exists.

FR-AP-03: Deduplication shall use canonical URL, normalised title hash and semantic similarity where necessary.

FR-AP-04: Deterministic filtering shall be applied before LLM processing.

FR-AP-05: Full-page extraction shall occur only for shortlisted articles.

FR-AP-06: Article-level LLM processing shall return structured JSON with:
- Concise summary.
- Key facts.
- Why it matters.
- Relevant topics and regions.
- Supporting source references.
- Confidence and warning flags.

FR-AP-07: The system shall not invent quotations, statistics, dates or entities. Any unsupported claim shall be rejected or flagged.

## 10. Functional Requirements — Newsletter Generation

FR-NG-01: The LLM shall generate structured newsletter content, not final HTML.

FR-NG-02: The structured edition shall include:
- Subject line.
- Preheader text.
- Newsletter title.
- Introduction.
- Ordered story sections.
- Headline, summary, why-it-matters and source link for each story.
- Closing section.
- Disclaimer when configured.

FR-NG-03: HTML shall be produced by a tested server-side template.

FR-NG-04: Templates shall support:
- Logo.
- Brand colours.
- Header and footer.
- Contact information.
- Unsubscribe or preferences link when required.
- Responsive email layout.
- Outlook-compatible table-based structure where needed.
- Plain-text alternative.

FR-NG-05: A reviewer shall be able to:
- Edit any text.
- Remove, restore and reorder stories.
- Regenerate one story.
- Replace a story.
- Regenerate the introduction or subject line.
- Preview desktop and narrow/mobile layouts.
- Send a test email.

FR-NG-06: The final sent edition shall be immutable. Later edits shall create a new revision.

FR-NG-07: The application shall retain the source evidence associated with every generated story.

## 11. Functional Requirements — Recipient Management and Email

FR-EM-01: Administrators shall manage recipient groups through the UI.

FR-EM-02: The application shall support manual entry and CSV import with validation.

FR-EM-03: A recipient may belong to multiple groups.

FR-EM-04: Email addresses shall not be exposed to other recipients.

FR-EM-05: The preferred delivery model is one message per recipient. A provider-supported bulk operation may be used only when it preserves recipient privacy and individual status.

FR-EM-06: The default sender configuration shall support:
- From address: contact@clientdomain.com or another approved mailbox-style sender.
- From display name: configurable per newsletter.
- Reply-to address: configurable.
- Sending domain: clientdomain.com or a dedicated subdomain such as mail.clientdomain.com.

FR-EM-07: The sending domain shall be verified with the selected email service and configured with SPF, DKIM and DMARC.

FR-EM-08: The system shall capture:
- Accepted/sent/failed status.
- Provider message identifier.
- Recipient.
- Failure reason.
- Retry count.
- Timestamp.

FR-EM-09: Failed sends shall be retried using bounded exponential backoff.

FR-EM-10: The system shall support test recipients and a non-production email mode.

## 12. Functional Requirements — Review and Approval

FR-RA-01: Newsletter approval states shall be:
Draft → Ready for Review → Changes Requested → Approved → Sending → Sent
with Failed and Cancelled states where applicable.

FR-RA-02: LinkedIn approval states shall be:
Draft → Ready for Review → Changes Requested → Approved → Publishing → Published
with Failed and Cancelled states where applicable.

FR-RA-03: Approval shall record approver identity, timestamp and optional comments.

FR-RA-04: The system shall prevent publishing or sending an edition that changed after approval. A material edit shall return it to review.

FR-RA-05: Administrators may configure:
- Always require approval.
- Automatic send after a defined stabilisation period.
- Require approval only when warnings or low confidence exist.

FR-RA-06: LinkedIn publishing shall always require explicit approval in the MVP.

## 13. Functional Requirements — LinkedIn Studio

FR-LI-01: A user shall be able to start a LinkedIn post from:
- A complete newsletter edition.
- One selected newsletter story.
- Multiple selected stories.
- A new research topic.
- A blank idea.

FR-LI-02: The user shall choose a saved writing profile such as:
- Executive insight.
- News analysis.
- Educational post.
- Contrarian perspective.
- Client custom format.

FR-LI-03: The system shall generate 2–3 substantially different candidate posts.

FR-LI-04: The editor shall be able to:
- Select one candidate.
- Edit all text.
- Regenerate a section.
- Adjust length.
- Add or remove hashtags.
- View source evidence.
- Check character count.

FR-LI-05: The user shall be able to upload an image in JPEG, PNG or WebP format.

FR-LI-06: The application shall validate file size and dimensions, generate a preview, and store the original and processed versions in Blob Storage.

FR-LI-07: The default MVP publishing workflow shall be assisted publishing:
- Display the final post in a clean LinkedIn preview.
- Copy final post text to the clipboard.
- Download the final image.
- Open LinkedIn in a new browser tab.
- Record that the post was prepared and optionally allow the user to mark it as manually published.
- Allow the user to paste the published LinkedIn URL for history and reporting.

FR-LI-08: Direct LinkedIn publishing is optional and shall not be required for MVP acceptance.

FR-LI-09: If direct publishing is later enabled:
- It shall use a client-controlled LinkedIn Developer application.
- The posting employee shall connect through LinkedIn OAuth.
- The system shall never request or store a LinkedIn password.
- OAuth tokens shall be encrypted, scoped minimally and revocable.
- Image upload shall occur before post creation.
- The platform shall store the final text, image reference, authorised member, LinkedIn post identifier, publish time and result.

FR-LI-10: Failure or absence of LinkedIn API access shall never block post generation, review, image preparation or manual publishing.

## 14. Search and Cost-Control Requirements

FR-SC-01: Native feeds and cached content shall be used before paid search.

FR-SC-02: Tavily basic/fast search shall be used for routine searches; advanced or research modes shall require explicit configuration.

FR-SC-03: Search results shall be cached for 6–12 hours by normalised query, date window and region.

FR-SC-04: Retrieved article content and structured summaries shall be cached indefinitely unless deletion is required.

FR-SC-05: The system shall store an article once and reuse it across newsletters and LinkedIn posts.

FR-SC-06: The system shall retrieve full content for only the highest-ranked candidates.

FR-SC-07: A cost-control dashboard shall show monthly:
- RSS articles ingested.
- GDELT requests.
- Brave requests.
- Tavily credits.
- Extracted pages.
- LLM input/output tokens.
- Emails sent.
- Estimated provider cost.

FR-SC-08: Hard monthly limits shall be configurable for paid search and LLM usage.

FR-SC-09: When a hard limit is reached, the system shall continue using feeds and cached content and notify an administrator.

## 15. Proposed Technical Architecture

Local and Azure-compatible application stack:

Frontend
- React with TypeScript and Vite.
- Responsive business UI.
- Azure Static Web Apps for production hosting.
- Entra ID authentication in Azure.
- Development authentication adapter for local use.

Backend API
- TypeScript with Node.js.
- Azure Functions v4 programming model.
- REST endpoints with OpenAPI documentation.
- Input validation using Zod or an equivalent schema library.

Workflow
- Existing Azure Logic Apps retained and refactored into generic workflows.
- Logic Apps called through authenticated HTTP triggers or Azure-native integration.
- Local workflow emulator/service to allow development without Azure.
- Preview runs and scheduled runs shall use the same core orchestration and provider adapters.

Storage
- Azure Table Storage for MVP business records.
- Azure Blob Storage for article snapshots where permitted, newsletter HTML, previews and images.
- Azurite for local development.
- Repository interfaces so Azure SQL can replace Table Storage later if needed.

AI model inference
- Microsoft Foundry Models deployed through a pay-as-you-go serverless API deployment where supported.
- Consume the selected model through the Azure AI Model Inference API or the deployment’s supported inference endpoint.
- No dedicated GPU/managed-compute deployment for the MVP.
- No provisioned throughput for the MVP.
- Model choice stored as configuration so it can be changed without rewriting business logic.
- Provider abstraction for local mocks and optional alternative models.
- Structured JSON schema responses.
- Prompt templates versioned in the repository.

Email
- Preferred MVP: existing Microsoft 365/Exchange Online mailbox or shared mailbox through the Logic Apps Office 365 Outlook connector.
- Optional: SMTP connector using the client’s existing mail provider.
- Future scale-up: Azure Communication Services Email.
- Email provider interface to support migration without application changes.

Search
- RSS/Atom ingestion.
- Optional GDELT provider.
- Brave Search provider.
- Tavily provider and selected-page extraction.
- Provider routing policy stored in configuration.

Observability
- Structured application logs.
- Application Insights in Azure.
- Correlation IDs across UI, Functions and Logic Apps.

## 16. Logical Component Model

1. Web Application
2. Authentication and Role Service
3. Newsletter Configuration Service
4. Recipient Group Service
5. Source Registry
6. Search Planner
7. Feed Ingestion Service
8. Search Provider Router
9. Article Retrieval and Normalisation Service
10. Deduplication and Ranking Service
11. LLM Content Service
12. Newsletter Template Renderer
13. Approval Service
14. Email Delivery Service
15. LinkedIn Draft Service
16. Image Asset Service
17. LinkedIn OAuth and Publishing Service
18. Usage and Cost Meter
19. Audit Service
20. Workflow Adapter for Logic Apps

## 17. Core Data Model

NewsletterDefinition
- id, name, description, status, topics, regions, languages
- includeRules, excludeRules, sourcePolicy
- preferredDomains, blockedDomains
- lookbackHours, maximumStories, schedule, timeZone
- templateId, recipientGroupId, approvalPolicy
- version, createdBy, createdAt, updatedAt

RecipientGroup
- id, name, description, status

Recipient
- id, email, displayName, status, attributes
- consentStatus, createdAt, updatedAt

RecipientGroupMember
- groupId, recipientId

SourceDefinition
- id, name, type, URL/feed URL, domain
- country, language, trustLevel, enabled
- termsNotes, lastSuccessfulFetch

SearchRun
- id, newsletterId, editionId, provider
- queries, start/end time, requestCount, creditEstimate
- status and error summary

Article
- id, canonicalUrl, title, publisher, author
- publicationDate, discoveredAt, language
- publisherCountry, storyRegions, topics
- snippet, contentLocation, contentHash
- qualityScore, relevanceScore, duplicateClusterId

NewsletterEdition
- id, newsletterId, editionDate, revision
- status, subject, preheader, introduction
- stories, renderedHtmlLocation, plainTextLocation
- warnings, createdAt, approvedAt, sentAt

LinkedInDraft
- id, sourceType, sourceIds, writingProfileId
- candidateTexts, selectedText, imageAssetId
- status, authorisedMemberId, postUrn
- approvedAt, publishedAt

ApprovalRecord
- id, objectType, objectId, action
- userId, comments, timestamp, objectVersion

UsageRecord
- provider, operation, quantity, unit
- estimatedCost, objectType, objectId, timestamp

AuditEvent
- id, actor, action, objectType, objectId
- correlationId, timestamp, metadata

## 18. Required API Endpoints

Authentication and profile
- GET /api/me

Newsletters
- GET /api/newsletters
- POST /api/newsletters
- GET /api/newsletters/{id}
- PUT /api/newsletters/{id}
- POST /api/newsletters/{id}/pause
- POST /api/newsletters/{id}/resume
- POST /api/newsletters/preview — test an unsaved newsletter definition with live content
- POST /api/newsletters/preview/{previewId}/rerun
- POST /api/newsletters/{id}/generate
- POST /api/newsletters/{id}/test-draft
- POST /api/newsletters/{id}/activate-version
- GET /api/newsletters/{id}/editions

Editions
- GET /api/editions/{id}
- PUT /api/editions/{id}
- POST /api/editions/{id}/regenerate-section
- POST /api/editions/{id}/send-test
- POST /api/editions/{id}/submit-review
- POST /api/editions/{id}/approve
- POST /api/editions/{id}/reject
- POST /api/editions/{id}/send

Recipients
- CRUD /api/recipient-groups
- CRUD /api/recipients
- POST /api/recipient-groups/{id}/import

Sources
- CRUD /api/sources
- POST /api/sources/test
- GET /api/sources/{id}/status

LinkedIn
- POST /api/linkedin/drafts
- GET /api/linkedin/drafts/{id}
- PUT /api/linkedin/drafts/{id}
- POST /api/linkedin/drafts/{id}/generate-options
- POST /api/linkedin/drafts/{id}/upload-image
- POST /api/linkedin/drafts/{id}/approve
- POST /api/linkedin/drafts/{id}/mark-manually-published
- Optional: POST /api/linkedin/connect
- Optional: GET /api/linkedin/oauth/callback
- Optional: POST /api/linkedin/drafts/{id}/publish
- Optional: POST /api/linkedin/disconnect

Operations
- GET /api/usage
- GET /api/audit
- GET /api/health
- GET /api/readiness

## 19. Prompt and AI Requirements

All prompts shall be stored as versioned files and shall not be embedded in UI code.

Required prompt categories:
- Newsletter description to structured definition.
- Structured definition to bounded search plan.
- Article classification and relevance.
- Article summary and key-fact extraction.
- Newsletter edition generation.
- Newsletter subject-line alternatives.
- LinkedIn candidate generation.
- LinkedIn rewrite by length or style.
- Safety and factual validation.

Production inference shall use a selected Microsoft Foundry model deployed as a pay-as-you-go serverless API where available. The application must not assume a specific model family.

Every production model request shall:
- Specify a JSON schema where structured output is expected.
- Include only the minimum required content.
- Include article source identifiers.
- Use a configured model, endpoint and generation settings.
- Record deployment/model name, prompt version and token usage.
- Reject invalid schema responses.
- Retry schema failures a bounded number of times.
- Prevent external page content from overriding system instructions.
- Support per-operation model selection so inexpensive models can perform classification and stronger models can be reserved for final writing.
- Enforce configurable input-size and cost limits.

The MVP shall not use:
- Dedicated managed GPU compute.
- Provisioned throughput units.
- Fine-tuning.
unless real usage later demonstrates a clear business need.

## 20. Security Requirements

SEC-01: Production authentication shall use Microsoft Entra ID.

SEC-02: Role checks shall be enforced in the API, not only in the UI.

SEC-03: API keys, email credentials and LinkedIn tokens shall be stored in Azure Key Vault.

SEC-04: Managed identities shall be used for Azure service access wherever supported.

SEC-05: Local secrets shall use an ignored .env.local file or developer secret store.

SEC-06: Search-page content shall be treated as untrusted input and protected against prompt injection.

SEC-07: Uploaded images shall be validated by MIME type, extension, file signature and size.

SEC-08: HTML shall be generated from controlled templates and sanitised content.

SEC-09: Logs shall not include full recipient lists, access tokens or article bodies.

SEC-10: LinkedIn OAuth tokens shall be encrypted, scoped minimally and revocable.

SEC-11: Approval and publish endpoints shall be protected against replay and duplicate submission.

SEC-12: All outbound HTTP calls shall use timeouts, bounded retries and domain controls.

SEC-13: Dependency and secret scanning shall run in CI.

SEC-14: The application shall maintain an immutable audit trail for send, approve and publish operations.

## 21. Non-Functional Requirements

Usability
- A non-technical user shall be able to create a newsletter without training beyond a short walkthrough.
- Primary actions shall use plain-language labels.
- The system shall provide clear progress, success and failure messages.

Performance
- Dashboard loads should normally complete within 3 seconds.
- CRUD API calls should normally complete within 2 seconds.
- Long-running generation shall be asynchronous and display status.
- Preview rendering should normally complete within 10 seconds after content is available.

Reliability
- Idempotency shall prevent duplicate sends and duplicate LinkedIn posts.
- A failed recipient shall not fail all other recipients.
- Workflow state shall survive application restarts.
- Search and LLM failures shall produce actionable diagnostics.

Accessibility
- Target WCAG 2.1 AA for key workflows.
- Keyboard navigation and visible focus states.
- Meaningful labels and validation messages.

Maintainability
- Strict TypeScript.
- Modular provider interfaces.
- Automated unit, integration and end-to-end tests.
- Infrastructure and configuration stored in Git.

## 22. Local Development Requirements

The repository shall support Windows, macOS and Linux development.

Required tools:
- Node.js LTS.
- npm or pnpm, selected once and documented.
- Azure Functions Core Tools.
- Azurite.
- Docker Desktop only for optional supporting services.
- Git.
- Claude Code.

Local startup shall require no Azure subscription for the normal UI and core workflow.

Provide:
- .env.example with every variable documented.
- npm run dev to launch frontend and backend.
- npm run test, lint, typecheck and build.
- npm run seed to create sample newsletters, users and articles.
- Mock search, LLM, email, Logic App and LinkedIn providers.
- Recorded fixtures for deterministic tests.
- Local file or Azurite-backed Blob/Table adapters.
- Development authentication with selectable test roles.
- A safe email sink such as Mailpit or a file-based provider.
- A fake LinkedIn publish result for end-to-end testing.

No real email, search or LinkedIn call shall occur in local development unless explicitly enabled.

## 23. Suggested Repository Structure

/apps
  /web
  /api
/packages
  /domain
  /storage
  /search-providers
  /llm
  /email
  /linkedin
  /workflow
  /templates
  /observability
/infrastructure
  /bicep
  /parameters
/logic-apps
  /content-generation
  /newsletter-send
/prompts
  /newsletter
  /linkedin
/templates
  /email
/tests
  /unit
  /integration
  /e2e
/docs
  architecture.md
  api.md
  operations.md
  deployment.md
  security.md
.env.example
README.md

## 24. Azure Deployment Requirements

Production Azure resources:
- Resource group.
- Azure Static Web App.
- Azure Function App on Flex Consumption or an approved low-cost plan.
- Storage account with Blob and Table services.
- Application Insights and Log Analytics.
- Key Vault.
- Existing or refactored Logic App.
- Microsoft Foundry project/resource and selected pay-as-you-go serverless model deployment.
- Office 365 Outlook API connection for the sending mailbox, where Microsoft 365 is used.
- Optional Azure Communication Services resource plus Email Communication Service only if later required.
- Optional custom email-domain configuration only if Azure Communication Services Email is adopted.
- Optional DNS zone if DNS is hosted in Azure.

Infrastructure shall be defined using Bicep for Azure-owned resources. Microsoft 365 mailbox, Send As permissions and Logic App API connections may require documented administrative steps because they are tenant resources rather than ordinary ARM-only deployment concerns.

Environments:
- local
- dev
- production

Deployment pipeline:
1. Install dependencies.
2. Lint and type-check.
3. Run unit and integration tests.
4. Build.
5. Run dependency and secret scans.
6. Deploy infrastructure changes.
7. Deploy Functions and Static Web App.
8. Deploy Logic App definitions.
9. Create or validate environment-specific API connections.
10. Run smoke tests.

Production shall not be deployed directly from a developer workstation.

## 25. Email Domain Setup

## Recommended MVP approach: Microsoft 365 mailbox

The first question should not be “Can the client configure Azure Communication Services?” It should be:

**Does contact@clientdomain.com already exist in Microsoft 365 or another hosted email system, and can someone send from it today?**

If the answer is yes, use that existing mail environment.

Preferred Microsoft 365 configuration:
- Create or reuse `contact@clientdomain.com` as a shared mailbox.
- Give one licensed Microsoft 365 user or controlled service account access to the mailbox.
- Grant that identity **Send As** permission.
- Create the Logic Apps Office 365 Outlook connection using that licensed identity.
- Use the connector’s shared-mailbox/send-from capability.
- Send one newsletter message per recipient.
- Set Reply-To to the same shared mailbox or another monitored address.

A shared mailbox normally does not require its own separate licence while it remains within Microsoft’s unlicensed shared-mailbox limits. However, the user who accesses it and authorises the Logic Apps connection must have an appropriate licensed Exchange Online mailbox.

This route avoids asking the client to:
- Create Azure Communication Services Email resources.
- Verify a custom email domain in Azure.
- Add ACS-specific SPF and DKIM records.
- Understand Azure email sender identities.

## Information to request from the client

Ask only these concrete questions:
1. Can you sign in to Microsoft 365 Admin Center?
2. Does `contact@clientdomain.com` already receive email?
3. Who currently reads replies sent to that address?
4. Which licensed Microsoft 365 user can authorise the Logic App connection?
5. Can a Microsoft 365 administrator grant that user **Send As** access?
6. Approximately how many emails will be sent per day?

Do not ask the client to explain DNS, Exchange architecture or connector internals.

## Guided setup responsibility

Because the client has limited technical capability:
- The development team shall provide a one-page setup checklist with screenshots.
- The client’s technical contact should screen-share while an authorised Microsoft 365 administrator performs the steps.
- The application shall include a **Test sender connection** operation.
- The setup shall not be considered complete until a test newsletter is sent to internal addresses and replies are confirmed.

## Alternatives

If Microsoft 365 is not available:

Option A — Existing SMTP provider
- Use the Logic Apps SMTP connector.
- Request SMTP host, port, TLS setting, username, password/app password and sender restrictions.
- Store secrets in Key Vault.
- Prefer port 587 with TLS rather than port 25.

Option B — Transactional email provider
- Use a provider such as SendGrid, Postmark, Mailgun or Amazon SES only after comparing regional availability, pricing, domain verification and procurement constraints.
- This still normally requires DNS verification for professional custom-domain sending.

Option C — Azure Communication Services Email
- Retain as a future option when volume, deliverability requirements or application-only authentication justify it.
- Azure provides a managed domain for early development, but production mail from `contact@clientdomain.com` still requires custom-domain verification and sender authentication.

The email provider shall remain behind an application interface so the sending method can change later without altering newsletter functionality.

## 26. LinkedIn Account Setup

Direct LinkedIn API publishing is optional.

## MVP setup

No LinkedIn Developer application is required for the default MVP.

The user will:
1. Review and approve the generated post.
2. Copy the final post text.
3. Download or copy the prepared image.
4. Open LinkedIn.
5. Paste and publish through their normal employee account.
6. Optionally paste the final LinkedIn URL back into the application.

This approach:
- Avoids developer-application approval.
- Avoids OAuth token management.
- Keeps the employee fully in control.
- Prevents the LinkedIn integration from delaying launch.

## Optional later enhancement

Only if direct publishing becomes valuable:
1. Create a LinkedIn Developer application under an appropriate client-controlled owner.
2. Configure authorised redirect URLs.
3. Enable/request the required sharing product and permission.
4. Implement OAuth securely.
5. Upload images through the supported LinkedIn media API.
6. Create the post through the supported LinkedIn posting API.
7. Store token expiry and provide disconnect/reconnect controls.

The employee’s password shall never be requested, stored or automated.

## 27. Error Handling and Operational Scenarios

The application shall handle:
- No qualifying stories: create a “no edition” recommendation rather than inventing content.
- Too few stories: show warnings and allow wider search.
- Search-provider limit reached: continue with feeds/cache and notify administrator.
- Source blocked or unavailable: mark failure and continue.
- LLM schema failure: bounded retry, then show actionable error.
- Email partial failure: retry only failed recipients.
- Duplicate send request: idempotently return existing operation.
- Optional LinkedIn token expired: request reconnect and retain the approved draft.
- Optional LinkedIn API publish failure: preserve the draft and fall back to assisted publishing.
- Image rejected: show reason and allow replacement.
- Logic App unavailable: queue or retry safely without duplicate operations.
- Live preview produces no qualifying stories: explain which rules removed results and offer controlled widening of the query.
- Live preview is costly: show the estimated usage and require confirmation before repeating unusually expensive searches.

## 28. Testing Requirements

Unit tests
- Search-plan parsing.
- Rule evaluation.
- URL canonicalisation.
- Deduplication.
- Ranking.
- LLM schema validation.
- Template rendering.
- Role enforcement.
- Cost calculations.
- Idempotency.

Integration tests
- Storage adapters with Azurite.
- Mock provider contracts.
- Logic App callback contract.
- Email delivery workflow.
- Optional LinkedIn OAuth callback and publish flow.

End-to-end tests
- Create newsletter from description.
- Generate edition from fixture articles.
- Edit and approve edition.
- Send to test recipients.
- Create LinkedIn post from a story.
- Upload image.
- Approve, copy and mark manually published through mock workflow.

Security tests
- Unauthorised role access.
- Prompt-injection content.
- Malicious HTML.
- Invalid and oversized image uploads.
- OAuth state mismatch.
- Duplicate approval/publish calls.

## 29. MVP Acceptance Criteria

The MVP is accepted when:

1. An authorised non-technical user can create a newsletter through a plain-language wizard.
2. The system converts the request into editable topics, regions and source rules.
3. Before saving, the user can execute a live test against current content.
4. The live test shows a complete sample newsletter, evidence, warnings and estimated usage.
5. The user can modify the description or structured fields, rerun the test and save only when satisfied.
6. A scheduled or manual run retrieves articles using feeds plus a configurable search fallback.
7. Search, articles and model outputs are cached and metered.
8. The system generates a source-backed draft using a controlled email template.
9. A reviewer can edit, reorder, regenerate, approve and send the edition.
10. Recipients do not see one another’s addresses.
11. Email can be sent from or on behalf of a client-controlled address such as `contact@clientdomain.com`.
12. A user can create a LinkedIn draft from a newsletter story.
13. The user can edit the post, add an image, preview it, copy the text and open LinkedIn.
14. Direct LinkedIn API publishing is not required for acceptance.
15. Every approval and send action is auditable; manually published LinkedIn URLs can be recorded.
16. The solution runs locally with mocks and deploys to Azure through Bicep and CI/CD.

## 30. Phased Development Plan for Claude Code

Phase 0 — Repository and engineering baseline
- Monorepo, TypeScript, linting, tests, CI and documentation.
- Domain interfaces and mock providers.
- Local authentication and Azurite.

Phase 1 — Newsletter designer and live preview
- Dashboard.
- Newsletter wizard.
- Structured-definition generation through mock/real Foundry model.
- Unsaved live-search preview.
- Iterative modify → rerun → compare workflow.
- Save and version only after user acceptance.
- Recipient groups and CSV import.
- Source registry.

Phase 2 — Discovery and article pipeline
- RSS ingestion.
- Provider router.
- Brave/Tavily adapters.
- Cache, extraction, normalisation, deduplication and ranking.
- Usage metering.

Phase 3 — Newsletter generation and review
- Article summaries.
- Edition generation.
- HTML templates.
- Preview, editing, revisions and approval.
- Test send.

Phase 4 — Email production integration
- Preferred: Microsoft 365 shared mailbox through the Logic Apps Office 365 Outlook connector.
- Send As configuration.
- Per-recipient delivery, retries and history.
- SMTP or Azure Communication Services adapter retained as alternatives.

Phase 5 — LinkedIn Studio
- Post generation.
- Writing profiles.
- Image upload and preview.
- Approval.
- Copy text, download image and open LinkedIn.
- Manual publication URL/history.

Phase 6 — Optional direct LinkedIn publishing
- Implement only when requested.
- LinkedIn developer application.
- OAuth.
- Image API.
- Posts API.
- Token lifecycle and fallback.

Phase 7 — Azure production deployment
- Bicep.
- Entra ID.
- Key Vault and managed identity.
- Microsoft Foundry pay-as-you-go model deployment.
- Application Insights.
- Logic App integration.
- Production smoke tests and runbook.

## 31. API Access and Payment Summary

Required or recommended external/service access:

1. Azure subscription
Required for production hosting, workflows, storage, monitoring and model inference.
Paid components may include Static Web Apps, Functions, Logic Apps, Storage, Application Insights, Key Vault and model usage. At this scale, most are low-consumption services, but costs depend on region and plan.

2. Microsoft Foundry Models
Recommended production approach: deploy a suitable model as a pay-as-you-go serverless API where that deployment type is offered.
- Billing is normally based on model usage, commonly input/output tokens, according to the selected model’s pricing terms.
- Do not use dedicated managed compute for the MVP because it can introduce GPU-hour charges even when traffic is low.
- Do not use provisioned throughput for the MVP because it is capacity-based rather than purely low-volume consumption-based.
- Model availability, offer terms and regions vary by provider and Azure billing geography.
- Azure AI Content Safety may create separate charges when enabled or required.

Access needed:
- Azure subscription eligible for the selected model offer.
- Microsoft Foundry project/resource.
- Permission to create the model deployment.
- Endpoint and authentication details.
- Azure Marketplace acceptance for partner/community models where required.

3. Search provider
Recommended MVP: RSS/cache first and Tavily as a bounded fallback.
- Tavily offers a free credit allowance and paid usage thereafter according to its current plan.
Optional:
- Brave Search API for URL/snippet discovery.
- GDELT public discovery.
Implement provider abstraction and hard monthly limits.

4. Microsoft 365 / Exchange Online email
Preferred email path when `contact@clientdomain.com` already belongs to the client’s Microsoft 365 environment.
Access needed:
- Microsoft 365 administrator for initial setup.
- Shared mailbox or existing mailbox.
- A licensed Exchange Online user/service identity to authorise the Logic Apps connector.
- Send As permission for `contact@clientdomain.com`.
- Logic Apps Office 365 Outlook API connection.

Payment:
- Usually no new application-email provider charge beyond Logic Apps executions.
- A shared mailbox normally does not require a separate licence within Microsoft’s unlicensed shared-mailbox limits.
- The delegate/connection user must already have an appropriate Exchange Online licence.
- Existing Microsoft 365 subscription costs continue to apply.

5. SMTP or transactional email provider
Optional fallback when Microsoft 365 is unavailable or unsuitable.
Payment depends on the provider and message volume.
Professional sending from `clientdomain.com` will normally still require domain verification and DNS cooperation.

6. Azure Communication Services Email
Optional future service rather than an MVP prerequisite.
Payment is based on email operations/data according to Azure pricing.
Custom-domain production sending requires domain verification plus SPF/DKIM configuration.
An Azure-managed email domain may be used for development, but it will not provide the desired `contact@clientdomain.com` identity.

7. LinkedIn
No LinkedIn Developer API access is required for the default MVP.
The user copies the generated content and image into LinkedIn manually.

Optional future direct publishing:
- Client-controlled LinkedIn Developer application.
- OAuth authorisation by the employee.
- Required sharing and media-upload permissions.
No per-post fee is normally expected, but LinkedIn platform access and restrictions apply.

8. Domain and DNS
No new DNS work is expected when the existing Microsoft 365 mailbox is used and the domain is already correctly configured.
DNS access becomes necessary if adopting a new transactional email provider or Azure Communication Services custom-domain sending.

9. Optional image source or generation API
Not required for MVP because users can upload images.
A later stock-image or image-generation integration will add API charges and licensing obligations.

10. Development tools
Claude Code may require an Anthropic plan or API usage depending on licensing.
GitHub or Azure DevOps may have organisation/user licensing costs depending on existing plans.

## 32. Implementation Decisions Requiring Client Confirmation

Before production deployment, confirm:
- Does `contact@clientdomain.com` already exist?
- Is it hosted in Microsoft 365/Exchange Online?
- Who reads replies sent to it?
- Which licensed user can authorise the Logic Apps Office 365 Outlook connection?
- Who can grant **Send As** permission?
- Approximate number of recipients and daily messages.
- Azure region and subscription/resource naming standards.
- Which Microsoft Foundry models are available and commercially acceptable in the client’s subscription.
- Approved websites, blocked websites and initial topics/regions.
- Newsletter templates and branding assets.
- Initial recipient groups and consent/unsubscribe policy.
- Which employee will manually post approved LinkedIn content.
- Retention period for articles, recipient records and audit history.

The following are optional and should not block MVP:
- LinkedIn Developer application ownership.
- Direct LinkedIn API publishing.
- Azure Communication Services Email.
- New transactional-email provider.

## 33. Reference Sources

Microsoft:
- Microsoft Foundry Models overview:
  https://learn.microsoft.com/azure/foundry/concepts/foundry-models-overview
- Foundry serverless API deployments:
  https://learn.microsoft.com/azure/foundry-classic/how-to/deploy-models-serverless
- Foundry deployment types:
  https://learn.microsoft.com/azure/ai-foundry/foundry-models/concepts/deployment-types
- Foundry cost management:
  https://learn.microsoft.com/azure/foundry/concepts/manage-costs
- Logic Apps Office 365 Outlook connector:
  https://learn.microsoft.com/azure/connectors/connectors-create-api-office365-outlook
- Office 365 Outlook connector reference:
  https://learn.microsoft.com/connectors/office365/
- Microsoft 365 shared mailboxes:
  https://learn.microsoft.com/microsoft-365/admin/email/about-shared-mailboxes
- Logic Apps SMTP connector:
  https://learn.microsoft.com/azure/connectors/connectors-create-api-smtp
- Azure Communication Services email domains:
  https://learn.microsoft.com/azure/communication-services/concepts/email/email-domain-and-sender-authentication
- Azure Communication Services managed domains:
  https://learn.microsoft.com/azure/communication-services/quickstarts/email/add-azure-managed-domains
- Azure Communication Services pricing:
  https://azure.microsoft.com/pricing/details/communication-services/
- Azure Functions pricing:
  https://azure.microsoft.com/pricing/details/functions/
- Azure Logic Apps pricing:
  https://azure.microsoft.com/pricing/details/logic-apps/
- Optional LinkedIn Share on LinkedIn:
  https://learn.microsoft.com/linkedin/consumer/integrations/self-serve/share-on-linkedin
- Optional LinkedIn Images API:
  https://learn.microsoft.com/linkedin/marketing/community-management/shares/images-api
- Optional LinkedIn Posts API:
  https://learn.microsoft.com/linkedin/marketing/community-management/shares/posts-api

Search providers:
- Tavily credits:
  https://docs.tavily.com/documentation/api-credits
- Tavily Search API:
  https://docs.tavily.com/documentation/api-reference/endpoint/search
- Brave Search API pricing:
  https://api-dashboard.search.brave.com/documentation/pricing
