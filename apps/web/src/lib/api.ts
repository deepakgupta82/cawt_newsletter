import type {
  AppConfig,
  ConversationMessage,
  Edition,
  Newsletter,
  NewsletterSummary,
} from './types';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  });

  if (!response.ok) {
    const detail = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error(detail.error ?? `Request failed with ${response.status}`);
  }
  return (await response.json()) as T;
}

export const api = {
  config: () => request<AppConfig>('/api/config'),

  listNewsletters: () => request<NewsletterSummary[]>('/api/newsletters'),

  getNewsletter: (id: string) => request<Newsletter>(`/api/newsletters/${id}`),

  createNewsletter: (input: { prompt?: string; sample?: string; name?: string }) =>
    request<{ newsletter: Newsletter; cost: number }>('/api/newsletters', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  refine: (id: string, instruction: string) =>
    request<{ newsletter: Newsletter; cost: number }>(`/api/newsletters/${id}/refine`, {
      method: 'POST',
      body: JSON.stringify({ instruction }),
    }),

  preview: (id: string) =>
    request<{ edition: Edition; cost: number }>(`/api/newsletters/${id}/preview`, {
      method: 'POST',
      body: JSON.stringify({}),
    }),

  conversation: (id: string) => request<ConversationMessage[]>(`/api/newsletters/${id}/conversation`),

  sendTest: (editionId: string, to: string) =>
    request<{ messageId: string; location?: string; provider: string }>(`/api/editions/${editionId}/send-test`, {
      method: 'POST',
      body: JSON.stringify({ to }),
    }),

  editionHtmlUrl: (editionId: string) => `/api/editions/${editionId}/html?preview=1`,
};
