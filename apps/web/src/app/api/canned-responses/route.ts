import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { z } from 'zod';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import * as schema from '@/lib/schema';
import { eq, asc } from 'drizzle-orm';
import { randomUUID } from 'crypto';

const crSchema = z.object({
  title: z.string().min(1),
  content: z.string().min(1),
  category: z.string().optional(),
});

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });

  const items = await db.select().from(schema.cannedResponses)
    .where(eq(schema.cannedResponses.tenantId, session.user.tenantId))
    .orderBy(asc(schema.cannedResponses.title));

  return NextResponse.json(items);
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });

  const body = await req.json();
  const parsed = crSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'Données invalides.' }, { status: 400 });

  const now = new Date().toISOString();
  const id = randomUUID();

  await db.insert(schema.cannedResponses).values({
    id,
    title: parsed.data.title,
    content: parsed.data.content,
    category: parsed.data.category ?? null,
    tenantId: session.user.tenantId,
    createdAt: now,
    updatedAt: now,
  });

  const [item] = await db.select().from(schema.cannedResponses)
    .where(eq(schema.cannedResponses.id, id)).limit(1);

  return NextResponse.json(item, { status: 201 });
}
