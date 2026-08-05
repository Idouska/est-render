import { prisma } from '../../lib/prisma.ts';

/**
 * Réponses déjà envoyées par l'équipe, pour des cas semblables.
 *
 * C'est ce qui manque le plus à un modèle générique : il sait écrire un
 * français correct, il ne sait pas comment *cette* boutique répond à un retard
 * de douane. Les vraies réponses passées portent le ton, les tournures, les
 * engagements précis — bien mieux qu'une consigne de style.
 *
 * Sélection par recouvrement de mots plutôt que par vecteurs : pas de service
 * d'embeddings à héberger, pas de coût par requête, et sur un corpus de
 * quelques milliers de tickets la pertinence est suffisante. Le jour où le
 * volume l'exigera, seule cette fonction changera.
 */

/** Mots vides : présents partout, ils ne discriminent rien. */
const STOP_WORDS = new Set([
  'bonjour', 'merci', 'cordialement', 'madame', 'monsieur', 'vous', 'votre', 'vos',
  'nous', 'notre', 'nos', 'avec', 'pour', 'dans', 'mais', 'plus', 'cette', 'cette',
  'est', 'sont', 'une', 'des', 'les', 'que', 'qui', 'pas', 'sur', 'par', 'the',
  'and', 'you', 'your', 'for', 'with', 'have', 'this', 'that', 'from', 'hello',
  'hi', 'thanks', 'regards', 'please',
]);

function keywords(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .split(/[^a-z0-9]+/)
      // Trois lettres minimum : « le », « du » et les initiales ne portent rien.
      .filter((word) => word.length >= 4 && !STOP_WORDS.has(word)),
  );
}

export interface ReplyExample {
  question: string;
  answer: string;
}

/**
 * Trois échanges passés proches du message reçu.
 *
 * Restreint au marchand et aux tickets clos : un ticket en cours n'a pas de
 * réponse validée, et en montrer une inachevée apprendrait au modèle à mal
 * faire.
 */
export async function findSimilarExchanges(params: {
  merchantId: string;
  intent: string | null;
  bodyText: string;
  excludeTicketId: string;
  limit?: number;
}): Promise<ReplyExample[]> {
  const { merchantId, intent, bodyText, excludeTicketId, limit = 3 } = params;

  const candidates = await prisma.ticket.findMany({
    where: {
      merchantId,
      id: { not: excludeTicketId },
      status: { in: ['CLOSED', 'AUTO_SENT'] },
      ...(intent ? { intent: intent as never } : {}),
      // Au moins une réponse partie : c'est elle qu'on veut montrer.
      messages: { some: { direction: 'OUTBOUND' } },
    },
    orderBy: { lastMessageAt: 'desc' },
    // On ratisse large puis on trie finement en mémoire : filtrer sur le
    // recouvrement de mots n'est pas exprimable en SQL sans index dédié.
    take: 80,
    select: {
      id: true,
      subject: true,
      messages: {
        orderBy: { receivedAt: 'asc' },
        select: { direction: true, bodyText: true },
      },
    },
  });

  const wanted = keywords(bodyText);
  if (wanted.size === 0) return [];

  const scored = candidates
    .map((ticket) => {
      const question = ticket.messages.find((m) => m.direction === 'INBOUND')?.bodyText;
      const answer = [...ticket.messages].reverse().find((m) => m.direction === 'OUTBOUND')
        ?.bodyText;

      if (!question || !answer) return null;

      const theirs = keywords(`${ticket.subject ?? ''} ${question}`);
      let shared = 0;
      for (const word of wanted) if (theirs.has(word)) shared += 1;

      // Normalisé par la taille du message reçu : sans ça, un long mail
      // ressemblerait à tout, et un court à rien.
      return { question, answer, score: shared / Math.sqrt(wanted.size) };
    })
    .filter((row): row is NonNullable<typeof row> => row !== null)
    // En dessous, le recouvrement tient au hasard du vocabulaire commercial.
    .filter((row) => row.score >= 0.6)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  return scored.map(({ question, answer }) => ({
    // Tronqué : trois exemples entiers doubleraient le prompt pour un gain nul,
    // le ton se lit dans les premières lignes.
    question: question.slice(0, 700),
    answer: answer.slice(0, 900),
  }));
}
