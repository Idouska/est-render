import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { z } from 'zod';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import * as schema from '@/lib/schema';
import { eq, and, or, like, desc, count, inArray } from 'drizzle-orm';
import { randomUUID } from 'crypto';

const createSchema = z.object({
  subject: z.string().min(1),
  customerEmail: z.string().email(),
  customerName: z.string().optional(),
  orderNumber: z.string().optional(),
  priority: z.enum(['LOW', 'NORMAL', 'HIGH', 'URGENT']).default('NORMAL'),
  category: z.string().optional(),
  message: z.string().min(1),
});

export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const status = searchParams.get('status');
  const priority = searchParams.get('priority');
  const q = searchParams.get('q');
  const page = Math.max(1, parseInt(searchParams.get('page') ?? '1'));
  const perPage = 20;

  const tenantId = session.user.tenantId;

  const filters = [
    eq(schema.tickets.tenantId, tenantId),
    status ? eq(schema.tickets.status, status) : undefined,
    priority ? eq(schema.tickets.priority, priority) : undefined,
  ].filter(Boolean) as any[];

  const tickets = await db.query.tickets.findMany({
    where: (t, { and: a, eq: e, or: o, like: l }) => {
      const base = a(
        e(t.tenantId, tenantId),
        status ? e(t.status, status) : undefined,
        priority ? e(t.priority, priority) : undefined,
      );
      return base;
    },
    with: {
      customer: { columns: { email: true, firstName: true, lastName: true } },
      agent: { columns: { name: true } },
    },
    orderBy: (t, { desc: d }) => d(t.createdAt),
    limit: perPage,
    offset: (page - 1) * perPage,
  });

  const [{ cnt }] = await db.select({ cnt: count() }).from(schema.tickets)
    .where(and(...filters));

  return NextResponse.json({ tickets, total: cnt, page, pages: Math.ceil(Number(cnt) / perPage) });
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });

  const body = await req.json();
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Données invalides.' }, { status: 400 });
  }

  const { subject, customerEmail, customerName, orderNumber, priority, category, message } = parsed.data;
  const tenantId = session.user.tenantId;
  const now = new Date().toISOString();

  const nameParts = (customerName ?? '').split(' ');
  const firstName = nameParts[0] || null;
  const lastName = nameParts.slice(1).join(' ') || null;

  const [existing] = await db.select({ id: schema.customers.id }).from(schema.customers)
    .where(and(eq(schema.customers.tenantId, tenantId), eq(schema.customers.email, customerEmail)))
    .limit(1);

  let customerId: string;
  if (existing) {
    customerId = existing.id;
  } else {
    customerId = randomUUID();
    await db.insert(schema.customers).values({
      id: customerId, tenantId, email: customerEmail, firstName, lastName,
      createdAt: now, updatedAt: now,
    });
  }

  let orderId: string | null = null;
  if (orderNumber) {
    const [order] = await db.select({ id: schema.orders.id }).from(schema.orders)
      .where(and(eq(schema.orders.tenantId, tenantId), eq(schema.orders.orderNumber, orderNumber)))
      .limit(1);
    orderId = order?.id ?? null;
  }

  const ticketId = randomUUID();
  await db.insert(schema.tickets).values({
    id: ticketId, subject, priority, category: category || null,
    tenantId, customerId, orderId, createdAt: now, updatedAt: now,
  });

  await db.insert(schema.messages).values({
    id: randomUUID(),
    content: message,
    type: 'REPLY',
    isPublic: true,
    ticketId,
    senderName: customerName ?? customerEmail,
    senderEmail: customerEmail,
    createdAt: now,
  });

  return NextResponse.json({ id: ticketId }, { status: 201 });
}
