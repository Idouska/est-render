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

  /*
   * `effort` n'existe que sur les modèles de la génération 5.
   *
   * Le passer à un Haiku 4.5 fait échouer l'appel en 400 — « This model does
   * not support the effort parameter » — et rend le modèle économique
   * inutilisable au moment précis où l'on en a besoin : un rattrapage de
   * plusieurs milliers de messages. Le réglage d'effort est un raffinement,
   * pas une exigence : on le retire quand le modèle ne le connaît pas.
   */
  const supportsEffort = /^claude-(opus|sonnet|fable)-5/.test(options.model);

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
            ...(request.effort && supportsEffort ? { effort: request.effort } : {}),
            format: { type: 'json_schema', schema: request.schema },
          },
          messages: [{ role: 'user', content: request.user }],
        });
      } catch (error) {
        /*
         * Le motif exact voyage dans le message.
         *
         * « Appel à l'API Claude en échec » n'indiquait ni le code HTTP ni la
         * raison : impossible de distinguer une clé invalide d'un crédit épuisé
         * ou d'un modèle inconnu, trois pannes qui se règlent différemment. Le
         * SDK porte l'un et l'autre — on les recopie.
         */
        const detail =
          typeof error === 'object' && error !== null && 'status' in error
            ? `HTTP ${(error as { status: unknown }).status} — ${
                error instanceof Error ? error.message : String(error)
              }`
            : error instanceof Error
              ? error.message
              : String(error);

        throw new AiProviderError(
          'anthropic',
          `Appel à l’API Claude en échec : ${detail.slice(0, 300)}`,
          error,
        );
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
