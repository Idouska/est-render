/**
 * Reconnaître les pannes Gmail qui ont un remède, parmi celles qui n'en ont pas.
 *
 * Isolé de tout le reste : ces fonctions ne touchent ni à la base, ni à la
 * configuration, ni au réseau. C'est ce qui les rend vérifiables — et elles
 * doivent l'être, parce qu'une seule forme d'erreur non reconnue suffit à
 * faire tomber toute la relève.
 */

interface GaxiosLike {
  code?: number | string;
  status?: number;
  response?: { status?: number };
  message?: string;
}

/**
 * Gmail dit-il « je ne connais pas ce curseur » ?
 *
 * Le code ne regardait que `error.code === 404`. Or googleapis expose le
 * statut à trois endroits selon la version et la nature de la panne — `code`
 * numérique, `code` textuel, `status`, `response.status` — et parfois
 * seulement dans le message : « Requested entity was not found ».
 *
 * Un curseur périmé arrivait donc sous une forme non reconnue, l'erreur était
 * relancée, et toute la relève tombait. L'écran affichait « Requested entity
 * was not found » pendant que le rattrapage par date, qui aurait fonctionné,
 * n'était jamais tenté.
 *
 * Volontairement strict sur ce qui n'en est pas : une coupure réseau ou un
 * refus d'autorisation doivent remonter, ils appellent d'autres gestes.
 */
export function isUnknownCursor(error: unknown): boolean {
  const candidate = (error ?? {}) as GaxiosLike;

  if (
    candidate.code === 404 ||
    candidate.code === '404' ||
    candidate.status === 404 ||
    candidate.response?.status === 404
  ) {
    return true;
  }

  return /requested entity was not found|failedprecondition|invalid.*historyid/i.test(
    candidate.message ?? '',
  );
}
