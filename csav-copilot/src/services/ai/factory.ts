import { env } from '../../config/env.ts';
import type { AiProvider } from './provider.ts';
import { createAnthropicProvider } from './providers/anthropic.ts';
import { createOpenAiCompatibleProvider } from './providers/openaiCompatible.ts';

/**
 * Choisit le fournisseur d'IA d'après `AI_PROVIDER`. Un seul point de bascule :
 * aucun autre fichier ne connaît le fournisseur actif.
 */
export function createAiProvider(): AiProvider {
  switch (env.AI_PROVIDER) {
    case 'anthropic':
      // env.ts a déjà vérifié la présence de la clé pour ce fournisseur au
      // démarrage ; ce garde ne fait que satisfaire le typage.
      if (!env.ANTHROPIC_API_KEY) {
        throw new Error('AI_PROVIDER=anthropic nécessite ANTHROPIC_API_KEY');
      }
      return createAnthropicProvider({ apiKey: env.ANTHROPIC_API_KEY, model: env.ANTHROPIC_MODEL });

    case 'deepseek':
      if (!env.DEEPSEEK_API_KEY) {
        throw new Error('AI_PROVIDER=deepseek nécessite DEEPSEEK_API_KEY');
      }
      return createOpenAiCompatibleProvider({
        name: 'deepseek',
        baseUrl: env.DEEPSEEK_BASE_URL,
        apiKey: env.DEEPSEEK_API_KEY,
        model: env.DEEPSEEK_MODEL,
      });

    default: {
      // Exhaustivité vérifiée par le compilateur : un fournisseur ajouté au
      // schéma sans branche ici casse le build plutôt que de tomber en silence
      // sur un cas par défaut.
      const exhaustive: never = env.AI_PROVIDER;
      throw new Error(`Fournisseur d'IA inconnu : ${exhaustive}`);
    }
  }
}

/** Instance partagée par tout le processus — un seul client à configurer. */
export const aiProvider: AiProvider = createAiProvider();
