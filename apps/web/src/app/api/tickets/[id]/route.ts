import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import * as schema from '@/lib/schema';
import { eq, and } from 'drizzle-orm';
import { randomUUID } from 'crypto';

interface Params { params: { id: string } }

export async function GET(_req: Request, { params }: Params) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
  const { id } = await params;

  const ticket = await db.query.tickets.findFirst({
    where: (t, { eq: e, and: a }) => a(e(t.id, id), e(t.tenantId, session.user.tenantId)),
    with: {
      customer: true,
      order: { with: { items: true } },
      agent: { columns: { id: true, name: true, email: true } },
      messages: {
        orderBy: (m, { asc }) => asc(m.createdAt),
        with: { author: { columns: { name: true } } },
      },
    },
  });

  if (!ticket) return NextResponse.json({ error: 'Introuvable' }, { status: 404 });
  return NextResponse.json(ticket);
}

export async function PATCH(req: Request, { params }: Params) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
  const { id } = await params;

  const body = await req.json();
  const allowed = ['status', 'priority', 'agentId', 'category'];
  const patch: Record<string, any> = {};

  for (const key of allowed) {
    if (key in body) patch[key] = body[key] === '' ? null : body[key];
  }

  if (patch.status === 'RESOLVED') {
    patch.resolvedAt = new Date().toISOString();
  } else if (patch.status && patch.status !== 'RESOLVED') {
    patch.resolvedAt = null;
  }

  patch.updatedAt = new Date().toISOString();

  const mapped: Record<string, any> = {};
  if ('status' in patch) mapped.status = patch.status;
  if ('priority' in patch) mapped.priority = patch.priority;
  if ('agentId' in patch) mapped.agentId = patch.agentId;
  if ('category' in patch) mapped.category = patch.category;
  if ('resolvedAt' in patch) mapped.resolvedAt = patch.resolvedAt;
  mapped.updatedAt = patch.updatedAt;

  await db.update(schema.tickets).set(mapped)
    .where(and(eq(schema.tickets.id, id), eq(schema.tickets.tenantId, session.user.tenantId)));

  if (patch.status) {
    await db.insert(schema.messages).values({
      id: randomUUID(),
      ticketId: id,
      content: `Statut changé en ${patch.status}`,
      type: 'STATUS_CHANGE',
      isPublic: false,
      authorId: session.user.id,
      createdAt: new Date().toISOString(),
    });
  }

  return NextResponse.json({ success: true });
}

export async function DELETE(_req: Request, { params }: Params) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
  const { id } = await params;

  await db.delete(schema.tickets)
    .where(and(eq(schema.tickets.id, id), eq(schema.tickets.tenantId, session.user.tenantId)));

  return NextResponse.json({ success: true });
}
