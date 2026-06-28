import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import * as schema from '@/lib/schema';
import { eq, and } from 'drizzle-orm';

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });

  const { id } = await params;
  await db.delete(schema.cannedResponses)
    .where(and(eq(schema.cannedResponses.id, id), eq(schema.cannedResponses.tenantId, session.user.tenantId)));

  return NextResponse.json({ success: true });
}
