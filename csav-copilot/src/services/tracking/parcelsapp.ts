import { logger } from '../../lib/logger.ts';
import { getCredentials } from '../platform/credentials.ts';
import type { TrackEvent, TrackInfo } from './track17.ts';

/**
 * Suivi de colis via ParcelsApp.
 *
 * Même rôle que 17TRACK, autre fournisseur. L'API est asynchrone : la première
 * requête rend un ticket (`uuid`), qu'on interroge jusqu'à ce que la réponse
 * soit prête. Les numéros déjà connus du service répondent immédiatement — en
 * pratique, seul le tout premier appel sur un numéro attend.
 */

const BASE = 'https://parcelsapp.com/api/v3';

/** États ParcelsApp → nos états normalisés (ceux de TRACK_STATUS_LABELS). */
const STATUS_MAP: Record<string, string> = {
  delivered: 'Delivered',
  transit: 'InTransit',
  pickup: 'AvailableForPickup',
  arrived: 'OutForDelivery',
  archive: 'Expired',
};

interface RawShipment {
  trackingId?: string;
  status?: string;
  carriers?: string[];
  lastState?: { date?: string; status?: string; location?: string };
  states?: Array<{ date?: string; status?: string; location?: string; carrier?: string }>;
}

async function call(body: unknown, key: string, uuid?: string): Promise<{
  done?: boolean;
  uuid?: string;
  shipments?: RawShipment[];
} | null> {
  try {
    const url = uuid
      ? `${BASE}/shipments/tracking?uuid=${encodeURIComponent(uuid)}&apiKey=${encodeURIComponent(key)}`
      : `${BASE}/shipments/tracking`;

    const response = await fetch(url, {
      method: uuid ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: uuid ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(8000),
    });

    if (!response.ok) {
      logger.warn({ status: response.status }, 'ParcelsApp a répondu en erreur');
      return null;
    }

    return (await response.json()) as { done?: boolean; uuid?: string; shipments?: RawShipment[] };
  } catch (error) {
    logger.warn({ err: error }, 'Appel ParcelsApp en échec');
    return null;
  }
}

function toInfo(raw: RawShipment): TrackInfo {
  const events: TrackEvent[] = (raw.states ?? [])
    .filter((state) => state.date)
    .map((state) => ({
      at: state.date!,
      status: state.status ?? '—',
      location: state.location ?? null,
    }))
    // Du plus récent au plus ancien, comme 17TRACK : c'est la dernière étape
    // qu'on lit quand un client demande où en est son colis.
    .sort((a, b) => b.at.localeCompare(a.at));

  const delivered = raw.status === 'delivered';

  return {
    trackingNumber: raw.trackingId ?? '',
    carrier: raw.carriers?.[0] ?? null,
    status: raw.status ? (STATUS_MAP[raw.status] ?? 'InTransit') : null,
    substatus: raw.lastState?.status ?? null,
    events,
    deliveredAt: delivered ? (raw.lastState?.date ?? events[0]?.at ?? null) : null,
    lastUpdatedAt: raw.lastState?.date ?? events[0]?.at ?? null,
  };
}

export async function getParcelsAppTracking(numbers: string[]): Promise<Map<string, TrackInfo>> {
  const result = new Map<string, TrackInfo>();

  const { PARCELSAPP_API_KEY: key } = await getCredentials();
  if (!key || numbers.length === 0) return result;

  const first = await call(
    {
      apiKey: key,
      language: 'fr',
      shipments: numbers.slice(0, 40).map((trackingId) => ({ trackingId, language: 'fr' })),
    },
    key,
  );
  if (!first) return result;

  let payload = first;

  // L'API travaille en arrière-plan : on repasse au guichet quelques fois,
  // puis on rend ce qu'on a. Un suivi incomplet vaut mieux qu'un écran qui
  // attend dix secondes — le prochain passage trouvera la réponse en cache.
  for (let attempt = 0; attempt < 4 && payload.done !== true && payload.uuid; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 1200));
    const next = await call(null, key, payload.uuid);
    if (!next) break;
    payload = { ...next, uuid: payload.uuid };
  }

  for (const shipment of payload.shipments ?? []) {
    if (shipment.trackingId) result.set(shipment.trackingId, toInfo(shipment));
  }

  return result;
}
