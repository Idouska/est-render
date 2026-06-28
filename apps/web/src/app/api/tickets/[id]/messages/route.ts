import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { z } from 'zod';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import * as schema from '@/lib/schema';
import { eq, and } from 'drizzle-orm';
import { randomUUID } from 'crypto';

const msgSchema = z.object({
  content: z.string().min(1),
  type: z.enum(['REPLY', 'NOTE', 'SYSTEM']).default('REPLY'),
  isPublic: z.boolean().default(true),
  authorId: z.string(),
});

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
  const { id } = await params;

  const [ticket] = await db.select({ id: schema.tickets.id, status: schema.tickets.status })
    .from(schema.tickets)
    .where(and(eq(schema.tickets.id, id), eq(schema.tickets.tenantId, session.user.tenantId)))
    .limit(1);

  if (!ticket) return NextResponse.json({ error: 'Introuvable' }, { status: 404 });

  const body = await req.json();
  const parsed = msgSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'Données invalides.' }, { status: 400 });

  const now = new Date().toISOString();
  const msgId = randomUUID();

  await db.insert(schema.messages).values({
    id: msgId,
    ticketId: id,
    content: parsed.data.content,
    type: parsed.data.type,
    isPublic: parsed.data.isPublic,
    authorId: parsed.data.authorId,
    createdAt: now,
  });

  if (ticket.status === 'OPEN') {
    await db.update(schema.tickets).set({ status: 'IN_PROGRESS', updatedAt: now })
      .where(eq(schema.tickets.id, id));
  }

  return NextResponse.json({ id: msgId }, { status: 201 });
}
