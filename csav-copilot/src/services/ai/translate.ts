import { getAiProvider } from './factory.ts';

/**
 * Traduction d'un fil client vers le français.
 *
 * Un SAV qui vend hors de France reçoit de l'anglais, de l'espagnol, parfois
 * de l'allemand. L'agent comprend l'essentiel, se trompe sur le détail, et le
 * détail est précisément ce qui distingue « je veux échanger » de « je veux
 * être remboursé ». Traduire d'un bouton coûte deux secondes ; se tromper de
 * demande coûte un colis.
 *
 * Le texte traduit ne remplace jamais l'original en base : on le renvoie à
 * l'écran, où il s'affiche à côté. Écraser le message reçu ferait disparaître
 * la preuve de ce que le client a réellement écrit.
 */
export async function translateToFrench(
  passages: string[],
): Promise<{ translations: string[]; model: string }> {
  const provider = await getAiProvider();

  const result = await provider.completeJson<{ translations: string[] }>({
    system: [
      'Tu traduis en français des messages reçus par un service après-vente.',
      'Traduis fidèlement, sans résumer, sans commenter, sans ajouter de formule.',
      'Conserve les numéros de commande, les tailles, les montants et les noms propres tels quels.',
      'Un passage déjà en français est renvoyé inchangé.',
      'Renvoie exactement autant de traductions que de passages, dans le même ordre.',
    ].join('\n'),
    user: passages.map((text, index) => `--- Passage ${index + 1} ---\n${text}`).join('\n\n'),
    schema: {
      type: 'object',
      properties: {
        translations: { type: 'array', items: { type: 'string' } },
      },
      required: ['translations'],
      additionalProperties: false,
    },
    validate: (value) => {
      const parsed = value as { translations?: unknown };
      if (!Array.isArray(parsed.translations)) throw new Error('translations manquant');
      if (parsed.translations.some((line) => typeof line !== 'string')) {
        throw new Error('translations doit être une liste de chaînes');
      }
      // Le nombre doit correspondre : une traduction de moins décalerait tout
      // le fil, chaque message affichant la traduction du suivant.
      if (parsed.translations.length !== passages.length) {
        throw new Error(
          `${parsed.translations.length} traductions pour ${passages.length} passages`,
        );
      }
      return { translations: parsed.translations as string[] };
    },
    maxTokens: 4000,
  });

  return { translations: result.data.translations, model: result.model };
}

/**
 * Le mot du marchand, traduit pour l'atelier : en anglais et en chinois.
 *
 * Les deux d'un coup, parce que la langue de l'atelier se choisit dans son
 * espace, au moment où il lit — pas quand le marchand écrit. Un appel pour
 * deux traductions coûte moins que deux appels, et l'atelier qui passe du
 * chinois à l'anglais n'attend rien.
 *
 * L'original reste en base à côté : c'est lui qui fait foi, et l'atelier peut
 * toujours le demander.
 */
export async function traduireDuFrancais(texte: string): Promise<{ en: string; zh: string; model: string }> {
  const provider = await getAiProvider();

  const result = await provider.completeJson<{ en: string; zh: string }>({
    system: [
      'Tu traduis un court message qu’un commerçant français adresse à son atelier de fabrication.',
      'Donne la traduction anglaise et la traduction en chinois simplifié.',
      'Traduis fidèlement, sans résumer, sans commenter, sans ajouter de formule de politesse.',
      'Conserve les numéros de commande, les tailles, les références et les noms propres tels quels.',
    ].join('\n'),
    user: texte,
    schema: {
      type: 'object',
      properties: { en: { type: 'string' }, zh: { type: 'string' } },
      required: ['en', 'zh'],
      additionalProperties: false,
    },
    validate: (value) => {
      const parsed = value as { en?: unknown; zh?: unknown };
      if (typeof parsed.en !== 'string' || typeof parsed.zh !== 'string') {
        throw new Error('en et zh doivent être des chaînes');
      }
      return { en: parsed.en, zh: parsed.zh };
    },
    maxTokens: 1500,
  });

  return { ...result.data, model: result.model };
}
