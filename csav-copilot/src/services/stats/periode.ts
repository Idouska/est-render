import { z } from 'zod';

/**
 * La période des statistiques, façon Shopify.
 *
 * Une période se choisit en dates du calendrier — « du 17 septembre au
 * 16 octobre » — et non en « trente jours glissants » : c'est ce que le
 * commerçant lit sur Shopify, et ce qu'il compare. Les dates s'entendent dans
 * le fuseau de celui qui regarde ; une vente de 23 h 30 à Paris tombe le bon
 * jour, pas le lendemain parce que le serveur compte en UTC.
 *
 * La comparaison se cale sur la période : la précédente de même longueur,
 * ou les mêmes dates l'an dernier. Les points se comparent rang par rang — le
 * troisième jour avec le troisième jour — comme sur Shopify.
 *
 * Tout ici est pur : ni base ni réseau, testé seul.
 */

export const GRAINS = ['heure', 'jour', 'semaine', 'mois'] as const;
export type Grain = (typeof GRAINS)[number];
export const COMPARAISONS = ['precedente', 'annee', 'aucune'] as const;
export type Comparaison = (typeof COMPARAISONS)[number];

/** Un an et un jour au plus : « 12 derniers mois », année bissextile comprise. */
export const JOURS_MAX = 366;
const FUSEAU_DEFAUT = 'Europe/Paris';
const JOUR_MS = 86_400_000;

export function fuseauValide(fuseau: string | undefined): string {
  if (!fuseau) return FUSEAU_DEFAUT;
  try {
    new Intl.DateTimeFormat('fr-FR', { timeZone: fuseau });
    return fuseau;
  } catch {
    return FUSEAU_DEFAUT;
  }
}

/* ------------------------------------------------------------ dates ---- */

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Une date du calendrier, sans heure ni fuseau, en jours depuis 1970. */
function numeroJour(date: string): number {
  const [, a, m, j] = DATE.exec(date) ?? [];
  return Date.UTC(Number(a), Number(m) - 1, Number(j)) / JOUR_MS;
}

function dateDuNumero(numero: number): string {
  return new Date(numero * JOUR_MS).toISOString().slice(0, 10);
}

export function ajouterJours(date: string, n: number): string {
  return dateDuNumero(numeroJour(date) + n);
}

/** Du premier au dernier jour, tous deux compris. */
export function joursEntre(debut: string, fin: string): number {
  return numeroJour(fin) - numeroJour(debut) + 1;
}

/** Les mêmes dates un an plus tôt ; le 29 février devient le 28. */
export function anneePrecedente(date: string): string {
  return decalerAnnee(date, -1);
}

function decalerAnnee(date: string, n: number): string {
  const [, a, m, j] = DATE.exec(date) ?? [];
  const annee = Number(a) + n;
  const dernier = new Date(Date.UTC(annee, Number(m), 0)).getUTCDate();
  return `${annee}-${m}-${String(Math.min(Number(j), dernier)).padStart(2, '0')}`;
}

/* ------------------------------------------------------------ fuseau --- */

const formats = new Map<string, Intl.DateTimeFormat>();
function format(fuseau: string): Intl.DateTimeFormat {
  let f = formats.get(fuseau);
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', {
      timeZone: fuseau,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
    formats.set(fuseau, f);
  }
  return f;
}

/**
 * L'écart entre l'heure locale et l'heure UTC, à cet instant.
 *
 * Mémorisé par quart d'heure — tous les fuseaux du monde changent d'heure sur
 * un quart d'heure rond : deux mille commandes et autant de messages tombent
 * dans quelques centaines de quarts d'heure, et `formatToParts` coûte.
 */
const decalages = new Map<string, number>();
function decalage(instant: number, fuseau: string): number {
  const quart = Math.floor(instant / 900_000) * 900_000;
  const cle = `${fuseau}|${quart}`;
  let ecart = decalages.get(cle);
  if (ecart === undefined) {
    const p = Object.fromEntries(format(fuseau).formatToParts(new Date(quart)).map((x) => [x.type, x.value]));
    ecart = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour) % 24, Number(p.minute)) - quart;
    if (decalages.size > 50_000) decalages.clear();
    decalages.set(cle, ecart);
  }
  return ecart;
}

/** La date et l'heure locales d'un instant. */
export function local(instant: number, fuseau: string): { date: string; heure: number } {
  const mur = new Date(instant + decalage(instant, fuseau));
  return { date: mur.toISOString().slice(0, 10), heure: mur.getUTCHours() };
}

/** L'instant où commence ce jour-là dans ce fuseau (minuit local). */
export function minuitLocal(date: string, fuseau: string): number {
  const naif = numeroJour(date) * JOUR_MS;
  // Deux passes : la seconde corrige un changement d'heure entre les deux.
  const approche = naif - decalage(naif, fuseau);
  return naif - decalage(approche, fuseau);
}

/* ------------------------------------------------------------ points --- */

/** Le point d'un instant : `2026-10-16T14`, `2026-10-16`, le lundi `2026-10-12`, `2026-10`. */
export function cleDe(instant: number, grain: Grain, fuseau: string): string {
  const { date, heure } = local(instant, fuseau);
  return cleLocale(date, heure, grain);
}

function cleLocale(date: string, heure: number, grain: Grain): string {
  if (grain === 'heure') return `${date}T${String(heure).padStart(2, '0')}`;
  if (grain === 'jour') return date;
  if (grain === 'mois') return date.slice(0, 7);
  return lundi(date);
}

function lundi(date: string): string {
  const n = numeroJour(date);
  const jourSemaine = new Date(n * JOUR_MS).getUTCDay(); // 0 = dimanche
  return dateDuNumero(n - ((jourSemaine + 6) % 7));
}

/** Tous les points de la période, dans l'ordre, y compris ceux sans rien. */
export function points(debut: string, fin: string, grain: Grain): string[] {
  const cles: string[] = [];
  const vus = new Set<string>();
  for (let n = numeroJour(debut); n <= numeroJour(fin); n += 1) {
    const date = dateDuNumero(n);
    if (grain === 'heure') {
      for (let h = 0; h < 24; h += 1) cles.push(`${date}T${String(h).padStart(2, '0')}`);
      continue;
    }
    const cle = grain === 'jour' ? date : grain === 'mois' ? date.slice(0, 7) : lundi(date);
    if (!vus.has(cle)) {
      vus.add(cle);
      cles.push(cle);
    }
  }
  return cles;
}

/** Le début d'un point, borné à celui de la période. */
function debutDuPoint(cle: string, grain: Grain, fuseau: string, debutPeriode: number): number {
  if (grain === 'heure') return minuitLocal(cle.slice(0, 10), fuseau) + Number(cle.slice(11)) * 3_600_000;
  const date = grain === 'mois' ? `${cle}-01` : cle;
  return Math.max(minuitLocal(date, fuseau), debutPeriode);
}

/** Le regroupement par défaut : à l'heure sur un jour, au mois sur un an. */
export function grainParDefaut(jours: number): Grain {
  if (jours <= 1) return 'heure';
  if (jours <= 31) return 'jour';
  if (jours <= 120) return 'semaine';
  return 'mois';
}

/** Par heure, une semaine au plus : au-delà, des centaines de barres illisibles. */
export function grainPermis(grain: Grain, jours: number): Grain {
  return grain === 'heure' && jours > 7 ? 'jour' : grain;
}

/* ------------------------------------------------------------ période -- */

export interface Plage {
  debut: string;
  fin: string;
  /** Minuit local du premier jour, et du lendemain du dernier (exclu). */
  depuis: Date;
  avant: Date;
  /**
   * Les points. Pour la comparaison, ceux d'en face, rang pour rang : le
   * point i de la comparaison est celui de la période décalé d'autant.
   */
  cles: string[];
  /** Les points pas encore commencés : rien à y compter, pas un zéro. */
  futurs: Set<string>;
}

export interface Periode {
  jours: number;
  grain: Grain;
  fuseau: string;
  comparer: Comparaison;
  courante: Plage;
  comparee: Plage | null;
}

export const schemaPeriode = z.object({
  debut: z.string().regex(DATE),
  fin: z.string().regex(DATE),
  comparer: z.enum(COMPARAISONS).default('precedente'),
  grain: z.enum(GRAINS).optional(),
  tz: z.string().max(64).optional(),
});

function plage(debut: string, fin: string, grain: Grain, fuseau: string, maintenant: number): Plage {
  const depuis = minuitLocal(debut, fuseau);
  const cles = points(debut, fin, grain);
  return {
    debut,
    fin,
    depuis: new Date(depuis),
    avant: new Date(minuitLocal(ajouterJours(fin, 1), fuseau)),
    cles,
    futurs: new Set(cles.filter((cle) => debutDuPoint(cle, grain, fuseau, depuis) > maintenant)),
  };
}

/**
 * La période demandée, ou une erreur lisible.
 *
 * La fin ne dépasse pas aujourd'hui (dans le fuseau de celui qui regarde) ;
 * la période ne dépasse pas un an et un jour.
 */
export function lirePeriode(
  brut: unknown,
  maintenant = Date.now(),
): { ok: true; periode: Periode } | { ok: false; erreur: string } {
  const parsed = schemaPeriode.safeParse(brut);
  if (!parsed.success) return { ok: false, erreur: 'Paramètres invalides' };
  const { debut, comparer } = parsed.data;
  const fuseau = fuseauValide(parsed.data.tz);
  const aujourdhui = local(maintenant, fuseau).date;
  const fin = parsed.data.fin > aujourdhui ? aujourdhui : parsed.data.fin;
  const jours = joursEntre(debut, fin);
  if (jours < 1) return { ok: false, erreur: 'La période se termine avant de commencer.' };
  if (jours > JOURS_MAX) return { ok: false, erreur: 'Un an au plus.' };

  const grain = grainPermis(parsed.data.grain ?? grainParDefaut(jours), jours);
  const courante = plage(debut, fin, grain, fuseau, maintenant);
  const reculer = comparer === 'annee' ? anneePrecedente : (date: string) => ajouterJours(date, -jours);
  const comparee =
    comparer === 'aucune'
      ? null
      : {
          ...plage(reculer(debut), reculer(fin), grain, fuseau, maintenant),
          // En face de chaque point de la période, le même décalé : la
          // semaine du 4 août 2025 face à celle du 3 août 2026, et non la
          // première semaine de chaque plage, qui ne commencent pas le même
          // jour de la semaine.
          cles: courante.cles.map((cle) => {
            if (grain === 'heure') return `${reculer(cle.slice(0, 10))}${cle.slice(10)}`;
            if (grain === 'mois') return reculer(`${cle}-01`).slice(0, 7);
            return reculer(cle);
          }),
          futurs: new Set<string>(),
        };

  return { ok: true, periode: { jours, grain, fuseau, comparer, courante, comparee } };
}

/** Ce que l'écran a besoin de savoir de la période, sans les dates internes. */
export function resumePeriode(periode: Periode) {
  const vue = (p: Plage) => ({ debut: p.debut, fin: p.fin, cles: p.cles });
  return {
    jours: periode.jours,
    grain: periode.grain,
    fuseau: periode.fuseau,
    comparer: periode.comparer,
    courante: vue(periode.courante),
    comparee: periode.comparee ? vue(periode.comparee) : null,
  };
}

/* ------------------------------------------------------------ séries --- */

/** Une série vide, un zéro par point, `null` aux points pas encore commencés. */
export function serieVide(p: { cles: string[]; futurs: Set<string> }): Array<number | null> {
  return p.cles.map((cle) => (p.futurs.has(cle) ? null : 0));
}

/** La place d'un instant dans la série, ou -1 s'il tombe hors de la période. */
export function indexeur(p: Plage, grain: Grain, fuseau: string): (instant: number) => number {
  const rang = new Map(p.cles.map((cle, i) => [cle, i]));
  return (instant) => {
    if (instant < p.depuis.getTime() || instant >= p.avant.getTime()) return -1;
    return rang.get(cleDe(instant, grain, fuseau)) ?? -1;
  };
}

/**
 * La place d'un instant de la comparaison : celle du point de la période où
 * il tombe une fois avancé d'autant (de la longueur de la période, ou d'un
 * an). Les deux séries ont ainsi la même longueur et se lisent rang pour rang.
 */
export function indexeurCompare(periode: Periode): (instant: number) => number {
  const { courante, comparee, grain, fuseau, comparer, jours } = periode;
  if (!comparee) return () => -1;
  const rang = new Map(courante.cles.map((cle, i) => [cle, i]));
  const avancer = comparer === 'annee' ? (date: string) => decalerAnnee(date, 1) : (date: string) => ajouterJours(date, jours);
  return (instant) => {
    if (instant < comparee.depuis.getTime() || instant >= comparee.avant.getTime()) return -1;
    const { date, heure } = local(instant, fuseau);
    return rang.get(cleLocale(avancer(date), heure, grain)) ?? -1;
  };
}

/** De quoi ranger une série : ses points, ceux à venir, et la place d'un instant. */
export interface Cadre {
  cles: string[];
  futurs: Set<string>;
  place: (instant: number) => number;
}

export function cadres(periode: Periode): { courant: Cadre; compare: Cadre | null } {
  const { courante, comparee, grain, fuseau } = periode;
  return {
    courant: { cles: courante.cles, futurs: courante.futurs, place: indexeur(courante, grain, fuseau) },
    compare: comparee ? { cles: comparee.cles, futurs: comparee.futurs, place: indexeurCompare(periode) } : null,
  };
}

export function mediane(valeurs: number[]): number | null {
  if (valeurs.length === 0) return null;
  const tries = [...valeurs].sort((a, b) => a - b);
  return tries[Math.floor(tries.length / 2)]!;
}
