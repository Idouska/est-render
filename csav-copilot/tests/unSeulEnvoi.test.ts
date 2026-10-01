import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

/*
 * Un message ne part qu'une fois.
 *
 * CE QUE CES TESTS PROTÈGENT. L'envoi d'une réponse vérifiait que le brouillon
 * n'était pas parti, appelait Gmail, puis seulement le marquait envoyé. Deux
 * requêtes rapprochées — un double clic, Cmd+Entrée répété, deux onglets —
 * passaient toutes les deux la vérification : le client recevait la même
 * réponse deux fois, le fournisseur la même notification deux fois.
 *
 * Les tests EXÉCUTENT l'envoi, deux fois à la fois, contre une base simulée
 * qui se comporte comme Postgres sur une ligne : une écriture conditionnelle
 * relit sa condition au moment d'écrire, et deux écritures ne s'entrelacent
 * pas. Gmail est lent exprès — c'est pendant son appel que le second envoi
 * arrive.
 */

process.env.ENCRYPTION_KEY ??= randomBytes(32).toString('base64');
process.env.APP_URL ??= 'https://example.test';
process.env.DATABASE_URL ??= 'postgresql://u:p@localhost:5432/db';
process.env.REDIS_URL ??= 'redis://localhost:6379';
process.env.SHOPIFY_API_KEY ??= 'key';
process.env.SHOPIFY_API_SECRET ??= 'secret';
process.env.SHOPIFY_SCOPES ??= 'read_orders';
process.env.GOOGLE_CLIENT_ID ??= 'client';
process.env.GOOGLE_CLIENT_SECRET ??= 'secret';
process.env.GOOGLE_SCOPES ??= 'https://www.googleapis.com/auth/gmail.readonly';
process.env.GOOGLE_PUBSUB_TOPIC ??= 'projects/p/topics/t';
process.env.GOOGLE_PUBSUB_SERVICE_ACCOUNT ??= 'sa@p.iam.gserviceaccount.com';

const { envoyerBrouillon } = await import('../src/services/tickets/envoyerBrouillon.ts');
const { sendEscalation } = await import('../src/services/suppliers/escalate.ts');
const { BAIL_ENVOI_MS } = await import('../src/services/envoi/uneSeuleFois.ts');

const lire = (chemin: string) =>
  readFileSync(fileURLToPath(new URL(`../${chemin}`, import.meta.url)), 'utf8');

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/* ------------------------------------------------ une base, en mémoire --- */

type Ligne = Record<string, unknown>;

/**
 * Une condition Prisma, évaluée sur une ligne. Seules les formes que l'envoi
 * emploie sont connues ; toute autre fait échouer le test plutôt que de
 * répondre « vrai » sans l'avoir comprise.
 */
function correspond(ligne: Ligne, where: Ligne): boolean {
  return Object.entries(where).every(([cle, condition]) => {
    if (cle === 'OR') return (condition as Ligne[]).some((sous) => correspond(ligne, sous));
    const valeur = ligne[cle] ?? null;
    if (condition === null) return valeur === null;
    if (condition instanceof Date) return valeur instanceof Date && valeur.getTime() === condition.getTime();
    if (typeof condition === 'object') {
      const c = condition as Ligne;
      if ('not' in c) return valeur !== c.not;
      if ('lt' in c) return valeur instanceof Date && valeur < (c.lt as Date);
      throw new Error(`condition non simulée : ${cle} ${JSON.stringify(condition)}`);
    }
    return valeur === condition;
  });
}

function table(lignes: Ligne[]) {
  const trouver = (where: Ligne) => lignes.find((ligne) => correspond(ligne, where)) ?? null;
  const extraire = (ligne: Ligne | null, select?: Record<string, boolean>) =>
    ligne && select ? Object.fromEntries(Object.keys(select).map((k) => [k, ligne[k]])) : ligne;

  return {
    lignes,
    // Une latence avant d'atteindre la base, puis la lecture et l'écriture
    // d'un seul tenant : rien ne s'intercale entre les deux, comme sur une
    // ligne verrouillée par Postgres.
    async findFirst({ where, select }: { where: Ligne; select?: Record<string, boolean> }) {
      await pause(1);
      return extraire(trouver(where), select);
    },
    async findFirstOrThrow({ where }: { where: Ligne }) {
      await pause(1);
      const ligne = trouver(where);
      if (!ligne) throw new Error('introuvable');
      return ligne;
    },
    async findUniqueOrThrow({ where }: { where: Ligne }) {
      return this.findFirstOrThrow({ where });
    },
    async updateMany({ where, data }: { where: Ligne; data: Ligne }) {
      await pause(1);
      const prises = lignes.filter((ligne) => correspond(ligne, where));
      for (const ligne of prises) Object.assign(ligne, data);
      return { count: prises.length };
    },
    async update({ where, data }: { where: Ligne; data: Ligne }) {
      await pause(1);
      const ligne = trouver(where);
      if (!ligne) throw new Error('introuvable');
      return Object.assign(ligne, data);
    },
  };
}

/* ----------------------------------------------- la réponse au client --- */

function scene(brouillon: Ligne = {}, lectureEnRetard: Ligne | null = null) {
  const ticket = {
    id: 't1', merchantId: 'm1', mailboxId: null, gmailThreadId: 'th1',
    customerEmail: 'lea@example.com', subject: 'Ma commande', status: 'NEW',
  };
  const draft = {
    id: 'd1', merchantId: 'm1', ticketId: 't1', gmailDraftId: null,
    body: 'Bonjour Léa', status: 'PENDING_REVIEW', sentAt: null, sendStartedAt: null,
    ...brouillon,
  };
  const envois: string[] = [];
  let echecs = 0;
  let pendantLEchec: (() => void) | null = null;

  const prisma = {
    draft: table([draft]),
    ticket: table([ticket]),
    message: { findFirst: async () => ({ gmailMessageId: 'g-in' }) },
    $transaction: (operations: Promise<unknown>[]) => Promise.all(operations),
  };
  // Les lignes partagent leur ticket, comme un `include`.
  const findFirst = prisma.draft.findFirst.bind(prisma.draft);
  prisma.draft.findFirst = async (args) => {
    const ligne = await findFirst(args);
    // La première lecture peut dater d'avant la fin d'un autre envoi.
    if (ligne && !args.select && lectureEnRetard) {
      const perimee = { ...ligne, ...lectureEnRetard, ticket };
      lectureEnRetard = null;
      return perimee;
    }
    return ligne && !args.select ? { ...ligne, ticket } : ligne;
  };

  const deps = {
    prisma,
    sendDraft: async () => {
      throw new Error('pas de brouillon Gmail hérité dans ces tests');
    },
    sendReplyInThread: async (params: { to: string }) => {
      if (echecs > 0) {
        echecs -= 1;
        pendantLEchec?.();
        throw new Error('Gmail indisponible');
      }
      await pause(30); // l'appel réseau, pendant lequel le second clic arrive
      envois.push(params.to);
      return { gmailMessageId: `g-out-${envois.length}`, fromEmail: 'sav@boutique.test' };
    },
    recordOutbound: async () => {},
    recordAudit: async () => {},
  };

  const envoyer = () =>
    envoyerBrouillon({ draftId: 'd1', merchantId: 'm1', userId: 'u1' }, deps as never);

  const echouerUneFois = (pendant: (() => void) | null = null) => {
    echecs = 1;
    pendantLEchec = pendant;
  };

  return { draft, ticket, envois, envoyer, echouerUneFois };
}

test('deux clics à la fois : une seule réponse part', async () => {
  const s = scene();
  const issues = await Promise.all([s.envoyer(), s.envoyer()]);

  assert.deepEqual(issues.sort(), ['en-cours', 'envoye']);
  assert.deepEqual(s.envois, ['lea@example.com'], 'un seul appel à Gmail');
  assert.equal(s.draft.status, 'SENT');
  assert.equal(s.draft.sendStartedAt, null, 'la place est rendue à la confirmation');
  assert.equal(s.ticket.status, 'CLOSED');
});

test('trois onglets à la fois : toujours une seule', async () => {
  const s = scene();
  const issues = await Promise.all([s.envoyer(), s.envoyer(), s.envoyer()]);
  assert.equal(issues.filter((issue) => issue === 'envoye').length, 1);
  assert.equal(s.envois.length, 1);
});

test('un second clic après coup : « déjà envoyé », rien ne repart', async () => {
  const s = scene();
  assert.equal(await s.envoyer(), 'envoye');
  assert.equal(await s.envoyer(), 'deja-envoye');
  assert.equal(s.envois.length, 1);
});

test('Gmail refuse : rien n’est marqué, la place est rendue, le nouvel essai part', async () => {
  const s = scene();
  s.echouerUneFois();

  await assert.rejects(s.envoyer(), /Gmail indisponible/);
  assert.equal(s.draft.status, 'PENDING_REVIEW');
  assert.equal(s.draft.sendStartedAt, null, 'sans quoi le brouillon resterait bloqué');
  assert.equal(s.ticket.status, 'NEW');

  assert.equal(await s.envoyer(), 'envoye');
  assert.equal(s.envois.length, 1);
});

test('un envoi interrompu bloque le brouillon le temps du bail, pas plus', async () => {
  // Le serveur est tombé pendant l'appel à Gmail : la place est restée posée.
  const recente = scene({ sendStartedAt: new Date(Date.now() - 30_000) });
  assert.equal(await recente.envoyer(), 'en-cours');
  assert.equal(recente.envois.length, 0, 'un envoi peut-être en route : on ne double pas');

  const expiree = scene({ sendStartedAt: new Date(Date.now() - BAIL_ENVOI_MS - 1_000) });
  assert.equal(await expiree.envoyer(), 'envoye');
  assert.equal(expiree.envois.length, 1);
});

test('la lecture a vu « pas encore envoyé », mais l’autre envoi a fini depuis : rien ne repart', async () => {
  // Le premier envoi s'est achevé — statut SENT, place rendue — entre la
  // lecture du second et sa prise. Seule la condition de statut, dans la
  // prise elle-même, l'arrête : la place est libre.
  const s = scene({ status: 'SENT', sentAt: new Date() }, { status: 'PENDING_REVIEW' });
  assert.equal(await s.envoyer(), 'deja-envoye');
  assert.equal(s.envois.length, 0);
});

test('un envoi plus lent que le bail ne rend pas la place d’un autre', async () => {
  // Pendant notre appel, le bail a expiré et un autre envoi a pris la place.
  // Notre échec ne doit pas la lui retirer : il est peut-être en route.
  const s = scene();
  // Une autre prise arrive au moins un bail après la nôtre : sa date diffère.
  const autre = new Date(Date.now() + BAIL_ENVOI_MS);
  s.echouerUneFois(() => (s.draft.sendStartedAt = autre));

  await assert.rejects(s.envoyer(), /Gmail indisponible/);
  assert.equal(s.draft.sendStartedAt, autre);
});

test('le brouillon d’une autre boutique n’est ni lu ni pris', async () => {
  const s = scene({ merchantId: 'autre' });
  assert.equal(await s.envoyer(), 'introuvable');
  assert.equal(s.draft.sendStartedAt, null);
  assert.equal(s.envois.length, 0);
});

/* ---------------------------------------- la notification fournisseur --- */

function sceneEscalade(escalade: Ligne = {}) {
  const ligne = {
    id: 'e1', merchantId: 'm1', ticketId: 't1', status: 'DRAFTING', reason: 'OTHER',
    note: null, notifiedAt: null, sendStartedAt: null,
    supplier: { name: 'Atelier', contactEmail: 'atelier@example.com' },
    ticket: { orderName: '#1001' },
    ...escalade,
  };
  const envois: string[] = [];
  let echecs = 0;

  const deps = {
    prisma: {
      supplierEscalation: table([ligne]),
      ticket: table([{ id: 't1', status: 'NEW' }]),
      merchant: table([{ id: 'm1', name: 'Boutique', brandName: null, shopDomain: 'b.myshopify.com', emailSignature: null }]),
      $transaction: (operations: Promise<unknown>[]) => Promise.all(operations),
    },
    sendPlainEmail: async (params: { to: string }) => {
      if (echecs > 0) {
        echecs -= 1;
        throw new Error('Gmail indisponible');
      }
      await pause(30);
      envois.push(params.to);
      return { gmailMessageId: null, fromEmail: 'sav@boutique.test' };
    },
    recordAudit: async () => {},
  };

  const envoyer = () =>
    sendEscalation({ merchantId: 'm1', escalationId: 'e1', userId: 'u1' }, deps as never);

  return { ligne, envois, envoyer, prisma: deps.prisma, echouerUneFois: () => (echecs = 1) };
}

test('escalade : deux clics à la fois, le fournisseur n’est notifié qu’une fois', async () => {
  const s = sceneEscalade();
  const issues = await Promise.all([s.envoyer(), s.envoyer()]);

  assert.deepEqual(issues.sort(), ['en-cours', 'envoye']);
  assert.deepEqual(s.envois, ['atelier@example.com']);
  assert.equal(s.ligne.status, 'OPEN');
  assert.equal(s.ligne.sendStartedAt, null);
  assert.equal(await s.envoyer(), 'deja-envoye');
  assert.equal(s.envois.length, 1);
});

test('escalade : Gmail refuse, la place est rendue et le nouvel essai part', async () => {
  const s = sceneEscalade();
  s.echouerUneFois();

  await assert.rejects(s.envoyer(), /Gmail indisponible/);
  assert.equal(s.ligne.status, 'DRAFTING');
  assert.equal(s.ligne.sendStartedAt, null);

  assert.equal(await s.envoyer(), 'envoye');
  assert.equal(s.envois.length, 1);
});

test('escalade : la lecture a vu DRAFTING, l’autre envoi a fini depuis — rien ne repart', async () => {
  const s = sceneEscalade({ status: 'OPEN' });
  // La lecture du service date d'avant la fin de l'autre envoi.
  const lire = s.prisma.supplierEscalation.findFirstOrThrow.bind(s.prisma.supplierEscalation);
  let premiere = true;
  s.prisma.supplierEscalation.findFirstOrThrow = async (args) => {
    const ligne = await lire(args);
    if (!premiere) return ligne;
    premiere = false;
    return { ...ligne, status: 'DRAFTING' };
  };

  assert.equal(await s.envoyer(), 'deja-envoye');
  assert.equal(s.envois.length, 0);
});

test('escalade : une notification interrompue attend la fin du bail', async () => {
  const s = sceneEscalade({ sendStartedAt: new Date(Date.now() - 5_000) });
  assert.equal(await s.envoyer(), 'en-cours');
  assert.equal(s.envois.length, 0);
});

/* ------------------------------------------- aucune autre porte de sortie */

const sansCommentaires = (code: string) =>
  code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/[^\n]*/gm, '');

test('les routes passent par les services verrouillés, et disent 409 au perdant', () => {
  // Une réponse envoyée directement depuis la route contournerait le verrou :
  // la route n'appelle plus Gmail elle-même.
  const tickets = sansCommentaires(lire('src/routes/tickets.ts'));
  assert.doesNotMatch(tickets, /\b(sendReplyInThread|sendDraft)\(/);
  assert.match(tickets, /await envoyerBrouillon\(/);
  assert.match(tickets, /issue !== 'envoye'\) return reply\.code\(409\)/);

  const fournisseurs = sansCommentaires(lire('src/routes/suppliers.ts'));
  assert.match(fournisseurs, /const issue = await sendEscalation\(/);
  assert.match(fournisseurs, /issue === 'en-cours'\) return reply\.code\(409\)/);
});

/* -------------------------------------------------- le bouton, à l'écran */

/** Une fonction d'app.js, de sa signature à l'accolade qui la ferme. */
function fonctionDeLApp(signature: string): string {
  const app = lire('public/app.js');
  const debut = app.indexOf(signature);
  assert.ok(debut > 0, `introuvable : ${signature}`);
  const fin = app.indexOf('\n}\n', debut);
  assert.ok(fin > debut);
  return app.slice(debut, fin + 2);
}

function boutonSimule(libelle: string) {
  const attributs = new Map<string, string>();
  return {
    disabled: false,
    textContent: libelle,
    setAttribute: (nom: string, valeur: string) => void attributs.set(nom, valeur),
    removeAttribute: (nom: string) => void attributs.delete(nom),
    occupe: () => attributs.get('aria-busy') === 'true',
  };
}

function ecranReponse(options: { envoiEchoue?: boolean; relectureEchoue?: boolean } = {}) {
  const bouton = boutonSimule('Envoyer la réponse');
  const appels: { chemin: string; ferme: boolean; libelle: string; occupe: boolean }[] = [];
  const toasts: string[] = [];

  const doublures = {
    state: { currentId: 't1', detail: { ticket: { drafts: [{ id: 'd1', body: 'Bonjour' }] } } },
    $: (id: string) => (id === 'btn-send' ? bouton : { value: 'Bonjour' }),
    api: async (chemin: string) => {
      appels.push({ chemin, ferme: bouton.disabled, libelle: bouton.textContent, occupe: bouton.occupe() });
      await pause(20);
      if (options.envoiEchoue && chemin.endsWith('/send')) throw new Error('Gmail indisponible');
      return { ok: true };
    },
    toast: (texte: string) => void toasts.push(texte),
    selectTicket: async () => {
      if (options.relectureEchoue) throw new Error('Réseau coupé');
      // La fiche relue remet le bouton dans son état d'après envoi.
      bouton.disabled = true;
      bouton.textContent = 'Réponse envoyée';
    },
    loadMetrics: async () => {},
    loadAudit: async () => {},
  };

  const source = `${fonctionDeLApp('function fermerPendantLEnvoi(')}\n${fonctionDeLApp('async function envoyerLaReponse(')}`;
  const envoyerLaReponse = new Function(...Object.keys(doublures), `${source}\nreturn envoyerLaReponse;`)(
    ...Object.values(doublures),
  ) as () => Promise<void>;

  return { bouton, appels, toasts, envoyerLaReponse };
}

test('le bouton se ferme dès le clic et dit qu’il envoie ; un second clic ne part pas', async () => {
  const e = ecranReponse();
  await Promise.all([e.envoyerLaReponse(), e.envoyerLaReponse()]);

  const envois = e.appels.filter((appel) => appel.chemin.endsWith('/send'));
  assert.equal(envois.length, 1, 'une seule requête d’envoi');
  assert.deepEqual(
    { ferme: envois[0]?.ferme, libelle: envois[0]?.libelle, occupe: envois[0]?.occupe },
    { ferme: true, libelle: 'Envoi…', occupe: true },
    'fermé et parlant AVANT la requête',
  );
  assert.equal(e.bouton.textContent, 'Réponse envoyée');
  assert.equal(e.bouton.occupe(), false);
});

test('rien n’est parti : le bouton revient, pour réessayer', async () => {
  const e = ecranReponse({ envoiEchoue: true });
  await e.envoyerLaReponse();

  assert.deepEqual(
    { ferme: e.bouton.disabled, libelle: e.bouton.textContent, occupe: e.bouton.occupe() },
    { ferme: false, libelle: 'Envoyer la réponse', occupe: false },
  );
  assert.deepEqual(e.toasts, ['Gmail indisponible']);
});

test('parti, mais la fiche n’a pas pu être relue : le bouton reste fermé et le dit', async () => {
  const e = ecranReponse({ relectureEchoue: true });
  await e.envoyerLaReponse();

  assert.equal(e.bouton.disabled, true, 'un bouton rouvert inviterait à renvoyer');
  assert.equal(e.bouton.textContent, 'Réponse envoyée');
  assert.equal(e.bouton.occupe(), false);
});

test('les deux envois d’escalade se ferment aussi pendant l’envoi', async () => {
  for (const [signature, appel] of [
    ['async function sendEscalation(', (f: Function, b: unknown) => f('t1', 'e1', b)],
    ['async function envoyerEscalade(', (f: Function, b: unknown) => f({ id: 'e1' }, b)],
  ] as const) {
    const bouton = boutonSimule('Envoyer');
    const envois: string[] = [];
    const doublures = {
      document: { querySelector: () => null },
      api: async (chemin: string) => {
        if (chemin.endsWith('/send')) envois.push(chemin);
        await pause(20);
        return {};
      },
      toast: () => {},
      loadAudit: async () => {},
      selectTicket: async () => {},
      loadRuptures: async () => {},
    };
    const source = `${fonctionDeLApp('function fermerPendantLEnvoi(')}\n${fonctionDeLApp(signature)}`;
    const nom = signature.replace('async function ', '').replace('(', '');
    const fonction = new Function(...Object.keys(doublures), `${source}\nreturn ${nom};`)(
      ...Object.values(doublures),
    );

    await Promise.all([appel(fonction, bouton), appel(fonction, bouton)]);
    assert.equal(envois.length, 1, `${nom} : une seule requête`);
  }

  // Et chaque bouton est bien passé à sa fonction.
  const app = sansCommentaires(lire('public/app.js'));
  assert.match(app, /sendEscalation\(ticketId, button\.dataset\.id, button\)/);
  assert.match(app, /faire: \(bouton\) => void envoyerEscalade\(d, bouton\)/);
  assert.match(app, /geste\.faire\(bouton\)/);
});
