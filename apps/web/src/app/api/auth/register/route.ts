import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { db } from '@/lib/db';
import * as schema from '@/lib/schema';
import { eq } from 'drizzle-orm';
import { slugify } from '@/lib/utils';
import { randomUUID } from 'crypto';

const registerSchema = z.object({
  name: z.string().min(2),
  shopName: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(8),
});

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const parsed = registerSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Données invalides.' }, { status: 400 });
    }

    const { name, shopName, email, password } = parsed.data;

    const [existing] = await db.select({ id: schema.users.id }).from(schema.users)
      .where(eq(schema.users.email, email)).limit(1);

    if (existing) {
      return NextResponse.json({ error: 'Cet email est déjà utilisé.' }, { status: 409 });
    }

    const hashedPassword = await bcrypt.hash(password, 12);
    let slug = slugify(shopName);

    const [slugExists] = await db.select({ id: schema.tenants.id }).from(schema.tenants)
      .where(eq(schema.tenants.slug, slug)).limit(1);
    if (slugExists) slug = `${slug}-${Date.now()}`;

    const now = new Date().toISOString();
    const tenantId = randomUUID();

    await db.insert(schema.tenants).values({
      id: tenantId,
      name: shopName,
      slug,
      plan: 'STARTER',
      createdAt: now,
      updatedAt: now,
    });

    await db.insert(schema.users).values({
      id: randomUUID(),
      name,
      email,
      password: hashedPassword,
      role: 'OWNER',
      tenantId,
      createdAt: now,
      updatedAt: now,
    });

    return NextResponse.json({ tenantId }, { status: 201 });
  } catch (err) {
    console.error('[register]', err);
    return NextResponse.json({ error: 'Erreur serveur.' }, { status: 500 });
  }
}
