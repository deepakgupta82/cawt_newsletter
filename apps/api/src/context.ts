import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { brandSchema, type Brand } from '@cawt/domain';
import {
  createEmailProvider,
  createLlmProvider,
  createSearchProvider,
  mockArticleContent,
  type EmailProvider,
  type LlmProvider,
  type SearchProvider,
} from '@cawt/providers';
import { createStores, type Stores } from '@cawt/storage';
import type { ContentResolver } from '@cawt/core';

export interface AppContext {
  stores: Stores;
  llm: LlmProvider;
  search: SearchProvider;
  email: EmailProvider;
  resolveContent: ContentResolver;
  config: {
    llm: string;
    search: string;
    email: string;
    storage: string;
    modelBulk: string;
    modelWriter: string;
    monthlyCapUsd: number;
  };
}

export const DEFAULT_BRAND: Brand = brandSchema.parse({
  id: 'default',
  name: 'CAWT',
  headerText: 'CapAlpha WhiteTrust',
  primaryColor: '#111827',
  accentColor: '#B45309',
  backgroundColor: '#FFFFFF',
  fontFamily: "Georgia, 'Times New Roman', serif",
  footerText: 'You are receiving this because you subscribed to updates from CapAlpha WhiteTrust.',
  contactAddress: 'contact@cawt.ai',
  disclaimer: 'Automated digest. Verify facts before relying on them.',
});

/** Loads .env.local into process.env without pulling in a dependency. */
export async function loadEnv(): Promise<void> {
  for (const file of ['.env.local', '.env']) {
    try {
      const content = await readFile(resolve(file), 'utf8');
      for (const line of content.split(/\r?\n/)) {
        const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i.exec(line);
        if (!match || line.trimStart().startsWith('#')) continue;
        const key = match[1]!;
        if (process.env[key] !== undefined) continue;
        process.env[key] = match[2]!.replace(/^["']|["']$/g, '');
      }
    } catch {
      // Absent env files are the normal case: everything defaults to mocks.
    }
  }
}

export async function createContext(): Promise<AppContext> {
  const stores = createStores();
  const llm = createLlmProvider();
  const search = createSearchProvider();
  const email = createEmailProvider();

  // Content lookup differs by provider: the fixture corpus holds full text
  // inline, while real providers stash it in Blob and hand back a reference.
  const resolveContent: ContentResolver = async (article) => {
    if (article.provider === 'mock') return mockArticleContent(article.id);
    if (article.contentRef) return stores.blobs.getText(article.contentRef);
    return article.snippet;
  };

  if (!(await stores.brands.get('default'))) {
    await stores.brands.save(DEFAULT_BRAND);
  }

  return {
    stores,
    llm,
    search,
    email,
    resolveContent,
    config: {
      llm: llm.name,
      search: search.name,
      email: email.name,
      storage: process.env['STORAGE_PROVIDER'] ?? 'file',
      modelBulk: process.env['MODEL_BULK'] ?? 'mock',
      modelWriter: process.env['MODEL_WRITER'] ?? 'mock',
      monthlyCapUsd: Number(process.env['MONTHLY_SPEND_CAP_USD'] ?? 10),
    },
  };
}
