import Anthropic from '@anthropic-ai/sdk';
import {
  AiProviderError,
  type AiProvider,
  type JsonCompletionRequest,
  type JsonCompletionResult,
} from '../provider.ts';

/**
 * API Claude. Le schéma est imposé par l'API elle-même
 * (`output_config.format`) : la réponse est structurellement garantie, il n'y a
 * donc rien à réparer ni à réessayer.
 */
export function createAnthropicProvider(options: {
  apiKey: string;
  model: string;
}): AiProvider {
  const client = new Anthropic({ apiKey: options.apiKey });

  return {
    name: 'anthropic',
    model: options.model,

    async completeJson<T>(request: JsonCompletionRequest<T>): Promise<JsonCompletionResult<T>> {
      let response;

      try {
        response = await client.messages.create({
          model: options.model,
          max_tokens: request.maxTokens,
          system: request.system,
          output_config: {
            ...(request.effort ? { effort: request.effort } : {}),
            format: { type: 'json_schema', schema: request.schema },
          },
          messages: [{ role: 'user', content: request.user }],
        });
      } catch (error) {
        throw new AiProviderError('anthropic', 'Appel à l’API Claude en échec', error);
      }

      const usage = {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      };

      if (response.stop_reason === 'refusal') {
        return { data: undefined as T, model: options.model, refused: true, usage, retries: 0 };
      }

      const text = response.content
        .filter((block): block is Anthropic.TextBlock => block.type === 'text')
        .map((block) => block.text)
        .join('')
        .trim();

      return {
        data: request.validate(JSON.parse(text)),
        model: options.model,
        refused: false,
        usage,
        retries: 0,
      };
    },
  };
}
