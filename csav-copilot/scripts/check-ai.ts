/**
 * Vérifie que la clé d'IA configurée fonctionne réellement.
 *
 *   npm run check:ai
 *
 * Envoie une toute petite requête au fournisseur actif (`AI_PROVIDER`) et
 * rapporte le résultat. La clé n'est jamais affichée : seuls sa longueur et
 * ses quatre derniers caractères le sont, de quoi vérifier qu'on a collé la
 * bonne sans jamais l'exposer dans un terminal ou un journal partagé.
 *
 * Volontairement autonome : ce script lit `process.env` directement au lieu de
 * passer par `config/env.ts`. Sur un dépôt fraîchement cloné il n'y a pas de
 * `.env` (il est ignoré par git), donc la validation complète échouerait sur
 * l'absence de base de données — un échec sans rapport avec la clé qu'on teste.
 * Ici, deux variables suffisent : AI_PROVIDER et la clé du fournisseur.
 */

import { createAnthropicProvider } from '../src/services/ai/providers/anthropic.ts';
import { createOpenAiCompatibleProvider } from '../src/services/ai/providers/openaiCompatible.ts';
import type { AiProvider } from '../src/services/ai/provider.ts';

const provider = (process.env.AI_PROVIDER ?? 'anthropic').trim();
const anthropicKey = process.env.ANTHROPIC_API_KEY?.trim();
const deepseekKey = process.env.DEEPSEEK_API_KEY?.trim();

function fingerprint(key: string | undefined): string {
  if (!key) return 'absente';
  return `${key.length} caractères, se termine par …${key.slice(-4)}`;
}

function build(): { client: AiProvider; key: string | undefined; host: string } {
  if (provider === 'deepseek') {
    const baseUrl = process.env.DEEPSEEK_BASE_URL?.trim() || 'https://api.deepseek.com/v1';
    if (!deepseekKey) {
      throw new Error('AI_PROVIDER=deepseek mais DEEPSEEK_API_KEY est absente.');
    }
    return {
      client: createOpenAiCompatibleProvider({
        name: 'deepseek',
        baseUrl,
        apiKey: deepseekKey,
        model: process.env.DEEPSEEK_MODEL?.trim() || 'deepseek-chat',
      }),
      key: deepseekKey,
      host: new URL(baseUrl).hostname,
    };
  }

  if (provider === 'anthropic') {
    if (!anthropicKey) {
      throw new Error('AI_PROVIDER=anthropic mais ANTHROPIC_API_KEY est absente.');
    }
    return {
      client: createAnthropicProvider({
        apiKey: anthropicKey,
        model: process.env.ANTHROPIC_MODEL?.trim() || 'claude-opus-5',
      }),
      key: anthropicKey,
      host: 'api.anthropic.com',
    };
  }

  throw new Error(`AI_PROVIDER inconnu : « ${provider} ». Valeurs acceptées : anthropic, deepseek.`);
}

const SCHEMA = {
  type: 'object',
  properties: { ok: { type: 'boolean' }, langue: { type: 'string' } },
  required: ['ok', 'langue'],
  additionalProperties: false,
} as const;

interface Probe {
  ok: boolean;
  langue: string;
}

function validate(value: unknown): Probe {
  if (typeof value !== 'object' || value === null) throw new TypeError('objet attendu');
  const v = value as Record<string, unknown>;
  if (typeof v.ok !== 'boolean' || typeof v.langue !== 'string') {
    throw new TypeError('champs ok/langue manquants');
  }
  return { ok: v.ok, langue: v.langue };
}

async function main(): Promise<void> {
  let client: AiProvider;
  let key: string | undefined;
  let host: string;

  try {
    ({ client, key, host } = build());
  } catch (error) {
    console.error('✗ Configuration incomplète.\n');
    console.error('  ', error instanceof Error ? error.message : String(error));
    console.error('\n  AI_PROVIDER        :', process.env.AI_PROVIDER ?? '(absent)');
    console.error('  ANTHROPIC_API_KEY  :', fingerprint(anthropicKey));
    console.error('  DEEPSEEK_API_KEY   :', fingerprint(deepseekKey));
    console.error('\n  → Ces variables se règlent dans les réglages de l’environnement cloud,');
    console.error('    et ne sont lues qu’au démarrage d’une session : ouvrez-en une nouvelle');
    console.error('    après les avoir enregistrées.');
    process.exitCode = 1;
    return;
  }

  console.log('Fournisseur :', provider);
  console.log('Modèle      :', client.model);
  console.log('Clé         :', fingerprint(key));
  console.log('\nEnvoi d’une requête de test…\n');

  const started = Date.now();

  try {
    const result = await client.completeJson<Probe>({
      system: 'Tu réponds uniquement en JSON, sans texte autour.',
      user: 'Réponds exactement {"ok": true, "langue": "français"}.',
      effort: 'low',
      maxTokens: 128,
      schema: SCHEMA,
      validate,
    });

    if (result.refused) {
      console.error('✗ Le modèle a refusé de répondre. Clé valide, mais réponse inattendue.');
      process.exitCode = 1;
      return;
    }

    console.log('✓ La clé fonctionne.');
    console.log(`  Réponse reçue en ${Date.now() - started} ms`);
    console.log(`  Modèle ayant répondu : ${result.model}`);
    if (result.retries > 0) {
      console.log(`  ${result.retries} nouvelle(s) tentative(s) — JSON non conforme au premier essai.`);
    }
    console.log(`  Jetons : ${result.usage.inputTokens} entrée / ${result.usage.outputTokens} sortie`);
    console.log('\nTout est prêt : l’application peut rédiger de vrais brouillons.');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const cause = error instanceof Error && error.cause instanceof Error ? error.cause.message : '';
    const full = `${message} ${cause}`;

    console.error('✗ L’appel a échoué.\n');
    console.error('  ', message);
    if (cause) console.error('  ', cause);

    // Traduction des erreurs les plus fréquentes en action concrète.
    if (/not in allowlist|egress/i.test(full)) {
      console.error(`\n  → Le réseau de cet environnement bloque ${host}.`);
      console.error('    Ce n’est pas un problème de clé : passez l’accès réseau en « Personnalisé »');
      console.error(`    et ajoutez ${host} aux domaines autorisés.`);
    } else if (/401|invalid|unauthor/i.test(full)) {
      console.error('\n  → La clé est refusée. Vérifiez qu’elle est complète, copiée sans espace,');
      console.error('    et qu’elle correspond bien au fournisseur choisi dans AI_PROVIDER.');
    } else if (/402|balance|quota|insufficient/i.test(full)) {
      console.error('\n  → La clé est valide mais le compte n’a pas de crédit. Rechargez le solde.');
    } else if (/ENOTFOUND|ECONNREFUSED|fetch failed|timeout/i.test(full)) {
      console.error('\n  → Le service est injoignable depuis cette machine (réseau ou pare-feu).');
    }

    process.exitCode = 1;
  }
}

await main();
