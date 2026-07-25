# CAWT Newsletter Studio

Prompt-driven newsletter authoring, generation and delivery for CapAlpha WhiteTrust.

A user describes a newsletter in plain language, or pastes one they already send. The system works out the
structure, runs it against current news, and shows a real edition for review before anything is saved or sent.

## Running it locally

```bash
npm install
npm run dev
```

- UI: <http://localhost:5173>
- API: <http://localhost:7071>

Nothing else is required. No Azure account, no API keys, no network. Everything defaults to local mocks, so a
fresh clone runs immediately.

Other scripts:

| Command | What it does |
|---|---|
| `npm run dev:api` | API only |
| `npm run dev:web` | UI only |
| `npm run dev:storage` | Azurite emulator, for exercising the Azure storage adapter locally |
| `npm run typecheck` | Typecheck every package and the UI |
| `npx tsx scripts/smoke.ts` | Whole pipeline end to end in the terminal, writes an `.eml` |

## How it fits together

```
packages/
  domain      Block vocabulary and schemas. The centre of the design.
  providers   Search, model and email behind interfaces, each with a mock.
  render      Block tree to Outlook-safe HTML and plain text.
  core        Designer (prompt/sample to blueprint) and generator (blueprint to edition).
  storage     Repositories over the filesystem or Azure Table + Blob.
apps/
  api         Express server. Handlers stay thin so Azure Functions can wrap them later.
  web         React + Vite + Tailwind UI.
```

### The block vocabulary

The load-bearing idea. A model never writes HTML and never invents structure. It composes a tree from seven
fixed block types (`section`, `story_group`, `prose_spec`, `divider`, and at render time `story`, `prose`,
`empty_state`, `group_label`). Structure stays open-ended; rendering stays deterministic, tested and safe for
Outlook.

### Blueprint versus edition

A **blueprint** is the saved template. It is derived once at design time from a prompt or a sample, approved by
a human, then frozen and versioned.

An **edition** is one instance, produced by executing a blueprint against the news that exists today.

Scheduled runs execute a stored blueprint. They never re-derive it. Without that rule the newsletter's shape
drifts day to day, and readers read drift as broken rather than dynamic. Changing structure creates a new
version that can be tested before activation and never alters editions already sent.

### Selection rules, not global knobs

There is no single "lookback period" or "max stories" setting. Every `story_group` carries its own freshness
window, count range and quality floor. That is what makes "fresh in the last 48 hours" and "ongoing matters
over 30 days" expressible in the same section, and what makes 96 hours a value rather than a code change.

Counts are ranges with a minimum of zero. If two stories clear the bar, the edition carries two. The system
never pads to hit a number, because padding is where invented content comes from.

## Not hallucinating

Layered, cheapest first:

1. Every story is generated only from retrieved article text passed into the prompt. No memory, no filler.
2. Structured JSON output against a schema, with bounded retries and no silent patching.
3. **A deterministic fact checker in plain code.** Every figure, percentage, currency amount, year and quoted
   phrase in a draft is checked against the source text it was built from. Anything absent is flagged before a
   human sees the draft as ready. This costs nothing and cannot itself hallucinate.
4. Conflicting figures across sources are surfaced, not resolved. Two sources disagreeing on a recovery total
   is reported as a disagreement.
5. An optional model-based check for softer problems (`modelFactCheck`).
6. Article text and uploaded samples are wrapped as untrusted data. Instructions found inside them are ignored.
7. Every story shows its sources in the review UI, so a reviewer verifies any claim in one click.

## Providers

Selected entirely by environment variable. Copy `.env.example` to `.env.local` to change anything.

| Variable | Default | Options |
|---|---|---|
| `LLM_PROVIDER` | `mock` | `mock`, `azure-openai` |
| `SEARCH_PROVIDER` | `mock` | `mock`, `tavily` |
| `EMAIL_PROVIDER` | `eml` | `eml`, `graph` (not yet wired) |
| `STORAGE_PROVIDER` | `file` | `file`, `azurite`, `azure` |

The mock model is not a canned response. It parses regions, freshness windows, cadence and length hints out of
the prompt and composes a real blueprint, so the designer can be built and demonstrated offline for nothing.

The mock email provider writes RFC 5322 `.eml` files to `.outbox/`. They open directly in Outlook, which is the
client that actually matters. This mock is not optional: without it, a stray test run eventually mails a draft
to the live recipient list.

### Two model tiers

Roughly 90% of tokens flow through scoring and summarising, not writing. `MODEL_BULK` handles that volume
cheaply; `MODEL_WRITER` handles the prose and the fact check. At CAWT's volume (about 1.2M input and 160K output
tokens a month) this keeps model spend in low single digits.

Note that only **eastus** offers consumption (`GlobalStandard`) model deployments in this subscription.
`centralindia` is provisioned-throughput only, which is capacity-priced and unusable at this budget.

## What is not built yet

- Graph / Exchange Online sending. Needs a tenant admin to grant `Mail.Send` to the app identity and scope it
  to `contact@cawt.ai` with an application access policy.
- PDF and DOCX sample upload. Pasting text or HTML works today; HTML is the better input anyway because heading
  levels come through exactly.
- Recipient management, scheduling, and the send pipeline.
- Rich text editing of story fields in the review UI.
