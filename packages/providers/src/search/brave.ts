import type { Article } from '@cawt/domain';
import { canonicalizeUrl, publisherFromUrl, titleKey } from '@cawt/domain';
import { createHash } from 'node:crypto';
import type { SearchProvider, SearchRequest, SearchResult } from '../types.js';

interface BraveNewsResult {
  url?: string;
  title?: string;
  description?: string;
  page_age?: string;
  meta_url?: { hostname?: string };
}

/**
 * Brave News Search. A cheaper alternative to Tavily: the free tier allows
 * ~2,000 queries a month, which comfortably covers several daily newsletters.
 *
 * Brave returns a description rather than full article text, so summaries here
 * are grounded on a shorter source than Tavily's raw content. The deterministic
 * fact-checker still runs against whatever text comes back.
 */
export class BraveSearchProvider implements SearchProvider {
  readonly name = 'brave';

  constructor(
    private readonly apiKey: string,
    private readonly costPerQueryUsd = 0,
  ) {
    if (!apiKey) throw new Error('BRAVE_API_KEY is required for the brave provider');
  }

  private freshness(maxAgeHours: number): string {
    if (maxAgeHours <= 24) return 'pd';
    if (maxAgeHours <= 168) return 'pw';
    if (maxAgeHours <= 744) return 'pm';
    return 'py';
  }

  async search(request: SearchRequest): Promise<SearchResult> {
    const seen = new Map<string, Article>();
    const perQuery = Math.max(3, Math.ceil(request.maxResults / Math.max(1, request.queries.length)));
    const blocked = new Set((request.blockedDomains ?? []).map((domain) => domain.toLowerCase()));
    let executed = 0;

    for (const query of request.queries) {
      const url = new URL('https://api.search.brave.com/res/v1/news/search');
      url.searchParams.set('q', query);
      url.searchParams.set('count', String(Math.min(perQuery, 20)));
      url.searchParams.set('freshness', this.freshness(request.maxAgeHours));
      url.searchParams.set('spellcheck', '0');

      const response = await fetch(url, {
        headers: { accept: 'application/json', 'x-subscription-token': this.apiKey },
        signal: AbortSignal.timeout(30_000),
      });

      executed += 1;
      if (!response.ok) continue; // a single failed query must not sink the edition

      const payload = (await response.json()) as { results?: BraveNewsResult[] };
      const now = new Date().toISOString();

      for (const result of payload.results ?? []) {
        if (!result.url || !result.title) continue;
        const canonical = canonicalizeUrl(result.url);
        if (seen.has(canonical)) continue;
        const hostname = (result.meta_url?.hostname ?? publisherFromUrl(canonical)).toLowerCase();
        if ([...blocked].some((domain) => hostname.includes(domain))) continue;

        seen.set(canonical, {
          id: `art_${createHash('sha256').update(canonical).digest('hex').slice(0, 16)}`,
          canonicalUrl: canonical,
          title: result.title,
          publisher: publisherFromUrl(canonical),
          ...(result.page_age ? { publishedAt: result.page_age } : {}),
          discoveredAt: now,
          language: 'en',
          regions: request.regions ?? [],
          topics: [],
          snippet: (result.description ?? '').slice(0, 2000),
          contentHash: createHash('sha256').update(titleKey(result.title)).digest('hex').slice(0, 32),
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
