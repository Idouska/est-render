/**
 * Abstraction du fournisseur de modèle.
 *
 * Les deux usages du produit — classer un mail, rédiger une réponse — ont
 * besoin de la même chose : envoyer une consigne et un texte, recevoir un objet
 * JSON conforme à un schéma. C'est le seul contrat exposé ici.
 *
 * Deux implémentations : l'API Claude, et n'importe quelle API compatible
 * OpenAI (DeepSeek, Mistral, un modèle auto-hébergé…). Changer de fournisseur
 * est une variable d'environnement, pas une réécriture.
 */

export interface JsonCompletionRequest<T> {
  system: string;
  user: string;
  /** Schéma JSON attendu, transmis au modèle. */
  schema: Record<string, unknown>;
  /** Valide et type la réponse. Doit lever si la forme ne convient pas. */
  validate: (value: unknown) => T;
  maxTokens: number;
  /** Profondeur de réflexion souhaitée. Ignoré par les modèles qui n'en ont pas. */
  effort?: 'low' | 'medium' | 'high';
}

export interface JsonCompletionResult<T> {
  data: T;
  model: string;
  /** Le modèle a refusé de répondre (garde-fous de sécurité). */
  refused: boolean;
  usage: { inputTokens: number; outputTokens: number };
  /** Nombre de tentatives supplémentaires nécessaires pour obtenir un JSON valide. */
  retries: number;
}

export interface AiProvider {
  /** Nom lisible, pour les journaux et la comparaison. */
  readonly name: string;
  /** Modèle réellement utilisé. Consigné sur chaque brouillon. */
  readonly model: string;
  completeJson<T>(request: JsonCompletionRequest<T>): Promise<JsonCompletionResult<T>>;
}

export class AiProviderError extends Error {
  readonly provider: string;
  override readonly cause: unknown;

  constructor(provider: string, message: string, cause?: unknown) {
    super(message);
    this.name = 'AiProviderError';
    this.provider = provider;
    this.cause = cause;
  }
}

/**
 * Extrait le premier objet JSON d'une réponse.
 *
 * Les modèles sans mode « schéma imposé » encadrent parfois leur JSON de texte
 * ou de balises Markdown. On récupère l'objet plutôt que d'échouer sur un
 * détail de mise en forme — mais on ne répare rien : un JSON réellement
 * malformé doit lever, pour déclencher une nouvelle tentative.
 */
export function extractJsonObject(text: string): unknown {
  const trimmed = text.trim();

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced?.[1]?.trim() ?? trimmed;

  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');

  if (start === -1 || end === -1 || end < start) {
    throw new SyntaxError('Aucun objet JSON dans la réponse du modèle');
  }

  return JSON.parse(candidate.slice(start, end + 1));
}
