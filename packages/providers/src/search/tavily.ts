import type { Article } from '@cawt/domain';
import { canonicalizeUrl, publisherFromUrl, titleKey } from '@cawt/domain';
import { createHash } from 'node:crypto';
import type { SearchProvider, SearchRequest, SearchResult } from '../types.js';

interface TavilyResult {
  url?: string;
  title?: string;
  content?: string;
  raw_content?: string;
  score?: number;
  published_date?: string;
}

/**
 * Tavily search. Retained behind the provider interface because CAWT's current
 * Logic App already uses it, so an existing key keeps working.
 *
 * Note that this is a paid tier-3 fallback, not the primary discovery path.
 * RSS feeds and cached articles are checked first; this only fills gaps, and
 * every call is metered against the monthly cap.
 */
export class TavilySearchProvider implements SearchProvider {
  readonly name = 'tavily';

  constructor(
    private readonly apiKey: string,
    private readonly costPerQueryUsd = 0.008,
  ) {
    if (!apiKey) throw new Error('TAVILY_API_KEY is required for the tavily provider');
  }

  async search(request: SearchRequest): Promise<SearchResult> {
    const seen = new Map<string, Article>();
    const perQuery = Math.max(3, Math.ceil(request.maxResults / Math.max(1, request.queries.length)));
    let executed = 0;

    for (const query of request.queries) {
      const response = await fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          query,
          search_depth: 'basic',
          topic: 'news',
          max_results: perQuery,
          days: Math.max(1, Math.ceil(request.maxAgeHours / 24)),
          // Fuller article text so summaries and the fact-checker have real
          // source, not a one-line teaser. Still a basic (1-credit) search.
          include_raw_content: true,
          include_domains: request.preferredDomains ?? [],
          exclude_domains: request.blockedDomains ?? [],
        }),
        signal: AbortSignal.timeout(30_000),
      });

      executed += 1;

      if (!response.ok) {
        // A search failure must not fail the whole edition when feeds and
        // cache already supplied usable content.
        continue;
      }

      const payload = (await response.json()) as { results?: TavilyResult[] };
      const now = new Date().toISOString();

      for (const result of payload.results ?? []) {
        if (!result.url || !result.title) continue;
        const url = canonicalizeUrl(result.url);
        if (seen.has(url)) continue;

        seen.set(url, {
          id: `art_${createHash('sha256').update(url).digest('hex').slice(0, 16)}`,
          canonicalUrl: url,
          title: result.title,
          publisher: publisherFromUrl(url),
          publishedAt: result.published_date,
          discoveredAt: now,
          language: 'en',
          regions: request.regions ?? [],
          topics: [],
          // snippet doubles as the content the summariser grounds on for real
          // providers (no separate blob), so keep enough to work with.
          snippet: (result.raw_content || result.content || '').slice(0, 4000),
          contentHash: createHash('sha256').update(titleKey(result.title)).digest('hex').slice(0, 32),
          relevanceScore: result.score,
          provider: this.name,
        });
      }
    }

    return {
      articles: [...seen.values()].slice(0, request.maxResults),
      usage: {
        provider: this.name,
        operation: 'search',
        inputTokens: 0,
        outputTokens: 0,
        searchQueries: executed,
        estimatedCostUsd: executed * this.costPerQueryUsd,
      },
    };
  }
}
