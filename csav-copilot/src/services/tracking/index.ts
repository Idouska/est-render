import { getCredentials } from '../platform/credentials.ts';
import { getParcelsAppTracking } from './parcelsapp.ts';
import {
  getTracking as get17Tracking,
  registerTracking as register17,
  type TrackInfo,
} from './track17.ts';

export { TRACK_STATUS_LABELS, type TrackEvent, type TrackInfo } from './track17.ts';

/**
 * Fournisseur de suivi effectif.
 *
 * ParcelsApp prime quand sa clé est là, 17TRACK sinon, silence sans clé du
 * tout. Un seul fournisseur actif à la fois : interroger les deux doublerait
 * le coût pour fusionner des chronologies qui racontent la même chose.
 */
export async function registerTracking(numbers: string[]): Promise<void> {
  const { PARCELSAPP_API_KEY } = await getCredentials();
  // ParcelsApp n'a pas d'étape d'enregistrement : la première interrogation
  // déclenche le suivi. Ne rien faire ici est le comportement voulu.
  if (PARCELSAPP_API_KEY) return;
  await register17(numbers);
}

export async function getTracking(numbers: string[]): Promise<Map<string, TrackInfo>> {
  const { PARCELSAPP_API_KEY } = await getCredentials();
  if (PARCELSAPP_API_KEY) return getParcelsAppTracking(numbers);
  return get17Tracking(numbers);
}
