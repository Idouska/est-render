import { getCredentials } from '../platform/credentials.ts';
import { estColisDemo, suiviColisDemo } from '../demo/suivi.ts';
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
  // Les colis de la démonstration n'existent chez aucun transporteur.
  numbers = numbers.filter((number) => !estColisDemo(number));
  if (numbers.length === 0) return;
  const { PARCELSAPP_API_KEY } = await getCredentials();
  // ParcelsApp n'a pas d'étape d'enregistrement : la première interrogation
  // déclenche le suivi. Ne rien faire ici est le comportement voulu.
  if (PARCELSAPP_API_KEY) return;
  await register17(numbers);
}

export async function getTracking(numbers: string[]): Promise<Map<string, TrackInfo>> {
  // Ceux de la démonstration se racontent ici, sans appel ni coût.
  const reels = numbers.filter((number) => !estColisDemo(number));
  const { PARCELSAPP_API_KEY } = await getCredentials();
  const lus = reels.length === 0
    ? new Map<string, TrackInfo>()
    : PARCELSAPP_API_KEY
      ? await getParcelsAppTracking(reels)
      : await get17Tracking(reels);
  for (const number of numbers) {
    const demo = suiviColisDemo(number);
    if (demo) lus.set(number, demo);
  }
  return lus;
}
