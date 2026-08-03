/**
 * Vérifie que la clé d'IA configurée fonctionne réellement.
 *
 *   npm run check:ai
 *
 * Envoie une toute petite requête au fournisseur actif (`AI_PROVIDER`) et
 * rapporte le résultat. La clé n'est jamais affichée : seuls sa présence, sa
 * longueur et ses quatre derniers caractères sont montrés, de quoi vérifier
 * qu'on a bien collé la bonne sans jamais l'exposer dans un terminal ou un
 * journal partagé.
 */

import { env } from '../src/config/env.ts';
import { aiProvider } from '../src/services/ai/factory.ts';

const KEYS = {
  anthropic: env.ANTHROPIC_API_KEY,
  deepseek: env.DEEPSEEK_API_KEY,
} as const;

function fingerprint(key: string | undefined): string {
  if (!key) return 'absente';
  return `${key.length} caractères, se termine par …${key.slice(-4)}`;
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
  if (typeof value !== 'object' || value === null) {
    throw new TypeError('objet attendu');
  }
  const v = value as Record<string, unknown>;
  if (typeof v.ok !== 'boolean' || typeof v.langue !== 'string') {
    throw new TypeError('champs ok/langue manquants');
  }
  return { ok: v.ok, langue: v.langue };
}

async function main(): Promise<void> {
  console.log('Fournisseur configuré :', env.AI_PROVIDER);
  console.log('Modèle               :', aiProvider.model);
  console.log('Clé                  :', fingerprint(KEYS[env.AI_PROVIDER]));
  console.log('\nEnvoi d’une requête de test…\n');

  const started = Date.now();

  try {
    const result = await aiProvider.completeJson<Probe>({
      system: 'Tu réponds uniquement en JSON, sans texte autour.',
      user: 'Réponds exactement {"ok": true, "langue": "français"}.',
      effort: 'low',
      maxTokens: 128,
      schema: SCHEMA,
      validate,
    });

    const ms = Date.now() - started;

    if (result.refused) {
      console.error('✗ Le modèle a refusé de répondre. Clé valide, mais réponse inattendue.');
      process.exitCode = 1;
      return;
    }

    console.log('✓ La clé fonctionne.');
    console.log(`  Réponse reçue en ${ms} ms`);
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
      const host = new URL(
        env.AI_PROVIDER === 'deepseek' ? env.DEEPSEEK_BASE_URL : 'https://api.anthropic.com',
      ).hostname;
      console.error(`\n  → Le réseau de cet environnement bloque ${host}.`);
      console.error('    Ce n’est pas un problème de clé : l’hôte doit être ajouté aux règles');
      console.error('    de sortie réseau de l’environnement avant que l’appel puisse aboutir.');
    } else if (/401|invalid|unauthor/i.test(full)) {
      console.error('\n  → La clé est refusée. Vérifiez qu’elle est complète et copiée sans espace,');
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
