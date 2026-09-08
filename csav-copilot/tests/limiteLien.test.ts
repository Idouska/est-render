import { deepEqual, equal, notEqual, ok } from 'node:assert/strict';
import { test } from 'node:test';
import {
  cleAdresse,
  lienAutorise,
  PLAFOND_JOUR,
  type Magasin,
} from '../src/services/auth/limiteLien.ts';

/*
 * `POST /api/auth/request-link` est publique par construction, et elle fait
 * partir un mail depuis la boîte Gmail du MARCHAND. Sans borne, qui connaît
 * l'adresse d'un équipier épuise le quota d'envoi du marchand — deux mille
 * messages par jour sur Workspace — et plus aucune réponse client ne part.
 *
 * Ce que ces tests fixent, c'est autant le comptage que ce qu'on en dit :
 * une borne qui se signale rouvrirait l'énumération d'adresses que la route
 * ferme par ailleurs.
 */

/** Un Redis de papier : la même sémantique, en mémoire. */
function magasinFactice(): Magasin & { cles: Map<string, string> } {
  const cles = new Map<string, string>();
  return {
    cles,
    async set(cle, valeur, _mode, _ttl, _nx) {
      if (cles.has(cle)) return null;
      cles.set(cle, valeur);
      return 'OK';
    },
    async incr(cle) {
      const n = Number(cles.get(cle) ?? '0') + 1;
      cles.set(cle, String(n));
      return n;
    },
    async expire() {
      return 1;
    },
  };
}

test('le premier envoi passe', async () => {
  const m = magasinFactice();
  deepEqual(await lienAutorise(m, 'sav@example.com'), { autorise: true });
});

test('le deuxième dans la minute est refusé', async () => {
  const m = magasinFactice();
  await lienAutorise(m, 'sav@example.com');
  deepEqual(await lienAutorise(m, 'sav@example.com'), { autorise: false, motif: 'delai' });
});

test('une autre adresse n’est pas bornée par la première', async () => {
  const m = magasinFactice();
  await lienAutorise(m, 'sav@example.com');
  deepEqual(await lienAutorise(m, 'compta@example.com'), { autorise: true });
});

test('l’adresse est normalisée : casse et espaces ne contournent pas la borne', async () => {
  const m = magasinFactice();
  await lienAutorise(m, 'sav@example.com');
  deepEqual(await lienAutorise(m, '  SAV@Example.COM  '), { autorise: false, motif: 'delai' });
});

test('le plafond journalier borne le total, délai court écoulé', async () => {
  const m = magasinFactice();
  // On efface la clé courte entre chaque envoi : c'est ce que fait le temps
  // qui passe, et c'est le seul moyen d'atteindre le plafond journalier.
  const envoyer = async () => {
    m.cles.delete(cleAdresse('court', 'sav@example.com'));
    return lienAutorise(m, 'sav@example.com');
  };

  for (let i = 0; i < PLAFOND_JOUR; i += 1) {
    deepEqual(await envoyer(), { autorise: true }, `envoi ${i + 1}`);
  }
  deepEqual(await envoyer(), { autorise: false, motif: 'plafond' });
});

test('la durée de vie journalière n’est posée qu’une fois', async () => {
  // Sinon la fenêtre glisserait à chaque appel et le plafond ne se
  // réinitialiserait jamais pour qui insiste.
  const m = magasinFactice();
  let expirations = 0;
  const compte: Magasin = { ...m, expire: async () => (expirations += 1) };

  await lienAutorise(compte, 'sav@example.com');
  m.cles.delete(cleAdresse('court', 'sav@example.com'));
  await lienAutorise(compte, 'sav@example.com');

  equal(expirations, 1);
});

test('le magasin en panne laisse passer, et le signale', async () => {
  // Un lien de connexion est le seul chemin d'entrée : refuser parce que
  // Redis hoquette verrouillerait dehors toute l'équipe.
  const casse: Magasin = {
    async set() {
      throw new Error('ECONNREFUSED');
    },
    async incr() {
      throw new Error('ECONNREFUSED');
    },
    async expire() {
      throw new Error('ECONNREFUSED');
    },
  };

  let journalise: unknown = null;
  deepEqual(await lienAutorise(casse, 'sav@example.com', (e) => (journalise = e)), {
    autorise: true,
  });
  ok(journalise instanceof Error, 'la panne doit être journalisée, pas avalée');
});

test('la clé ne contient pas l’adresse en clair', async () => {
  // Redis garde ses clés en clair, journaux compris : y écrire les adresses
  // reviendrait à publier l'annuaire du marchand dans un service qui n'a
  // aucune raison de le connaître.
  const cle = cleAdresse('court', 'sav@example.com');
  equal(cle.includes('sav@example.com'), false);
  equal(cle.includes('example.com'), false);
  equal(cle.includes('sav'), false);
  notEqual(cle, cleAdresse('court', 'compta@example.com'));
});
