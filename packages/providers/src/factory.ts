import type { EmailProvider, LlmProvider, ModelTier, SearchProvider } from './types.js';
import { MockLlmProvider } from './llm/mock.js';
import { AzureOpenAiProvider } from './llm/azure-openai.js';
import { MockSearchProvider } from './search/mock.js';
import { TavilySearchProvider } from './search/tavily.js';
import { BraveSearchProvider } from './search/brave.js';
import { EmlFileEmailProvider } from './email/eml.js';
import { GraphEmailProvider } from './email/graph.js';

/**
 * Provider selection, driven entirely by environment variables.
 *
 * Everything defaults to a local mock, so `npm run dev` works on a fresh clone
 * with no keys, no Azure account and no network. Flipping one variable swaps in
 * the real service without touching application code.
 */

export interface ProviderConfig {
  search: string;
  llm: string;
  email: string;
}

export function resolveProviderConfig(env: NodeJS.ProcessEnv = process.env): ProviderConfig {
  return {
    search: env['SEARCH_PROVIDER'] ?? 'mock',
    llm: env['LLM_PROVIDER'] ?? 'mock',
    email: env['EMAIL_PROVIDER'] ?? 'eml',
  };
}

export function createLlmProvider(env: NodeJS.ProcessEnv = process.env): LlmProvider {
  const kind = env['LLM_PROVIDER'] ?? 'mock';

  switch (kind) {
    case 'mock':
      return new MockLlmProvider();

    case 'azure-openai': {
      const deployments: Record<ModelTier, string> = {
        bulk: env['MODEL_BULK'] ?? 'gpt-5-mini',
        writer: env['MODEL_WRITER'] ?? 'gpt-5.1',
      };
      return new AzureOpenAiProvider({
        endpoint: env['AZURE_AI_ENDPOINT'] ?? '',
        apiVersion: env['AZURE_AI_API_VERSION'] ?? '2025-04-01-preview',
        deployments,
        apiKey: env['AZURE_AI_API_KEY'] || undefined,
        ...(env['AZURE_REASONING_EFFORT'] ? { reasoningEffort: env['AZURE_REASONING_EFFORT'] } : {}),
      });
    }

    default:
      throw new Error(`Unknown LLM_PROVIDER "${kind}". Expected one of: mock, azure-openai.`);
  }
}

export function createSearchProvider(env: NodeJS.ProcessEnv = process.env): SearchProvider {
  const kind = env['SEARCH_PROVIDER'] ?? 'mock';

  switch (kind) {
    case 'mock':
      return new MockSearchProvider();
    case 'tavily':
      return new TavilySearchProvider(env['TAVILY_API_KEY'] ?? '');
    case 'brave':
      return new BraveSearchProvider(env['BRAVE_API_KEY'] ?? '');
    default:
      throw new Error(`Unknown SEARCH_PROVIDER "${kind}". Expected one of: mock, tavily, brave.`);
  }
}

export function createEmailProvider(env: NodeJS.ProcessEnv = process.env): EmailProvider {
  const kind = env['EMAIL_PROVIDER'] ?? 'eml';

  switch (kind) {
    case 'eml':
      return new EmlFileEmailProvider(env['OUTBOX_DIR'] ?? '.outbox');
    case 'graph':
      return new GraphEmailProvider({
        tenantId: env['AZURE_TENANT_ID'] ?? '',
        clientId: env['GRAPH_CLIENT_ID'] ?? '',
        clientSecret: env['GRAPH_CLIENT_SECRET'] ?? '',
        sender: env['GRAPH_SENDER'] ?? 'contact@cawt.ai',
      });
    default:
      throw new Error(`Unknown EMAIL_PROVIDER "${kind}". Expected one of: eml, graph.`);
  }
}
