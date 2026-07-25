/**
 * End-to-end smoke test against the mock providers.
 *
 * Crude prompt -> brief -> blueprint -> live edition -> HTML -> .eml on disk.
 * Runs offline, costs nothing, and touches no Azure resource.
 *
 *   npx tsx scripts/smoke.ts
 */
import { design, generateEdition, totalCost } from '@cawt/core';
import { EmlFileEmailProvider, MockLlmProvider, MockSearchProvider, mockArticleContent } from '@cawt/providers';
import { renderEditionHtml, renderEditionText } from '@cawt/render';
import { brandSchema, collectStories, type Brand } from '@cawt/domain';

const PROMPT =
  'daily wealth and succession news for private client advisers, india singapore and us, keep each item short, last 96 hours for fresh stuff';

const brand: Brand = brandSchema.parse({
  id: 'default',
  name: 'CAWT',
  headerText: 'CapAlpha WhiteTrust',
  primaryColor: '#111827',
  accentColor: '#B45309',
  footerText: 'You are receiving this because you subscribed to updates from CAWT.',
  contactAddress: 'contact@cawt.ai',
  disclaimer: 'Automated digest. Verify facts before relying on them.',
});

async function main(): Promise<void> {
  const llm = new MockLlmProvider();
  const search = new MockSearchProvider();

  console.log('Prompt:\n  ' + PROMPT + '\n');

  // ---- Design -------------------------------------------------------------
  const designed = await design(llm, { prompt: PROMPT });
  console.log('Brief:\n  ' + designed.brief.replace(/\. /g, '.\n  ') + '\n');

  console.log('Blueprint:');
  console.log('  title: ' + designed.blueprint.titleTemplate);
  for (const block of designed.blueprint.blocks) {
    if (block.type === 'section') {
      console.log(`  section "${block.heading}"`);
      for (const child of block.children) {
        if (child.type === 'story_group') {
          console.log(
            `    story_group ${child.freshness.windowHours}h  max ${child.count.max}  ~${child.targetWords} words  floor ${child.relevanceFloor}`,
          );
        } else if (child.type === 'prose_spec') {
          console.log(`    prose_spec ${child.purpose}`);
        }
      }
    } else if (block.type === 'prose_spec') {
      console.log(`  prose_spec ${block.purpose} "${block.label ?? ''}"`);
    }
  }

  console.log('\nNeeds you to supply:');
  for (const note of designed.notes) console.log('  - ' + note);

  // ---- Generate -----------------------------------------------------------
  const edition = await generateEdition({
    llm,
    search,
    resolveContent: async (article) => mockArticleContent(article.id),
    blueprint: designed.blueprint,
    newsletterId: 'nl-smoke',
    isPreview: true,
  });

  const stories = collectStories(edition.blocks);
  console.log(`\nEdition: ${edition.title}`);
  console.log(`  ${stories.length} stories selected`);
  for (const block of edition.blocks) {
    if (block.type !== 'section') continue;
    const kinds = block.children.map((child) => child.type);
    const storyCount = kinds.filter((kind) => kind === 'story').length;
    const empties = kinds.filter((kind) => kind === 'empty_state').length;
    console.log(`  ${block.heading}: ${storyCount} stories, ${empties} empty groups`);
  }

  if (edition.warnings.length > 0) {
    console.log('\nEdition warnings:');
    for (const warning of edition.warnings) console.log('  ! ' + warning);
  }

  const flagged = stories.filter((story) => story.warnings.length > 0);
  if (flagged.length > 0) {
    console.log('\nFact-check findings:');
    for (const story of flagged) {
      console.log(`  ${story.headline}`);
      for (const warning of story.warnings) console.log('    ! ' + warning);
    }
  }

  // Confirms the fixture distractors were actually rejected.
  const junk = stories.filter((story) => /hiring|sponsored|token launch/i.test(story.headline));
  console.log(`\nPromotional/recruitment items that leaked through: ${junk.length} (want 0)`);

  // ---- Render and deliver -------------------------------------------------
  const html = renderEditionHtml(edition, { brand });
  const text = renderEditionText(edition, { brand });

  const email = new EmlFileEmailProvider('.outbox');
  const sent = await email.send({
    to: 'reviewer@cawt.ai',
    toName: 'Reviewer',
    fromAddress: 'contact@cawt.ai',
    fromName: 'CAWT',
    replyTo: 'contact@cawt.ai',
    subject: edition.subject,
    html,
    text,
    headers: { 'List-Unsubscribe': '<mailto:contact@cawt.ai?subject=unsubscribe>' },
  });

  console.log(`\nHTML: ${html.length} bytes`);
  console.log(`Wrote ${sent.location}`);
  console.log(`Estimated provider cost for this run: $${totalCost(edition.usage).toFixed(4)}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
