import type { TrackInfo } from '../tracking/track17.ts';
import { scenariosColis, suiviDemo, type ScenarioColis } from './catalogue.ts';

/*
 * Le suivi des colis de la démonstration, inventé ici.
 *
 * Ses numéros ne partent jamais chez 17TRACK ou ParcelsApp : chaque numéro
 * déclaré y est facturé, et ceux-là n'existent chez aucun transporteur.
 */

/** Les retours en route vers l'agence : des colis Colissimo, partis du client. */
const RETOURS: Array<[string, ScenarioColis & { transporteur: string }]> = [
  ['6A2610482215', { etat: 'transit', expedie: 2, transporteur: 'Colissimo' }],
  ['6A2610482398', { etat: 'livre', expedie: 6, transporteur: 'Colissimo' }],
  ['6A2610483051', { etat: 'livre', expedie: 9, transporteur: 'Colissimo' }],
];

const SCENARIOS = new Map<string, ScenarioColis & { transporteur: string }>([...scenariosColis(), ...RETOURS]);

export const NUMEROS_RETOUR_DEMO = RETOURS.map(([numero]) => numero);

export const estColisDemo = (numero: string): boolean => SCENARIOS.has(numero);

export function suiviColisDemo(numero: string, maintenant = Date.now()): TrackInfo | undefined {
  const scenario = SCENARIOS.get(numero);
  if (!scenario) return undefined;
  const suivi = suiviDemo(scenario, scenario.transporteur, maintenant);
  return {
    trackingNumber: numero,
    carrier: scenario.transporteur,
    status: suivi.status,
    substatus: null,
    events: suivi.events,
    deliveredAt: suivi.deliveredAt,
    lastUpdatedAt: suivi.lastUpdatedAt,
  };
}
