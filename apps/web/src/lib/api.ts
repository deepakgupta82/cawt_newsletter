import type {
  AdminCosts,
  AppConfig,
  Blueprint,
  ConversationMessage,
  Delivery,
  Edition,
  Newsletter,
  NewsletterSummary,
  NewsletterSummaryStats,
  Recipient,
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

  updateNewsletter: (
    id: string,
    patch: Partial<Pick<Newsletter, 'name' | 'status' | 'schedule' | 'reviewers' | 'autoPublish' | 'sourcePolicy'>> & {
      blueprint?: Blueprint;
    },
  ) => request<Newsletter>(`/api/newsletters/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),

  summary: (id: string) => request<NewsletterSummaryStats>(`/api/newsletters/${id}/summary`),

  adminCosts: () => request<AdminCosts>('/api/admin/costs'),

  recipients: (id: string) => request<Recipient[]>(`/api/newsletters/${id}/recipients`),

  addRecipients: (id: string, emails: string) =>
    request<{ added: string[]; recipients: Recipient[] }>(`/api/newsletters/${id}/recipients`, {
      method: 'POST',
      body: JSON.stringify({ emails }),
    }),

  removeRecipient: (id: string, recipientId: string) =>
    request<Recipient[]>(`/api/newsletters/${id}/recipients/${recipientId}`, { method: 'DELETE' }),

  preview: (id: string) =>
    request<{ edition: Edition; cost: number }>(`/api/newsletters/${id}/preview`, {
      method: 'POST',
      body: JSON.stringify({}),
    }),

  conversation: (id: string) => request<ConversationMessage[]>(`/api/newsletters/${id}/conversation`),

  editions: (id: string) => request<Edition[]>(`/api/newsletters/${id}/editions`),

  getEdition: (editionId: string) => request<Edition>(`/api/editions/${editionId}`),

  sendTest: (editionId: string, to: string) =>
    request<{ messageId: string; location?: string; provider: string }>(`/api/editions/${editionId}/send-test`, {
      method: 'POST',
      body: JSON.stringify({ to }),
    }),

  publish: (editionId: string, actor?: string) =>
    request<{ status: string; sent: number; failed: number; recipientCount: number }>(
      `/api/editions/${editionId}/publish`,
      { method: 'POST', body: JSON.stringify({ actor }) },
    ),

  social: (editionId: string) =>
    request<{ post: string; diagramPrompt: string; charCount: number; cost: number }>(
      `/api/editions/${editionId}/social`,
      { method: 'POST', body: JSON.stringify({}) },
    ),

  deliveries: (id: string) => request<Delivery[]>(`/api/newsletters/${id}/deliveries`),

  editionHtmlUrl: (editionId: string) => `/api/editions/${editionId}/html?preview=1`,

  deliveryHtmlUrl: (deliveryId: string) => `/api/deliveries/${deliveryId}/html`,
};
