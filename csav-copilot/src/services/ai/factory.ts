import { getCredentials } from '../platform/credentials.ts';
import type { AiProvider } from './provider.ts';
import { createAnthropicProvider } from './providers/anthropic.ts';
import { createOpenAiCompatibleProvider } from './providers/openaiCompatible.ts';

/**
 * Choisit le fournisseur d'IA d'après la configuration effective. Un seul point
 * de bascule : aucun autre fichier ne connaît le fournisseur actif.
 *
 * Le client est reconstruit dès que la configuration change — changer de
 * fournisseur ou corriger une clé depuis la console d'administration prend
 * alors effet sans redémarrer les processus. L'empreinte ci-dessous évite de
 * reconstruire un client à chaque appel tant que rien n'a bougé.
 */

let cached: { fingerprint: string; provider: AiProvider } | null = null;

export async function getAiProvider(): Promise<AiProvider> {
  const credentials = await getCredentials();
  const raw = credentials.AI_PROVIDER ?? 'anthropic';

  // La valeur peut venir de la base : elle n'est pas typée par le schéma de
  // `env.ts`, donc on la valide ici plutôt que de la caster.
  if (raw !== 'anthropic' && raw !== 'deepseek') {
    throw new Error(`Fournisseur d'IA inconnu : « ${raw} ». Valeurs acceptées : anthropic, deepseek.`);
  }

  const active: 'anthropic' | 'deepseek' = raw;

  let fingerprint: string;
  let build: () => AiProvider;

  switch (active) {
    case 'anthropic': {
      const apiKey = credentials.ANTHROPIC_API_KEY;
      if (!apiKey) {
        throw new Error(
          'AI_PROVIDER=anthropic nécessite ANTHROPIC_API_KEY — réglez-la dans la console d’administration (/admin).',
        );
      }
      const model = credentials.ANTHROPIC_MODEL ?? 'claude-opus-5';
      fingerprint = `anthropic:${model}:${apiKey}`;
      build = () => createAnthropicProvider({ apiKey, model });
      break;
    }

    case 'deepseek': {
      const apiKey = credentials.DEEPSEEK_API_KEY;
      if (!apiKey) {
        throw new Error(
          'AI_PROVIDER=deepseek nécessite DEEPSEEK_API_KEY — réglez-la dans la console d’administration (/admin).',
        );
      }
      const model = credentials.DEEPSEEK_MODEL ?? 'deepseek-chat';
      const baseUrl = credentials.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com/v1';
      fingerprint = `deepseek:${baseUrl}:${model}:${apiKey}`;
      build = () => createOpenAiCompatibleProvider({ name: 'deepseek', baseUrl, apiKey, model });
      break;
    }

    default: {
      // Exhaustivité vérifiée par le compilateur : un fournisseur ajouté au
      // schéma sans branche ici casse le build plutôt que de tomber en silence
      // sur un cas par défaut.
      const exhaustive: never = active;
      throw new Error(`Fournisseur d'IA inconnu : ${exhaustive}`);
    }
  }

  if (cached?.fingerprint !== fingerprint) {
    cached = { fingerprint, provider: build() };
  }

  return cached.provider;
}

/**
 * Identifiant du modèle actif, au format `fournisseur:modèle`, consigné sur
 * chaque brouillon. Sans lui, impossible de comparer deux fournisseurs sur le
 * même trafic après un changement de configuration.
 */
export async function describeActiveModel(): Promise<string> {
  const provider = await getAiProvider();
  return `${provider.name}:${provider.model}`;
}
