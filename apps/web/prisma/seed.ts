import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { join } from 'path';
import * as schema from '../src/lib/schema';
import { randomUUID } from 'crypto';
import bcrypt from 'bcryptjs';

const sqlite = new Database(join(__dirname, 'dev.db'));
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');
const db = drizzle(sqlite, { schema });

async function seed() {
  const now = new Date().toISOString();
  const tenantId = randomUUID();

  await db.insert(schema.tenants).values({
    id: tenantId,
    name: 'Démo Boutique',
    slug: 'demo-boutique',
    plan: 'PRO',
    createdAt: now,
    updatedAt: now,
  }).onConflictDoNothing();

  const userId = randomUUID();
  const hashedPw = bcrypt.hashSync('demo1234', 12);
  await db.insert(schema.users).values({
    id: userId,
    email: 'demo@supporthub.io',
    name: 'Sophie Martin',
    password: hashedPw,
    role: 'OWNER',
    tenantId,
    createdAt: now,
    updatedAt: now,
  }).onConflictDoNothing();

  const cannedItems = [
    {
      title: 'Retard de livraison',
      category: 'delivery',
      content: "Bonjour,\n\nNous avons bien pris note de votre message concernant votre commande. Suite à un volume élevé de commandes, des délais supplémentaires peuvent être constatés. Votre colis est en chemin et devrait vous parvenir sous 2-3 jours ouvrés.\n\nNous vous remercions de votre patience et restons disponibles pour toute question.\n\nCordialement,\nL'équipe SAV",
    },
    {
      title: 'Accusé de réception',
      category: 'other',
      content: "Bonjour,\n\nNous avons bien reçu votre message et nous en prenons bonne note. Notre équipe va traiter votre demande dans les meilleurs délais et vous répondra sous 24h ouvrées.\n\nCordialement,\nL'équipe SAV",
    },
    {
      title: 'Procédure de retour',
      category: 'return',
      content: "Bonjour,\n\nPour effectuer un retour, voici la procédure :\n1. Emballez le produit dans son emballage d'origine\n2. Joignez le bon de retour disponible dans votre espace client\n3. Déposez le colis en point relais ou bureau de poste\n\nUne fois le retour réceptionné, le remboursement sera effectué sous 5-7 jours ouvrés.\n\nCordialement,\nL'équipe SAV",
    },
    {
      title: 'Confirmation de remboursement',
      category: 'refund',
      content: "Bonjour,\n\nNous confirmons que votre remboursement de [MONTANT] a été initié. Il apparaîtra sur votre relevé bancaire sous 5-7 jours ouvrés selon votre banque.\n\nNous nous excusons pour la gêne occasionnée et vous remercions de votre compréhension.\n\nCordialement,\nL'équipe SAV",
    },
  ];

  for (const item of cannedItems) {
    await db.insert(schema.cannedResponses).values({
      id: randomUUID(),
      ...item,
      tenantId,
      createdAt: now,
      updatedAt: now,
    }).onConflictDoNothing();
  }

  const customerData = [
    { email: 'marie.dupont@email.fr', firstName: 'Marie', lastName: 'Dupont', phone: '0612345678' },
    { email: 'jean.bernard@email.fr', firstName: 'Jean', lastName: 'Bernard', phone: '0698765432' },
    { email: 'alice.martin@email.fr', firstName: 'Alice', lastName: 'Martin', phone: null },
  ];

  const customerIds = customerData.map(() => randomUUID());

  for (let i = 0; i < customerData.length; i++) {
    await db.insert(schema.customers).values({
      id: customerIds[i],
      ...customerData[i],
      tenantId,
      createdAt: now,
      updatedAt: now,
    }).onConflictDoNothing();
  }

  const order1Id = randomUUID();
  const order2Id = randomUUID();

  await db.insert(schema.orders).values({
    id: order1Id,
    externalId: 'demo-001',
    orderNumber: '1042',
    status: 'paid',
    total: 89.99,
    currency: 'EUR',
    platform: 'shopify',
    customerId: customerIds[0],
    tenantId,
    createdAt: now,
    updatedAt: now,
  }).onConflictDoNothing();

  await db.insert(schema.orderItems).values([
    { id: randomUUID(), orderId: order1Id, name: 'T-shirt Premium Blanc', sku: 'TSH-001-WH', quantity: 2, price: 29.99 },
    { id: randomUUID(), orderId: order1Id, name: 'Casquette Logo', sku: 'CAP-BLK-01', quantity: 1, price: 30.01 },
  ]);

  await db.insert(schema.orders).values({
    id: order2Id,
    externalId: 'demo-002',
    orderNumber: '5821',
    status: 'processing',
    total: 145.50,
    currency: 'EUR',
    platform: 'woocommerce',
    customerId: customerIds[1],
    tenantId,
    createdAt: now,
    updatedAt: now,
  }).onConflictDoNothing();

  await db.insert(schema.orderItems).values([
    { id: randomUUID(), orderId: order2Id, name: 'Sneakers Edition Limitée', sku: 'SNK-EL-42', quantity: 1, price: 145.50 },
  ]);

  // Ticket 1: Open, high priority
  const t1Id = randomUUID();
  await db.insert(schema.tickets).values({
    id: t1Id,
    subject: "Ma commande #1042 n'est pas encore arrivée",
    status: 'OPEN',
    priority: 'HIGH',
    category: 'delivery',
    customerId: customerIds[0],
    orderId: order1Id,
    tenantId,
    createdAt: now,
    updatedAt: now,
  }).onConflictDoNothing();
  await db.insert(schema.messages).values({
    id: randomUUID(),
    content: "Bonjour, j'ai commandé il y a 10 jours et je n'ai toujours pas reçu mon colis. Pouvez-vous m'aider ?",
    type: 'REPLY',
    isPublic: true,
    ticketId: t1Id,
    senderName: 'Marie Dupont',
    senderEmail: 'marie.dupont@email.fr',
    createdAt: now,
  });

  // Ticket 2: In progress, normal priority
  const t2Id = randomUUID();
  await db.insert(schema.tickets).values({
    id: t2Id,
    subject: 'Je souhaite retourner mes sneakers (mauvaise taille)',
    status: 'IN_PROGRESS',
    priority: 'NORMAL',
    category: 'return',
    customerId: customerIds[1],
    orderId: order2Id,
    agentId: userId,
    tenantId,
    createdAt: now,
    updatedAt: now,
  }).onConflictDoNothing();
  await db.insert(schema.messages).values([
    {
      id: randomUUID(),
      content: "Bonjour, j'ai reçu mes sneakers mais elles sont trop petites. Comment faire pour les échanger ?",
      type: 'REPLY',
      isPublic: true,
      ticketId: t2Id,
      senderName: 'Jean Bernard',
      senderEmail: 'jean.bernard@email.fr',
      createdAt: now,
    },
    {
      id: randomUUID(),
      content: 'Bonjour Jean, je comprends votre situation. Voici la procédure de retour...',
      type: 'REPLY',
      isPublic: true,
      ticketId: t2Id,
      authorId: userId,
      createdAt: now,
    },
  ]);

  // Ticket 3: Waiting, urgent
  const t3Id = randomUUID();
  await db.insert(schema.tickets).values({
    id: t3Id,
    subject: 'Produit défectueux reçu — remboursement souhaité',
    status: 'WAITING',
    priority: 'URGENT',
    category: 'product',
    customerId: customerIds[2],
    tenantId,
    createdAt: now,
    updatedAt: now,
  }).onConflictDoNothing();
  await db.insert(schema.messages).values({
    id: randomUUID(),
    content: "Bonjour, j'ai reçu un produit abîmé. Je joins des photos. Je souhaite un remboursement immédiat.",
    type: 'REPLY',
    isPublic: true,
    ticketId: t3Id,
    senderName: 'Alice Martin',
    senderEmail: 'alice.martin@email.fr',
    createdAt: now,
  });

  console.log('✓ Seed terminé.');
  console.log('  Email  : demo@supporthub.io');
  console.log('  Pass   : demo1234');
  sqlite.close();
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
