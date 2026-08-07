import {
  AiProviderError,
  extractJsonObject,
  type AiProvider,
  type JsonCompletionRequest,
  type JsonCompletionResult,
} from '../provider.ts';

/**
 * Toute API au format OpenAI : DeepSeek, Mistral, un modèle auto-hébergé
 * derrière vLLM, etc.
 *
 * Différence de fond avec l'API Claude : ces API proposent au mieux un mode
 * « réponds en JSON », pas un schéma imposé. La conformité n'est donc pas
 * garantie — on décrit le schéma dans la consigne, on valide la réponse, et on
 * réessaie une fois en cas d'échec. C'est le prix à payer, et il est visible :
 * `retries` remonte dans le résultat pour qu'on puisse le mesurer.
 */
export function createOpenAiCompatibleProvider(options: {
  name: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  maxRetries?: number;
  fetchImpl?: typeof fetch;
}): AiProvider {
  const doFetch = options.fetchImpl ?? fetch;
  // Trois essais : le premier échoue souvent sur un débit dépassé, et deux
  // attentes doublantes suffisent à laisser passer le pic.
  const maxRetries = options.maxRetries ?? 3;
  const endpoint = `${options.baseUrl.replace(/\/$/, '')}/chat/completions`;

  return {
    name: options.name,
    model: options.model,

    async completeJson<T>(request: JsonCompletionRequest<T>): Promise<JsonCompletionResult<T>> {
      const system = [
        request.system,
        '',
        'Réponds exclusivement par un objet JSON valide conforme à ce schéma,',
        'sans texte autour et sans balises Markdown :',
        JSON.stringify(request.schema),
      ].join('\n');

      const usage = { inputTokens: 0, outputTokens: 0 };
      let lastError: unknown;

      for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
        const messages = [
          { role: 'system', content: system },
          { role: 'user', content: request.user },
        ];

        // À la seconde tentative, on dit au modèle ce qui n'allait pas :
        // c'est nettement plus efficace que de relancer à l'identique.
        if (attempt > 0) {
          messages.push({
            role: 'user',
            content:
              `Ta réponse précédente n'était pas un JSON conforme (${String(lastError)}). ` +
              `Renvoie uniquement l'objet JSON demandé.`,
          });
        }

        let payload;

        try {
          const response = await doFetch(endpoint, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${options.apiKey}`,
            },
            body: JSON.stringify({
              model: options.model,
              max_tokens: request.maxTokens,
              response_format: { type: 'json_object' },
              messages,
            }),
          });

          if (!response.ok) {
            const detail = (await response.text()).slice(0, 200);

            /*
             * Débit dépassé ou panne passagère : on attend et on recommence.
             *
             * Traiter cinq mille messages d'un coup sature n'importe quel
             * fournisseur ; sans cette attente, la moitié de la file se
             * marquait « en échec » pour une erreur qui se dissipait en deux
             * secondes. L'attente double à chaque essai, et le corps de la
             * réponse voyage dans le message : « en échec » tout court
             * n'apprenait rien, « HTTP 402 Insufficient Balance » dit quoi
             * faire.
             */
            if (
              (response.status === 429 || response.status >= 500) &&
              attempt < maxRetries
            ) {
              await new Promise((resolve) => setTimeout(resolve, 2000 * 2 ** attempt));
              lastError = `HTTP ${response.status}`;
              continue;
            }

            throw new Error(`HTTP ${response.status} — ${detail}`);
          }

          payload = (await response.json()) as {
            choices?: Array<{ message?: { content?: string }; finish_reason?: string }>;
            usage?: { prompt_tokens?: number; completion_tokens?: number };
          };
        } catch (error) {
          // Une panne réseau ou une erreur HTTP n'est pas un problème de format :
          // inutile de réessayer avec un message correctif.
          throw new AiProviderError(
            options.name,
            `Appel à ${options.name} en échec : ${
              error instanceof Error ? error.message : String(error)
            }`,
            error,
          );
        }

        usage.inputTokens += payload.usage?.prompt_tokens ?? 0;
        usage.outputTokens += payload.usage?.completion_tokens ?? 0;

        const content = payload.choices?.[0]?.message?.content;

        if (typeof content !== 'string' || content.trim() === '') {
          lastError = 'réponse vide';
          continue;
        }

        try {
          return {
            data: request.validate(extractJsonObject(content)),
            model: options.model,
            refused: false,
            usage,
            retries: attempt,
          };
        } catch (error) {
          lastError = error instanceof Error ? error.message : String(error);
        }
      }

      throw new AiProviderError(
        options.name,
        `Réponse non conforme au schéma après ${maxRetries + 1} tentatives : ${String(lastError)}`,
      );
    },
  };
}
