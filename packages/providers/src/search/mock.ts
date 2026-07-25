import type { Article } from '@cawt/domain';
import { hoursSince } from '@cawt/domain';
import type { SearchProvider, SearchRequest, SearchResult } from '../types.js';
import { loadCorpus, type CorpusArticle } from './corpus.js';

/** Words too common to carry signal when matching a query to an article. */
const STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'of', 'in', 'on', 'for', 'to', 'with', 'at', 'by', 'from',
  'news', 'latest', 'update', 'updates', 'about', 'that', 'this', 'is', 'are', 'was', 'were',
]);

function terms(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 2 && !STOP_WORDS.has(word));
}

/** Term-overlap score across title, snippet, topics and regions. */
function scoreAgainstQueries(article: CorpusArticle, queries: string[]): number {
  const haystack = new Set(
    terms([article.title, article.snippet, article.topics.join(' '), article.regions.join(' ')].join(' ')),
  );
  if (haystack.size === 0) return 0;

  let best = 0;
  for (const query of queries) {
    const needles = terms(query);
    if (needles.length === 0) continue;
    const hits = needles.filter((needle) => haystack.has(needle)).length;
    best = Math.max(best, hits / needles.length);
  }
  return best;
}

/**
 * Replays a recorded article corpus instead of calling a paid search API.
 *
 * Same interface as the real providers, so nothing upstream can tell the
 * difference. Development costs nothing, tests are deterministic, and there is
 * no way to accidentally spend search credits from a unit test.
 */
export class MockSearchProvider implements SearchProvider {
  readonly name = 'mock';

  constructor(private readonly clock: () => Date = () => new Date()) {}

  async search(request: SearchRequest): Promise<SearchResult> {
    const now = this.clock();
    const corpus = loadCorpus(now);
    const blocked = new Set((request.blockedDomains ?? []).map((domain) => domain.toLowerCase()));

    const scored = corpus
      .filter((article) => !blocked.has(article.publisher.toLowerCase()))
      .filter((article) => hoursSince(article.publishedAt, now) <= request.maxAgeHours)
      .filter((article) => {
        if (!request.regions || request.regions.length === 0) return true;
        return request.regions.some((region) =>
          article.regions.some((candidate) => candidate.toLowerCase() === region.toLowerCase()),
        );
      })
      .map((article) => ({ article, score: scoreAgainstQueries(article, request.queries) }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, request.maxResults);

    const articles: Article[] = scored.map((entry) => ({
      ...entry.article,
      relevanceScore: Number(entry.score.toFixed(3)),
    }));

    return {
      articles,
      usage: {
        provider: 'mock',
        operation: 'search',
        inputTokens: 0,
        outputTokens: 0,
        searchQueries: request.queries.length,
        estimatedCostUsd: 0,
      },
    };
  }
}

/** Full text for an article in the fixture corpus. Real providers read Blob. */
export function mockArticleContent(articleId: string, reference = new Date()): string | undefined {
  return loadCorpus(reference).find((article) => article.id === articleId)?.content;
}
