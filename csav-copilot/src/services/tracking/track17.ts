import { logger } from '../../lib/logger.ts';
import { getCredentials } from '../platform/credentials.ts';

/**
 * Suivi de colis via 17TRACK.
 *
 * Shopify ne connaît du colis que ce que le marchand y a saisi : un numéro et
 * un statut figé au moment de l'expédition. Pour un envoi depuis la Chine, ce
 * statut reste « expédié » pendant trois semaines, ce qui ne permet ni de
 * répondre au client ni de contester un litige. 17TRACK agrège les
 * transporteurs et rend l'historique réel, étape par étape.
 *
 * Sans clé configurée, le service se tait : chaque appel renvoie `null` et
 * l'application retombe sur les données Shopify. Un suivi absent est gênant,
 * une erreur en travers d'un écran l'est plus.
 */

const BASE = 'https://api.17track.net/track/v2.2';

export interface TrackEvent {
  at: string;
  status: string;
  location: string | null;
}

export interface TrackInfo {
  trackingNumber: string;
  carrier: string | null;
  /** État normalisé : InfoReceived, InTransit, Delivered, Exception… */
  status: string | null;
  /** Sous-état plus précis, quand le transporteur en fournit un. */
  substatus: string | null;
  events: TrackEvent[];
  deliveredAt: string | null;
  lastUpdatedAt: string | null;
}

async function call(path: string, key: string, body: unknown): Promise<unknown | null> {
  try {
    const response = await fetch(`${BASE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', '17token': key },
      body: JSON.stringify(body),
      // Un suivi qui met dix secondes à répondre bloquerait l'ouverture du
      // ticket : mieux vaut afficher la commande sans lui.
      signal: AbortSignal.timeout(8000),
    });

    if (!response.ok) {
      logger.warn({ path, status: response.status }, '17TRACK a répondu en erreur');
      return null;
    }

    return await response.json();
  } catch (error) {
    logger.warn({ path, err: error }, 'Appel 17TRACK en échec');
    return null;
  }
}

/**
 * Déclare un numéro auprès de 17TRACK.
 *
 * Obligatoire avant toute lecture : la plateforme ne suit que ce qu'on lui a
 * demandé de suivre. Ré-enregistrer un numéro déjà connu est sans effet, donc
 * on le fait systématiquement plutôt que de tenir un état de plus.
 */
export async function registerTracking(numbers: string[]): Promise<void> {
  const { TRACK17_API_KEY: key } = await getCredentials();
  if (!key || numbers.length === 0) return;

  // 40 numéros par appel, plafond de l'API.
  for (let index = 0; index < numbers.length; index += 40) {
    await call(
      '/register',
      key,
      numbers.slice(index, index + 40).map((number) => ({ number })),
    );
  }
}

interface RawTrack {
  number: string;
  track_info?: {
    latest_status?: { status?: string; sub_status?: string };
    latest_event?: { time_iso?: string };
    tracking?: {
      providers?: Array<{
        provider?: { name?: string };
        events?: Array<{ time_iso?: string; description?: string; location?: string }>;
      }>;
    };
    time_metrics?: { estimated_delivery_date?: { from?: string } };
    milestone?: Array<{ key_stage?: string; time_iso?: string }>;
  };
}

/** État courant et historique d'un ou plusieurs colis. */
export async function getTracking(numbers: string[]): Promise<Map<string, TrackInfo>> {
  const result = new Map<string, TrackInfo>();

  const { TRACK17_API_KEY: key } = await getCredentials();
  if (!key || numbers.length === 0) return result;

  const payload = (await call(
    '/gettrackinfo',
    key,
    numbers.slice(0, 40).map((number) => ({ number })),
  )) as { data?: { accepted?: RawTrack[] } } | null;

  for (const row of payload?.data?.accepted ?? []) {
    const info = row.track_info;
    const provider = info?.tracking?.providers?.[0];

    const events: TrackEvent[] = (provider?.events ?? [])
      .filter((event) => event.time_iso)
      .map((event) => ({
        at: event.time_iso!,
        status: event.description ?? '—',
        location: event.location ?? null,
      }))
      // Du plus récent au plus ancien : c'est la dernière étape qu'on lit en
      // premier quand un client demande où en est son colis.
      .sort((a, b) => b.at.localeCompare(a.at));

    result.set(row.number, {
      trackingNumber: row.number,
      carrier: provider?.provider?.name ?? null,
      status: info?.latest_status?.status ?? null,
      substatus: info?.latest_status?.sub_status ?? null,
      events,
      deliveredAt:
        info?.milestone?.find((stage) => stage.key_stage === 'Delivered')?.time_iso ?? null,
      lastUpdatedAt: info?.latest_event?.time_iso ?? null,
    });
  }

  return result;
}

/** Libellés français des états normalisés de 17TRACK. */
export const TRACK_STATUS_LABELS: Record<string, string> = {
  NotFound: 'Introuvable chez le transporteur',
  InfoReceived: 'Pris en charge par le fournisseur',
  InTransit: 'En transit',
  Expired: 'Suivi expiré',
  AvailableForPickup: 'À retirer en point relais',
  OutForDelivery: 'En cours de livraison',
  DeliveryFailure: 'Échec de livraison',
  Delivered: 'Livré',
  Exception: 'Incident de livraison',
};
