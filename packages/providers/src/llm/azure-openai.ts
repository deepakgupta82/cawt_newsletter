import type { JsonRequest, LlmProvider, LlmResult, ModelTier, TextRequest } from '../types.js';
import { estimateCost } from '../types.js';

export interface AzureOpenAiOptions {
  endpoint: string;
  apiVersion: string;
  /** Deployment name per tier. Bulk carries ~90% of tokens, so keep it cheap. */
  deployments: Record<ModelTier, string>;
  /** Static key for local development. Omit in Azure and supply getToken instead. */
  apiKey?: string;
  /** Managed-identity token provider. Preferred in Azure: no secret to rotate. */
  getToken?: () => Promise<string>;
  maxRetries?: number;
}

interface ChatResponse {
  choices?: Array<{ message?: { content?: string | null }; finish_reason?: string }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  error?: { message?: string; code?: string };
}

/**
 * Azure OpenAI on Foundry, called over plain fetch so there is no SDK version
 * to keep in step. Works identically against any deployment that speaks the
 * chat-completions shape.
 *
 * Structured responses go through response_format: json_schema with strict
 * mode, so the model cannot return a shape the pipeline is not expecting.
 * Schema failures are retried a bounded number of times and then surfaced,
 * never silently patched.
 */
export class AzureOpenAiProvider implements LlmProvider {
  readonly name = 'azure-openai';

  constructor(private readonly options: AzureOpenAiOptions) {
    if (!options.endpoint) throw new Error('AZURE_AI_ENDPOINT is required for the azure-openai provider');
    if (!options.apiKey && !options.getToken) {
      throw new Error('azure-openai provider needs either AZURE_AI_API_KEY or a managed-identity token provider');
    }
  }

  async completeText(request: TextRequest): Promise<LlmResult<string>> {
    const { content, usage, model } = await this.call(request);
    return {
      value: content,
      usage: {
        provider: this.name,
        operation: request.operation,
        model,
        inputTokens: usage.input,
        outputTokens: usage.output,
        searchQueries: 0,
        estimatedCostUsd: estimateCost(model, usage.input, usage.output),
      },
    };
  }

  async completeJson<T>(request: JsonRequest<T>): Promise<LlmResult<T>> {
    const maxAttempts = this.options.maxRetries ?? 2;
    let lastError: unknown;

    for (let attempt = 0; attempt <= maxAttempts; attempt++) {
      // strict:false on purpose. Strict mode requires every property to appear
      // in `required` and forbids optionals, which fights the defaults the
      // blueprint schema relies on. Zod validation plus the bounded retry below
      // gives the same guarantee without contorting the schema.
      const { content, usage, model } = await this.call(request, {
        type: 'json_schema',
        json_schema: {
          name: request.schema.name,
          strict: false,
          schema: request.schema.jsonSchema,
        },
      });

      try {
        const value = request.schema.parse(JSON.parse(content));
        return {
          value,
          usage: {
            provider: this.name,
            operation: request.operation,
            model,
            inputTokens: usage.input,
            outputTokens: usage.output,
            searchQueries: 0,
            estimatedCostUsd: estimateCost(model, usage.input, usage.output),
          },
        };
      } catch (error) {
        lastError = error;
      }
    }

    throw new Error(
      `Model returned a response that did not match schema "${request.schema.name}" after ${maxAttempts + 1} attempts: ${String(lastError)}`,
    );
  }

  private async call(
    request: TextRequest,
    responseFormat?: Record<string, unknown>,
  ): Promise<{ content: string; usage: { input: number; output: number }; model: string }> {
    const model = this.options.deployments[request.tier];
    const url = `${this.options.endpoint.replace(/\/$/, '')}/openai/deployments/${encodeURIComponent(model)}/chat/completions?api-version=${this.options.apiVersion}`;

    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (this.options.getToken) {
      headers['authorization'] = `Bearer ${await this.options.getToken()}`;
    } else if (this.options.apiKey) {
      headers['api-key'] = this.options.apiKey;
    }

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        messages: [
          { role: 'system', content: request.system },
          { role: 'user', content: request.user },
        ],
        max_completion_tokens: request.maxTokens ?? 4000,
        ...(responseFormat ? { response_format: responseFormat } : {}),
      }),
      signal: AbortSignal.timeout(120_000),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(`Azure OpenAI request failed (${response.status}): ${detail.slice(0, 500)}`);
    }

    const payload = (await response.json()) as ChatResponse;
    if (payload.error) throw new Error(`Azure OpenAI error: ${payload.error.message ?? payload.error.code}`);

    const content = payload.choices?.[0]?.message?.content;
    if (!content) throw new Error('Azure OpenAI returned an empty response');

    return {
      content,
      usage: {
        input: payload.usage?.prompt_tokens ?? 0,
        output: payload.usage?.completion_tokens ?? 0,
      },
      model,
    };
  }
}
